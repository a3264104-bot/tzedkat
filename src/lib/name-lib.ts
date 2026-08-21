// ═══════════════════════════════════════════════════════════════
// §173: שם פרטי ושם משפחה
// ═══════════════════════════════════════════════════════════════
// 🐛 הבעיה מהשטח: לקוחות הזינו "ברכה" בלבד, ואי אפשר היה לדעת
// אם זה שם פרטי או שם משפחה. בדף חלוקה עם 40 שורות זה הופך
// לניחוש, ובשיחת טלפון זה מביך.
//
// ⚠️ **name נשאר מקור האמת.** הוא בשימוש בכ-50 מקומות - snapshot
// על ההזמנה, מיילים, IVR, אקסל, דף חלוקה. firstName/lastName
// מתווספים לצדו ואינם מחליפים אותו.
//
// כלל ההרכבה יושב כאן ולא מפוזר: שלוש נקודות יצירת לקוח (אתר,
// נציג, מנהל) ועוד ה-IVR - ארבע גרסאות שונות של אותה לוגיקה היו
// מתפצלות ביום שמישהו משנה אחת מהן.

import { cleanName } from "@/lib/identity";

/** ⚠️ 2 תווים לפחות. "א" אינו שם, ו-1 תו עובר ולידציה נאיבית. */
const MIN_PART = 2;
const MAX_PART = 40;

export type NameParts = { firstName: string; lastName: string; name: string };

export type NameError = { ok: false; error: string };

/**
 * §173: אימות והרכבה של שם מלא.
 *
 * ⚠️ מחזיר את **שלושת** הערכים: השניים לשמירה, והשלישי לתצוגה.
 * החזרת שניים בלבד הייתה מחייבת כל קורא להרכיב בעצמו, וזה בדיוק
 * המקום שבו נוצרים הבדלים ("יוסי כהן" מול "כהן יוסי").
 */
export function buildName(
  firstRaw: string | null | undefined,
  lastRaw: string | null | undefined
): (NameParts & { ok: true }) | NameError {
  const first = cleanName(String(firstRaw ?? ""));
  const last = cleanName(String(lastRaw ?? ""));

  if (!first || first.length < MIN_PART) {
    return { ok: false, error: "יש להזין שם פרטי" };
  }
  if (!last || last.length < MIN_PART) {
    return { ok: false, error: "יש להזין שם משפחה" };
  }
  if (first.length > MAX_PART || last.length > MAX_PART) {
    return { ok: false, error: "השם ארוך מדי" };
  }

  // ⚠️ סדר: פרטי ואז משפחה, כמו בדיבור. הדף המודפס והמיילים
  // מציגים את name כמו שהוא, ולכן הסדר כאן קובע את מה שהנציג
  // רואה בחלוקה.
  return { ok: true, firstName: first, lastName: last, name: `${first} ${last}` };
}

/**
 * §173: פיצול השם לתצוגה, ללקוחות ותיקים שאין להם פיצול.
 *
 * ⚠️ **לתצוגה בלבד - לא לשמירה.** הניחוש כאן שגוי לעיתים קרובות:
 * "בן דוד יוסי" יפוצל ל"בן" + "דוד יוסי", ו"ברכה" יישאר בלי
 * משפחה. שמירת ניחוש הייתה יוצרת נתון שנראה אמין ואינו.
 *
 * מי שצריך את הפיצול האמיתי - המנהל ישלים אותו ידנית.
 */
export function displayParts(c: {
  name: string;
  firstName?: string | null;
  lastName?: string | null;
}): { first: string; last: string; needsSplit: boolean } {
  if (c.firstName && c.lastName) {
    return { first: c.firstName, last: c.lastName, needsSplit: false };
  }
  // ⚠️ needsSplit=true מסמן למסך להציג תגית "חסר פיצול", כדי
  // שהמנהל יוכל לסנן ולהשלים בהדרגה.
  return { first: c.name, last: "", needsSplit: true };
}
