"use client";

// §20: תצוגת טבלה מהירה (Excel-like) להזנת משקלים
// - כל שורה = פריט (לא לקוח)
// - שם ומספר הזמנה ממוזגים על הפריטים של אותו לקוח
// - Tab/Enter קופצים לשדה הבא
// - שמירה אוטומטית ב-onBlur (בלי לחיצת כפתור)
// - הבלטת שורה פעילה
// - פעולות: ביטול פריט + החלפת מוצר בתוך הטבלה

import { useMemo, useRef, useState, useEffect } from "react";
import type { Order, OrderItem, AvailableProduct } from "./AgentSaleClient";

type Props = {
  orders: Order[];
  availableProducts: AvailableProduct[];
  productWeightsFromNotes: Record<string, number>;
  productWeightsUsed: Record<string, number>;
  readOnly?: boolean;
  onItemUpdate: (orderId: string, itemId: string, updates: Partial<OrderItem>) => void;
  onNeedsReload: () => void;
};

// Flat row - פריט אחד עם כל המידע שצריך להציג
type FlatRow = {
  orderId: string;
  itemId: string;
  customerName: string;
  phone: string;
  orderNumber: number;
  productId: string;
  productName: string;
  isSingle: boolean;
  isCancelled: boolean;
  originalProductId: string | null;
  ordered: string; // "1 קרטון" / "2 ק"ג"
  unitPrice: number;
  estimatedWeight: number | null;
  agentEnteredWeight: number | null;
  agentNote: string | null;
  // הצגה: האם זו השורה הראשונה של הלקוח?
  isFirstOfCustomer: boolean;
  // כמה פריטים יש ללקוח הזה?
  customerItemCount: number;
};

