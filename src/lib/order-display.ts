// פונקציית תצוגה מרכזית של פריטי הזמנה
// זה המקום היחיד שממיר { isSingle, quantity, unit } לטקסט קריא בעברית.
// אסור להציג "X unit" גולמי במקום אחר במערכת - להשתמש בפונקציות מכאן.
//
// הסיבה: quantity משנה משמעות לפי הקונטקסט:
//   - isSingle=false           → מספר קרטונים
//   - isSingle=true + unit=ק"ג  → מספר ק"ג
//   - isSingle=true + unit=יחידה → מספר יחידות
//
// כל מסך שהציג {quantity} {unit} בלי הבחנה היה יוצר בלבול (כמו "11 יח'" במקום "11 ק"ג").

export type OrderItemLike = {
  isSingle: boolean;
  quantity: number | string;
  unit?: string | null;
};

// מחזיר טקסט מקוצר: "1 קרטון" / "1.5 ק"ג" / "2 יחידות"
export function formatItemQty(item: OrderItemLike): string {
  const qty = Number(item.quantity);
  if (!item.isSingle) {
    return qty === 1 ? "1 קרטון" : `${qty} קרטונים`;
  }
  // בודדים
  if (item.unit === "יחידה" || item.unit === "יחידות") {
    return qty === 1 ? "1 יחידה" : `${qty} יחידות`;
  }
  return `${qty} ק"ג`;
}

// מחזיר אובייקט מפורק לשימוש בעיצוב פנימי
// (מספר בנפרד, יחידה בנפרד - שימושי לbadges)
export function formatItemQtyParts(item: OrderItemLike): {
  number: string;
  label: string;
} {
  const qty = Number(item.quantity);
  if (!item.isSingle) {
    return {
      number: String(qty),
      label: qty === 1 ? "קרטון" : "קרטונים",
    };
  }
  if (item.unit === "יחידה" || item.unit === "יחידות") {
    return {
      number: String(qty),
      label: qty === 1 ? "יחידה" : "יחידות",
    };
  }
  return { number: String(qty), label: 'ק"ג' };
}

// מחזיר badge label - "קרטון" או "בודדים"
export function orderItemBadge(item: OrderItemLike): "קרטון" | "בודדים" {
  return item.isSingle ? "בודדים" : "קרטון";
}

// פורמט משקל (משוער או סופי)
export function formatWeight(kg: number | string | null | undefined): string {
  if (kg == null) return "—";
  const n = Number(kg);
  if (!Number.isFinite(n) || n <= 0) return "—";
  return `${n.toFixed(1)} ק"ג`;
}
