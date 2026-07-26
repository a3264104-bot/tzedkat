"use client";

// §20: מסך המנהל לבקרת ותיקון משקלים
// - מציג את מה שהנציג הזין
// - המנהל יכול לתקן ב-actualWeight (השדה שהלקוח משלם עליו)
// - agentEnteredWeight נשאר נעול (בסיס העמלה של הנציג)

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";

type Item = {
  id: string;
  productId: string;
  productName: string;
  unit: string;
  isSingle: boolean;
  quantity: number;
  unitPrice: number;
  estimatedWeight: number | null;
  estimatedPrice: number;
  actualWeight: number | null;
  finalWeight: number | null;
  finalPrice: number | null;
  agentEnteredWeight: number | null;
  agentEnteredBy: string | null;
  agentNote: string | null;
  isCancelled: boolean;
  originalProductId: string | null;
};

type Order = {
  id: string;
  orderNumber: number;
  customerName: string;
  phone: string;
  status: string;
  point: { id: string; name: string } | null;
  finalTotal: number | null;
  items: Item[];
};

type Data = {
  pricelist: {
    id: string;
    name: string;
    status: string;
    deliveryDate: string | null;
    deliveryDateText: string | null;
  };
  orders: Order[];
};

type FlatRow = Item & {
  orderId: string;
  customerName: string;
  phone: string;
  orderNumber: number;
  pointName: string | null;
  isFirstOfCustomer: boolean;
};

type FilterMode = "all" | "pending" | "reviewed" | "conflicts";

