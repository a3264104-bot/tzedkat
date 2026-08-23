// ═══════════════════════════════════════════════════════════════
// §200: פורמט תאריכים בשעון ישראל
// ═══════════════════════════════════════════════════════════════
// 🐛 הבאג: השרת ב-Vercel רץ ב-UTC. כל `toLocaleString("he-IL")`
// ב-server component פורמט לפי שעון השרת, ולכן הציג **3 שעות
// אחורה** (2 בשעון חורף).
//
// הדוגמה מהשטח: מכירה שנסגרת ב-09:00 הוצגה כ-"06:00", בזמן
// שהספירה לאחור הראתה 50 דקות. הספירה הייתה נכונה - היא מחשבת
// הפרש בין זמנים מוחלטים - והתצוגה שגויה.
//
// ⚠️ למה לא TZ=Asia/Jerusalem ב-Vercel: זה שם שמור אצלם ואי
// אפשר להגדיר אותו. לכן אזור הזמן מצוין מפורשות בכל קריאה.
//
// ⚠️ שימוש: **בכל מקום** שמציג תאריך למשתמש. מספיק מקום אחד
// שישכח, והוא יציג 3 שעות אחורה בלי שאיש ישים לב - בדיוק כמו
// שקרה עד עכשיו.

/**
 * אזור הזמן של המערכת. כל הלקוחות בישראל, ולכן זה קבוע.
 *
 * ⚠️ מחרוזת IANA ולא היסט מספרי: היא מטפלת לבד במעבר שעון
 * קיץ/חורף, שבישראל זז פעמיים בשנה. היסט קשיח היה נכון חצי שנה.
 */
export const TZ = "Asia/Jerusalem";

type DateInput = Date | string | number | null | undefined;

function toDate(d: DateInput): Date | null {
  if (d === null || d === undefined || d === "") return null;
  const dt = d instanceof Date ? d : new Date(d);
  return Number.isNaN(dt.getTime()) ? null : dt;
}

/** תאריך ושעה מלאים: "23.08.2026, 09:00" */
export function fmtDateTime(d: DateInput, fallback = "—"): string {
  const dt = toDate(d);
  if (!dt) return fallback;
  return dt.toLocaleString("he-IL", {
    timeZone: TZ,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** תאריך בלבד: "23.08.2026" */
export function fmtDate(d: DateInput, fallback = "—"): string {
  const dt = toDate(d);
  if (!dt) return fallback;
  return dt.toLocaleDateString("he-IL", {
    timeZone: TZ,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

/** שעה בלבד: "09:00" */
export function fmtTime(d: DateInput, fallback = "—"): string {
  const dt = toDate(d);
  if (!dt) return fallback;
  return dt.toLocaleTimeString("he-IL", {
    timeZone: TZ,
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** יום בשבוע + תאריך + שעה: "יום ראשון, 23.08.2026, 09:00" */
export function fmtFull(d: DateInput, fallback = "—"): string {
  const dt = toDate(d);
  if (!dt) return fallback;
  return dt.toLocaleString("he-IL", {
    timeZone: TZ,
    weekday: "long",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * §200: ערך לשדה datetime-local.
 *
 * 🐛 הבאג המקורי: `iso.slice(0, 16)` חתך את מחרוזת ה-UTC כמו
 * שהיא. המנהל קבע 21:00, נשמר 18:00Z, ובטעינה מחדש הוצג 18:00 -
 * וכל עריכה הזיזה עוד 3 שעות אחורה.
 *
 * ⚠️ הפונקציה בונה את המחרוזת מהחלקים בשעון ישראל, במקום לחתוך
 * ISO. כך היא נכונה גם בשרת (UTC) וגם בדפדפן.
 */
export function toDateTimeLocal(d: DateInput): string {
  const dt = toDate(d);
  if (!dt) return "";
  // en-CA נותן YYYY-MM-DD, שזה בדיוק הפורמט ש-datetime-local רוצה
  const date = dt.toLocaleDateString("en-CA", { timeZone: TZ });
  const time = dt.toLocaleTimeString("en-GB", {
    timeZone: TZ,
    hour: "2-digit",
    minute: "2-digit",
  });
  return `${date}T${time}`;
}

/**
 * §200: המרת ערך מ-datetime-local ל-ISO, בהנחה שהוא בשעון ישראל.
 *
 * ⚠️ בדפדפן `new Date("2026-09-01T21:00")` כבר מפרש לפי השעון
 * המקומי, ולכן זה נכון. הפונקציה כאן להשלמה ולשימוש בשרת, שם
 * הפירוש היה יוצא UTC.
 */
export function fromDateTimeLocal(value: string | null | undefined): string | null {
  if (!value) return null;
  // מחשבים את ההיסט של ישראל **באותו תאריך** - כדי שיהיה נכון
  // גם בשעון קיץ וגם בחורף.
  const naive = new Date(value + ":00Z"); // מפרשים כ-UTC זמנית
  if (Number.isNaN(naive.getTime())) return null;
  const asIsrael = new Date(
    naive.toLocaleString("en-US", { timeZone: TZ })
  );
  const asUtc = new Date(naive.toLocaleString("en-US", { timeZone: "UTC" }));
  const offset = asIsrael.getTime() - asUtc.getTime();
  return new Date(naive.getTime() - offset).toISOString();
}
