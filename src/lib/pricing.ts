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
// singlesMode + singleUnitPrice: תמיכה בסלומון וכד' - בודדים במצב UNITS מקבלים מחיר קבוע ליחידה
// (לא לק"ג עם תוספת). Backward compatible - קוראים ישנים לא צריכים לעדכן.
export function effectiveUnitPrice(
  basePrice: number,
  isSingle: boolean,
  singleSurcharge: number,
  singlesMode?: string | null,
  singleUnitPrice?: number | null
): number {
  // בודדים במצב UNITS (סלומון וכד') - מחיר קבוע ליחידה, בלי תוספת לק"ג
  if (isSingle && singlesMode === "UNITS" && singleUnitPrice != null) {
    return Math.round(Number(singleUnitPrice) * 100) / 100;
  }
  // בודדים במצב KG (בשר) - מחיר בסיס + תוספת לק"ג
  const p = isSingle ? basePrice + singleSurcharge : basePrice;
  return Math.round(p * 100) / 100;
}

export function lineEstimate(unitPrice: number, qty: number): number {
  return Math.round(unitPrice * qty * 100) / 100;
}

// הערכת מחיר חכמה שמתחשבת במשקל ממוצע ליחידה.
// - WEIGHT (לפי ק"ג): הלקוח מזמין בק"ג ישירות, אז unitPrice × qty
// - UNIT (לפי יחידה): המחיר הוא לק"ג, אז צריך unitPrice × avgWeight × qty
//   (לדוגמה: עוף 30₪/ק"ג, משקל ממוצע 2 ק"ג, 2 יחידות = 30×2×2 = 120₪)
// - PACKAGE (מארז): המחיר הוא למארז שלם, אז unitPrice × qty
// אם אין avgWeightPerUnit ל-UNIT, נופלים חזרה ל-unitPrice × qty (התנהגות ישנה)
export function smartLineEstimate(
  unitPrice: number,
  qty: number,
  saleType: string,
  priceType: string,
  avgWeightPerUnit: number | null
): number | null {
  // מכירה ביחידה שמתומחרת לק"ג - חייבת משקל ממוצע.
  // אם חסר - מחזירים null (הקורא יציג "חסר משקל משוער") במקום לנחש.
  if (saleType === "UNIT" && priceType === "PER_KG") {
    if (!avgWeightPerUnit || avgWeightPerUnit <= 0) return null;
    return Math.round(unitPrice * avgWeightPerUnit * qty * 100) / 100;
  }
  // כל שאר המקרים: מחיר × כמות
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
