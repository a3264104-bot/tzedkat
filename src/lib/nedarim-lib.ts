// ═══════════════════════════════════════════════════════════════════
// מודול חיוב server-to-server מול נדרים פלוס - §19
// ═══════════════════════════════════════════════════════════════════
//
// ⚠️ PLACEHOLDER ⚠️
// אנחנו יודעים את MosadId + ApiPassword, אבל עדיין חסר:
//   1. כתובת ה-endpoint לחיוב חוזר עם Token
//   2. פורמט הפרמטרים בבקשה
//   3. פורמט התשובה (איך לזהות הצלחה/כישלון/כרטיס-פסול)
//
// עד שנקבל תיעוד רשמי מנדרים, chargeToken() מחזיר כישלון בכוונה
// עם cardProblem=false, error מפורש. זה מונע ממנו לסמן הזמנות
// כ-PAID בטעות ומאפשר לבנות את שאר התשתית בבטחון.
//
// כשיגיע התיעוד, מחליפים רק את גוף הפונקציה - החתימה והחוזה
// נשארים זהים, וכל שאר הקוד ממשיך לעבוד ללא שינוי.
//
// דורש env:
//   NEDARIM_MOSAD_ID=7015318
//   NEDARIM_API_PASSWORD=mj844
//   NEDARIM_CHARGE_ENDPOINT=???  (עדיין ממתין לתיעוד)

const MOSAD_ID = process.env.NEDARIM_MOSAD_ID || "";
const API_PASSWORD = process.env.NEDARIM_API_PASSWORD || "";
const CHARGE_ENDPOINT = process.env.NEDARIM_CHARGE_ENDPOINT || "";

export type ChargeResult =
  | { ok: true; transactionId: string }
  | { ok: false; error: string; cardProblem: boolean };

/**
 * מחייב לקוח באמצעות Token שנשמר.
 * @param token ה-Token שקיבלנו מנדרים בעת אימות הכרטיס
 * @param amount סכום החיוב בשקלים (מספר עם שני מקומות עשרוניים)
 * @param orderRef מזהה ההזמנה שלנו (למשל orderNumber) לתיעוד אצל נדרים
 * @returns הצלחה עם transactionId, או כישלון עם דגל cardProblem
 *          (cardProblem=true משמעו שהטוקן פסול/פג-תוקף וצריך לבקש כרטיס חדש)
 */
export async function chargeToken(
  token: string,
  amount: number,
  orderRef: string
): Promise<ChargeResult> {
  // אימות בסיסי של קלט
  if (!token) {
    return { ok: false, error: "missing token", cardProblem: true };
  }
  if (!(amount > 0)) {
    return { ok: false, error: "invalid amount", cardProblem: false };
  }
  if (!MOSAD_ID || !API_PASSWORD) {
    console.error("[nedarim-lib] Missing env: NEDARIM_MOSAD_ID or NEDARIM_API_PASSWORD");
    return { ok: false, error: "server config error", cardProblem: false };
  }

  // ═══════════════════════════════════════════════════════════════════
  // ⚠️ PLACEHOLDER - עד לקבלת תיעוד מנדרים ⚠️
  // ═══════════════════════════════════════════════════════════════════
  //
  // כשיגיע התיעוד, הקטע הזה יוחלף במשהו כזה (דוגמה בלבד - השמות המדויקים
  // של הפרמטרים והשדות בתשובה יגיעו מנדרים):
  //
  //   const params = new URLSearchParams({
  //     MosadId: MOSAD_ID,
  //     ApiPassword: API_PASSWORD,
  //     Token: token,
  //     Amount: amount.toFixed(2),
  //     Tashlumim: "1",
  //     OrderRef: orderRef,
  //   });
  //   const res = await fetch(CHARGE_ENDPOINT, {
  //     method: "POST",
  //     headers: { "Content-Type": "application/x-www-form-urlencoded" },
  //     body: params.toString(),
  //   });
  //   const data = await res.json();  // או text() אם הם מחזירים מחרוזת
  //   if (data.Status === "OK" || data.ok === true) {
  //     return { ok: true, transactionId: data.TransactionId || data.Asmachta };
  //   }
  //   const errCode = data.ErrorCode || data.Status || "";
  //   const isCardProblem =
  //     errCode === "TOKEN_INVALID" ||
  //     errCode === "CARD_EXPIRED" ||
  //     errCode === "CARD_BLOCKED";
  //   return { ok: false, error: data.ErrorMessage || errCode || "unknown", cardProblem: isCardProblem };

  console.warn(
    `[nedarim-lib] PLACEHOLDER: chargeToken called (order=${orderRef}, amount=${amount}). ` +
    `Real endpoint not yet integrated. Returning intentional failure.`
  );

  if (!CHARGE_ENDPOINT) {
    return {
      ok: false,
      error: "PLACEHOLDER: Nedarim charge endpoint not yet configured. Awaiting API documentation from Nedarim Plus.",
      cardProblem: false,
    };
  }

  // אם יום אחד ה-endpoint כן מוגדר ב-env אבל עוד לא היה מימוש - עדיין לא מבצעים חיוב.
  // רק לוגים ברורים, ומחזירים כישלון מסומן.
  return {
    ok: false,
    error: "PLACEHOLDER: implementation pending. Do not enable in production until charge body is implemented.",
    cardProblem: false,
  };
}