export function WeightsTable({
  orders,
  availableProducts,
  productWeightsFromNotes,
  productWeightsUsed,
  readOnly,
  onItemUpdate,
  onNeedsReload,
}: Props) {
  // בניית שורות שטוחות - כולל מבוטלים (יופיעו בסוף לכל לקוח)
  const rows = useMemo<FlatRow[]>(() => {
    const out: FlatRow[] = [];
    for (const order of orders) {
      // ראשית פריטים פעילים, ואז מבוטלים - כך שקל להזין ואז לראות מה בוטל
      const active = order.items.filter((i) => !i.isCancelled);
      const cancelled = order.items.filter((i) => i.isCancelled);
      const allItems = [...active, ...cancelled];
      if (allItems.length === 0) continue;
      allItems.forEach((item, idx) => {
        out.push({
          orderId: order.id,
          itemId: item.id,
          customerName: order.customerName,
          phone: order.phone,
          orderNumber: order.orderNumber,
          productId: item.productId,
          productName: item.productName,
          isSingle: item.isSingle,
          isCancelled: item.isCancelled,
          originalProductId: item.originalProductId,
          ordered: item.isSingle
            ? `${item.quantity} ק"ג`
            : `${item.quantity} קרטון${item.quantity > 1 ? "ים" : ""}`,
          unitPrice: item.unitPrice,
          estimatedWeight: item.estimatedWeight,
          agentEnteredWeight: item.agentEnteredWeight,
          agentNote: item.agentNote,
          isFirstOfCustomer: idx === 0,
          customerItemCount: allItems.length,
        });
      });
    }
    return out;
  }, [orders]);

  return (
    <div className="bg-white rounded-2xl border border-zinc-200 shadow-sm overflow-hidden">
      {/* כותרת + הסבר */}
      <div className="px-4 py-3 bg-zinc-50 border-b border-zinc-200">
        <div className="font-bold text-brand-slatedark text-sm">
          טבלת הזנה מהירה
        </div>
        <div className="text-[10px] text-zinc-500 mt-0.5">
          Tab/Enter = שדה הבא · השמירה אוטומטית · לחץ על שם הלקוח לפתיחת הזמנה מלאה
        </div>
      </div>

      {/* טבלה */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-zinc-50 border-b border-zinc-200 sticky top-0">
            <tr className="text-[10px] font-bold text-zinc-500 uppercase">
              <th className="text-right px-3 py-2 min-w-[130px]">לקוח</th>
              <th className="text-right px-3 py-2 min-w-[100px]">טלפון</th>
              <th className="text-right px-3 py-2 min-w-[180px]">מוצר</th>
              <th className="text-right px-3 py-2 min-w-[80px]">הוזמן</th>
              <th className="text-center px-3 py-2 min-w-[100px]">משקל (ק"ג)</th>
              <th className="text-right px-3 py-2 min-w-[80px]">מחיר</th>
              <th className="text-right px-3 py-2 min-w-[100px]">יתרה במלאי</th>
              <th className="text-right px-3 py-2 min-w-[140px]">הערה</th>
              <th className="text-center px-3 py-2 min-w-[80px]">פעולות</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={9} className="text-center py-8 text-zinc-500">
                  אין פריטים להזין
                </td>
              </tr>
            ) : (
              rows.map((row, idx) => (
                <TableRow
                  key={row.itemId}
                  row={row}
                  isEvenCustomer={
                    // צביעה סירוגית לפי לקוח (לא לפי שורה)
                    (() => {
                      let cust = 0;
                      for (let i = 0; i <= idx; i++) {
                        if (rows[i].isFirstOfCustomer) cust++;
                      }
                      return cust % 2 === 0;
                    })()
                  }
                  productAvailable={productWeightsFromNotes[row.productId]}
                  productUsed={productWeightsUsed[row.productId] || 0}
                  availableProducts={availableProducts}
                  readOnly={readOnly}
                  onItemUpdate={onItemUpdate}
                  onNeedsReload={onNeedsReload}
                  totalRows={rows.length}
                  rowIdx={idx}
                />
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Summary bar */}
      <div className="px-4 py-2 bg-zinc-50 border-t border-zinc-200 text-xs text-brand-slate">
        סה״כ שורות: <strong>{rows.length}</strong> ·{" "}
        הוזנו: <strong className="text-emerald-700">
          {rows.filter((r) => r.agentEnteredWeight && r.agentEnteredWeight > 0).length}
        </strong> ·{" "}
        ממתינים: <strong className="text-amber-700">
          {rows.filter((r) => !r.agentEnteredWeight || r.agentEnteredWeight === 0).length}
        </strong>
      </div>
    </div>
  );
}

function TableRow({
  row,
  isEvenCustomer,
  productAvailable,
  productUsed,
  availableProducts,
  readOnly,
  onItemUpdate,
  onNeedsReload,
  totalRows,
  rowIdx,
}: {
  row: FlatRow;
  isEvenCustomer: boolean;
  productAvailable?: number;
  productUsed: number;
  availableProducts: AvailableProduct[];
  readOnly?: boolean;
  onItemUpdate: (orderId: string, itemId: string, updates: Partial<OrderItem>) => void;
  onNeedsReload: () => void;
  totalRows: number;
  rowIdx: number;
}) {
  const [weightVal, setWeightVal] = useState(row.agentEnteredWeight?.toString() || "");
  const [noteVal, setNoteVal] = useState(row.agentNote || "");
  const [saving, setSaving] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);
  const [showActions, setShowActions] = useState(false);
  const [showReplace, setShowReplace] = useState(false);
  const [replaceQuery, setReplaceQuery] = useState("");
  const weightRef = useRef<HTMLInputElement>(null);
  const noteRef = useRef<HTMLInputElement>(null);

  // סנכרון אחרי onNeedsReload
  useEffect(() => {
    setWeightVal(row.agentEnteredWeight?.toString() || "");
  }, [row.agentEnteredWeight]);
  useEffect(() => {
    setNoteVal(row.agentNote || "");
  }, [row.agentNote]);

  const hasNoteData = productAvailable !== undefined && productAvailable > 0;
  const remaining = hasNoteData ? productAvailable - productUsed : 0;
  const overAllocated = hasNoteData && remaining < -0.01;
  const goodRemaining = hasNoteData && remaining > 0.1;

  const currentWeight = parseFloat(weightVal);
  const validWeight = !isNaN(currentWeight) && currentWeight >= 0;
  const currentPrice = validWeight ? currentWeight * row.unitPrice : 0;

  const isEntered = row.agentEnteredWeight !== null && row.agentEnteredWeight > 0;

  async function saveWeight() {
    const w = parseFloat(weightVal);
    if (isNaN(w) || w < 0) {
      // איפוס אם ערך לא תקין
      setWeightVal(row.agentEnteredWeight?.toString() || "");
      return;
    }
    if (w === row.agentEnteredWeight) return; // אין שינוי

    setSaving(true);
    try {
      const res = await fetch(`/api/agent/order-item/${row.itemId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agentEnteredWeight: w }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error);
      onItemUpdate(row.orderId, row.itemId, {
        agentEnteredWeight: json.item.agentEnteredWeight,
        actualWeight: json.item.actualWeight,
      });
      setSavedFlash(true);
      setTimeout(() => setSavedFlash(false), 800);
    } catch (e: any) {
      alert("שגיאה: " + e.message);
      setWeightVal(row.agentEnteredWeight?.toString() || "");
    } finally {
      setSaving(false);
    }
  }

  async function saveNote() {
    if (noteVal === (row.agentNote || "")) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/agent/order-item/${row.itemId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agentNote: noteVal || null }),
      });
      if (!res.ok) throw new Error("שגיאה");
      onItemUpdate(row.orderId, row.itemId, { agentNote: noteVal || null });
    } catch (e: any) {
      alert("שגיאה: " + e.message);
      setNoteVal(row.agentNote || "");
    } finally {
      setSaving(false);
    }
  }

  async function toggleCancel() {
    setSaving(true);
    try {
      const res = await fetch(`/api/agent/order-item/${row.itemId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isCancelled: !row.isCancelled }),
      });
      if (!res.ok) throw new Error("שגיאה");
      onItemUpdate(row.orderId, row.itemId, { isCancelled: !row.isCancelled });
      setShowActions(false);
    } catch (e: any) {
      alert("שגיאה: " + e.message);
    } finally {
      setSaving(false);
    }
  }

  async function doReplace(newProductId: string) {
    if (!newProductId || newProductId === row.productId) return;
    if (!confirm("להחליף את המוצר? המחיר יתעדכן לפי המוצר החדש")) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/agent/order-item/${row.itemId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ replaceWithProductId: newProductId }),
      });
      if (!res.ok) throw new Error("שגיאה");
      setShowReplace(false);
      setShowActions(false);
      setReplaceQuery("");
      onNeedsReload();
    } catch (e: any) {
      alert("שגיאה: " + e.message);
    } finally {
      setSaving(false);
    }
  }

  // Enter על שדה משקל = שמור וקפוץ לשדה משקל בשורה הבאה
  function handleWeightKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      weightRef.current?.blur();
      // קפוץ לשורה הבאה - חיפוש בעץ ה-DOM
      const nextRow = document.querySelector<HTMLInputElement>(
        `input[data-weight-idx="${rowIdx + 1}"]`
      );
      if (nextRow) {
        setTimeout(() => nextRow.focus(), 50);
      }
    }
  }

  // רקע לפי לקוח + הבלטה אם הוזן / מבוטל
  const rowBg = row.isCancelled
    ? "bg-red-50/40 opacity-60"
    : isEntered
    ? "bg-emerald-50/30"
    : isEvenCustomer
    ? "bg-zinc-50/50"
    : "bg-white";

  const filteredReplacements = availableProducts.filter((p) =>
    p.product.name.toLowerCase().includes(replaceQuery.toLowerCase())
  );

  return (
    <tr
      className={`border-b border-zinc-100 hover:bg-yellow-50/30 ${rowBg} transition-colors relative`}
    >
      {/* לקוח - רק בשורה הראשונה */}
      <td className="px-3 py-2 align-top">
        {row.isFirstOfCustomer ? (
          <div>
            <div className={`font-bold text-sm truncate ${row.isCancelled ? "text-zinc-400" : "text-brand-slatedark"}`}>
              {row.customerName}
            </div>
            <div className="text-[10px] text-zinc-400">#{row.orderNumber}</div>
          </div>
        ) : (
          <div className="text-[10px] text-zinc-300">↑</div>
        )}
      </td>
      {/* טלפון - רק בשורה הראשונה */}
      <td className="px-3 py-2 align-top" dir="ltr">
        {row.isFirstOfCustomer ? (
          <a
            href={`tel:${row.phone}`}
            className="text-xs text-brand-rust font-mono hover:underline"
          >
            {row.phone}
          </a>
        ) : (
          ""
        )}
      </td>
      {/* מוצר */}
      <td className="px-3 py-2">
        <div className="flex items-center gap-1 flex-wrap">
          <span
            className={`font-semibold ${
              row.isCancelled ? "line-through text-zinc-400" : "text-brand-slatedark"
            }`}
          >
            {row.productName}
          </span>
          {row.isSingle && (
            <span className="text-[9px] bg-amber-100 text-amber-700 px-1 py-0.5 rounded font-bold">
              בודדים
            </span>
          )}
          {row.originalProductId && (
            <span className="text-[9px] bg-blue-100 text-blue-700 px-1 py-0.5 rounded font-bold">
              הוחלף
            </span>
          )}
          {row.isCancelled && (
            <span className="text-[9px] bg-red-100 text-red-700 px-1 py-0.5 rounded font-bold">
              ✗ בוטל
            </span>
          )}
        </div>
      </td>
      {/* הוזמן */}
      <td className="px-3 py-2 text-xs text-zinc-500 whitespace-nowrap">
        {row.ordered}
      </td>
      {/* משקל - שדה עיקרי (מושבת אם מבוטל) */}
      <td className="px-2 py-1.5 text-center relative">
        {row.isCancelled ? (
          <span className="text-zinc-400 text-xs">—</span>
        ) : (
          <>
            <input
              ref={weightRef}
              type="number"
              inputMode="decimal"
              step="0.01"
              min="0"
              value={weightVal}
              onChange={(e) => setWeightVal(e.target.value)}
              onBlur={saveWeight}
              onKeyDown={handleWeightKey}
              disabled={readOnly || saving}
              data-weight-idx={rowIdx}
              placeholder="0.00"
              className={`w-full px-2 py-1.5 border-2 rounded-md text-center font-bold text-base focus:outline-none focus:ring-2 focus:ring-brand-rust transition-all ${
                savedFlash
                  ? "border-emerald-500 bg-emerald-100"
                  : isEntered
                  ? "border-emerald-300 bg-emerald-50 text-emerald-800"
                  : "border-zinc-300 bg-white"
              }`}
            />
            {saving && (
              <span className="absolute top-0 left-1 text-[8px] text-amber-600 animate-pulse">
                שומר...
              </span>
            )}
          </>
        )}
      </td>
      {/* מחיר מחושב */}
      <td className="px-3 py-2 text-xs whitespace-nowrap">
        {row.isCancelled ? (
          <span className="text-zinc-300">—</span>
        ) : currentPrice > 0 ? (
          <span className="text-brand-rust font-bold">₪{currentPrice.toFixed(2)}</span>
        ) : (
          <span className="text-zinc-300">—</span>
        )}
      </td>
      {/* יתרה במלאי - רק אם לא בודדים ויש תעודה */}
      <td className="px-3 py-2 text-xs whitespace-nowrap">
        {!row.isCancelled && !row.isSingle && hasNoteData ? (
          <span
            className={`font-bold px-1.5 py-0.5 rounded ${
              overAllocated
                ? "bg-red-100 text-red-700"
                : goodRemaining
                ? "bg-emerald-50 text-emerald-700"
                : "bg-amber-50 text-amber-700"
            }`}
            title={`בתעודה: ${productAvailable!.toFixed(2)} · חולק: ${productUsed.toFixed(2)}`}
          >
            {overAllocated
              ? `⚠️ ${Math.abs(remaining).toFixed(1)} חריגה`
              : `${remaining.toFixed(1)} ק"ג`}
          </span>
        ) : (
          <span className="text-zinc-300">—</span>
        )}
      </td>
      {/* הערה */}
      <td className="px-3 py-1.5">
        <input
          ref={noteRef}
          type="text"
          value={noteVal}
          onChange={(e) => setNoteVal(e.target.value)}
          onBlur={saveNote}
          disabled={readOnly || saving}
          placeholder={row.isCancelled ? "לקוח לא רצה..." : "הערה..."}
          className="w-full px-2 py-1 border border-zinc-200 rounded text-xs focus:outline-none focus:ring-2 focus:ring-brand-rust bg-white"
        />
      </td>
      {/* פעולות */}
      <td className="px-2 py-1.5 text-center relative">
        {!readOnly && (
          <div className="flex items-center justify-center gap-1">
            {/* כפתור החלפת מוצר - רק אם לא מבוטל */}
            {!row.isCancelled && (
              <button
                onClick={() => setShowReplace((v) => !v)}
                disabled={saving}
                className="p-1 rounded hover:bg-blue-100 text-blue-600 disabled:opacity-30"
                title="החלף מוצר"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
                </svg>
              </button>
            )}
            {/* כפתור ביטול / החזרה */}
            <button
              onClick={toggleCancel}
              disabled={saving}
              className={`p-1 rounded disabled:opacity-30 ${
                row.isCancelled
                  ? "hover:bg-emerald-100 text-emerald-600"
                  : "hover:bg-red-100 text-red-600"
              }`}
              title={row.isCancelled ? "החזר פריט" : "בטל פריט"}
            >
              {row.isCancelled ? (
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
              ) : (
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              )}
            </button>
          </div>
        )}

        {/* Dropdown להחלפת מוצר */}
        {showReplace && !readOnly && (
          <div className="absolute z-30 top-full left-1/2 -translate-x-1/2 mt-1 w-72 bg-white border border-zinc-200 rounded-xl shadow-2xl p-2">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-bold text-brand-slatedark">
                החלף מוצר
              </span>
              <button
                onClick={() => {
                  setShowReplace(false);
                  setReplaceQuery("");
                }}
                className="text-zinc-400 hover:text-zinc-700 text-lg leading-none px-1"
              >
                ×
              </button>
            </div>
            <input
              type="text"
              value={replaceQuery}
              onChange={(e) => setReplaceQuery(e.target.value)}
              placeholder="חפש מוצר..."
              autoFocus
              className="w-full px-2 py-1.5 border border-zinc-300 rounded text-sm mb-2 focus:outline-none focus:ring-2 focus:ring-brand-rust"
            />
            <div className="max-h-56 overflow-y-auto space-y-1">
              {filteredReplacements.slice(0, 20).map((p) => (
                <button
                  key={p.productId}
                  onClick={() => doReplace(p.productId)}
                  className="w-full text-right p-2 hover:bg-blue-50 rounded text-xs text-brand-slatedark"
                >
                  <div className="font-semibold">{p.product.name}</div>
                  <div className="text-[10px] text-zinc-500">
                    {p.product.category?.name} · ₪{p.price.toFixed(2)}
                  </div>
                </button>
              ))}
              {filteredReplacements.length === 0 && (
                <div className="text-center text-xs text-zinc-500 py-3">
                  אין תוצאות
                </div>
              )}
            </div>
          </div>
        )}
      </td>
    </tr>
  );
}
