"use client";

// §20: תצוגת טבלה מהירה (Excel-like) להזנת משקלים
// - כל שורה = פריט (לא לקוח)
// - שם ומספר הזמנה ממוזגים על הפריטים של אותו לקוח
// - Tab/Enter קופצים לשדה הבא
// - שמירה אוטומטית ב-onBlur (בלי לחיצת כפתור)
// - הבלטת שורה פעילה

import { useMemo, useRef, useState, useEffect } from "react";
import type { Order, OrderItem } from "./AgentSaleClient";

type Props = {
  orders: Order[];
  productWeightsFromNotes: Record<string, number>;
  productWeightsUsed: Record<string, number>;
  readOnly?: boolean;
  onItemUpdate: (orderId: string, itemId: string, updates: Partial<OrderItem>) => void;
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
  productWeightsFromNotes,
  productWeightsUsed,
  readOnly,
  onItemUpdate,
}: Props) {
  // בניית שורות שטוחות
  const rows = useMemo<FlatRow[]>(() => {
    const out: FlatRow[] = [];
    for (const order of orders) {
      const activeItems = order.items.filter((i) => !i.isCancelled);
      if (activeItems.length === 0) continue;
      activeItems.forEach((item, idx) => {
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
          customerItemCount: activeItems.length,
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
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={8} className="text-center py-8 text-zinc-500">
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
                  readOnly={readOnly}
                  onItemUpdate={onItemUpdate}
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
  readOnly,
  onItemUpdate,
  totalRows,
  rowIdx,
}: {
  row: FlatRow;
  isEvenCustomer: boolean;
  productAvailable?: number;
  productUsed: number;
  readOnly?: boolean;
  onItemUpdate: (orderId: string, itemId: string, updates: Partial<OrderItem>) => void;
  totalRows: number;
  rowIdx: number;
}) {
  const [weightVal, setWeightVal] = useState(row.agentEnteredWeight?.toString() || "");
  const [noteVal, setNoteVal] = useState(row.agentNote || "");
  const [saving, setSaving] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);
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

  // רקע לפי לקוח + הבלטה אם הוזן
  const rowBg = isEntered
    ? "bg-emerald-50/30"
    : isEvenCustomer
    ? "bg-zinc-50/50"
    : "bg-white";

  return (
    <tr
      className={`border-b border-zinc-100 hover:bg-yellow-50/30 ${rowBg} transition-colors`}
    >
      {/* לקוח - רק בשורה הראשונה */}
      <td className="px-3 py-2 align-top">
        {row.isFirstOfCustomer ? (
          <div>
            <div className="font-bold text-brand-slatedark text-sm truncate">
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
      <td className="px-3 py-2 text-brand-slatedark">
        <div className="flex items-center gap-1 flex-wrap">
          <span className="font-semibold">{row.productName}</span>
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
        </div>
      </td>
      {/* הוזמן */}
      <td className="px-3 py-2 text-xs text-zinc-500 whitespace-nowrap">
        {row.ordered}
      </td>
      {/* משקל - שדה עיקרי */}
      <td className="px-2 py-1.5 text-center relative">
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
      </td>
      {/* מחיר מחושב */}
      <td className="px-3 py-2 text-xs whitespace-nowrap">
        {currentPrice > 0 ? (
          <span className="text-brand-rust font-bold">₪{currentPrice.toFixed(2)}</span>
        ) : (
          <span className="text-zinc-300">—</span>
        )}
      </td>
      {/* יתרה במלאי - רק אם לא בודדים ויש תעודה */}
      <td className="px-3 py-2 text-xs whitespace-nowrap">
        {!row.isSingle && hasNoteData ? (
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
          placeholder="הערה..."
          className="w-full px-2 py-1 border border-zinc-200 rounded text-xs focus:outline-none focus:ring-2 focus:ring-brand-rust bg-white"
        />
      </td>
    </tr>
  );
}
