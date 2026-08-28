"use client";

// §15: מסך משקלים ממתינים - Client Component
// - טבלה מהירה (default): הזנת משקלים בלי לצאת ולהיכנס להזמנות
// - כרטיסים: תצוגה מקובצת עם קישור לעמוד ההזמנה
// - סינון לפי מכירה + חיפוש טקסטואלי
// - שמירה אוטומטית ב-onBlur + Tab/Enter לשדה הבא

import { useMemo, useRef, useState } from "react";
import Link from "next/link";

type Row = {
  id: string;
  orderId: string;
  orderNumber: number;
  pricelistId: string;
  pricelistName: string;
  customerName: string;
  phone: string;
  pointName: string | null;
  productName: string;
  unit: string;
  isSingle: boolean;
  /** §312: PACKAGE = קרטון · UNIT/WEIGHT = יחידות */
  saleType?: string | null;
  quantity: number;
  unitPrice: number;
  estimatedWeight: number | null;
  estimatedPrice: number;
  agentEnteredWeight: number | null;
  agentNote: string | null;
};

type ViewMode = "table" | "cards";

export default function PendingWeightsClient({
  initialRows,
}: {
  initialRows: Row[];
}) {
  const [rows, setRows] = useState<Row[]>(initialRows);
  const [viewMode, setViewMode] = useState<ViewMode>("table");
  const [filter, setFilter] = useState("");
  const [pricelistFilter, setPricelistFilter] = useState<string>("");

  // רשימת מחירונים ייחודית (למקרה שיש כמה מכירות בתהליך במקביל)
  const pricelists = useMemo(() => {
    const map = new Map<string, string>();
    for (const r of rows) map.set(r.pricelistId, r.pricelistName);
    return Array.from(map.entries()).map(([id, name]) => ({ id, name }));
  }, [rows]);

  // סינון לפי חיפוש + מחירון
  const filteredRows = useMemo(() => {
    let list = rows;
    if (pricelistFilter) {
      list = list.filter((r) => r.pricelistId === pricelistFilter);
    }
    if (filter.trim()) {
      const q = filter.trim().toLowerCase();
      list = list.filter(
        (r) =>
          r.customerName.toLowerCase().includes(q) ||
          r.phone.includes(q) ||
          String(r.orderNumber).includes(q) ||
          r.productName.toLowerCase().includes(q)
      );
    }
    return list;
  }, [rows, filter, pricelistFilter]);

  // ספירת נשלמו (בסה"כ + מסונן)
  const totalCount = rows.length;
  const filteredCount = filteredRows.length;

  // מחיקת שורה מה-state אחרי שהוזן משקל בהצלחה
  const handleWeightSaved = (rowId: string) => {
    // מסיר את השורה כי כבר לא "ממתינה"
    setRows((prev) => prev.filter((r) => r.id !== rowId));
  };

  return (
    <div dir="rtl" className="min-h-screen bg-brand-cream pb-20">
      <header className="bg-brand-yellow border-b-4 border-brand-rust/20 sticky top-0 z-30">
        <div className="mx-auto max-w-7xl px-4 py-3 flex items-center justify-between">
          <Link href="/admin" className="text-brand-slate font-medium text-sm">
            ← ניהול
          </Link>
          <div className="text-right">
            <h1 className="font-extrabold text-brand-slatedark">
              ⚖️ משקלים ממתינים
            </h1>
            <div className="text-xs text-brand-slate mt-0.5">
              {filteredCount} מתוך {totalCount} פריטים
            </div>
          </div>
        </div>
      </header>

      {/* Toolbar */}
      <div className="sticky top-[52px] z-20 bg-white border-b border-zinc-200 shadow-sm">
        <div className="mx-auto max-w-7xl px-4 py-3 space-y-2">
          <div className="flex gap-2 items-stretch flex-wrap">
            <input
              type="text"
              placeholder="חיפוש שם / טלפון / מוצר / הזמנה..."
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              className="flex-1 min-w-[200px] px-3 py-2 border border-zinc-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-rust"
            />

            {pricelists.length > 1 && (
              <select
                value={pricelistFilter}
                onChange={(e) => setPricelistFilter(e.target.value)}
                className="px-3 py-2 border border-zinc-300 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-brand-rust"
              >
                <option value="">כל המכירות</option>
                {pricelists.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            )}

            {/* Toggle תצוגה */}
            <div className="flex bg-zinc-100 rounded-lg p-0.5 shrink-0">
              <button
                onClick={() => setViewMode("table")}
                className={`px-3 py-1.5 rounded-md text-xs font-bold transition-colors ${
                  viewMode === "table"
                    ? "bg-white text-brand-slatedark shadow-sm"
                    : "text-zinc-500 hover:text-brand-slatedark"
                }`}
                title="טבלה מהירה"
              >
                📊 טבלה
              </button>
              <button
                onClick={() => setViewMode("cards")}
                className={`px-3 py-1.5 rounded-md text-xs font-bold transition-colors ${
                  viewMode === "cards"
                    ? "bg-white text-brand-slatedark shadow-sm"
                    : "text-zinc-500 hover:text-brand-slatedark"
                }`}
                title="כרטיסים"
              >
                🗂️ כרטיסים
              </button>
            </div>
          </div>

          {viewMode === "table" && (
            <div className="text-[10px] text-zinc-500">
              💡 <strong>Tab / Enter</strong> = שדה הבא · שמירה אוטומטית ביציאה מהשדה
            </div>
          )}
        </div>
      </div>

      <main className="mx-auto max-w-7xl px-4 py-5">
        {filteredRows.length === 0 ? (
          <div className="bg-white rounded-2xl border border-zinc-200 p-8 text-center">
            <p className="text-brand-slatedark font-semibold">
              {filter || pricelistFilter
                ? "לא נמצאו פריטים מתאימים"
                : "כל המשקלים הוזנו! ✅"}
            </p>
          </div>
        ) : viewMode === "table" ? (
          <WeightsTable
            rows={filteredRows}
            onWeightSaved={handleWeightSaved}
          />
        ) : (
          <CardsView rows={filteredRows} />
        )}
      </main>
    </div>
  );
}

// ═══════════════════════════════════════════════════════
// טבלה מהירה - הזנה כמו Excel
// ═══════════════════════════════════════════════════════
function WeightsTable({
  rows,
  onWeightSaved,
}: {
  rows: Row[];
  onWeightSaved: (rowId: string) => void;
}) {
  return (
    <div className="bg-white rounded-2xl border border-zinc-200 shadow-sm overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-zinc-50 border-b border-zinc-200">
            <tr className="text-[10px] font-bold text-zinc-500 uppercase">
              <th className="text-right px-3 py-2 min-w-[130px]">לקוח</th>
              <th className="text-right px-3 py-2 min-w-[100px]">טלפון</th>
              <th className="text-right px-3 py-2 min-w-[70px]">הזמנה</th>
              <th className="text-right px-3 py-2 min-w-[160px]">מוצר</th>
              <th className="text-right px-3 py-2 min-w-[70px]">הוזמן</th>
              <th className="text-right px-3 py-2 min-w-[70px]">משוער</th>
              <th className="text-center px-3 py-2 min-w-[120px] bg-emerald-50">
                משקל בפועל
              </th>
              <th className="text-right px-3 py-2 min-w-[90px]">מחיר סופי</th>
              <th className="text-center px-3 py-2 min-w-[60px]">פעולות</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, idx) => (
              <TableRow
                key={row.id}
                row={row}
                rowIdx={idx}
                onSaved={onWeightSaved}
              />
            ))}
          </tbody>
        </table>
      </div>
      <div className="px-4 py-2 bg-zinc-50 border-t border-zinc-200 text-xs text-brand-slate">
        סה״כ פריטים ממתינים: <strong>{rows.length}</strong>
      </div>
    </div>
  );
}

