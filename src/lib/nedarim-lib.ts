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
//   NEDARIM_API_VALID=mj844 (או NEDARIM_API_PASSWORD - תמיכה כפולה)
//   NEDARIM_CHARGE_ENDPOINT (אופציונלי - יש default hardcoded)
//
// ═══════════════════════════════════════════════════════════════════
// שינוי בטיחות חשוב (Fix #3):
// ═══════════════════════════════════════════════════════════════════
// כאשר יש timeout או שגיאת רשת, אנחנו לא יודעים אם נדרים כן חייבו את הלקוח.
// לפי תיעוד נדרים: "המערכת שולחת את ההודעה פעם אחת בלבד ואינה חוזרת".
// לכן במקרים כאלה מוחזר requiresManualVerification=true, וה-caller
// חייב להשאיר את ההזמנה במצב CHARGING (לא FAILED!) עד שאדם יבדוק ידנית
// אצל נדרים. אחרת ניסיון חוזר יגרום לחיוב כפול.

const DEFAULT_ENDPOINT = "https://matara.pro/nedarimplus/V6/Files/WebServices/DebitCard.aspx";
const CHARGE_URL = process.env.NEDARIM_CHARGE_ENDPOINT || DEFAULT_ENDPOINT;
const MOSAD_ID = process.env.NEDARIM_MOSAD_ID || "";
const API_VALID = process.env.NEDARIM_API_VALID || process.env.NEDARIM_API_PASSWORD || "";

const REQUEST_TIMEOUT_MS = 30000; // 30 שניות

export type ChargeParams = {
  token: string;
  tokef?: string | null; // תוקף הכרטיס בפורמט MMYY - אופציונלי כי במצב CreateToken נדרים שומרים אותו
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
  | {
      ok: false;
      error: string;
      cardProblem: boolean;
      // ⚠️ אם true: לא ידוע אם נדרים חייבו. יש להשאיר את ההזמנה ב-CHARGING
      // ולבצע בדיקה ידנית אצל נדרים לפני ניסיון חוזר!
      requiresManualVerification?: boolean;
      rawResponse?: unknown;
    };

/**
 * מחייב לקוח באמצעות Token שנשמר.
 * מחזיר {ok:true} אם החיוב הצליח, או {ok:false, ...} אם נכשל.
 *
 * דגלי כישלון:
 *   cardProblem=true → הטוקן פסול/פג-תוקף. הלקוח צריך להזין כרטיס חדש.
 *   requiresManualVerification=true → timeout או שגיאת רשת. לא ידוע אם חויב.
 *                                     חובה לבדוק אצל נדרים לפני ניסיון חוזר.
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
  // Tokef אופציונלי: במצב CreateToken נדרים שומרים את התוקף אצלם.
  // אם סופק — בודקים פורמט. אם לא — שולחים בלי Tokef.
  if (tokef && !/^\d{4}$/.test(tokef)) {
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
  if (tokef) body.set("Tokef", tokef); // אופציונלי - במצב CreateToken נדרים כבר יודעים את התוקף
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

  // ─── לוג בקשה ────────────────────────────────────────
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
    // ═══ Fix #3: timeout/network error → requiresManualVerification ═══
    // אנחנו לא יודעים אם הבקשה הגיעה לנדרים ואם הם ביצעו את החיוב.
    // חובה לבדוק ידנית באזור הניהול של נדרים לפני ניסיון חוזר.
    if (e?.name === "AbortError") {
      console.error(`[nedarim-lib] TIMEOUT after ${REQUEST_TIMEOUT_MS / 1000}s - manual verification required`);
      return {
        ok: false,
        error: `timeout after ${REQUEST_TIMEOUT_MS / 1000}s - unknown if charged at Nedarim`,
        cardProblem: false,
        requiresManualVerification: true,
      };
    }
    console.error("[nedarim-lib] NETWORK ERROR - manual verification required:", e?.message || e);
    return {
      ok: false,
      error: `network error: ${String(e?.message || e).substring(0, 300)}`,
      cardProblem: false,
      requiresManualVerification: true,
    };
  }

  // ─── HTTP-level failure ─────────────────────────────
  // תשובה התקבלה - נדרים יודעים על המצב. לא דורש בדיקה ידנית.
  if (httpStatus < 200 || httpStatus >= 300) {
    return {
      ok: false,
      error: `HTTP ${httpStatus}: ${rawText.substring(0, 300)}`,
      cardProblem: false,
      rawResponse: rawText,
    };
  }

  // ─── פרסינג של התשובה ───────────────────────────────
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
    // ═══ Fix #3 (המשך): תשובה שאי-אפשר לפרסר גם דורשת בדיקה ידנית ═══
    // כי אולי נדרים כן ביצעו את החיוב אבל התשובה מוזרה.
    console.error("[nedarim-lib] UNPARSEABLE RESPONSE - manual verification required:", rawText.substring(0, 300));
    return {
      ok: false,
      error: `unparseable response: ${rawText.substring(0, 300)}`,
      cardProblem: false,
      requiresManualVerification: true,
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
