"use client";

// §65: הוספת מוצר להזמנה קיימת (סעיפים 4 ו-7 ברשימת התיקונים).
//
// ═══════════════════════════════════════════════════════════════
// סעיף 4 — שוויון מלא לאתר
// ═══════════════════════════════════════════════════════════════
// 🐛 הפער: ההוספה שלחה תמיד `{ quantity: 1, unitPrice: cartonPrice }`.
// כלומר קרטון אחד, במחיר קרטון, בלי אפשרות לבודדים ובלי לבחור כמות.
// צד השרת דווקא *כן* תמך ב-isSingle ובחישוב המחיר הנכון - רק ה-UI
// לא נתן דרך לשלוח את זה.
//
// עכשיו: בחירת סוג (קרטון / בודדים), כמות, ומחיר יחידה שמחושב
// באותה פונקציה של האתר (effectiveUnitPrice), כך שאין שתי שיטות
// תמחור שעלולות להיפרד.
//
// ═══════════════════════════════════════════════════════════════
// סעיף 7 — מוצרים לא פעילים
// ═══════════════════════════════════════════════════════════════
// מוצר שהמנהל סימן כלא-פעיל עדיין יושב במחירון עם מחיר; הוא רק
// מסונן מהתצוגה ללקוח. זה בדיוק התרחיש שתיארת: פרימיום או כמות
// מוגבלת, שהמנהל מחליט למי להביא.
//
// לכן הם מוצגים כאן בקבוצה נפרדת ומסומנת, ולא מעורבבים ברשימה -
// כדי שברור שזו החלטה ולא בחירה מקרית.

import { useMemo, useState } from "react";
import { effectiveUnitPrice, fmt } from "@/lib/pricing";

export type AddableProduct = {
  id: string;
  name: string;
  unit: string;
  cartonPrice: number | string;
  priceType?: string | null;
  allowSingles?: boolean;
  singlesMode?: string | null;
  singleUnitPrice?: number | string | null;
  avgWeightPerUnit?: number | string | null;
  isActive?: boolean;
  categoryName?: string | null;
};

