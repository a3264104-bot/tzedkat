// חישובי מחירים משותפים — בודדים מוסיפים תוספת לק"ג

export type SaleType = "WEIGHT" | "UNIT" | "PACKAGE";

// מחזור חיים של הזמנה:
// PENDING_REVIEW -> FINAL_PRICE_SET -> PAYMENT_PENDING -> PAID -> READY_FOR_PICKUP -> COMPLETED
// (או CANCELLED בכל שלב)
export const STATUS_LABELS: Record<string, string> = {
  PENDING_REVIEW: "ממתינה לשקילה",
  FINAL_PRICE_SET: "מחיר סופי נקבע",
  PAYMENT_PENDING: "ממתינה לתשלום",
  PAID: "שולמה",
  READY_FOR_PICKUP: "מוכנה לחלוקה",
  COMPLETED: "נמסרה",
  CANCELLED: "בוטלה",
};

// כל הסטטוסים האפשריים (לסינון, לדוחות וכו')
export const STATUS_ORDER = [
  "PENDING_REVIEW",
  "FINAL_PRICE_SET",
  "PAYMENT_PENDING",
  "PAID",
  "READY_FOR_PICKUP",
  "COMPLETED",
  "CANCELLED",
];

// סטטוסים שמותר למנהל/נציג לקבוע ידנית דרך כפתורי הסטטוס הרגילים בעמוד הזמנה.
// PAID אינו ברשימה הזו בכוונה — הוא נקבע רק דרך webhook (תשלום אונליין) או
// "סימון תשלום מזומן" (טופס נפרד ומבוקר), אף פעם לא כלחיצת כפתור סטטוס חופשית.
export const MANUAL_STATUS_OPTIONS = [
  "PENDING_REVIEW",
  "FINAL_PRICE_SET",
  "READY_FOR_PICKUP",
  "COMPLETED",
  "CANCELLED",
];

// READY_FOR_PICKUP ו-COMPLETED מותרים רק אם paymentStatus=PAID
export const STATUSES_REQUIRING_PAYMENT = ["READY_FOR_PICKUP", "COMPLETED"];

export const PAYMENT_STATUS_LABELS: Record<string, string> = {
  PENDING: "טרם נקבע מחיר סופי",
  PAYMENT_PENDING: "ממתין לתשלום אונליין",
  PAID: "שולם",
  PARTIALLY_PAID: "שולם חלקית",
  FAILED: "תשלום נכשל",
  REFUNDED: "זוכה",
};

export const PAYMENT_METHOD_LABELS: Record<string, string> = {
  ONLINE: "שולם באתר",
  CASH: "שולם במזומן",
  BANK_TRANSFER: "העברה בנקאית",
  MANUAL: "סומן ידנית",
};

export const PRICELIST_STATUS: Record<string, string> = {
  DRAFT: "טיוטה",
  ACTIVE: "פעיל",
  CLOSED: "סגור",
  DONE: "הסתיים",
};

// מחיר ליחידה בהתחשב בבודדים
export function effectiveUnitPrice(
  basePrice: number,
  isSingle: boolean,
  singleSurcharge: number
): number {
  const p = isSingle ? basePrice + singleSurcharge : basePrice;
  return Math.round(p * 100) / 100;
}

export function lineEstimate(unitPrice: number, qty: number): number {
  return Math.round(unitPrice * qty * 100) / 100;
}

// קובע את paymentStatus הנכון לפי amountPaid מול finalTotal (כלל 5/6/7 מהדרישות)
export function resolvePaymentStatusFromAmount(
  amountPaid: number,
  finalTotal: number
): "PAID" | "PARTIALLY_PAID" | "OVERPAID" {
  // overpaid מטופל כ"שולם" אך מסומן בנפרד ל-UI כדי להציג אזהרה לפני אישור
  if (amountPaid > finalTotal) return "OVERPAID";
  if (amountPaid < finalTotal) return "PARTIALLY_PAID";
  return "PAID";
}

export function fmt(n: number | string | null | undefined): string {
  if (n === null || n === undefined) return "—";
  const v = typeof n === "string" ? parseFloat(n) : n;
  if (Number.isNaN(v)) return "—";
  return "₪" + v.toLocaleString("he-IL", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
