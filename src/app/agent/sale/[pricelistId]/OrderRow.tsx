"use client";

// §20: שורת הזמנה של לקוח - עם עריכת משקלים, הערות, החלפה וביטול
import { useState } from "react";
import type { Order, OrderItem, AvailableProduct } from "./AgentSaleClient";

type Props = {
  order: Order;
  availableProducts: AvailableProduct[];
  productWeightsFromNotes: Record<string, number>; // כמה יש מכל מוצר בתעודות
  productWeightsUsed: Record<string, number>;      // כמה כבר חולק מכל מוצר
  readOnly?: boolean;
  onItemUpdate: (itemId: string, updates: Partial<OrderItem>) => void;
  onNeedsReload: () => void;
};

export function OrderRow({
  order,
  availableProducts,
  productWeightsFromNotes,
  productWeightsUsed,
  readOnly,
  onItemUpdate,
  onNeedsReload,
}: Props) {
  const [expanded, setExpanded] = useState(false);
  const [saving, setSaving] = useState<string | null>(null);

  // האם הוזנו כל המשקלים?
  const activeItems = order.items.filter((i) => !i.isCancelled);
  const allEntered = activeItems.every(
    (i) => i.agentEnteredWeight !== null && i.agentEnteredWeight > 0
  );
  const partiallyEntered = activeItems.some(
    (i) => i.agentEnteredWeight !== null && i.agentEnteredWeight > 0
  );

  async function saveWeight(item: OrderItem, weight: number) {
    setSaving(item.id);
    try {
      const res = await fetch(`/api/agent/order-item/${item.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agentEnteredWeight: weight }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error);
      onItemUpdate(item.id, {
        agentEnteredWeight: json.item.agentEnteredWeight,
        actualWeight: json.item.actualWeight,
      });
    } catch (e: any) {
      alert(e.message || "שגיאה בשמירה");
    } finally {
      setSaving(null);
    }
  }

  async function saveNote(item: OrderItem, note: string) {
    setSaving(item.id);
    try {
      const res = await fetch(`/api/agent/order-item/${item.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agentNote: note }),
      });
      if (!res.ok) throw new Error("שגיאה");
      onItemUpdate(item.id, { agentNote: note });
    } catch (e: any) {
      alert(e.message);
    } finally {
      setSaving(null);
    }
  }

  async function toggleCancel(item: OrderItem) {
    setSaving(item.id);
    try {
      const res = await fetch(`/api/agent/order-item/${item.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isCancelled: !item.isCancelled }),
      });
      if (!res.ok) throw new Error("שגיאה");
      onItemUpdate(item.id, { isCancelled: !item.isCancelled });
    } catch (e: any) {
      alert(e.message);
    } finally {
      setSaving(null);
    }
  }

  async function replaceProduct(item: OrderItem, newProductId: string) {
    if (!newProductId || newProductId === item.productId) return;
    if (!confirm("להחליף את המוצר? המחיר יתעדכן לפי המוצר החדש")) return;
    setSaving(item.id);
    try {
      const res = await fetch(`/api/agent/order-item/${item.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ replaceWithProductId: newProductId }),
      });
      if (!res.ok) throw new Error("שגיאה");
      onNeedsReload();
    } catch (e: any) {
      alert(e.message);
    } finally {
      setSaving(null);
    }
  }

  return (
    <div className="bg-white rounded-xl border border-zinc-200 shadow-sm overflow-hidden">
      {/* Header - שם + טלפון + סטטוס */}
      <button
        onClick={() => setExpanded((v) => !v)}
        className="w-full px-4 py-3 flex items-center justify-between hover:bg-zinc-50 text-right"
      >
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-bold text-brand-slatedark truncate">
              {order.customerName}
            </span>
            <span className="text-xs text-zinc-400">#{order.orderNumber}</span>
            {allEntered ? (
              <span className="text-[10px] bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full font-bold">
                ✓ מוזנים
              </span>
            ) : partiallyEntered ? (
              <span className="text-[10px] bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full font-bold">
                חלקי
              </span>
            ) : (
              <span className="text-[10px] bg-zinc-100 text-zinc-600 px-2 py-0.5 rounded-full">
                ממתין
              </span>
            )}
          </div>
          <div className="text-xs text-zinc-500 mt-0.5" dir="ltr">
            {order.phone} · {activeItems.length} פריטים
          </div>
        </div>
        <svg
          className={`w-5 h-5 text-zinc-400 shrink-0 transition-transform ${
            expanded ? "rotate-180" : ""
          }`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* Body - הפריטים */}
      {expanded && (
        <div className="border-t border-zinc-100 divide-y divide-zinc-100">
          {order.items.map((item) => (
            <ItemRow
              key={item.id}
              item={item}
              availableProducts={availableProducts}
              productAvailable={productWeightsFromNotes[item.productId]}
              productUsed={productWeightsUsed[item.productId] || 0}
              readOnly={readOnly}
              saving={saving === item.id}
              onSaveWeight={(w) => saveWeight(item, w)}
              onSaveNote={(n) => saveNote(item, n)}
              onToggleCancel={() => toggleCancel(item)}
              onReplace={(id) => replaceProduct(item, id)}
            />
          ))}

          {/* טלפון-קליק לנוחות */}
          <div className="p-3 bg-zinc-50 flex items-center justify-between text-xs gap-2 flex-wrap">
            <a
              href={`tel:${order.phone}`}
              className="text-brand-rust font-medium flex items-center gap-1"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
              </svg>
              חייג ללקוח
            </a>
            {allEntered && !readOnly && (
              <button
                onClick={() => setExpanded(false)}
                className="text-xs px-3 py-1.5 rounded-md bg-emerald-100 text-emerald-700 hover:bg-emerald-200 font-bold flex items-center gap-1"
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
                סמן כמושלם וסגור
              </button>
            )}
            <div className="text-zinc-500">
              נקודה: <strong>{order.point?.name || "—"}</strong>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ItemRow({
  item,
  availableProducts,
  productAvailable,
  productUsed,
  readOnly,
  saving,
  onSaveWeight,
  onSaveNote,
  onToggleCancel,
  onReplace,
}: {
  item: OrderItem;
  availableProducts: AvailableProduct[];
  productAvailable?: number;    // כמה יש מהמוצר בתעודה
  productUsed: number;          // כמה כבר חולק
  readOnly?: boolean;
  saving: boolean;
  onSaveWeight: (w: number) => void;
  onSaveNote: (n: string) => void;
  onToggleCancel: () => void;
  onReplace: (productId: string) => void;
}) {
  const [weightInput, setWeightInput] = useState<string>(
    item.agentEnteredWeight?.toString() || ""
  );
  const [noteInput, setNoteInput] = useState<string>(item.agentNote || "");
  const [showReplace, setShowReplace] = useState(false);
  const [replaceQuery, setReplaceQuery] = useState("");

  const originalWeight = item.estimatedWeight;
  const currentPrice = item.agentEnteredWeight
    ? item.agentEnteredWeight * item.unitPrice
    : 0;

  // חישוב יתרה: כמה נשאר לחלוקה מהמוצר?
  const hasNoteData = productAvailable !== undefined && productAvailable > 0;
  const remaining = hasNoteData ? productAvailable - productUsed : 0;
  // האם חורגים מהתעודה?
  const overAllocated = hasNoteData && remaining < 0;
  // האם נשארה עדיין כמות טובה?
  const goodRemaining = hasNoteData && remaining > 0.1;

  const filteredReplacements = availableProducts.filter((p) =>
    p.product.name.toLowerCase().includes(replaceQuery.toLowerCase())
  );

  return (
    <div
      className={`p-3 ${
        item.isCancelled ? "bg-red-50/30" : "bg-white"
      }`}
    >
      {/* שם + כמות שהוזמנה */}
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span
              className={`font-semibold text-sm ${
                item.isCancelled
                  ? "line-through text-zinc-400"
                  : "text-brand-slatedark"
              }`}
            >
              {item.productName}
            </span>
            {item.isSingle && (
              <span className="text-[10px] bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded font-bold">
                בודדים
              </span>
            )}
            {item.originalProductId && (
              <span
                className="text-[10px] bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded font-bold"
                title="הוחלף"
              >
                הוחלף
              </span>
            )}
          </div>
          <div className="text-xs text-zinc-500 mt-0.5">
            הוזמן: {item.isSingle ? `${item.quantity} ק"ג` : `${item.quantity} קרטון${item.quantity > 1 ? "ים" : ""}`}
            {originalWeight && !item.isSingle && (
              <span> (~{originalWeight.toFixed(2)} ק"ג משוער)</span>
            )}
            {" · "}
            ₪{item.unitPrice.toFixed(2)} ל{item.isSingle ? "ק״ג" : (item.unit === 'ק"ג' ? "ק״ג" : "יח׳")}
          </div>
        </div>
      </div>

      {/* Banner מלאי - רק אם יש נתונים מהתעודה + לא בודדים + לא מבוטל */}
      {!item.isCancelled && !item.isSingle && hasNoteData && (
        <div
          className={`text-xs rounded-lg px-2.5 py-1.5 mb-2 flex items-center justify-between gap-2 ${
            overAllocated
              ? "bg-red-100 text-red-800 border border-red-300 font-bold"
              : goodRemaining
              ? "bg-emerald-50 text-emerald-800 border border-emerald-200"
              : "bg-amber-50 text-amber-800 border border-amber-200"
          }`}
        >
          <div className="flex items-center gap-1.5">
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
            </svg>
            <span>לחלוקה בסה״כ: <b>{productAvailable!.toFixed(2)} ק"ג</b></span>
          </div>
          <div>
            {overAllocated
              ? `⚠️ חריגה של ${Math.abs(remaining).toFixed(2)} ק"ג`
              : `נשאר: ${remaining.toFixed(2)} ק"ג`}
          </div>
        </div>
      )}

      {!item.isCancelled && (
        <>
          {/* משקל בפועל */}
          <div className="flex items-center gap-2 mb-2">
            <label className="flex-1">
              <div className="text-[10px] font-bold text-zinc-500 mb-0.5">
                משקל בפועל (ק"ג)
              </div>
              <input
                type="number"
                inputMode="decimal"
                step="0.01"
                min="0"
                value={weightInput}
                onChange={(e) => setWeightInput(e.target.value)}
                onBlur={() => {
                  const w = parseFloat(weightInput);
                  if (!isNaN(w) && w >= 0 && w !== item.agentEnteredWeight) {
                    onSaveWeight(w);
                  }
                }}
                disabled={readOnly || saving}
                placeholder="0.00"
                className={`w-full px-3 py-2 border rounded-lg text-lg font-bold text-center focus:outline-none focus:ring-2 focus:ring-brand-rust ${
                  item.agentEnteredWeight
                    ? "border-emerald-300 bg-emerald-50/30 text-emerald-800"
                    : "border-zinc-300"
                }`}
              />
            </label>
            {currentPrice > 0 && (
              <div className="text-center min-w-[75px]">
                <div className="text-[10px] font-bold text-zinc-500 mb-0.5">
                  מחיר
                </div>
                <div className="text-brand-rust font-extrabold text-base py-2">
                  ₪{currentPrice.toFixed(2)}
                </div>
              </div>
            )}
          </div>

          {/* הערה */}
          <div className="mb-2">
            <div className="text-[10px] font-bold text-zinc-500 mb-0.5">הערה</div>
            <input
              type="text"
              value={noteInput}
              onChange={(e) => setNoteInput(e.target.value)}
              onBlur={() => {
                if (noteInput !== (item.agentNote || "")) {
                  onSaveNote(noteInput);
                }
              }}
              disabled={readOnly || saving}
              placeholder="למשל: הגיע צלעות במקום כתפיים"
              className="w-full px-3 py-1.5 border border-zinc-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-rust"
            />
          </div>
        </>
      )}

      {/* פעולות */}
      {!readOnly && (
        <div className="flex gap-2 items-center flex-wrap">
          <button
            onClick={onToggleCancel}
            className={`text-xs px-2.5 py-1 rounded-md font-medium transition-colors ${
              item.isCancelled
                ? "bg-emerald-100 text-emerald-700 hover:bg-emerald-200"
                : "bg-red-100 text-red-700 hover:bg-red-200"
            }`}
          >
            {item.isCancelled ? "החזר פריט" : "בטל פריט"}
          </button>
          {!item.isCancelled && (
            <button
              onClick={() => setShowReplace((v) => !v)}
              className="text-xs px-2.5 py-1 rounded-md bg-blue-100 text-blue-700 hover:bg-blue-200 font-medium"
            >
              {showReplace ? "סגור" : "החלף מוצר"}
            </button>
          )}
        </div>
      )}

      {/* החלפת מוצר */}
      {showReplace && !item.isCancelled && (
        <div className="mt-2 p-2 bg-blue-50 rounded-lg border border-blue-200">
          <input
            type="text"
            value={replaceQuery}
            onChange={(e) => setReplaceQuery(e.target.value)}
            placeholder="חפש מוצר להחלפה..."
            className="w-full px-2 py-1 border border-blue-300 rounded text-sm mb-2"
          />
          <div className="max-h-40 overflow-y-auto space-y-1">
            {filteredReplacements.slice(0, 20).map((p) => (
              <button
                key={p.productId}
                onClick={() => {
                  onReplace(p.productId);
                  setShowReplace(false);
                  setReplaceQuery("");
                }}
                className="w-full text-right p-2 bg-white hover:bg-blue-100 rounded text-sm text-brand-slatedark"
              >
                <div className="font-semibold">{p.product.name}</div>
                <div className="text-xs text-zinc-500">
                  {p.product.category?.name} · ₪{p.price.toFixed(2)} ל{p.product.unit}
                </div>
              </button>
            ))}
            {filteredReplacements.length === 0 && (
              <div className="text-center text-xs text-zinc-500 py-2">
                אין תוצאות
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
