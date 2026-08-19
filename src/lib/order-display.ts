// פונקציית תצוגה מרכזית של פריטי הזמנה
// זה המקום היחיד שממיר { isSingle, quantity, unit } לטקסט קריא בעברית.
// אסור להציג "X unit" גולמי במקום אחר במערכת - להשתמש בפונקציות מכאן.
//
// הסיבה: quantity משנה משמעות לפי הקונטקסט:
//   - isSingle=false + unit ק"ג/ריק → מספר קרטונים
//   - isSingle=false + unit יחידה   → מספר יחידות  ← §128
//   - isSingle=true  + unit=ק"ג     → מספר ק"ג
//   - isSingle=true  + unit=יחידה   → מספר יחידות

export type OrderItemLike = {
  isSingle: boolean;
  quantity: number | string;
  unit?: string | null;
};

// ═══════════════════════════════════════════════════════════════
// §128: היחידה של פריט שאינו בודדים
// ═══════════════════════════════════════════════════════════════
// 🐛 הבאג שחזר שוב ושוב: הקוד החזיר "קרטון" לכל פריט שאינו
// בודדים, **בלי לקרוא את unit בכלל**. מוצר שנמכר ביחידות - כבד,
// בקר טחון - הוצג ללקוח כ"2 קרטונים" במקום "2 יחידות".
//
// זה הופיע בכל מסך במערכת, כי כולם קוראים לפונקציה הזו. תיקון
// במסך בודד היה מסתיר את התסמין ומשאיר את השורש - וזו הסיבה
// שהבאג חזר.
//
// ⚠️ הכלל: unit שאינו ק"ג הוא **יחידת המכירה בפועל**. ק"ג או
// ריק פירושם שהמוצר נמכר לפי משקל ונארז בקרטונים.
const KG = 'ק"ג';

function packUnitOf(unit?: string | null): string {
  const u = (unit || "").trim();
  if (!u) return "קרטון";
  if (u === KG || u === "קג" || u === "קילו" || u === "קילוגרם") return "קרטון";
  return u;
}

// ═══════════════════════════════════════════════════════════════
// ריבוי בעברית
// ═══════════════════════════════════════════════════════════════
// ⚠️ אות סופית חייבת להשתנות לפני התוספת. "קרטון" + "ים" נותן
// "קרטוןים" - שגיאה שכבר תפסנו פעם וחזרה כאן.
const FINALS: Record<string, string> = {
  "ן": "נ",
  "ם": "מ",
  "ץ": "צ",
  "ף": "פ",
  "ך": "כ",
};

function pluralize(word: string, qty: number): string {
  if (qty === 1) return word;

  // מילים שהריבוי שלהן אינו סדיר
  const irregular: Record<string, string> = {
    "יחידה": "יחידות",
    "חבילה": "חבילות",
    "שקית": "שקיות",
    "קופסה": "קופסאות",
    "מגש": "מגשים",
    "מארז": "מארזים",
    "קרטון": "קרטונים",
  };
  if (irregular[word]) return irregular[word];

  // ⚠️ מילה שנגמרת ב-ה (נקבה) מקבלת "ות" ולא "ים":
  // "יחידה" -> "יחידות", ולא "יחידהים".
  if (word.endsWith("ה")) return word.slice(0, -1) + "ות";

  const last = word.slice(-1);
  const base = FINALS[last] ? word.slice(0, -1) + FINALS[last] : word;
  return base + "ים";
}

// מחזיר טקסט מקוצר: "1 קרטון" / "1.5 ק"ג" / "2 יחידות"
export function formatItemQty(item: OrderItemLike): string {
  const qty = Number(item.quantity);

  if (!item.isSingle) {
    // §128: היחידה נגזרת מ-unit ולא מונחת כ"קרטון"
    const u = packUnitOf(item.unit);
    return `${qty} ${pluralize(u, qty)}`;
  }

  // בודדים
  if (item.unit === "יחידה" || item.unit === "יחידות") {
    return qty === 1 ? "1 יחידה" : `${qty} יחידות`;
  }
  return `${qty} ${KG}`;
}

// מחזיר אובייקט מפורק לשימוש בעיצוב פנימי
// (מספר בנפרד, יחידה בנפרד - שימושי לbadges)
export function formatItemQtyParts(item: OrderItemLike): {
  number: string;
  label: string;
} {
  const qty = Number(item.quantity);

  if (!item.isSingle) {
    const u = packUnitOf(item.unit);
    return { number: String(qty), label: pluralize(u, qty) };
  }
  if (item.unit === "יחידה" || item.unit === "יחידות") {
    return {
      number: String(qty),
      label: qty === 1 ? "יחידה" : "יחידות",
    };
  }
  return { number: String(qty), label: KG };
}

/**
 * תגית קצרה לצד שם המוצר.
 *
 * §128: מציגה את יחידת המכירה האמיתית ולא "קרטון" קבוע. לקוח
 * שהזמין יחידות וראה תגית "קרטון" הניח שהוא הזמין משהו אחר.
 */
export function orderItemBadge(item: OrderItemLike): string {
  if (item.isSingle) return "בודדים";
  return packUnitOf(item.unit);
}

// פורמט משקל (משוער או סופי)
export function formatWeight(kg: number | string | null | undefined): string {
  if (kg == null) return "—";
  const n = Number(kg);
  if (!Number.isFinite(n) || n <= 0) return "—";
  return `${n.toFixed(1)} ${KG}`;
}
