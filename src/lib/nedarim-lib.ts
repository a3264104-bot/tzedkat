// ═══════════════════════════════════════════════════════════════════
// מודול חיוב server-to-server מול נדרים פלוס - §19
// מומש לפי תיעוד רשמי של נדרים (DebitCard.aspx)
// ═══════════════════════════════════════════════════════════════════
//
// endpoint: https://matara.pro/nedarimplus/V6/Files/WebServices/DebitCard.aspx
// method: POST, application/x-www-form-urlencoded
// אימות: Mosad + ApiValid
//
// דורש env:
//   NEDARIM_MOSAD_ID=7015318
//   NEDARIM_API_VALID=mj844
//   NEDARIM_CHARGE_ENDPOINT (אופציונלי - יש default hardcoded)

const DEFAULT_ENDPOINT = "https://matara.pro/nedarimplus/V6/Files/WebServices/DebitCard.aspx";
const CHARGE_URL = process.env.NEDARIM_CHARGE_ENDPOINT || DEFAULT_ENDPOINT;
const MOSAD_ID = process.env.NEDARIM_MOSAD_ID || "";
// תמיכה בשני שמות: NEDARIM_API_VALID (שם רשמי) או NEDARIM_API_PASSWORD (השם הישן שהוגדר)
const API_VALID = process.env.NEDARIM_API_VALID || process.env.NEDARIM_API_PASSWORD || "";

const REQUEST_TIMEOUT_MS = 30000; // 30 שניות

export type ChargeParams = {
  token: string;
  tokef: string; // תוקף הכרטיס בפורמט MMYY (למשל "1228")
  amount: number;
  orderRef: string; // מספר הזמנה שלנו לתיעוד אצל נדרים
  clientName?: string;
  phone?: string;
  email?: string;
  address?: string;
  zeout?: string; // ת"ז
  tashloumim?: number; // מספר תשלומים, ברירת מחדל 1
};

export type ChargeResult =
  | { ok: true; transactionId: string; rawResponse?: unknown }
  | { ok: false; error: string; cardProblem: boolean; rawResponse?: unknown };

/**
 * מחייב לקוח באמצעות Token שנשמר.
 * מחזיר {ok:true} אם החיוב הצליח, או {ok:false, cardProblem} אם נכשל.
 * cardProblem=true משמעו שהטוקן פסול/פג-תוקף - יש לבקש כרטיס חדש.
 */