export default function AdminWeightReviewClient({
  pricelistId,
}: {
  pricelistId: string;
}) {
  const [data, setData] = useState<Data | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [filterMode, setFilterMode] = useState<FilterMode>("all");

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/admin/weight-review/${pricelistId}`, {
        cache: "no-store",
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error);
      setData(json);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [pricelistId]);

  useEffect(() => {
    load();
  }, [load]);

  const updateItem = useCallback(
    (orderId: string, itemId: string, updates: Partial<Item>) => {
      setData((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          orders: prev.orders.map((o) =>
            o.id === orderId
              ? {
                  ...o,
                  items: o.items.map((it) =>
                    it.id === itemId ? { ...it, ...updates } : it
                  ),
                }
              : o
          ),
        };
      });
    },
    []
  );

  // בניית שורות שטוחות
  const rows = useMemo<FlatRow[]>(() => {
    if (!data) return [];
    const out: FlatRow[] = [];
    for (const order of data.orders) {
      const active = order.items.filter((i) => !i.isCancelled);
      const cancelled = order.items.filter((i) => i.isCancelled);
      const all = [...active, ...cancelled];
      if (all.length === 0) continue;
      all.forEach((item, idx) => {
        out.push({
          ...item,
          orderId: order.id,
          customerName: order.customerName,
          phone: order.phone,
          orderNumber: order.orderNumber,
          pointName: order.point?.name || null,
          isFirstOfCustomer: idx === 0,
        });
      });
    }
    return out;
  }, [data]);

  // סינון
  const filteredRows = useMemo(() => {
    let list = rows;

    if (filterMode === "pending") {
      // ממתינים למשקל
      list = list.filter((r) => !r.isCancelled && !r.agentEnteredWeight && !r.actualWeight);
    } else if (filterMode === "reviewed") {
      // המנהל תיקן (actualWeight שונה מ-agentEnteredWeight)
      list = list.filter(
        (r) =>
          !r.isCancelled &&
          r.actualWeight !== null &&
          r.agentEnteredWeight !== null &&
          Math.abs((r.actualWeight || 0) - (r.agentEnteredWeight || 0)) > 0.01
      );
    } else if (filterMode === "conflicts") {
      // פערים גדולים בין מה שהנציג הזין למה שאמור להיות (סטייה >5% מהמשוער)
      list = list.filter((r) => {
        if (r.isCancelled) return false;
        const w = r.agentEnteredWeight || 0;
        if (!w) return false;
        if (!r.estimatedWeight) return false;
        const diff = Math.abs(w - r.estimatedWeight) / r.estimatedWeight;
        return diff > 0.15; // >15% סטייה מהמשוער
      });
    }

    if (filter.trim()) {
      const q = filter.trim().toLowerCase();
      list = list.filter(
        (r) =>
          r.customerName.toLowerCase().includes(q) ||
          r.phone.includes(q) ||
          String(r.orderNumber).includes(q) ||
          r.productName.toLowerCase().includes(q) ||
          (r.agentEnteredBy || "").toLowerCase().includes(q)
      );
    }

    return list;
  }, [rows, filter, filterMode]);

  // סטטיסטיקות
  const stats = useMemo(() => {
    let pending = 0;
    let entered = 0;
    let reviewed = 0;
    let cancelled = 0;
    let conflicts = 0;
    for (const r of rows) {
      if (r.isCancelled) {
        cancelled++;
        continue;
      }
      if (r.agentEnteredWeight) entered++;
      else pending++;

      if (
        r.actualWeight !== null &&
        r.agentEnteredWeight !== null &&
        Math.abs((r.actualWeight || 0) - (r.agentEnteredWeight || 0)) > 0.01
      ) {
        reviewed++;
      }

      if (r.agentEnteredWeight && r.estimatedWeight) {
        const diff = Math.abs(r.agentEnteredWeight - r.estimatedWeight) / r.estimatedWeight;
        if (diff > 0.15) conflicts++;
      }
    }
    return { pending, entered, reviewed, cancelled, conflicts, total: rows.length };
  }, [rows]);

  if (loading) {
    return (
      <div dir="rtl" className="min-h-screen bg-brand-cream flex items-center justify-center">
        <div className="text-brand-slatedark">טוען...</div>
      </div>
    );
  }
  if (error || !data) {
    return (
      <div dir="rtl" className="min-h-screen bg-brand-cream flex items-center justify-center p-6">
        <div className="text-red-600">{error || "שגיאה"}</div>
      </div>
    );
  }

  return (
    <div dir="rtl" className="min-h-screen bg-brand-cream pb-20">
      <header className="bg-brand-yellow border-b-4 border-brand-rust/20 sticky top-0 z-30">
        <div className="mx-auto max-w-7xl px-4 py-3 flex items-center justify-between">
          <Link
            href={`/admin/sale-control/${pricelistId}`}
            className="text-brand-slate font-medium text-sm"
          >
            ← בקרת מכירה
          </Link>
          <div className="text-right">
            <h1 className="font-extrabold text-brand-slatedark">
              ⚖️ בקרת משקלים
            </h1>
            <div className="text-xs text-brand-slate mt-0.5">
              {data.pricelist.name}
            </div>
          </div>
        </div>
      </header>

      {/* סרגל סטטיסטיקות + חיפוש */}
      <div className="sticky top-[52px] z-20 bg-white border-b border-zinc-200 shadow-sm">
        <div className="mx-auto max-w-7xl px-4 py-3">
          <div className="grid grid-cols-2 md:grid-cols-5 gap-2 mb-3">
            <StatMini label="סה״כ פריטים" value={String(stats.total)} color="slate" />
            <StatMini label="ממתינים" value={String(stats.pending)} color="amber" />
            <StatMini label="הוזנו" value={String(stats.entered)} color="emerald" />
            <StatMini label="תיקנתי" value={String(stats.reviewed)} color="blue" />
            <StatMini label="חשודים" value={String(stats.conflicts)} color="red" />
          </div>

          <div className="flex gap-2 mb-2">
            <input
              type="text"
              placeholder="חיפוש שם / טלפון / מוצר / נציג..."
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              className="flex-1 px-3 py-2 border border-zinc-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-rust"
            />
          </div>

          <div className="flex gap-1.5 overflow-x-auto">
            <FilterChip active={filterMode === "all"} onClick={() => setFilterMode("all")} color="slate">
              הכל · {stats.total}
            </FilterChip>
            <FilterChip active={filterMode === "pending"} onClick={() => setFilterMode("pending")} color="amber">
              ממתינים · {stats.pending}
            </FilterChip>
            <FilterChip active={filterMode === "reviewed"} onClick={() => setFilterMode("reviewed")} color="blue">
              תיקנתי · {stats.reviewed}
            </FilterChip>
            <FilterChip active={filterMode === "conflicts"} onClick={() => setFilterMode("conflicts")} color="red">
              🚩 חשודים · {stats.conflicts}
            </FilterChip>
          </div>
        </div>
      </div>

      <main className="mx-auto max-w-7xl px-4 py-5">
        <div className="bg-white rounded-2xl border border-zinc-200 shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-zinc-50 border-b border-zinc-200">
                <tr className="text-[10px] font-bold text-zinc-500 uppercase">
                  <th className="text-right px-3 py-2 min-w-[130px]">לקוח</th>
                  <th className="text-right px-3 py-2 min-w-[180px]">מוצר</th>
                  <th className="text-right px-3 py-2 min-w-[80px]">משוער</th>
                  <th className="text-center px-3 py-2 min-w-[100px] bg-blue-50">משקל נציג</th>
                  <th className="text-center px-3 py-2 min-w-[100px] bg-emerald-50">משקל סופי (ללקוח)</th>
                  <th className="text-right px-3 py-2 min-w-[80px]">מחיר סופי</th>
                  <th className="text-right px-3 py-2 min-w-[100px]">נציג</th>
                  <th className="text-right px-3 py-2 min-w-[140px]">הערה</th>
                  <th className="text-center px-3 py-2 min-w-[50px]"></th>
                </tr>
              </thead>
              <tbody>
                {filteredRows.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="text-center py-8 text-zinc-500">
                      אין פריטים
                    </td>
                  </tr>
                ) : (
                  filteredRows.map((row, idx) => (
                    <ReviewRow
                      key={row.id}
                      row={row}
                      onItemUpdate={updateItem}
                      rowIdx={idx}
                    />
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="mt-3 bg-blue-50 border border-blue-200 rounded-xl p-3 text-xs text-blue-900">
          <strong>איך זה עובד:</strong> העמודה <span className="bg-blue-100 px-1 rounded">משקל נציג</span> - מה שהנציג הזין, נעול לחישוב עמלה.
          העמודה <span className="bg-emerald-100 px-1 rounded">משקל סופי</span> - מה שהלקוח יחויב עליו. אם לא תיקנת = שווה למשקל הנציג.
        </div>
      </main>
    </div>
  );
}

function ReviewRow({
  row,
  onItemUpdate,
  rowIdx,
}: {
  row: FlatRow;
  onItemUpdate: (orderId: string, itemId: string, updates: Partial<Item>) => void;
  rowIdx: number;
}) {
  const [actualVal, setActualVal] = useState(
    row.actualWeight?.toString() || row.agentEnteredWeight?.toString() || ""
  );
  const [noteVal, setNoteVal] = useState(row.agentNote || "");
  const [saving, setSaving] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);

  useEffect(() => {
    setActualVal(row.actualWeight?.toString() || row.agentEnteredWeight?.toString() || "");
  }, [row.actualWeight, row.agentEnteredWeight]);
  useEffect(() => {
    setNoteVal(row.agentNote || "");
  }, [row.agentNote]);

  const currentVal = parseFloat(actualVal);
  const hasValue = !isNaN(currentVal) && currentVal > 0;
  const finalPrice = hasValue ? currentVal * row.unitPrice : 0;

  const agentW = row.agentEnteredWeight || 0;
  const finalW = row.actualWeight || row.agentEnteredWeight || 0;
  const wasEdited =
    row.actualWeight !== null &&
    row.agentEnteredWeight !== null &&
    Math.abs(row.actualWeight - row.agentEnteredWeight) > 0.01;

  // סטייה מהמשוער
  let anomaly = false;
  if (agentW > 0 && row.estimatedWeight) {
    const diff = Math.abs(agentW - row.estimatedWeight) / row.estimatedWeight;
    anomaly = diff > 0.15;
  }

  async function saveActual() {
    const w = parseFloat(actualVal);
    if (isNaN(w) || w < 0) {
      setActualVal(row.actualWeight?.toString() || row.agentEnteredWeight?.toString() || "");
      return;
    }
    if (Math.abs(w - (row.actualWeight || row.agentEnteredWeight || 0)) < 0.001) return;

    setSaving(true);
    try {
      const res = await fetch(`/api/admin/weight-review-item/${row.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ actualWeight: w }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error);
      onItemUpdate(row.orderId, row.id, {
        actualWeight: json.item.actualWeight,
        finalWeight: json.item.finalWeight,
        finalPrice: json.item.finalPrice,
      });
      setSavedFlash(true);
      setTimeout(() => setSavedFlash(false), 800);
    } catch (e: any) {
      alert("שגיאה: " + e.message);
      setActualVal(row.actualWeight?.toString() || row.agentEnteredWeight?.toString() || "");
    } finally {
      setSaving(false);
    }
  }

  async function saveNote() {
    if (noteVal === (row.agentNote || "")) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/admin/weight-review-item/${row.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agentNote: noteVal || null }),
      });
      if (!res.ok) throw new Error("שגיאה");
      onItemUpdate(row.orderId, row.id, { agentNote: noteVal || null });
    } catch (e: any) {
      alert(e.message);
      setNoteVal(row.agentNote || "");
    } finally {
      setSaving(false);
    }
  }

  async function toggleCancel() {
    setSaving(true);
    try {
      const res = await fetch(`/api/admin/weight-review-item/${row.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isCancelled: !row.isCancelled }),
      });
      if (!res.ok) throw new Error("שגיאה");
      onItemUpdate(row.orderId, row.id, { isCancelled: !row.isCancelled });
    } catch (e: any) {
      alert(e.message);
    } finally {
      setSaving(false);
    }
  }

  function handleKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      const next = document.querySelector<HTMLInputElement>(
        `input[data-actual-idx="${rowIdx + 1}"]`
      );
      if (next) setTimeout(() => next.focus(), 50);
    }
  }

  const rowBg = row.isCancelled
    ? "bg-red-50/40 opacity-60"
    : wasEdited
    ? "bg-blue-50/40"
    : anomaly
    ? "bg-amber-50/40"
    : "bg-white";

  return (
    <tr className={`border-b border-zinc-100 hover:bg-yellow-50/30 ${rowBg}`}>
      {/* לקוח */}
      <td className="px-3 py-2 align-top">
        {row.isFirstOfCustomer ? (
          <div>
            <div
              className={`font-bold text-sm truncate ${
                row.isCancelled ? "text-zinc-400" : "text-brand-slatedark"
              }`}
            >
              {row.customerName}
            </div>
            <div className="text-[10px] text-zinc-400" dir="ltr">
              {row.phone}
            </div>
            <div className="text-[10px] text-zinc-400">
              #{row.orderNumber}
              {row.pointName && ` · ${row.pointName}`}
            </div>
          </div>
        ) : (
          <div className="text-[10px] text-zinc-300">↑</div>
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
          {row.isCancelled && (
            <span className="text-[9px] bg-red-100 text-red-700 px-1 py-0.5 rounded font-bold">
              ✗ בוטל
            </span>
          )}
        </div>
        <div className="text-[10px] text-zinc-500 mt-0.5">
          {row.isSingle ? `${row.quantity} ק"ג` : `${row.quantity} קרטון`} · ₪
          {row.unitPrice.toFixed(2)}
        </div>
      </td>

      {/* משקל משוער */}
      <td className="px-3 py-2 text-xs text-zinc-500 whitespace-nowrap">
        {row.estimatedWeight ? `${row.estimatedWeight.toFixed(2)} ק"ג` : "—"}
      </td>

      {/* משקל שהנציג הזין */}
      <td className="px-3 py-2 text-center bg-blue-50/30 whitespace-nowrap">
        {row.agentEnteredWeight ? (
          <div>
            <div
              className={`font-bold ${anomaly ? "text-red-700" : "text-brand-slatedark"}`}
            >
              {row.agentEnteredWeight.toFixed(2)}
              {anomaly && <span className="text-red-600 mr-1">🚩</span>}
            </div>
            <div className="text-[9px] text-zinc-500">
              עמלה: ₪{(row.agentEnteredWeight * (row.isSingle ? 4 : 1)).toFixed(2)}
            </div>
          </div>
        ) : (
          <span className="text-zinc-300">—</span>
        )}
      </td>

      {/* משקל סופי (עורך) */}
      <td className="px-2 py-1.5 text-center bg-emerald-50/30 relative">
        {row.isCancelled ? (
          <span className="text-zinc-400">—</span>
        ) : (
          <>
            <input
              type="number"
              inputMode="decimal"
              step="0.01"
              min="0"
              value={actualVal}
              onChange={(e) => setActualVal(e.target.value)}
              onBlur={saveActual}
              onKeyDown={handleKey}
              disabled={saving}
              data-actual-idx={rowIdx}
              placeholder="0.00"
              className={`w-full px-2 py-1.5 border-2 rounded-md text-center font-bold text-base focus:outline-none focus:ring-2 focus:ring-brand-rust transition-all ${
                savedFlash
                  ? "border-emerald-500 bg-emerald-100"
                  : wasEdited
                  ? "border-blue-400 bg-blue-50 text-blue-800"
                  : row.actualWeight || row.agentEnteredWeight
                  ? "border-emerald-300 bg-white text-emerald-800"
                  : "border-zinc-300 bg-white"
              }`}
            />
            {wasEdited && (
              <div className="text-[9px] text-blue-700 mt-0.5">
                תוקן ({(row.actualWeight! - row.agentEnteredWeight!).toFixed(2)})
              </div>
            )}
          </>
        )}
      </td>

      {/* מחיר סופי */}
      <td className="px-3 py-2 text-xs whitespace-nowrap">
        {row.isCancelled ? (
          <span className="text-zinc-300">—</span>
        ) : finalPrice > 0 ? (
          <span className="text-brand-rust font-extrabold">₪{finalPrice.toFixed(2)}</span>
        ) : (
          <span className="text-zinc-300">—</span>
        )}
      </td>

      {/* שם הנציג */}
      <td className="px-3 py-2 text-xs text-zinc-600 whitespace-nowrap">
        {row.agentEnteredBy || <span className="text-zinc-300">—</span>}
      </td>

      {/* הערה */}
      <td className="px-3 py-1.5">
        <input
          type="text"
          value={noteVal}
          onChange={(e) => setNoteVal(e.target.value)}
          onBlur={saveNote}
          disabled={saving}
          placeholder="הערה..."
          className="w-full px-2 py-1 border border-zinc-200 rounded text-xs focus:outline-none focus:ring-2 focus:ring-brand-rust bg-white"
        />
      </td>

      {/* פעולות */}
      <td className="px-2 py-1.5 text-center">
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
      </td>
    </tr>
  );
}

function StatMini({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color: "slate" | "amber" | "emerald" | "blue" | "red";
}) {
  const colorMap = {
    slate: "bg-zinc-50 text-brand-slatedark border-zinc-200",
    amber: "bg-amber-50 text-amber-800 border-amber-200",
    emerald: "bg-emerald-50 text-emerald-700 border-emerald-200",
    blue: "bg-blue-50 text-blue-800 border-blue-200",
    red: "bg-red-50 text-red-800 border-red-200",
  }[color];
  return (
    <div className={`rounded-lg border p-2 ${colorMap}`}>
      <div className="text-[10px] font-medium opacity-80">{label}</div>
      <div className="font-extrabold text-lg">{value}</div>
    </div>
  );
}

function FilterChip({
  active,
  onClick,
  color,
  children,
}: {
  active: boolean;
  onClick: () => void;
  color: "slate" | "amber" | "emerald" | "blue" | "red";
  children: React.ReactNode;
}) {
  const activeColors = {
    slate: "bg-brand-slatedark text-white",
    amber: "bg-amber-500 text-white",
    emerald: "bg-emerald-600 text-white",
    blue: "bg-blue-600 text-white",
    red: "bg-red-600 text-white",
  }[color];
  return (
    <button
      onClick={onClick}
      className={`px-3 py-1.5 text-xs font-bold rounded-lg whitespace-nowrap transition-colors ${
        active ? activeColors + " shadow-sm" : "bg-zinc-100 text-zinc-500 hover:bg-zinc-200"
      }`}
    >
      {children}
    </button>
  );
}
