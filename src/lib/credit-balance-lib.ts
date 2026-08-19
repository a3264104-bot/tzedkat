// ═══════════════════════════════════════════════════════════════
// §124: יתרת זכות למכירה הבאה
// ═══════════════════════════════════════════════════════════════
// התרחיש: ההזמנה כבר שולמה, ומגיע ללקוח זיכוי - מוצר פגום, משקל
// חסר. החזר כספי בפועל דורש התעסקות מול הסליקה, ולכן הסכום נשמר
// כיתרה ומקוזז אוטומטית בהזמנה הבאה.
//
// ⚠️ מרוכז כאן בכוונה. הקיזוז חייב לקרות בכל ערוץ הזמנה - אתר,
// טלפון, נציג, אקסל - ובאותה נוסחה בדיוק. ארבע נוסחאות נפרדות
// היו נפרדות ביום שמישהו משנה אחת מהן, והלקוח היה מקבל קיזוז
// שתלוי באיזה ערוץ הזמין.

import { fmt } from "@/lib/pricing";

export type CreditApplication = {
  /** כמה קוזז בפועל בהזמנה הזו */
  applied: number;
  /** מה נשאר ליתרה, אחרי הקיזוז */
  remaining: number;
  /** הסכום לתשלום אחרי הקיזוז */
  payable: number;
};

/**
 * חישוב הקיזוז.
 *
 * ⚠️ הקיזוז לעולם לא עולה על סכום ההזמנה. יתרה של 200 ש"ח מול
 * הזמנה של 80 מקזזת 80, ו-120 נשארים ליתרה - ולא סכום שלילי
 * שהמערכת תנסה "לחייב" מול הסליקה.
 */
export function applyCreditBalance(
  orderTotal: number,
  balance: number
): CreditApplication {
  const total = Math.max(0, Number(orderTotal) || 0);
  const bal = Math.max(0, Number(balance) || 0);

  if (bal === 0 || total === 0) {
    return { applied: 0, remaining: bal, payable: total };
  }

  const applied = Math.min(bal, total);
  return {
    applied: Math.round(applied * 100) / 100,
    remaining: Math.round((bal - applied) * 100) / 100,
    payable: Math.round((total - applied) * 100) / 100,
  };
}

/**
 * §124: הודעת יתרה ללקוח.
 *
 * ⚠️ מוחזר null כשאין יתרה. הודעה כמו "יתרת הזכות שלך: 0 ש\"ח"
 * מבלבלת יותר משהיא עוזרת, ולקוח שלא קיבל זיכוי לא צריך לדעת
 * שהמנגנון קיים בכלל.
 */
export function creditBalanceMessage(balance: number): string | null {
  const b = Number(balance) || 0;
  if (b <= 0) return null;
  return `יש לך יתרת זכות של ${fmt(b)} שתקוזז אוטומטית מההזמנה הבאה שלך.`;
}

/**
 * §124: אותה הודעה, להקראה במערכת הטלפונית.
 *
 * ⚠️ בלי סימן ש"ח ובלי נקודה עשרונית בטקסט - הפרוטוקול של ימות
 * מפצל בנקודה, ו-sayNumber מטפל בשבר בנפרד. כאן מוחזר רק המספר
 * העגול, והמילים מסביבו מוקראות כהודעה.
 */
export function creditBalanceForPhone(balance: number): number | null {
  const b = Number(balance) || 0;
  if (b <= 0) return null;
  return Math.round(b * 100) / 100;
}

/**
 * §124: קיזוז היתרה בחישוב המחיר הסופי.
 *
 * ═══════════════════════════════════════════════════════════════
 * למה כאן ולא ביצירת ההזמנה
 * ═══════════════════════════════════════════════════════════════
 * ביצירה הסכום עדיין משוער - הוא משתנה אחרי השקילה. קיזוז על
 * הערכה היה מייצר יתרה שגויה ברגע שהמשקל שונה ממה שהוערך.
 *
 * וכאן זה גם משותף לכל הערוצים: אתר, טלפון, נציג ואקסל עוברים
 * כולם דרך חישוב המחיר הסופי, ולכן די בנקודה אחת.
 *
 * ═══════════════════════════════════════════════════════════════
 * ⚠️ אידמפוטנטיות - הנקודה הקריטית
 * ═══════════════════════════════════════════════════════════════
 * חישוב המחיר הסופי רץ **בכל שקילה** - עשרות פעמים בהזמנה אחת.
 * קיזוז נאיבי היה מוריד מהיתרה בכל פעם, והלקוח היה מאבד את כל
 * הזכות שלו תוך דקות.
 *
 * הפתרון: מה שכבר קוזז בהזמנה הזו **מוחזר** ליתרה הזמינה לפני
 * החישוב מחדש. כך ריצה שנייה מגיעה לאותה תוצאה בדיוק.
 */
export async function applyBalanceToOrder(
  prisma: any,
  orderId: string,
  customerId: string,
  totalBeforeCredit: number
): Promise<{ payable: number; applied: number }> {
  const [customer, order] = await Promise.all([
    prisma.customer.findUnique({
      where: { id: customerId },
      select: { creditBalance: true },
    }),
    prisma.order.findUnique({
      where: { id: orderId },
      select: { appliedCreditBalance: true },
    }),
  ]);

  const alreadyApplied = Number(order?.appliedCreditBalance ?? 0);
  // ⚠️ מחזירים את מה שכבר קוזז לפני החישוב מחדש - זו כל
  // האידמפוטנטיות. בלי זה, כל שקילה הייתה גוזלת מהיתרה שוב.
  const available = Math.max(0, Number(customer?.creditBalance ?? 0) + alreadyApplied);

  const { applied, remaining, payable } = applyCreditBalance(
    totalBeforeCredit,
    available
  );

  // כתיבה רק כשמשהו באמת השתנה - חוסכת עדכון מיותר בכל שקילה
  if (applied !== alreadyApplied) {
    await prisma.$transaction([
      prisma.customer.update({
        where: { id: customerId },
        data: { creditBalance: remaining },
      }),
      prisma.order.update({
        where: { id: orderId },
        data: { appliedCreditBalance: applied > 0 ? applied : null },
      }),
    ]);
  }

  return { payable, applied };
}
