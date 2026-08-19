"use client";

// §120: הוספת תוספת להזמנה שכבר חויבה.
//
// ═══════════════════════════════════════════════════════════════
// למה זה קיים
// ═══════════════════════════════════════════════════════════════
// ההזמנה נשקלה וחויבה, ובחלוקה הלקוח מבקש עוד משהו. הוספה
// להזמנה המקורית הייתה יוצרת חוב שלא ייגבה - החיוב כבר יצא.
//
// כאן נוצרת הזמנה נפרדת, קשורה למקורית, שנגבית בנפרד.
//
// ⚠️ שני מסלולי תשלום, ושניהם חייבים להיות זמינים:
//   • אשראי - הכרטיס השמור
//   • מזומן - הלקוח משלם במקום
// לקוח בלי כרטיס שלא יכול לשלם במזומן היה יוצר בדיוק את החוב
// שהמערכת נבנתה כדי לסיים.

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { effectiveUnitPrice, fmt } from "@/lib/pricing";
import type { AddableProduct } from "@/components/AddOrderItem";

export function AddSupplement({
  parentOrderId,
  parentOrderNumber,
  customerName,
  hasCard,
  products,
  singleSurcharge,
  onDone,
}: {
  parentOrderId: string;
  parentOrderNumber: number;
  customerName: string;
  /** האם ללקוח יש כרטיס שמור - קובע אילו מסלולי תשלום זמינים */
  hasCard: boolean;
  products: AddableProduct[];
  singleSurcharge: number;
  /**
   * §120: אופציונלי - הדף שמארח את הרכיב הוא server component
   * ואינו יכול להעביר פונקציה. הרכיב מציג בעצמו את אישור ההצלחה
   * עם מספר ההזמנה שנוצרה, ולכן אין תלות ברענון חיצוני.
   */
  onDone?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [productId, setProductId] = useState("");
  const [isSingle, setIsSingle] = useState(false);
  const [qty, setQty] = useState("1");
  const [customPrice, setCustomPrice] = useState("");
  // ברירת המחדל: מזומן אם אין כרטיס. אחרת אשראי.
  const [payCash, setPayCash] = useState(!hasCard);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState<{ n: number; total: number } | null>(null);
  const router = useRouter();

  const selected = useMemo(
    () => products.find((p) => p.id === productId) || null,
    [products, productId]
  );

  const regular = products.filter((p) => !p.isFavorite && p.isActive !== false);
  const favorites = products.filter((p) => p.isFavorite);

  const unitPrice = selected
    ? effectiveUnitPrice(
        Number(selected.cartonPrice),
        isSingle,
        singleSurcharge,
        selected.singlesMode || "KG",
        selected.singleUnitPrice != null ? Number(selected.singleUnitPrice) : null
      )
    : 0;

  const charged = customPrice !== "" ? Number(customPrice) : unitPrice;
  const estTotal = Number(qty) > 0 ? charged * Number(qty) : 0;

  async function submit() {
    setError("");
    if (!selected) return setError("יש לבחור מוצר");
    const n = Number(qty);
    if (!Number.isFinite(n) || n <= 0) return setError("כמות לא תקינה");
    if (customPrice !== "" && Number(customPrice) < unitPrice) {
      return setError(`לא ניתן לקבוע מחיר נמוך מהמחירון (${unitPrice.toFixed(2)} ₪)`);
    }

    setBusy(true);
    try {
      const res = await fetch("/api/agent/supplement", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          parentOrderId,
          productId: selected.id,
          quantity: n,
          isSingle,
          agentSetPrice:
            selected.isFavorite && customPrice !== "" ? Number(customPrice) : null,
          payCash,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "שגיאה");
      setDone({ n: data.orderNumber, total: data.estimatedTotal });
      setProductId("");
      setQty("1");
      setCustomPrice("");
      onDone?.();
      // §120: רענון נתוני השרת. בלעדיו הנציג רואה "נוצרה הזמנה
      // #518" אבל המסך עדיין מציג את המצב הישן - והוא עלול
      // ללחוץ שוב ולייצר כפילות.
      router.refresh();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div className="bg-emerald-50 border-2 border-emerald-300 rounded-xl p-3">
        <div className="font-bold text-emerald-800 text-sm">
          ✓ נוצרה הזמנת תוספת #{done.n}
        </div>
        <div className="text-xs text-emerald-700 mt-0.5">
          תוספת להזמנה #{parentOrderNumber} · {fmt(done.total)} משוער
          {payCash ? " · תשלום במזומן" : " · תחויב בכרטיס אחרי השקילה"}
        </div>
        <button
          onClick={() => {
            setDone(null);
            setOpen(false);
          }}
          className="btn-ghost btn-sm mt-2"
        >
          סגור
        </button>
      </div>
    );
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="w-full py-2.5 rounded-xl border-2 border-brand-rust text-brand-rust font-bold text-sm hover:bg-orange-50"
      >
        ➕ הוספת מוצר בחלוקה (הזמנה נפרדת)
      </button>
    );
  }

  return (
    <div className="bg-orange-50 border-2 border-brand-rust rounded-xl p-3 space-y-2.5">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="font-bold text-brand-slatedark text-sm">
            תוספת ל{customerName}
          </div>
          {/* ⚠️ ההסבר הזה חיוני: הנציג צריך להבין שזו הזמנה נוספת
              ולא עריכה, אחרת הוא יחשוב שהוא הכפיל בטעות. */}
          <div className="text-[11px] text-zinc-600 leading-relaxed">
            ההזמנה #{parentOrderNumber} כבר תומחרה, ולכן התוספת נוצרת כהזמנה
            נפרדת שתיגבה בנפרד. היא תופיע מקושרת למקורית.
          </div>
        </div>
        <button onClick={() => setOpen(false)} className="text-zinc-400 text-xl leading-none px-1">
          ×
        </button>
      </div>

      <select
        className="input w-full"
        value={productId}
        onChange={(e) => {
          setProductId(e.target.value);
          setCustomPrice("");
          const p = products.find((x) => x.id === e.target.value);
          if (!p?.allowSingles) setIsSingle(false);
        }}
        disabled={busy}
      >
        <option value="">— בחר מוצר —</option>
        {regular.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
        {favorites.length > 0 && (
          <optgroup label="── ⭐ מוצרים מועדפים ──">
            {favorites.map((p) => (
              <option key={p.id} value={p.id}>
                ⭐ {p.name}
              </option>
            ))}
          </optgroup>
        )}
      </select>

      {selected && (
        <>
          {selected.allowSingles && (
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setIsSingle(false)}
                className={`flex-1 py-1.5 rounded-lg border-2 text-xs font-bold ${
                  !isSingle ? "border-brand-rust bg-white text-brand-rust" : "border-zinc-300 bg-white text-zinc-500"
                }`}
              >
                {selected.priceType === "PER_KG" ? "קרטון" : selected.unit || "יחידה"}
              </button>
              <button
                type="button"
                onClick={() => setIsSingle(true)}
                className={`flex-1 py-1.5 rounded-lg border-2 text-xs font-bold ${
                  isSingle ? "border-amber-600 bg-white text-amber-800" : "border-zinc-300 bg-white text-zinc-500"
                }`}
              >
                {selected.singlesMode === "UNITS" ? "יחידות" : 'בודדים (ק"ג)'}
              </button>
            </div>
          )}

          {/* §119: תמחור עצמי במוצר מועדף */}
          {selected.isFavorite && (
            <div className="bg-white border-2 border-amber-300 rounded-lg p-2 space-y-1">
              <div className="text-[11px] font-bold text-amber-900">
                ⭐ ניתן לקבוע מחיר גבוה יותר
              </div>
              <input
                className="input w-full"
                type="number"
                step="0.01"
                min={unitPrice}
                dir="ltr"
                placeholder={`מחירון: ${unitPrice.toFixed(2)}`}
                value={customPrice}
                onChange={(e) => setCustomPrice(e.target.value)}
                disabled={busy}
              />
              {customPrice !== "" && Number(customPrice) >= unitPrice && (
                <div className="text-[11px] text-emerald-800 font-bold">
                  העמלה שלך: {(Number(customPrice) - (unitPrice - 1)).toFixed(2)} ₪ לק&quot;ג
                </div>
              )}
            </div>
          )}

          <div className="flex items-end gap-2">
            <div className="flex-1">
              <label className="text-[11px] text-zinc-600 block mb-0.5">כמות</label>
              <input
                className="input w-full"
                type="number"
                step={isSingle && selected.singlesMode !== "UNITS" ? 0.5 : 1}
                min={0}
                dir="ltr"
                value={qty}
                onChange={(e) => setQty(e.target.value)}
                disabled={busy}
              />
            </div>
            <div className="text-xs text-zinc-700 pb-2">
              <div>
                משוער: <b className="text-brand-rust">{fmt(estTotal)}</b>
              </div>
            </div>
          </div>

          {/* ─── אופן התשלום ─── */}
          <div>
            <div className="text-[11px] font-bold text-zinc-600 mb-1">אופן תשלום</div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setPayCash(false)}
                disabled={!hasCard || busy}
                title={!hasCard ? "ללקוח אין כרטיס שמור" : undefined}
                className={`flex-1 py-2 rounded-lg border-2 text-xs font-bold disabled:opacity-40 ${
                  !payCash ? "border-emerald-500 bg-emerald-50 text-emerald-800" : "border-zinc-300 bg-white text-zinc-500"
                }`}
              >
                💳 אשראי
              </button>
              <button
                type="button"
                onClick={() => setPayCash(true)}
                disabled={busy}
                className={`flex-1 py-2 rounded-lg border-2 text-xs font-bold ${
                  payCash ? "border-amber-500 bg-amber-50 text-amber-800" : "border-zinc-300 bg-white text-zinc-500"
                }`}
              >
                💵 מזומן
              </button>
            </div>
            {!hasCard && (
              <p className="text-[11px] text-amber-800 mt-1">
                ללקוח אין כרטיס שמור — התשלום חייב להיות במזומן.
              </p>
            )}
          </div>
        </>
      )}

      {error && <p className="text-red-700 text-xs font-medium">{error}</p>}

      <button
        type="button"
        onClick={submit}
        disabled={busy || !productId}
        className="w-full py-2.5 rounded-xl bg-brand-rust text-white font-bold text-sm disabled:opacity-40"
      >
        {busy ? "יוצר…" : "צור הזמנת תוספת"}
      </button>

      <p className="text-[10px] text-zinc-500 leading-relaxed">
        המשקל יוזן בטבלת המשקלים כרגיל, והמחיר הסופי ייקבע לפי השקילה.
      </p>
    </div>
  );
}
