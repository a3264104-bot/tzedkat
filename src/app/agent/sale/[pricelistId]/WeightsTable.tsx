"use client";

// §81: טבלת המשקלים המרוכזת.
//
// ═══════════════════════════════════════════════════════════════
// למה נבנתה מחדש
// ═══════════════════════════════════════════════════════════════
// הטבלה הקודמת הייתה רשימה שטוחה: שורה לכל *פריט*. לקוח עם 6
// מוצרים תפס 6 שורות, ובנקודה עם 100 לקוחות זה 600 שורות גלילה.
// הנציג עמד בחלוקה עם הטלפון ביד וחיפש איפה הוא נמצא.
//
// כאן: **שורה לכל לקוח**, ועמודה לכל מוצר. הנציג רואה את כל
// ההזמנה של הלקוח בשורה אחת, ממלא, ועובר לבא.
//
// ═══════════════════════════════════════════════════════════════
// מניעת ההפסד — זו המטרה האמיתית
// ═══════════════════════════════════════════════════════════════
// משקל שלא מולא אינו "שדה ריק" אלא כסף שלא נגבה: קרטון שריר
// שנשכח הוא הפסד של כ-1,900 ש"ח בשורה אחת. לכן:
//
//   • תא ריק צועק - רקע אדום, מסגרת, ואנימציה
//   • מונה קבוע בראש המסך: "חסרים X משקלים"
//   • סגירת המכירה חסומה כל עוד יש חסר
//   • 0 הוא ערך **תקף** ומולא במפורש - "הלקוח לא קיבל" שונה
//     מ"שכחתי למלא", ורק ההבחנה הזו מאפשרת לחסום את השני.

import { useEffect, useMemo, useRef, useState } from "react";
import type { Order, OrderItem, AvailableProduct } from "./AgentSaleClient";
import { fmt } from "@/lib/pricing";
// §128: תצוגת יחידות - מקור אחד לכל המערכת
import { formatItemQty } from "@/lib/order-display";

type Props = {
  orders: Order[];
  availableProducts: AvailableProduct[];
  productWeightsFromNotes: Record<string, number>;
  productWeightsUsed: Record<string, number>;
  readOnly?: boolean;
  onItemUpdate: (orderId: string, itemId: string, updates: Partial<OrderItem>) => void;
  onNeedsReload: () => void;
  /** §81: דיווח על מספר המשקלים החסרים - לחסימת סגירת המכירה */
  onMissingCountChange?: (count: number) => void;
};

type Cell = {
  itemId: string;
  orderId: string;
  productName: string;
  isSingle: boolean;
  isCancelled: boolean;
  ordered: string;
  orderedQty: number;
  unitPrice: number;
  estimatedWeight: number | null;
  agentEnteredWeight: number | null;
};

type CustomerRow = {
  orderId: string;
  orderNumber: number;
  customerName: string;
  phone: string;
  /** productId -> תא. לקוח שלא הזמין מוצר מסוים פשוט לא יופיע כאן */
  cells: Map<string, Cell>;
  total: number;
  missing: number;
  /** §103: מתי הנציג סימן שסיים. null = טרם טופל. */
  agentClosedAt: string | null;
  // §130: מצב התשלום - לסימון מזומן מהטבלה
  paymentStatus: string | null;
  finalTotal: number | null;
};

