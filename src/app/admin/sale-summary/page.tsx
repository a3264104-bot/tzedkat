"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/client";
import { fmt, STATUS_LABELS } from "@/lib/pricing";
import { payStatusLabel, payStatusColor } from "@/lib/pay-status-lib";

type ProductRow = {
  productId: string;
  productName: string;
  unit: string;
  totalQuantity: number;
  singlesQuantity: number;
  totalEstimatedWeight: number;
  totalActualWeight: number;
  orderCount: number;
  limitedQty: boolean;
  limitedQtyAmount: number | null;
  overLimit: boolean;
  nearLimit: boolean;
};

type PointOrder = {
  orderNumber: number;
  customerName: string;
  phone: string;
  status: string;
  paymentStatus: string;
  itemCount: number;
  finalTotal: number | null;
  estimatedTotal: number;
  items: { productName: string; quantity: number; unit: string; isSingle: boolean }[];
};

type PointRow = {
  pointId: string;
  pointName: string;
  city: string | null;
  orderCount: number;
  paidCount: number;
  estimatedTotal: number;
  finalTotal: number;
  orders: PointOrder[];
};

type Summary = {
  pricelist: { id: string; name: string; deliveryDateText: string | null; status: string };
  paymentSummary: {
    totalOrders: number;
    paid: number;
    pending: number;
    estimatedSum: number;
    finalSum: number;
    paidSum: number;
  };
  products: ProductRow[];
  points: PointRow[];
};

