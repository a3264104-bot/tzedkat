// §29: שיגור הודעות קוליות יזומות דרך ימות המשיח.
//
// למה: לקוח שנרשם בטלפון לרוב אין לו מייל, ולכן כל ההודעות שהמערכת
// שולחת במייל (תזכורת חלוקה, עדכון שעות) לא מגיעות אליו. הפתרון:
// אותו תוכן בדיוק, בשיחה יוצאת - "צינתוק" שמקריא את ההודעה.
//
// ⚠️ ההגדרות של ימות נדרשות: YEMOT_USER ו-YEMOT_PASSWORD במשתני הסביבה.
// בלעדיהם הפונקציה לא שולחת ומחזירה שגיאה מפורשת במקום להיכשל בשקט.

const YEMOT_API = "https://www.call2all.co.il/ym/api";

type SendResult = { ok: boolean; error?: string; skipped?: boolean };

/**
 * התחברות לימות וקבלת טוקן.
 * הטוקן תקף לזמן מוגבל, ולכן מבצעים התחברות בכל שליחה ולא שומרים.
 */
async function login(): Promise<string | null> {
  const user = process.env.YEMOT_USER;
  const pass = process.env.YEMOT_PASSWORD;
  if (!user || !pass) return null;

  try {
    const res = await fetch(
      `${YEMOT_API}/Login?username=${encodeURIComponent(user)}&password=${encodeURIComponent(pass)}`
    );
    const data = await res.json();
    return data?.token ?? null;
  } catch {
    return null;
  }
}

/**
 * ניקוי טקסט להקראה. זהה ל-sanitizeTts ב-yemot-lib:
 * נקודה, מקף, & ו-= הם מפרידים בפרוטוקול ושוברים את הבקשה.
 */
function clean(text: string): string {
  return String(text ?? "")
    .replace(/[.\-–—]/g, " ")
    .replace(/[&=]/g, " ")
    .replace(/["'`׳״]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * שיגור הודעה קולית ללקוח.
 *
 * @param phone מספר הטלפון (0501234567)
 * @param text  הטקסט שיוקרא. יוגבל ל-500 תווים - הקראה ארוכה מזה
 *              גורמת לאנשים לנתק לפני הסוף.
 */
export async function sendVoiceMessage(
  phone: string,
  text: string
): Promise<SendResult> {
  const digits = String(phone ?? "").replace(/\D/g, "");
  if (!digits) return { ok: false, error: "מספר טלפון לא תקין" };

  const token = await login();
  if (!token) {
    // לא זורקים שגיאה: המערכת צריכה להמשיך לעבוד גם בלי ההגדרות,
    // והקורא מחליט אם זו בעיה.
    return { ok: false, skipped: true, error: "חסרות הגדרות YEMOT_USER/YEMOT_PASSWORD" };
  }

  const message = `t-${clean(text).slice(0, 500)}`;

  try {
    const params = new URLSearchParams({
      token,
      phones: digits,
      message,
    });
    const res = await fetch(`${YEMOT_API}/RunCampaign?${params.toString()}`);
    const data = await res.json();
    if (data?.responseStatus === "OK") return { ok: true };
    return { ok: false, error: String(data?.message ?? "שגיאה לא ידועה מימות") };
  } catch (e: any) {
    return { ok: false, error: String(e?.message ?? e).slice(0, 300) };
  }
}

/**
 * שיגור לכמה נמענים. מחזיר סיכום ולא נופל על נמען בודד -
 * שליחה ל-50 לקוחות לא צריכה להיכשל בגלל מספר אחד שגוי.
 */
export async function sendVoiceBroadcast(
  recipients: { phone: string; text: string }[]
): Promise<{ sent: number; failed: number; skipped: boolean; errors: string[] }> {
  let sent = 0;
  let failed = 0;
  const errors: string[] = [];
  let skipped = false;

  for (const r of recipients) {
    const res = await sendVoiceMessage(r.phone, r.text);
    if (res.skipped) {
      skipped = true;
      break; // אין הגדרות - אין טעם להמשיך
    }
    if (res.ok) sent++;
    else {
      failed++;
      if (errors.length < 5) errors.push(`${r.phone}: ${res.error}`);
    }
  }

  return { sent, failed, skipped, errors };
}
