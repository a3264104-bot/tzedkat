// חישובי מחירים משותפים — בודדים מוסיפים תוספת לק"ג

export type SaleType = "WEIGHT" | "UNIT" | "PACKAGE";

export const STATUS_LABELS: Record<string, string> = {
  NEW: "חדשה",
  CONFIRMED: "אושרה",
  PROCESSING: "בטיפול",
  READY: "מוכנה לחלוקה",
  DELIVERED: "נמסרה",
  CANCELLED: "בוטלה",
};

export const STATUS_ORDER = ["NEW", "CONFIRMED", "PROCESSING", "READY", "DELIVERED", "CANCELLED"];

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

export function fmt(n: number | string | null | undefined): string {
  if (n === null || n === undefined) return "—";
  const v = typeof n === "string" ? parseFloat(n) : n;
  if (Number.isNaN(v)) return "—";
  return "₪" + v.toLocaleString("he-IL", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
