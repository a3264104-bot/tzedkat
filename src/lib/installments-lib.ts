// ═══════════════════════════════════════════════════════════════
// §296: פריסה לתשלומים — מקור אמת יחיד
// ═══════════════════════════════════════════════════════════════
// למה כאן: הרשימה הופיעה בשלושה מסכים ובשני מסלולי שרת, כל אחד
// עם עותק משלו. ביום שמישהו יוסיף 18 תשלומים לאחד מהם, השאר
// יישארו מאחור - והנציג ישמור ערך שהחיוב ידחה.
//
// ⚠️ והתקרה שונה לפי תפקיד: המנהל עד 12, הנציג עד 2.
//
// פריסה ארוכה היא החלטה עסקית - היא דוחה את הכסף בחודשים
// ומגדילה את החשיפה. הנציג בשטח מקבל בקשה מלקוח ומאשר במקום,
// בלי לראות את התמונה הכוללת.
//
// ⚠️ שתי אפשרויות לנציג ולא אחת: לקוח שמבקש לחלק לשניים בחלוקה
// הוא מקרה שכיח, ושליחתו למנהל על כל בקשה כזו הופכת את הנציג
// למתווך מיותר.

/** כל האפשרויות — התקרה של המנהל */
export const INSTALLMENT_OPTIONS = [1, 2, 3, 4, 6, 10, 12];

/** התקרה של נציג */
export const AGENT_MAX_INSTALLMENTS = 2;

/**
 * האפשרויות שמותרות לתפקיד נתון.
 *
 * ⚠️ הבורר במסך נגזר מכאן, וכך גם האימות בשרת. שתי רשימות
 * שונות היו יוצרות מצב שהמשתמש בוחר ערך ואז נכשל, בלי להבין
 * למה.
 */
export function installmentOptionsFor(isAdmin: boolean): number[] {
  return isAdmin
    ? INSTALLMENT_OPTIONS
    : INSTALLMENT_OPTIONS.filter((n) => n <= AGENT_MAX_INSTALLMENTS);
}

/**
 * אימות בשרת.
 *
 * ⚠️ בורר במסך אינו הרשאה - בקשה ידנית עוקפת אותו. זה הדפוס
 * שנתפס ב-§221 (מחירון נציגים) וב-§289 (נקודות סמויות).
 *
 * @returns null אם תקין, אחרת הודעת שגיאה
 */
export function validateInstallments(
  n: unknown,
  isAdmin: boolean
): string | null {
  const num = Number(n);
  if (!Number.isInteger(num) || !INSTALLMENT_OPTIONS.includes(num)) {
    return `מספר תשלומים לא תקין. מותר: ${INSTALLMENT_OPTIONS.join(", ")}`;
  }
  if (!isAdmin && num > AGENT_MAX_INSTALLMENTS) {
    return `נציג יכול לפרוס עד ${AGENT_MAX_INSTALLMENTS} תשלומים. לפריסה ארוכה יותר יש לפנות למנהל.`;
  }
  return null;
}

/**
 * §296: פיצול הסכום לתשלומים, עם העיגול בתשלום האחרון.
 *
 * ⚠️ נדרש כי 849.80 ל-3 אינו מתחלק: 283.27 + 283.27 + 283.26.
 * הצגת "283.27 × 3" הייתה מטעה ב-אגורה, והלקוח שמשווה לחיוב
 * בכרטיס רואה הפרש.
 */
export function splitInstallments(total: number, n: number): number[] {
  if (n <= 1) return [Math.round(total * 100) / 100];
  const each = Math.floor((total / n) * 100) / 100;
  const parts = Array(n - 1).fill(each);
  const last = Math.round((total - each * (n - 1)) * 100) / 100;
  return [...parts, last];
}