export function WeightsTable({
  orders,
  availableProducts,
  readOnly,
  onItemUpdate,
  onNeedsReload,
  onMissingCountChange,
}: Props) {
  // ─── עמודות: כל המוצרים שהוזמנו בפועל ───
  // לא כל הקטלוג - רק מה שמישהו הזמין. מוצר שאיש לא הזמין הוא
  // עמודה ריקה שגוזלת רוחב מסך יקר.
  //
  // הסדר לפי כמות המזמינים: המוצרים הנפוצים משמאל, קרוב לשם
  // הלקוח, כדי שהנציג ימלא את רובם בלי גלילה אופקית.
  const columns = useMemo(() => {
    const counts = new Map<string, { id: string; name: string; n: number }>();
    for (const o of orders) {
      for (const it of o.items) {
        if (it.isCancelled) continue;
        const cur = counts.get(it.productId) || {
          id: it.productId,
          name: it.productName,
          n: 0,
        };
        cur.n++;
        counts.set(it.productId, cur);
      }
    }
    return Array.from(counts.values()).sort(
      (a, b) => b.n - a.n || a.name.localeCompare(b.name, "he")
    );
  }, [orders]);

  // ─── שורות: לקוח אחד לשורה ───
  const rows = useMemo<CustomerRow[]>(() => {
    return orders
      .filter((o) => o.items.some((i) => !i.isCancelled))
      .map((o) => {
        const cells = new Map<string, Cell>();
        let total = 0;
        let missing = 0;
        for (const it of o.items) {
          if (it.isCancelled) continue;
          const w = it.agentEnteredWeight;
          // null = לא מולא. 0 = מולא במפורש ("לא קיבל").
          if (w === null || w === undefined) missing++;
          else total += w * it.unitPrice;
          cells.set(it.productId, {
            itemId: it.id,
            orderId: o.id,
            productName: it.productName,
            isSingle: it.isSingle,
            isCancelled: it.isCancelled,
            // §128: 🐛 שני באגים כאן.
            //
            // 1. "קרטון" היה מקודד: מוצר שנמכר ביחידות (בקר טחון,
            //    כבד) הוצג לנציג כקרטון, והוא היה שוקל את הדבר
            //    הלא נכון.
            //
            // 2. `קרטון + "ים"` נותן "קרטוןים" - האות הסופית לא
            //    טופלה. formatItemQty מטפל בשניהם.
            ordered: formatItemQty({
              isSingle: it.isSingle,
              quantity: it.quantity,
              unit: it.unit,
            }),
            orderedQty: it.quantity,
            unitPrice: it.unitPrice,
            estimatedWeight: it.estimatedWeight,
            agentEnteredWeight: w ?? null,
          });
        }
        return {
          orderId: o.id,
          orderNumber: o.orderNumber,
          customerName: o.customerName,
          phone: o.phone,
          cells,
          total,
          missing,
          agentClosedAt: (o as any).agentClosedAt ?? null,
          paymentStatus: (o as any).paymentStatus ?? null,
          finalTotal: (o as any).finalTotal ?? null,
        };
      });
  }, [orders]);

  const totalMissing = rows.reduce((s, r) => s + r.missing, 0);
  const closedCount = rows.filter((r) => r.agentClosedAt).length;

  // §118: התא החסר הראשון - לקפיצה ישירה. סורק לפי סדר התצוגה,
  // כך שהנציג עובר על החסרים בסדר הגיוני ולא קופץ אחורה וקדימה.
  const firstMissing = useMemo(() => {
    for (const r of rows) {
      if (r.missing === 0) continue;
      for (const c of columns) {
        const cell = r.cells.get(c.id);
        if (cell && cell.agentEnteredWeight === null) {
          return {
            cellId: `w-${r.orderId}-${c.id}`,
            customerName: r.customerName,
            productName: c.name,
          };
        }
      }
    }
    return null;
  }, [rows, columns]);
  const grandTotal = rows.reduce((s, r) => s + r.total, 0);

  useEffect(() => {
    onMissingCountChange?.(totalMissing);
  }, [totalMissing, onMissingCountChange]);

  return (
    <div className="bg-white rounded-2xl border border-zinc-200 shadow-sm overflow-hidden">
      {/* ─── פס מצב דביק ─── */}
      {/* דביק בכוונה: הנציג גולל בין 100 לקוחות, והמספר החסר חייב
          להישאר מול העיניים כל הזמן. */}
      <div
        className={`sticky top-0 z-20 px-4 py-2.5 border-b-2 flex items-center justify-between gap-3 flex-wrap ${
          totalMissing > 0
            ? "bg-red-50 border-red-300"
            : "bg-emerald-50 border-emerald-300"
        }`}
      >
        <div className="flex items-center gap-2">
          {totalMissing > 0 ? (
            <>
              <span className="text-xl">⚠️</span>
              <div>
                <div className="font-extrabold text-red-800 text-sm">
                  חסרים {totalMissing} משקלים
                </div>
                <div className="text-[11px] text-red-700">
                  לא ניתן לסגור את המכירה עד שכולם ימולאו. לא קיבל סחורה? הזן 0.
                </div>
                {/* §118: קפיצה אל החסר הראשון.
                    "חסרים 7" בלי דרך למצוא אותם הוא תסכול: בטבלה
                    של 100 שורות ו-12 עמודות, הנציג גולל ומחפש
                    תאים אדומים במקום לעבוד. */}
                {firstMissing && (
                  <button
                    type="button"
                    onClick={() => {
                      const el = document.getElementById(firstMissing.cellId);
                      el?.scrollIntoView({ behavior: "smooth", block: "center", inline: "center" });
                      (el as HTMLInputElement | null)?.focus();
                    }}
                    className="mt-1 text-[11px] font-bold bg-red-600 text-white rounded-lg px-2.5 py-1"
                  >
                    ← קפוץ אל {firstMissing.customerName} · {firstMissing.productName}
                  </button>
                )}
              </div>
            </>
          ) : (
            <>
              <span className="text-xl">✓</span>
              <div className="font-extrabold text-emerald-800 text-sm">
                כל המשקלים מולאו
              </div>
            </>
          )}
        </div>
        <div className="flex items-center gap-3">
          {/* §103: כמה לקוחות כבר טופלו - הנציג רואה את ההתקדמות
              שלו במבט אחד, בלי לספור שורות. */}
          <div className="text-xs font-bold text-zinc-600">
            טופלו {closedCount} מתוך {rows.length}
          </div>
          <div className="text-sm font-bold text-brand-slatedark">
            סה״כ: {fmt(grandTotal)}
          </div>
        </div>
      </div>

      <div className="px-4 py-2 bg-zinc-50 border-b border-zinc-200 text-[10px] text-zinc-500">
        Tab/Enter = השדה הבא · השמירה אוטומטית · לחיצה על שם הלקוח פותחת את ההזמנה המלאה
      </div>

      {/* ─── הטבלה ─── */}
      <div className="overflow-x-auto">
        <table className="text-sm border-collapse">
          <thead>
            <tr className="bg-zinc-100 border-b-2 border-zinc-300">
              {/* עמודת הלקוח קפואה - היא נקודת הייחוס בגלילה אופקית */}
              <th className="sticky right-0 z-10 bg-zinc-100 text-right px-3 py-2 min-w-[140px] border-l-2 border-zinc-300 text-[11px] font-bold text-zinc-600">
                שם הלקוח
              </th>
              {columns.map((c) => (
                <th
                  key={c.id}
                  className="px-2 py-2 min-w-[120px] border-l border-zinc-200 text-[11px] font-bold text-zinc-700"
                >
                  {c.name}
                </th>
              ))}
              <th className="px-3 py-2 min-w-[90px] border-l border-zinc-200 text-[11px] font-bold text-zinc-600">
                סה״כ הזמנה
              </th>
              {/* §103: עמודת הסימון - קפואה בקצה, כי זו הפעולה
                  שהנציג מחפש אחרי שסיים למלא את השורה. */}
              {/* §130: תשלום. הלקוח מביא מזומן בחלוקה, והנציג
                  חייב לסמן **בזמן אמת** - אחרת הכרטיס יחויב בערב
                  והוא ישלם פעמיים.
                  
                  ⚠️ בטבלה ולא רק בכרטיס ההזמנה: כאן הנציג עובד
                  בפועל, ומעבר בין מסכים על כל לקוח לא יקרה. */}
              <th className="px-3 py-2 min-w-[90px] border-l border-zinc-200 text-[11px] font-bold text-zinc-600">
                תשלום
              </th>
              <th className="sticky left-0 z-10 bg-zinc-100 px-3 py-2 min-w-[80px] border-r-2 border-zinc-300 text-[11px] font-bold text-zinc-600">
                טופל
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr
                key={r.orderId}
                className={`border-b border-zinc-200 ${
                  r.missing > 0 ? "bg-red-50/40" : "hover:bg-zinc-50"
                }`}
              >
                <td className="sticky right-0 z-10 bg-inherit px-3 py-2 border-l-2 border-zinc-300 align-middle">
                  <a
                    href={`/agent/orders/${r.orderId}`}
                    className="font-bold text-brand-slatedark hover:text-brand-rust block leading-tight"
                  >
                    {r.customerName}
                  </a>
                  <span className="text-[10px] text-zinc-400">#{r.orderNumber}</span>
                </td>

                {columns.map((c) => {
                  const cell = r.cells.get(c.id);
                  return (
                    <td
                      key={c.id}
                      className="px-1.5 py-1.5 border-l border-zinc-200 align-middle text-center"
                    >
                      {cell ? (
                        <WeightCell
                          // §118: מזהה לקפיצה אל התא החסר
                          cellId={`w-${r.orderId}-${c.id}`}
                          cell={cell}
                          readOnly={readOnly}
                          onItemUpdate={onItemUpdate}
                          onNeedsReload={onNeedsReload}
                        />
                      ) : (
                        // לא הזמין את המוצר - תא מושתק ולא ריק, כדי
                        // שלא ייראה כמו משקל שנשכח
                        <span className="text-zinc-200 select-none">—</span>
                      )}
                    </td>
                  );
                })}

                <td
                  className={`px-3 py-2 border-l border-zinc-200 text-center font-extrabold ${
                    r.missing > 0 ? "text-zinc-400" : "text-brand-rust"
                  }`}
                >
                  {r.missing > 0 ? (
                    <span className="text-[11px] text-red-700 font-bold">
                      חסר {r.missing}
                    </span>
                  ) : (
                    fmt(r.total)
                  )}
                </td>

                <td className="px-2 py-2 border-l border-zinc-200 text-center">
                  <CashCell
                    orderId={r.orderId}
                    orderNumber={r.orderNumber}
                    customerName={r.customerName}
                    paymentStatus={r.paymentStatus}
                    finalTotal={r.finalTotal}
                    missing={r.missing}
                    readOnly={readOnly}
                    onDone={onNeedsReload}
                  />
                </td>

                <td className="sticky left-0 z-10 bg-inherit px-2 py-2 border-r-2 border-zinc-300 text-center">
                  <CloseOrderCheck
                    orderId={r.orderId}
                    orderNumber={r.orderNumber}
                    customerName={r.customerName}
                    missing={r.missing}
                    closedAt={r.agentClosedAt}
                    readOnly={readOnly}
                    onDone={onNeedsReload}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {rows.length === 0 && (
        <div className="p-8 text-center text-zinc-500 text-sm">
          אין הזמנות להזנה בנקודה זו.
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// תא בודד: כמות שהוזמנה, שדה משקל, וסכום
// ─────────────────────────────────────────────────────────────
function WeightCell({
  cell,
  cellId,
  readOnly,
  onItemUpdate,
  onNeedsReload,
}: {
  cell: Cell;
  cellId: string;
  readOnly?: boolean;
  onItemUpdate: (orderId: string, itemId: string, updates: Partial<OrderItem>) => void;
  onNeedsReload: () => void;
}) {
  const [val, setVal] = useState(
    cell.agentEnteredWeight !== null ? String(cell.agentEnteredWeight) : ""
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setVal(cell.agentEnteredWeight !== null ? String(cell.agentEnteredWeight) : "");
  }, [cell.agentEnteredWeight]);

  // null ולא 0: "לא מולא" ו"מולא 0" הם שני מצבים שונים לגמרי, וזו
  // כל ההבחנה שמאפשרת לחסום סגירת מכירה על שכחה.
  const isMissing = cell.agentEnteredWeight === null;
  const lineTotal =
    cell.agentEnteredWeight !== null ? cell.agentEnteredWeight * cell.unitPrice : 0;

  async function save() {
    const raw = val.trim();
    if (raw === "") return; // ריק = לא נגעו; לא שולחים כלום
    const w = Number(raw);
    if (!Number.isFinite(w) || w < 0) {
      setError(true);
      setVal(cell.agentEnteredWeight !== null ? String(cell.agentEnteredWeight) : "");
      setTimeout(() => setError(false), 1500);
      return;
    }
    if (w === cell.agentEnteredWeight) return;

    setSaving(true);
    try {
      const res = await fetch(`/api/agent/order-item/${cell.itemId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agentEnteredWeight: w }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "שגיאה");
      // finalPrice אינו חלק מטיפוס OrderItem במסך הזה, וגם אין בו
      // צורך: הסכום המוצג נגזר מ-agentEnteredWeight × unitPrice.
      onItemUpdate(cell.orderId, cell.itemId, {
        agentEnteredWeight: json.item.agentEnteredWeight,
        actualWeight: json.item.actualWeight,
      });
    } catch {
      setError(true);
      setVal(cell.agentEnteredWeight !== null ? String(cell.agentEnteredWeight) : "");
      setTimeout(() => setError(false), 2000);
      onNeedsReload();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col items-center gap-0.5 min-w-[100px]">
      {/* מה הוזמן - קטן, רק כדי לדעת מול מה שוקלים */}
      <div className="text-[10px] text-zinc-500 leading-none">{cell.ordered}</div>

      <input
        ref={inputRef}
        id={cellId}
        type="number"
        inputMode="decimal"
        step="0.01"
        min={0}
        dir="ltr"
        disabled={readOnly || saving}
        value={val}
        onChange={(e) => setVal(e.target.value)}
        onBlur={save}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            (e.target as HTMLInputElement).blur();
          }
        }}
        placeholder={cell.estimatedWeight ? `~${cell.estimatedWeight}` : "משקל"}
        // ⚠️ תא חסר צועק: אדום מלא + מסגרת עבה + פעימה. משקל שנשכח
        // הוא כסף שלא נגבה, ולכן הוא לא יכול להיראות כמו שדה רגיל.
        className={`w-full text-center font-bold rounded-md py-1.5 border-2 transition-colors ${
          error
            ? "border-red-600 bg-red-100 text-red-800"
            : isMissing
              ? "border-red-500 bg-red-100 text-red-900 placeholder-red-400 animate-pulse"
              : "border-emerald-400 bg-emerald-50 text-emerald-900"
        } ${readOnly ? "opacity-60" : ""}`}
      />

      {/* הסכום שיצא למוצר הזה */}
      <div
        className={`text-[10px] font-bold leading-none ${
          isMissing ? "text-red-400" : "text-brand-rust"
        }`}
      >
        {saving ? "שומר…" : isMissing ? "—" : fmt(lineTotal)}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// §103: הוי"ו — סימון הנציג שסיים לטפל בלקוח
// ─────────────────────────────────────────────────────────────
// למה זה נחוץ בנוסף למונה המשקלים החסרים: המונה אומר מה **חסר
// למערכת**; הוי"ו אומר מה **הנציג כבר בדק**. בחלוקה עם 100 לקוחות
// הנציג צריך לדעת איפה הוא נמצא, ולא רק אם נשארו שדות ריקים.
//
// אי אפשר לסמן הזמנה עם משקל חסר - השרת חוסם, וכאן הכפתור אפור
// עם הסבר. בלי החסימה הזו הוי"ו היה קישוט.
function CloseOrderCheck({
  orderId,
  orderNumber,
  customerName,
  missing,
  closedAt,
  readOnly,
  onDone,
}: {
  orderId: string;
  orderNumber: number;
  customerName: string;
  missing: number;
  closedAt: string | null;
  readOnly?: boolean;
  onDone: () => void;
}) {
  const [saving, setSaving] = useState(false);
  const closed = !!closedAt;

  async function toggle() {
    if (missing > 0 && !closed) {
      alert(
        `לא ניתן לסמן את ${customerName} כטופל.\n\nחסרים ${missing} משקלים בהזמנה #${orderNumber}.\n\nלקוח שלא קיבל פריט — יש להזין 0.`
      );
      return;
    }
    if (closed && !window.confirm(`לבטל את הסימון של ${customerName}?`)) return;

    setSaving(true);
    try {
      const res = await fetch(`/api/agent/orders/${orderId}/close`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ closed: !closed }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "שגיאה");
      onDone();
    } catch (e: any) {
      alert(e.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={saving || readOnly}
      title={
        closed
          ? `טופל ב-${new Date(closedAt!).toLocaleString("he-IL")}`
          : missing > 0
            ? `חסרים ${missing} משקלים`
            : "סמן כטופל"
      }
      className={`w-9 h-9 rounded-lg border-2 font-extrabold text-lg transition-colors disabled:opacity-50 ${
        closed
          ? "border-emerald-500 bg-emerald-500 text-white"
          : missing > 0
            ? "border-zinc-300 bg-zinc-100 text-zinc-300 cursor-not-allowed"
            : "border-emerald-400 bg-white text-emerald-500 hover:bg-emerald-50"
      }`}
    >
      {saving ? "…" : "✓"}
    </button>
  );
}

// ─────────────────────────────────────────────────────────────
// §130: סימון תשלום מזומן מתוך הטבלה
// ─────────────────────────────────────────────────────────────
// התרחיש: לקוח רשום כמשלם באשראי, אבל ביום החלוקה הביא מזומן.
// אם הנציג לא מסמן - הכרטיס יחויב בערב והלקוח ישלם פעמיים.
//
// ⚠️ למה כאן ולא רק בכרטיס ההזמנה: הנציג עובד בטבלה. מעבר למסך
// אחר על כל לקוח פשוט לא יקרה בחלוקה, והסימון יישכח.
//
// ⚠️ דורש מחיר סופי, כלומר שכל המשקלים של הלקוח מולאו. סימון
// לפני כן היה נועל סכום שאינו מה שהלקוח חייב.
function CashCell({
  orderId,
  orderNumber,
  customerName,
  paymentStatus,
  finalTotal,
  missing,
  readOnly,
  onDone,
}: {
  orderId: string;
  orderNumber: number;
  customerName: string;
  paymentStatus: string | null;
  finalTotal: number | null;
  missing: number;
  readOnly?: boolean;
  onDone: () => void;
}) {
  const [saving, setSaving] = useState(false);
  const paid = paymentStatus === "PAID" || paymentStatus === "PARTIALLY_PAID";

  if (paid) {
    return (
      <span className="text-[10px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded px-1.5 py-1 block">
        ✓ שולם
      </span>
    );
  }

  const blocked = missing > 0 || finalTotal == null;

  async function markCash() {
    if (blocked) {
      alert(
        missing > 0
          ? `יש להשלים את המשקלים של ${customerName} לפני סימון תשלום.\n\nחסרים ${missing} משקלים.`
          : "יש לקבוע מחיר סופי לפני סימון תשלום."
      );
      return;
    }
    if (
      !window.confirm(
        `${customerName} שילם ${finalTotal} ש"ח במזומן?\n\nההזמנה תסומן כשולמה והכרטיס לא יחויב.`
      )
    )
      return;

    setSaving(true);
    try {
      const res = await fetch(`/api/admin/orders/${orderId}/cash-payment`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          amountPaid: finalTotal,
          note: "שולם במזומן בחלוקה",
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "שגיאה");
      onDone();
    } catch (e: any) {
      alert(e.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <button
      type="button"
      onClick={markCash}
      disabled={saving || readOnly}
      title={
        blocked
          ? "יש להשלים משקלים לפני סימון תשלום"
          : `סמן שקיבלת ${finalTotal} ש"ח במזומן`
      }
      className={`w-full text-[10px] font-bold rounded border-2 py-1 transition-colors disabled:opacity-50 ${
        blocked
          ? "border-zinc-200 bg-zinc-50 text-zinc-300 cursor-not-allowed"
          : "border-amber-400 bg-white text-amber-800 hover:bg-amber-500 hover:text-white"
      }`}
    >
      {saving ? "…" : "💵 מזומן"}
    </button>
  );
}
