// ═══════════════════════════════════════════════════════════════
// §401: 💵 לקוח מזומן — קבוע, או למכירה אחת בלבד
// ═══════════════════════════════════════════════════════════════
// מקור אחד לשאלה "האם הלקוח משלם מזומן במכירה הזו":
//   ⭐ קבוע    — paymentPreference = "CASH" (עד שהמנהל/נציג משנה)
//   💵 מכירה   — cashPricelistId = המכירה הזו בלבד
//
// ⚠️ מזומן-למכירה **לא** משנה את paymentPreference. כל מקום שלא
// יודע על המכירה (דוחות, מסך לקוחות, IVR במכירה הבאה) רואה לקוח
// אשראי — וזו בדיוק הכוונה.

export type CashFields = {
  paymentPreference?: string | null;
  cashPricelistId?: string | null;
};

/** ⭐ לקוח מזומן קבוע */
export function isPermanentCash(c: CashFields | null | undefined): boolean {
  return c?.paymentPreference === "CASH";
}

/** 💵 מזומן רק במכירה הזו (ולא קבוע) */
export function isSaleOnlyCash(
  c: CashFields | null | undefined,
  pricelistId: string | null | undefined
): boolean {
  return (
    !!c &&
    !isPermanentCash(c) &&
    !!pricelistId &&
    !!c.cashPricelistId &&
    c.cashPricelistId === pricelistId
  );
}

/** האם הלקוח משלם מזומן במכירה הזו (קבוע או למכירה) */
export function isCashFor(
  c: CashFields | null | undefined,
  pricelistId: string | null | undefined
): boolean {
  return isPermanentCash(c) || isSaleOnlyCash(c, pricelistId);
}

/**
 * אמצעי התשלום להזמנה חדשה.
 *
 * ⚠️ מזומן-למכירה → "MANUAL" על ההזמנה: זה הערך של §332 (בורר
 * "מזומן להזמנה זו"), וכל המסכים כבר מכירים אותו — החיוב הקבוצתי
 * מדלג, מסך התשלומים מציג "שילם במזומן", חשבון הנציג סופר נכון.
 * לקוח קבוע — כמו עד היום (ההעדפה שלו מספיקה).
 */
export function newOrderPaymentMethod(
  c: CashFields | null | undefined,
  pricelistId: string | null | undefined
): "MANUAL" | undefined {
  return isSaleOnlyCash(c, pricelistId) ? "MANUAL" : undefined;
}