export function AddOrderItem({
  products,
  singleSurcharge,
  onAdd,
  disabled,
}: {
  products: AddableProduct[];
  /** תוספת בודדים של המחירון - חייבת להיות זהה לזו שבאתר */
  singleSurcharge: number;
  onAdd: (item: {
    productId: string;
    quantity: number;
    isSingle: boolean;
    unitPrice: number;
  }) => Promise<void> | void;
  disabled?: boolean;
}) {
  const [productId, setProductId] = useState("");
  const [isSingle, setIsSingle] = useState(false);
  const [qty, setQty] = useState("1");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const selected = useMemo(
    () => products.find((p) => p.id === productId) || null,
    [products, productId]
  );

  // §7: הפרדה לשתי קבוצות. פעילים קודם - זו ברירת המחדל.
  const activeProducts = products.filter((p) => p.isActive !== false);
  const inactiveProducts = products.filter((p) => p.isActive === false);

  // מוצר שאינו מאפשר בודדים - מאפסים את הבחירה כדי שלא יישלח
  // isSingle על מוצר שלא תומך בו
  function pickProduct(id: string) {
    setProductId(id);
    setError("");
    const p = products.find((x) => x.id === id);
    if (!p?.allowSingles) setIsSingle(false);
    // בודדים בק"ג מתחילים ב-1 ק"ג, קרטונים בקרטון אחד
    setQty("1");
  }

  // המחיר מחושב באותה פונקציה של האתר. לא מחשבים כאן ידנית -
  // שתי נוסחאות תמחור נפרדות הן בדיוק איך שנוצרים פערי חיוב.
  const unitPrice = selected
    ? effectiveUnitPrice(
        Number(selected.cartonPrice),
        isSingle,
        singleSurcharge,
        selected.singlesMode || "KG",
        selected.singleUnitPrice != null ? Number(selected.singleUnitPrice) : null
      )
    : 0;

  // תווית הכמות - זהה לניסוח באתר, כדי שהמנהל והלקוח ידברו באותה שפה
  const qtyUnitLabel = !selected
    ? ""
    : isSingle
      ? selected.singlesMode === "UNITS"
        ? "יחידות"
        : 'ק"ג'
      : selected.priceType === "PER_KG"
        ? "קרטונים"
        : selected.unit || "יחידות";

  async function submit() {
    setError("");
    if (!selected) {
      setError("יש לבחור מוצר");
      return;
    }
    const n = Number(qty);
    if (!Number.isFinite(n) || n <= 0) {
      setError("כמות לא תקינה");
      return;
    }
    setBusy(true);
    try {
      await onAdd({ productId: selected.id, quantity: n, isSingle, unitPrice });
      setProductId("");
      setIsSingle(false);
      setQty("1");
    } catch (e: any) {
      setError(e?.message || "שגיאה בהוספה");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="bg-zinc-50 border border-zinc-200 rounded-xl p-3 space-y-2.5">
      <div className="text-xs font-bold text-zinc-500">➕ הוספת מוצר להזמנה</div>

      <div className="flex flex-wrap gap-2">
        <select
          className="input flex-1 min-w-[200px]"
          value={productId}
          onChange={(e) => pickProduct(e.target.value)}
          disabled={disabled || busy}
        >
          <option value="">— בחר מוצר —</option>
          {activeProducts.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
          {/* §7: קבוצה נפרדת ומסומנת. המנהל/נציג רואה שאלה מוצרים
              שאינם מוצגים ללקוחות, ובוחר מהם במודע. */}
          {inactiveProducts.length > 0 && (
            <optgroup label="── לא פעילים למכירה (לא מוצגים ללקוח) ──">
              {inactiveProducts.map((p) => (
                <option key={p.id} value={p.id}>
                  ⭐ {p.name}
                </option>
              ))}
            </optgroup>
          )}
        </select>
      </div>

      {selected && (
        <>
          {selected.isActive === false && (
            <div className="bg-violet-50 border border-violet-200 rounded-lg px-2.5 py-1.5 text-[11px] text-violet-800">
              ⭐ מוצר שאינו מוצג ללקוחות באתר. ההוספה כאן היא החלטה
              יזומה שלך עבור הלקוח הזה.
            </div>
          )}

          {/* סוג - רק אם המוצר מאפשר בודדים */}
          {selected.allowSingles && (
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => {
                  setIsSingle(false);
                  setQty("1");
                }}
                disabled={disabled || busy}
                className={`flex-1 py-2 rounded-lg border-2 text-sm font-bold transition-colors ${
                  !isSingle
                    ? "border-brand-rust bg-orange-50 text-brand-rust"
                    : "border-zinc-300 bg-white text-zinc-600"
                }`}
              >
                {selected.priceType === "PER_KG" ? "קרטון" : selected.unit || "יחידה"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setIsSingle(true);
                  setQty("1");
                }}
                disabled={disabled || busy}
                className={`flex-1 py-2 rounded-lg border-2 text-sm font-bold transition-colors ${
                  isSingle
                    ? "border-amber-600 bg-amber-50 text-amber-800"
                    : "border-zinc-300 bg-white text-zinc-600"
                }`}
              >
                {selected.singlesMode === "UNITS" ? "יחידות" : 'בודדים (ק"ג)'}
              </button>
            </div>
          )}

          <div className="flex items-end gap-2 flex-wrap">
            <div className="flex-1 min-w-[120px]">
              <label className="text-[11px] text-zinc-500 block mb-0.5">
                כמות ({qtyUnitLabel})
              </label>
              <input
                className="input"
                type="number"
                // בודדים בק"ג מאפשרים שברים; קרטונים ויחידות - שלמים
                step={isSingle && selected.singlesMode !== "UNITS" ? 0.5 : 1}
                min={0}
                dir="ltr"
                value={qty}
                onChange={(e) => setQty(e.target.value)}
                disabled={disabled || busy}
              />
            </div>
            <div className="text-xs text-zinc-600 pb-2">
              <div>
                מחיר יחידה:{" "}
                <span className="font-bold text-brand-slatedark">{fmt(unitPrice)}</span>
              </div>
              {/* מוצר שנשקל - המחיר הסופי ייקבע רק אחרי שקילה, ולכן
                  לא מציגים "סה״כ" שייראה כמו התחייבות */}
              {selected.priceType === "PER_KG" && !isSingle && (
                <div className="text-[10px] text-amber-700">
                  נשקל — הסכום ייקבע לאחר שקילה
                </div>
              )}
            </div>
            <button
              type="button"
              onClick={submit}
              disabled={disabled || busy || !productId}
              className="btn-primary btn-sm"
            >
              {busy ? "מוסיף..." : "הוסף"}
            </button>
          </div>
        </>
      )}

      {error && <p className="text-red-600 text-xs">{error}</p>}
    </div>
  );
}