// ייצוא CSV תואם אקסל (BOM לעברית)
function downloadCsv(filename: string, rows: string[][]) {
  const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\r\n");
  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export default function SaleSummaryPage() {
  const [data, setData] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  // אילו נקודות פתוחות כרגע (Set מאפשר לפתוח כמה במקביל, לא כמו accordion)
  const [openPoints, setOpenPoints] = useState<Set<string>>(new Set());
  // אילו נקודות המנהל בחר להציג. null = הצג את כולן (ברירת מחדל).
  // Set של pointIds = הצג רק אותן. שימושי כשיש הרבה נקודות ורוצים להתמקד ב-1-2.
  const [visiblePointIds, setVisiblePointIds] = useState<Set<string> | null>(null);
  const [showPointFilter, setShowPointFilter] = useState(false);

  function togglePointOpen(pointId: string) {
    setOpenPoints((prev) => {
      const next = new Set(prev);
      if (next.has(pointId)) next.delete(pointId);
      else next.add(pointId);
      return next;
    });
  }

  function togglePointVisible(pointId: string) {
    setVisiblePointIds((prev) => {
      // אם עוד לא בחרו כלום (null), מתחילים set חדש עם כל השאר חוץ מזה שהוסר
      if (prev === null) {
        // ברגע שהמשתמש מסיר נקודה - מציגים את השאר
        const all = new Set(data?.points.map((p) => p.pointId) ?? []);
        all.delete(pointId);
        return all;
      }
      const next = new Set(prev);
      if (next.has(pointId)) next.delete(pointId);
      else next.add(pointId);
      // אם המנהל סימן שוב את כולם - חוזרים ל-null (הכל)
      if (next.size === (data?.points.length ?? 0)) return null;
      return next;
    });
  }

  function selectAllPoints() {
    setVisiblePointIds(null);
  }

  function selectNonePoints() {
    setVisiblePointIds(new Set());
  }

  async function load() {
    setLoading(true);
    setError("");
    try {
      const d = await api("/api/admin/sale-summary");
      setData(d);
    } catch (e: any) {
      setError(e.message || "אין מכירה פעילה");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    load();
  }, []);

  function exportProductsCsv() {
    if (!data) return;
    const rows: string[][] = [
      ["מוצר", "קרטונים", 'בודדים (ק"ג/יח\')', 'סה"כ משקל (ק"ג)', 'משקל בפועל (ק"ג)', "הזמנות", "מגבלה"],
      ...data.products.map((p) => {
        const singlesOnly = Number(p.singlesQuantity || 0);
        const cartonsOnly = Math.max(0, Number(p.totalQuantity) - singlesOnly);
        const singlesUnit = p.unit === "יחידה" || p.unit === "יחידות" ? "יח'" : 'ק"ג';
        return [
          p.productName,
          cartonsOnly > 0 ? String(cartonsOnly) : "",
          singlesOnly > 0 ? `${singlesOnly} ${singlesUnit}` : "",
          p.totalEstimatedWeight ? String(p.totalEstimatedWeight) : "",
          p.totalActualWeight ? String(p.totalActualWeight) : "",
          String(p.orderCount),
          p.limitedQtyAmount != null ? String(p.limitedQtyAmount) : "",
        ];
      }),
    ];
    downloadCsv(`סיכום-מוצרים-${data.pricelist.name}.csv`, rows);
  }

  // ─── §23: תזכורת חלוקה ללקוחות ───────────────────────────────
  // שליחה יזומה. לפני השליחה מציגים למנהל בדיוק כמה לקוחות יקבלו
  // וכמה נשארים בחוץ בלי מייל - זה מייל לעשרות אנשים ולא כדאי
  // לגלות אחרי מי קיבל.
  const [reminderBusy, setReminderBusy] = useState(false);

  async function sendDeliveryReminder() {
    if (!data) return;
    setReminderBusy(true);
    try {
      const pid = data.pricelist.id;
      const preview = await api(`/api/admin/delivery-reminder?pricelistId=${pid}`);
      if (preview.recipientCount === 0) {
        alert("אין לקוחות עם כתובת מייל במכירה הזו.");
        return;
      }
      const warnDate = preview.hasDeliveryDate
        ? ""
        : "\n\n⚠️ למכירה זו לא הוגדר תאריך חלוקה — המייל יישלח בלי התאריך העברי.";
      const warnNoMail =
        preview.noEmailCount > 0
          ? `\n(${preview.noEmailCount} לקוחות ללא מייל יקבלו צינתוק קולי)`
          : "";
      const ok = confirm(
        `לשלוח תזכורת חלוקה ל-${preview.recipientCount} לקוחות?${warnNoMail}${warnDate}`
      );
      if (!ok) return;

      const res = await api("/api/admin/delivery-reminder", {
        method: "POST",
        body: JSON.stringify({ pricelistId: pid }),
      });
      alert(
        `נשלחו ${res.sent} תזכורות במייל.` +
          (res.voiceSent ? `\n${res.voiceSent} צינתוקים קוליים ללקוחות ללא מייל.` : "") +
          (res.failed ? `\n${res.failed} נכשלו.` : "") +
          (res.voiceFailed ? `\n${res.voiceFailed} צינתוקים נכשלו.` : "") +
          (res.voiceSkipped
            ? `\n\n⚠️ הצינתוקים לא נשלחו - חסרות הגדרות YEMOT_USER ו-YEMOT_PASSWORD.`
            : "")
      );
    } catch (e: any) {
      alert("שגיאה: " + e.message);
    } finally {
      setReminderBusy(false);
    }
  }

  // ─── טבלת הזמנה לספק: מוצר × נקודת חלוקה ───────────────────────
  // למה: הייצוא הקיים ("רשימת איסוף") נותן שורה לכל *לקוח* - מצוין
  // לחלוקה בנקודה, אבל חסר תועלת כשצריך להזמין מהספק. כדי להזמין צריך
  // את הצבירה ההפוכה: כמה קרטונים מכל מוצר, ואיך הם מתפצלים לנקודות.
  //
  // קרטונים ובודדים מופיעים בשורות נפרדות בכוונה - הם יחידות שונות
  // (קרטון מול ק"ג) ושורות הזמנה שונות מול הספק, ואסור לחבר ביניהן.
  // תא ריק = המוצר הזה לא מוזמן לנקודה הזו, כלומר אין מה לשלוח לשם.
  type MatrixRow = {
    key: string;
    productName: string;
    isSingle: boolean;
    unitLabel: string;
    total: number;
    byPoint: Record<string, number>;
  };

  function buildOrderMatrix(): { rows: MatrixRow[]; points: PointRow[] } {
    if (!data) return { rows: [], points: [] };
    const visible = data.points.filter(
      (pt) => visiblePointIds === null || visiblePointIds.has(pt.pointId)
    );
    const map = new Map<string, MatrixRow>();

    for (const pt of visible) {
      for (const o of pt.orders) {
        for (const it of o.items) {
          // מפתח מורכב: אותו מוצר בקרטונים ובבודדים = שתי שורות
          const key = `${it.productName}__${it.isSingle ? "S" : "C"}`;
          let row = map.get(key);
          if (!row) {
            row = {
              key,
              productName: it.productName,
              isSingle: it.isSingle,
              unitLabel: it.isSingle
                ? it.unit === "יחידה" || it.unit === "יחידות"
                  ? "יח'"
                  : 'ק"ג'
                : "קרטון",
              total: 0,
              byPoint: {},
            };
            map.set(key, row);
          }
          const qty = Number(it.quantity);
          row.total += qty;
          row.byPoint[pt.pointId] = (row.byPoint[pt.pointId] || 0) + qty;
        }
      }
    }

    const rows = Array.from(map.values())
      .map((r) => ({
        ...r,
        total: Math.round(r.total * 1000) / 1000,
        byPoint: Object.fromEntries(
          Object.entries(r.byPoint).map(([k, v]) => [k, Math.round(v * 1000) / 1000])
        ),
      }))
      // קרטונים קודם (זה מה שמזמינים), ובתוך כל קבוצה לפי כמות יורדת
      .sort((a, b) => {
        if (a.isSingle !== b.isSingle) return a.isSingle ? 1 : -1;
        return b.total - a.total;
      });

    return { rows, points: visible };
  }

  function exportOrderMatrixCsv() {
    const { rows, points } = buildOrderMatrix();
    if (rows.length === 0) return;
    const header = ["מוצר", "יחידה", 'סה"כ להזמנה', ...points.map((p) => p.pointName)];
    const body = rows.map((r) => [
      r.productName,
      r.unitLabel,
      String(r.total),
      ...points.map((p) => (r.byPoint[p.pointId] ? String(r.byPoint[p.pointId]) : "")),
    ]);
    downloadCsv(`הזמנה-לספק-${data?.pricelist.name || "מכירה"}.csv`, [header, ...body]);
  }

  function exportPointCsv(point: PointRow) {    if (!data) return;
    const rows: string[][] = [
      ["הזמנה", "שם", "טלפון", "סטטוס", "תשלום", "פריטים", 'סה"כ'],
      ...point.orders.map((o) => [
        `#${o.orderNumber}`,
        o.customerName,
        o.phone,
        STATUS_LABELS[o.status] ?? o.status,
        payStatusLabel(o.paymentStatus),
        o.items
          .map((it) => {
            const qty = Number(it.quantity);
            const label = it.isSingle
              ? it.unit === "יחידה" || it.unit === "יחידות"
                ? `${qty} יח'`
                : `${qty} ק"ג`
              : `${qty} קרטון${qty > 1 ? "ים" : ""}`;
            return `${it.productName} · ${label}`;
          })
          .join(" | "),
        o.finalTotal != null ? String(o.finalTotal) : `~${o.estimatedTotal}`,
      ]),
    ];
    downloadCsv(`רשימת-איסוף-${point.pointName}.csv`, rows);
  }

  if (loading) return <p className="text-zinc-500">טוען...</p>;
  if (error || !data)
    return (
      <div className="card p-6 text-center text-zinc-500">
        {error || "אין מכירה פעילה כרגע"}
      </div>
    );

  const ps = data.paymentSummary;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold text-brand-slatedark">סיכום מכירה</h1>
          <p className="text-sm text-zinc-500">
            {data.pricelist.name}
            {data.pricelist.deliveryDateText && ` · חלוקה: ${data.pricelist.deliveryDateText}`}
          </p>
        </div>
        <button
          onClick={sendDeliveryReminder}
          disabled={reminderBusy}
          className="btn-ghost btn-sm no-print"
          title="שליחת תזכורת ללקוחות עם מועד ומיקום החלוקה"
        >
          {reminderBusy ? "שולח..." : "✉ שלח תזכורת חלוקה"}
        </button>
        <button onClick={() => window.print()} className="btn-ghost btn-sm no-print">
          🖨 הדפסה
        </button>
      </div>

      {/* כרטיסי סיכום */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="card p-4 text-center">
          <div className="text-2xl font-extrabold text-brand-slatedark">{ps.totalOrders}</div>
          <div className="text-xs text-zinc-500">הזמנות</div>
        </div>
        <div className="card p-4 text-center">
          <div className="text-2xl font-extrabold text-green-600">{ps.paid}</div>
          <div className="text-xs text-zinc-500">שולמו</div>
        </div>
        <div className="card p-4 text-center">
          <div className="text-2xl font-extrabold text-amber-600">{ps.pending}</div>
          <div className="text-xs text-zinc-500">ממתינות לתשלום</div>
        </div>
        <div className="card p-4 text-center">
          <div className="text-2xl font-extrabold text-brand-rust">{fmt(ps.paidSum)}</div>
          <div className="text-xs text-zinc-500">התקבל בפועל</div>
        </div>
      </div>

      {/* התראות מלאי מוגבל */}
      {data.products.some((p) => p.overLimit || p.nearLimit) && (
        <div className="space-y-2">
          {data.products
            .filter((p) => p.overLimit || p.nearLimit)
            .map((p) => (
              <div
                key={p.productId}
                className={`card p-3 text-sm font-medium ${
                  p.overLimit
                    ? "bg-red-50 border-red-200 text-red-700"
                    : "bg-amber-50 border-amber-200 text-amber-700"
                }`}
              >
                {p.overLimit ? "🔴" : "⚠️"} {p.productName}: הוזמנו {p.totalQuantity} מתוך מגבלה
                של {p.limitedQtyAmount}
                {p.overLimit ? " — המכסה מלאה!" : " — מתקרב למכסה"}
              </div>
            ))}
        </div>
      )}

      {/* טבלת מוצרים - להזמנה מהספק */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-lg font-bold text-brand-slatedark">
            סיכום לפי מוצר (להזמנה מהספק)
          </h2>
          <button onClick={exportProductsCsv} className="btn-ghost btn-sm no-print">
            ⬇ ייצוא לאקסל
          </button>
        </div>

        {/* הסבר קצר בראש הטבלה */}
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-2.5 mb-2 text-xs text-blue-900">
          💡 <strong>שים לב:</strong> "קרטונים" = יחידות שלמות של קרטון. "בודדים" = חלקים
          שהוזמנו לפי משקל (בק״ג). "סה״כ משקל" מסכם את שניהם למשקל כולל להזמנה מהספק.
        </div>

        <div className="table-wrap">
          <table className="admin">
            <thead>
              <tr>
                <th>מוצר</th>
                <th className="text-center">קרטונים</th>
                <th className="text-center">בודדים</th>
                <th className="text-center">סה״כ משקל</th>
                <th className="text-center">הזמנות</th>
              </tr>
            </thead>
            <tbody>
              {data.products.map((p) => {
                // 🔎 חישוב חכם:
                // ה-API מחזיר totalQuantity שכולל את הכל (קרטונים + בודדים)
                // ו-singlesQuantity שהוא רק הבודדים.
                // לכן: קרטונים נטו = totalQuantity - singlesQuantity
                const cartonsOnly = Math.max(
                  0,
                  Number(p.totalQuantity) - Number(p.singlesQuantity || 0)
                );
                const singlesOnly = Number(p.singlesQuantity || 0);
                const hasCartons = cartonsOnly > 0;
                const hasSingles = singlesOnly > 0;
                const totalWeight = Number(p.totalEstimatedWeight || 0);

                return (
                  <tr key={p.productId} className={p.overLimit ? "bg-red-50" : ""}>
                    <td className="font-medium">
                      {p.productName}
                      {p.overLimit && (
                        <span className="badge bg-red-100 text-red-700 mr-1">
                          מכסה מלאה
                        </span>
                      )}
                      {p.nearLimit && (
                        <span className="badge bg-amber-100 text-amber-700 mr-1">
                          מתקרב
                        </span>
                      )}
                      {p.limitedQtyAmount != null && (
                        <div className="text-[10px] text-zinc-500 mt-0.5">
                          מגבלה: {p.limitedQtyAmount}
                        </div>
                      )}
                    </td>

                    {/* קרטונים */}
                    <td className="text-center">
                      {hasCartons ? (
                        <span className="inline-flex items-center gap-1">
                          <span className="text-lg font-extrabold text-orange-700">
                            {cartonsOnly}
                          </span>
                          <span className="text-xs text-zinc-500">
                            {cartonsOnly === 1 ? "קרטון" : "קרטונים"}
                          </span>
                        </span>
                      ) : (
                        <span className="text-zinc-300">—</span>
                      )}
                    </td>

                    {/* בודדים */}
                    <td className="text-center">
                      {hasSingles ? (
                        <span className="inline-flex items-center gap-1">
                          <span className="text-lg font-extrabold text-amber-700">
                            {singlesOnly}
                          </span>
                          <span className="text-xs text-zinc-500">
                            {/* בבשר/עוף - ק"ג; במוצרים UNITS - יחידות */}
                            {p.unit === "יחידה" || p.unit === "יחידות"
                              ? singlesOnly === 1
                                ? "יחידה"
                                : "יחידות"
                              : "ק״ג"}
                          </span>
                        </span>
                      ) : (
                        <span className="text-zinc-300">—</span>
                      )}
                    </td>

                    {/* סה"כ משקל - השדה החשוב ביותר להזמנה מהספק */}
                    <td className="text-center">
                      {totalWeight > 0 ? (
                        <span className="font-extrabold text-brand-rust">
                          {totalWeight.toFixed(1)} ק״ג
                        </span>
                      ) : (
                        <span className="text-zinc-300">—</span>
                      )}
                    </td>

                    <td className="text-center text-zinc-500">{p.orderCount}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* ─── טבלת הזמנה לספק: מוצר × נקודה ─── */}
      {(() => {
        const { rows: matrixRows, points: matrixPoints } = buildOrderMatrix();
        if (matrixRows.length === 0) return null;
        return (
          <div>
            <div className="flex items-center justify-between gap-2 flex-wrap mb-3">
              <div>
                <h2 className="text-lg font-bold text-brand-slatedark">
                  הזמנה לספק — לפי מוצר ונקודה
                </h2>
                <p className="text-xs text-zinc-500">
                  סה״כ להזמנה מהספק, ואיך הכמות מתפצלת לנקודות. תא ריק = לא
                  מוזמן לנקודה הזו.
                </p>
                <p className="text-xs text-emerald-700 mt-1 font-medium">
                  להזמנה בפועל מהחברה — הורד את קובץ ההזמנה לספק. יש בו גיליון
                  לכל נקודה, ועמודה שבה ממירים יחידות ובודדים לקרטונים.
                </p>
              </div>
              <div className="flex gap-2 no-print">
                {/* §50: קובץ ההזמנה לספק. גיליון לכל נקודה, עם עמודת
                    ההמרה הידנית מיחידות/בודדים לקרטונים - וזו העמודה
                    שממנה משדרים לחברה בפועל. */}
                <button
                  onClick={() =>
                    (window.location.href = `/api/admin/supplier-export?pricelistId=${data.pricelist.id}`)
                  }
                  className="btn-primary btn-sm bg-emerald-600 hover:bg-emerald-700"
                >
                  📗 קובץ הזמנה לספק
                </button>
                <button onClick={exportOrderMatrixCsv} className="btn-ghost btn-sm">
                  ⬇ ייצוא טבלה זו
                </button>
              </div>
            </div>

            <div className="table-wrap">
              <table className="admin">
                <thead>
                  <tr>
                    <th>מוצר</th>
                    <th>יחידה</th>
                    <th className="text-center">סה״כ להזמנה</th>
                    {matrixPoints.map((p) => (
                      <th key={p.pointId} className="text-center whitespace-nowrap">
                        {p.pointName}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {matrixRows.map((r) => (
                    <tr key={r.key} className={r.isSingle ? "bg-amber-50/40" : ""}>
                      <td className="font-medium">
                        {r.productName}
                        {r.isSingle && (
                          <span className="text-xs text-amber-700 mr-1">(בודדים)</span>
                        )}
                      </td>
                      <td className="text-zinc-500 text-xs">{r.unitLabel}</td>
                      <td className="text-center font-extrabold text-brand-rust">
                        <bdi>{r.total}</bdi>
                      </td>
                      {matrixPoints.map((p) => (
                        <td key={p.pointId} className="text-center">
                          {r.byPoint[p.pointId] ? (
                            <bdi className="font-medium">{r.byPoint[p.pointId]}</bdi>
                          ) : (
                            <span className="text-zinc-300">—</span>
                          )}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-xs text-zinc-500 mt-1.5">
              שורות בודדים מסומנות בצהוב — הן נמדדות בק״ג/יחידות ולא בקרטונים,
              ולכן מופיעות בנפרד.
            </p>
          </div>
        );
      })()}

      {/* פירוט לפי נקודה */}
      <div>
        <div className="flex items-center justify-between gap-2 flex-wrap mb-3">
          <h2 className="text-lg font-bold text-brand-slatedark">לפי נקודת חלוקה</h2>
          <div className="flex items-center gap-2">
            <span className="text-xs text-zinc-500">
              {visiblePointIds === null
                ? `מציג את כל ${data.points.length} הנקודות`
                : `מציג ${visiblePointIds.size} מתוך ${data.points.length} נקודות`}
            </span>
            <button
              onClick={() => setShowPointFilter(!showPointFilter)}
              className="text-xs px-3 py-1.5 rounded-lg bg-zinc-100 hover:bg-zinc-200 font-bold no-print"
            >
              {showPointFilter ? "סגור בחירה" : "🎯 בחר נקודות"}
            </button>
          </div>
        </div>

        {showPointFilter && (
          <div className="card p-3 mb-3 no-print space-y-2">
            <div className="flex items-center justify-between gap-2">
              <div className="text-xs font-bold text-zinc-500">
                סמן אילו נקודות להציג:
              </div>
              <div className="flex gap-1">
                <button
                  onClick={selectAllPoints}
                  className="text-[10px] px-2 py-1 rounded bg-emerald-100 hover:bg-emerald-200 text-emerald-800 font-bold"
                >
                  בחר הכל
                </button>
                <button
                  onClick={selectNonePoints}
                  className="text-[10px] px-2 py-1 rounded bg-zinc-100 hover:bg-zinc-200 font-bold"
                >
                  נקה
                </button>
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-1">
              {data.points.map((pt) => {
                const isChecked = visiblePointIds === null || visiblePointIds.has(pt.pointId);
                return (
                  <label
                    key={pt.pointId}
                    className={`flex items-center gap-2 p-2 rounded cursor-pointer text-sm ${
                      isChecked ? "bg-emerald-50" : "bg-white hover:bg-zinc-50"
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={isChecked}
                      onChange={() => togglePointVisible(pt.pointId)}
                      className="w-4 h-4 accent-emerald-600"
                    />
                    <span className="flex-1 min-w-0 truncate">
                      {pt.city ? `${pt.city} — ` : ""}
                      {pt.pointName}
                    </span>
                    <span className="text-[10px] text-zinc-500 shrink-0">
                      <bdi>{pt.orderCount}</bdi>
                    </span>
                  </label>
                );
              })}
            </div>
          </div>
        )}

        <div className="space-y-2">
          {data.points
            .filter((pt) => visiblePointIds === null || visiblePointIds.has(pt.pointId))
            .map((pt) => (
            <div key={pt.pointId} className="card p-4">
              <button
                onClick={() => togglePointOpen(pt.pointId)}
                className="w-full flex justify-between items-center text-right"
              >
                <div className="min-w-0">
                  {/* 🐛 תוקן בעיית RTL: שם הנקודה והמונה היו באותה שורה, ומכיוון
                      שרוב שמות הנקודות מסתיימים במספר בית ("נדבורנא 34"),
                      הדפדפן צירף אותו למונה שאחריו והציג "341 הזמנות"
                      במקום "34" ואז "1 הזמנות". הפרדה לשתי שורות + בידוד
                      דו-כיווני על המספרים מונע את ההידבקות. */}
                  <div className="font-bold text-brand-slatedark">
                    {pt.city ? `${pt.city} — ` : ""}
                    {pt.pointName}
                  </div>
                  <div className="text-sm text-zinc-500 mt-0.5">
                    <bdi>{pt.orderCount}</bdi> הזמנות · <bdi>{pt.paidCount}</bdi> שולמו
                  </div>
                </div>
                <span className="font-bold text-brand-rust">
                  {pt.finalTotal > 0 ? fmt(pt.finalTotal) : `~${fmt(pt.estimatedTotal)}`}
                </span>
              </button>

              {openPoints.has(pt.pointId) && (
                <div className="mt-3 border-t pt-3">
                  <div className="flex justify-end mb-2 no-print">
                    <button onClick={() => exportPointCsv(pt)} className="btn-ghost btn-sm">
                      ⬇ ייצוא רשימת איסוף
                    </button>
                  </div>
                  <div className="table-wrap">
                    <table className="admin">
                      <thead>
                        <tr>
                          <th>#</th>
                          <th>שם</th>
                          <th>טלפון</th>
                          <th>פריטים</th>
                          <th>תשלום</th>
                        </tr>
                      </thead>
                      <tbody>
                        {pt.orders.map((o) => (
                          <tr key={o.orderNumber}>
                            <td>#{o.orderNumber}</td>
                            <td className="font-medium">{o.customerName}</td>
                            <td dir="ltr" className="text-right">{o.phone}</td>
                            <td className="text-xs text-zinc-500 max-w-[280px]">
                              {o.items
                                .map((it) => {
                                  const qty = Number(it.quantity);
                                  const label = it.isSingle
                                    ? it.unit === "יחידה" || it.unit === "יחידות"
                                      ? `${qty} יח'`
                                      : `${qty} ק"ג`
                                    : `${qty} קרטון${qty > 1 ? "ים" : ""}`;
                                  return `${it.productName} · ${label}`;
                                })
                                .join(" | ")}
                            </td>
                            <td>
                              <span
                                className={`badge ${payStatusColor(o.paymentStatus)}`}
                              >
                                {payStatusLabel(o.paymentStatus)}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
