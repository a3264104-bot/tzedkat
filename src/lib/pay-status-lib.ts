// מיפוי סטטוסי תשלום להצגה: תווית עברית + צבע Tailwind.
// כולל 8 הסטטוסים של §19 + סטטוסים מדור קודם לתאימות היסטורית.
// (paymentStatus הוא String בסכמה, לא enum - כל הערכים חיים באותו שדה.)

export type PayStatus =
  // §19 - 8 סטטוסים חדשים
  | "PENDING"              // ממתין להזנת אשראי
  | "TOKEN_CREATED"        // Token נוצר, ממתין להמשך תהליך
  | "AWAITING_WEIGHING"    // ממתין לשקילה ע"י מנהל/נציג
  | "READY_TO_CHARGE"      // מחיר סופי נקבע - מוכן לחיוב
  | "CHARGING"             // חיוב בתהליך אצל נדרים
  | "PAID"                 // שולם בהצלחה
  | "FAILED"               // החיוב נכשל (שגיאה כללית - ניתן לנסות שוב)
  | "CARD_UPDATE_NEEDED"   // כרטיס פסול/פג-תוקף - נדרש עדכון מהלקוח
  // מדור קודם - נשמרים למיפוי הזמנות ישנות
  | "PAYMENT_PENDING"
  | "PARTIALLY_PAID"
  | "REFUNDED"
  | "CANCELLED";

export const PAY_STATUS_LABELS: Record<string, string> = {
  PENDING: "ממתין להזנת אשראי",
  TOKEN_CREATED: "כרטיס נשמר",
  AWAITING_WEIGHING: "ממתין לשקילה",
  READY_TO_CHARGE: "מוכן לחיוב",
  CHARGING: "חיוב בתהליך",
  PAID: "שולם",
  FAILED: "חיוב נכשל",
  CARD_UPDATE_NEEDED: "נדרש עדכון כרטיס",
  // legacy
  PAYMENT_PENDING: "ממתין לתשלום",
  PARTIALLY_PAID: "תשלום חלקי",
  REFUNDED: "הוחזר",
  CANCELLED: "בוטל",
};

// צבעים במסגרת Tailwind (bg + text). ה-fallback במקרה של סטטוס לא-מוכר: אפור נייטרלי + הצגת הקוד.
export const PAY_STATUS_COLORS: Record<string, string> = {
  PENDING: "bg-zinc-100 text-zinc-700",
  TOKEN_CREATED: "bg-blue-100 text-blue-700",
  AWAITING_WEIGHING: "bg-amber-100 text-amber-800",
  READY_TO_CHARGE: "bg-purple-100 text-purple-700",
  CHARGING: "bg-indigo-100 text-indigo-700",
  PAID: "bg-emerald-100 text-emerald-700",
  FAILED: "bg-red-100 text-red-700",
  CARD_UPDATE_NEEDED: "bg-orange-100 text-orange-700",
  // legacy
  PAYMENT_PENDING: "bg-yellow-100 text-yellow-800",
  PARTIALLY_PAID: "bg-yellow-100 text-yellow-800",
  REFUNDED: "bg-slate-100 text-slate-700",
  CANCELLED: "bg-zinc-100 text-zinc-500",
};

export function payStatusLabel(status: string | null | undefined): string {
  if (!status) return "—";
  return PAY_STATUS_LABELS[status] || status;
}

export function payStatusColor(status: string | null | undefined): string {
  if (!status) return "bg-zinc-100 text-zinc-500";
  return PAY_STATUS_COLORS[status] || "bg-zinc-100 text-zinc-700";
}

// האם הסטטוס דורש פעולת מנהל דחופה (להצגה בולטת ב-dashboard)?
export function payStatusNeedsAttention(status: string | null | undefined): boolean {
  if (!status) return false;
  return status === "FAILED" || status === "CARD_UPDATE_NEEDED" || status === "READY_TO_CHARGE";
}

// האם ההזמנה סגורה מבחינת תשלום (אין יותר מה לעשות איתה)?
export function payStatusIsClosed(status: string | null | undefined): boolean {
  if (!status) return false;
  return status === "PAID" || status === "REFUNDED" || status === "CANCELLED";
}