export async function chargeToken(params: ChargeParams): Promise<ChargeResult> {
  const {
    token,
    tokef,
    amount,
    orderRef,
    clientName,
    phone,
    email,
    address,
    zeout,
    tashloumim = 1,
  } = params;

  // ─── בדיקות קלט ─────────────────────────────────────
  if (!token) {
    return { ok: false, error: "missing token", cardProblem: true };
  }
  if (!tokef || !/^\d{4}$/.test(tokef)) {
    return {
      ok: false,
      error: `invalid Tokef format (expected MMYY, got "${tokef}")`,
      cardProblem: true,
    };
  }
  if (!(amount > 0)) {
    return { ok: false, error: "invalid amount", cardProblem: false };
  }
  if (!MOSAD_ID || !API_VALID) {
    console.error("[nedarim-lib] Missing env: NEDARIM_MOSAD_ID or NEDARIM_API_VALID");
    return { ok: false, error: "server config error (missing credentials)", cardProblem: false };
  }

  // ─── בניית גוף הבקשה ─────────────────────────────────
  const body = new URLSearchParams();
  body.set("Mosad", MOSAD_ID);
  body.set("ApiValid", API_VALID);
  body.set("Token", token);
  body.set("Tokef", tokef);
  body.set("Amount", amount.toFixed(2));
  body.set("Tashloumim", String(tashloumim));
  body.set("Currency", "1"); // 1 = ש"ח
  body.set("Avour", `הזמנה #${orderRef}`);
  body.set("Groupe", "הזמנות");

  if (clientName) body.set("ClientName", clientName);
  if (phone) body.set("Phone", phone);
  if (email) body.set("Mail", email);
  if (address) body.set("Adresse", address);
  if (zeout) body.set("Zeout", zeout);

  // ─── לוג בקשה (בלי לחשוף את הטוקן המלא) ────────────
  const tokenPreview = token.length > 8 ? token.substring(0, 4) + "..." + token.slice(-4) : "***";
  console.log("[nedarim-lib] Charge request:", {
    endpoint: CHARGE_URL,
    Mosad: MOSAD_ID,
    Token: tokenPreview,
    Tokef: tokef,
    Amount: amount.toFixed(2),
    Tashloumim: tashloumim,
    orderRef,
  });

  // ─── שליחת הבקשה עם timeout ─────────────────────────
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let rawText = "";
  let httpStatus = 0;

  try {
    const res = await fetch(CHARGE_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: body.toString(),
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    httpStatus = res.status;
    rawText = await res.text();

    console.log("[nedarim-lib] Charge response:", {
      status: httpStatus,
      bodyLength: rawText.length,
      bodyPreview: rawText.substring(0, 500),
    });
  } catch (e: any) {
    clearTimeout(timeoutId);
    if (e?.name === "AbortError") {
      return { ok: false, error: `timeout after ${REQUEST_TIMEOUT_MS / 1000}s`, cardProblem: false };
    }
    return {
      ok: false,
      error: `network error: ${String(e?.message || e).substring(0, 300)}`,
      cardProblem: false,
    };
  }

  // ─── HTTP-level failure ─────────────────────────────
  if (httpStatus < 200 || httpStatus >= 300) {
    return {
      ok: false,
      error: `HTTP ${httpStatus}: ${rawText.substring(0, 300)}`,
      cardProblem: false,
      rawResponse: rawText,
    };
  }

  // ─── פרסינג של התשובה ───────────────────────────────
  // נסה JSON קודם (התיעוד אומר application/json)
  let data: Record<string, any> = {};
  let parsed = false;
  try {
    data = JSON.parse(rawText);
    parsed = true;
  } catch {
    // נכשל - נסה form-urlencoded fallback
    if (rawText.includes("=")) {
      for (const pair of rawText.split("&")) {
        const [k, v] = pair.split("=");
        if (k) {
          try {
            data[decodeURIComponent(k.trim())] = decodeURIComponent((v ?? "").trim());
          } catch {
            data[k.trim()] = (v ?? "").trim();
          }
        }
      }
      parsed = Object.keys(data).length > 0;
    }
  }

  if (!parsed) {
    return {
      ok: false,
      error: `unparseable response: ${rawText.substring(0, 300)}`,
      cardProblem: false,
      rawResponse: rawText,
    };
  }

  // ─── זיהוי הצלחה: TransactionId קיים ולא ריק ─────────
  const transactionId = String(
    data.TransactionId ||
      data.transactionId ||
      data.Numero ||
      data.numero ||
      data.Asmachta ||
      ""
  ).trim();

  if (transactionId && transactionId !== "0") {
    // ✓ הצלחה
    return {
      ok: true,
      transactionId,
      rawResponse: data,
    };
  }

  // ─── כישלון: חילוץ הודעת שגיאה ─────────────────────
  const errorMessage = String(
    data.ErrorMessage ||
      data.errorMessage ||
      data.Message ||
      data.message ||
      data.Error ||
      data.error ||
      data.Status ||
      data.status ||
      `charge rejected (no TransactionId in response): ${rawText.substring(0, 200)}`
  );

  // ─── זיהוי בעיית כרטיס לפי מילות מפתח ────────────────
  const lowerText = rawText.toLowerCase();
  const lowerError = errorMessage.toLowerCase();
  const combined = `${lowerText} ${lowerError}`;
  const cardProblemKeywords = [
    "expired",
    "declined",
    "invalid card",
    "card blocked",
    "בוטל",
    "פסול",
    "פג תוקף",
    "פג-תוקף",
    "לא תקין",
    "נחסם",
    "כרטיס לא",
  ];
  const cardProblem = cardProblemKeywords.some((k) => combined.includes(k));

  return {
    ok: false,
    error: errorMessage.substring(0, 500),
    cardProblem,
    rawResponse: data,
  };
}