function TableRow({
  row,
  rowIdx,
  onSaved,
}: {
  row: Row;
  rowIdx: number;
  onSaved: (rowId: string) => void;
}) {
  const [weightVal, setWeightVal] = useState<string>(
    row.agentEnteredWeight?.toString() || ""
  );

  // §301: 📦 **משבצת לכל קרטון** — כמו במסך הנציג.
  //
  // הבעיה מהשטח: לקוח לקח 2 קרטונים, והשוקל שוקל כל אחד בנפרד -
  // 12.4 ו-13.1. משבצת אחת אילצה אותו לחבר בראש, ושם נופלות
  // הטעויות.
  //
  // ⚠️ הסכום הוא מה שנשמר: הפריט מחזיק משקל אחד, ופיצול במסד
  // היה דורש מיגרציה ושינוי בכל מי שקורא אותו.
  //
  // ⚠️ ומי ששקל ביחד ממלא הכל בראשונה ומשאיר את השנייה ריקה.
  //
  // ⚠️ רק קרטונים: בודדים לפי ק"ג הם שקילה אחת.
  // §312: הפיצול רק לקרטונים — 3 יחידות כבד אינן 3 שקילות.
  const cartonCount =
    !row.isSingle &&
    (row as any).saleType === "PACKAGE" &&
    row.quantity > 1
      ? Math.min(Math.floor(row.quantity), 6)
      : 1;

  // ⚠️ בטעינה הכל בראשונה: המסד מחזיק סכום, לא פירוט.
  const [parts, setParts] = useState<string[]>(() => {
    const arr = Array(cartonCount).fill("");
    if (row.agentEnteredWeight != null) arr[0] = String(row.agentEnteredWeight);
    return arr;
  });

  // §326: ביטול פריט — אותה פעולה של שאר המסכים.
  async function cancelItem() {
    if (
      !window.confirm(
        `לבטל את "${row.productName}" מההזמנה?\n\nהפריט יוצא מהחישוב אך יישאר לתיעוד.`
      )
    )
      return;
    try {
      const res = await fetch(`/api/agent/order-item/${row.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isCancelled: true }),
      });
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        throw new Error(e.error || "הביטול נכשל");
      }
      onSaved(row.id);
    } catch (e: any) {
      alert(e?.message || "שגיאה");
    }
  }

  const partsSum = () =>
    Math.round(parts.reduce((a, x) => a + (Number(x) || 0), 0) * 100) / 100;
  const [saving, setSaving] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);
  const weightRef = useRef<HTMLInputElement>(null);

  const currentWeight = parseFloat(weightVal);
  const validWeight = !isNaN(currentWeight) && currentWeight > 0;
  const finalPrice = validWeight ? currentWeight * row.unitPrice : 0;

  async function saveWeight() {
    const w = parseFloat(weightVal);
    if (isNaN(w) || w <= 0) {
      // ערך לא תקין - איפוס
      setWeightVal("");
      return;
    }

    setSaving(true);
    try {
      // שימוש ב-API הקיים של weight-review-item שמעדכן actualWeight+finalWeight+finalPrice
      const res = await fetch(`/api/admin/weight-review-item/${row.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ actualWeight: w }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "שגיאה");

      // Flash ירוק - נראה 800ms ואז מסיר את השורה
      setSavedFlash(true);
      setTimeout(() => {
        onSaved(row.id);
      }, 600);
    } catch (e: any) {
      alert("שגיאה: " + e.message);
      setSaving(false);
    }
  }

  function handleKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      weightRef.current?.blur();
      // קפיצה לשדה הבא
      const next = document.querySelector<HTMLInputElement>(
        `input[data-weight-idx="${rowIdx + 1}"]`
      );
      if (next) setTimeout(() => next.focus(), 100);
    }
  }

  return (
    <tr
      className={`border-b border-zinc-100 hover:bg-yellow-50/30 transition-colors ${
        savedFlash ? "bg-emerald-100" : ""
      }`}
    >
      {/* לקוח */}
      <td className="px-3 py-2">
        <div className="font-bold text-brand-slatedark text-sm">
          {row.customerName}
        </div>
      </td>

      {/* טלפון */}
      <td className="px-3 py-2 text-xs" dir="ltr">
        <a
          href={`tel:${row.phone}`}
          className="text-brand-rust font-mono hover:underline"
        >
          {row.phone}
        </a>
      </td>

      {/* מספר הזמנה + מכירה */}
      <td className="px-3 py-2 text-xs text-zinc-500">
        <div className="font-bold">#{row.orderNumber}</div>
        <div className="text-[9px] text-zinc-400 truncate max-w-[70px]">
          {row.pricelistName}
        </div>
      </td>

      {/* מוצר */}
      <td className="px-3 py-2">
        <div className="flex items-center gap-1 flex-wrap">
          <span
            onDoubleClick={cancelItem}
            title={`${row.productName} · לחיצה כפולה לביטול`}
            className="font-semibold text-brand-slatedark cursor-pointer"
          >
            {row.productName}
          </span>
          {row.isSingle && (
            <span className="text-[9px] bg-amber-100 text-amber-700 px-1 py-0.5 rounded font-bold">
              בודדים
            </span>
          )}
        </div>
        {row.agentNote && (
          <div className="text-[10px] mt-0.5 bg-yellow-50 text-yellow-800 px-1.5 py-0.5 rounded inline-block">
            💬 {row.agentNote}
          </div>
        )}
      </td>

      {/* הוזמן */}
      <td className="px-3 py-2 text-xs text-zinc-600 whitespace-nowrap">
        {/* §312: 🐛 כל מה שאינו "בודדים" נקרא "קרטון" — גם כבד.
            
            מוצר UNIT (כבד ארוז, נקניק) נמכר ביחידות, לא
            בקרטונים. המנהל קרא "3 קרטון כבד" וחיפש קרטונים
            שלא קיימים.
            
            ⚠️ אותה הבחנה של §233 ו-§284: saleType === "PACKAGE"
            הוא הקרטון. השאר יחידות. */}
        {row.isSingle
          ? `${row.quantity} ק"ג`
          : (row as any).saleType === "PACKAGE"
            ? `${row.quantity} קרטון`
            : `${row.quantity} ${row.unit || "יח׳"}`}
      </td>

      {/* §326: 🗑️ ביטול פריט — גם מכאן.
          
          הפעולה קיימת בכל מסך אחר (§302/§315/§326), ולא במסך
          המשקלים של המנהל. מי שעובד שם היה צריך לצאת למסך
          ההזמנה כדי לבטל פריט אחד.
          
          ⚠️ לחיצה כפולה על שם המוצר — כמו בטבלת הנציג. */}
      {/* §312: מוצר יחידות — התווית "משקל" מטעה.
          
          המנהל מחפש משקולת למשהו שכתוב עליו 500 גרם. מה שנדרש
          כאן הוא **אישור כמות**: הלקוח הזמין 3 וקיבל 2. */}
      {/* משקל משוער */}
      <td className="px-3 py-2 text-xs text-zinc-500 whitespace-nowrap">
        {row.estimatedWeight ? `~${row.estimatedWeight.toFixed(1)} ק"ג` : "—"}
      </td>

      {/* שדה משקל בפועל - הלב של הטבלה */}
      <td className="px-2 py-1.5 text-center bg-emerald-50/30 relative">
        {/* §301: 📦 משבצת לכל קרטון.
            
            השוקל שוקל כל קרטון בנפרד. משבצת אחת אילצה אותו
            לחבר בראש - ושם נופלות הטעויות.
            
            ⚠️ מי ששקל ביחד ממלא הכל בראשונה ומשאיר ריק. */}
        {cartonCount > 1 ? (
          <div className="flex flex-col gap-1">
            {parts.map((p, i) => (
              <div key={i} className="flex items-center gap-1">
                <span className="text-[10px] text-zinc-400 w-3 shrink-0">
                  {i + 1}
                </span>
                <input
                  type="number"
                  inputMode="decimal"
                  step="0.01"
                  min="0"
                  value={p}
                  onChange={(e) => {
                    const next = [...parts];
                    next[i] = e.target.value;
                    setParts(next);
                  }}
                  onBlur={() => {
                    // ⚠️ הסכום נשמר — הפריט מחזיק משקל אחד.
                    const sum = parts.reduce(
                      (a, x) => a + (Number(x) || 0),
                      0
                    );
                    const r = Math.round(sum * 100) / 100;
                    setWeightVal(r > 0 ? String(r) : "");
                    // ⚠️ setTimeout כדי ש-weightVal יתעדכן לפני
                    // שהשמירה קוראת אותו.
                    setTimeout(() => saveWeight(), 0);
                  }}
                  disabled={saving}
                  placeholder="0.00"
                  className="w-full px-2 py-1.5 border-2 border-zinc-300 rounded-md text-center font-bold focus:outline-none focus:ring-2 focus:ring-brand-rust"
                />
              </div>
            ))}
            {/* ⚠️ הסכום מוצג: השוקל רואה מה יישמר בלי לחבר. */}
            {parts.some((x) => x !== "") && (
              <div className="text-[11px] font-bold text-emerald-700">
                סה״כ {partsSum()}
              </div>
            )}
          </div>
        ) : (
        <input
          ref={weightRef}
          type="number"
          inputMode="decimal"
          // §312: יחידות שלמות במוצר UNIT — אין חצי כבד.
          step={(row as any).saleType === "UNIT" ? "1" : "0.01"}
          min="0"
          value={weightVal}
          onChange={(e) => setWeightVal(e.target.value)}
          onBlur={saveWeight}
          onKeyDown={handleKey}
          disabled={saving}
          data-weight-idx={rowIdx}
          // §312: מוצר יחידות — הכמות שהתקבלה, לא משקל.
          placeholder={
            (row as any).saleType === "UNIT" ? `${row.quantity} יח׳` : "0.00"
          }
          autoFocus={rowIdx === 0}
          className={`w-full px-2 py-1.5 border-2 rounded-md text-center font-bold text-base focus:outline-none focus:ring-2 focus:ring-brand-rust transition-all ${
            savedFlash
              ? "border-emerald-500 bg-emerald-100"
              : validWeight
              ? "border-emerald-300 bg-emerald-50 text-emerald-800"
              : "border-zinc-300 bg-white"
          }`}
        />
        )}
        {saving && (
          <span className="absolute top-0 left-1 text-[8px] text-amber-600 animate-pulse">
            שומר...
          </span>
        )}
      </td>

      {/* מחיר סופי */}
      <td className="px-3 py-2 text-xs whitespace-nowrap">
        {finalPrice > 0 ? (
          <span className="text-brand-rust font-extrabold">
            ₪{finalPrice.toFixed(2)}
          </span>
        ) : (
          <span className="text-zinc-300">
            ₪{row.estimatedPrice.toFixed(2)}
          </span>
        )}
      </td>

      {/* קישור להזמנה */}
      <td className="px-2 py-1.5 text-center">
        <Link
          href={`/admin/orders/${row.orderId}`}
          target="_blank"
          className="inline-flex p-1 rounded hover:bg-blue-100 text-blue-600"
          title="פתח הזמנה"
        >
          <svg
            className="w-4 h-4"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
            />
          </svg>
        </Link>
      </td>
    </tr>
  );
}

// ═══════════════════════════════════════════════════════
// כרטיסים - מקובץ לפי הזמנה
// ═══════════════════════════════════════════════════════
function CardsView({ rows }: { rows: Row[] }) {
  // מקבץ לפי orderId
  const grouped = useMemo(() => {
    const map = new Map<string, { order: Row; items: Row[] }>();
    for (const r of rows) {
      const existing = map.get(r.orderId);
      if (existing) {
        existing.items.push(r);
      } else {
        map.set(r.orderId, { order: r, items: [r] });
      }
    }
    return Array.from(map.values());
  }, [rows]);

  return (
    <div className="space-y-3">
      {grouped.map(({ order, items }) => (
        <div
          key={order.orderId}
          className="bg-white rounded-2xl border border-zinc-200 shadow-sm overflow-hidden"
        >
          {/* Header */}
          <div className="px-4 py-3 border-b border-zinc-100 flex items-start justify-between gap-3">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs font-bold bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full">
                  #{order.orderNumber}
                </span>
                <span className="font-bold text-brand-slatedark">
                  {order.customerName}
                </span>
                <span className="text-xs bg-zinc-100 text-zinc-600 px-2 py-0.5 rounded-full font-bold">
                  {items.length} פריט{items.length > 1 ? "ים" : ""} ללא משקל
                </span>
              </div>
              <div className="text-xs text-zinc-500 mt-1 flex flex-wrap gap-x-3" dir="ltr">
                <span>📞 {order.phone}</span>
                {order.pointName && <span dir="rtl">📍 {order.pointName}</span>}
                <span dir="rtl">📄 {order.pricelistName}</span>
              </div>
            </div>
            <Link
              href={`/admin/orders/${order.orderId}`}
              className="shrink-0 text-xs px-3 py-2 bg-brand-rust text-white rounded-lg font-bold hover:bg-[#a83a15]"
            >
              פתח הזמנה →
            </Link>
          </div>

          {/* פריטים */}
          <div className="p-3 space-y-1">
            {items.map((item) => (
              <div
                key={item.id}
                className="bg-yellow-50 border border-yellow-200 rounded-lg px-3 py-2 flex items-center justify-between gap-2 text-sm"
              >
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-semibold text-brand-slatedark">
                    {item.productName}
                  </span>
                  {item.isSingle && (
                    <span className="text-[9px] bg-amber-200 text-amber-800 px-1 py-0.5 rounded font-bold">
                      בודדים
                    </span>
                  )}
                  <span className="text-xs text-zinc-600">
                    {item.isSingle
                      ? `${item.quantity} ק"ג`
                      : `${item.quantity} קרטון`}
                  </span>
                  {item.estimatedWeight && (
                    <span className="text-xs text-zinc-500">
                      (~{item.estimatedWeight.toFixed(1)} ק"ג)
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
