"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/client";
import { fmt, STATUS_LABELS, PAYMENT_STATUS_LABELS } from "@/lib/pricing";

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
  const [openPoint, setOpenPoint] = useState<string | null>(null);

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

  function exportPointCsv(point: PointRow) {
    if (!data) return;
    const rows: string[][] = [
      ["הזמנה", "שם", "טלפון", "סטטוס", "תשלום", "פריטים", 'סה"כ'],
      ...point.orders.map((o) => [
        `#${o.orderNumber}`,
        o.customerName,
        o.phone,
        STATUS_LABELS[o.status] ?? o.status,
        PAYMENT_STATUS_LABELS[o.paymentStatus] ?? o.paymentStatus,
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

      {/* פירוט לפי נקודה */}
      <div>
        <h2 className="text-lg font-bold text-brand-slatedark mb-2">לפי נקודת חלוקה</h2>
        <div className="space-y-2">
          {data.points.map((pt) => (
            <div key={pt.pointId} className="card p-4">
              <button
                onClick={() => setOpenPoint(openPoint === pt.pointId ? null : pt.pointId)}
                className="w-full flex justify-between items-center text-right"
              >
                <div>
                  <span className="font-bold text-brand-slatedark">
                    {pt.city ? `${pt.city} — ` : ""}
                    {pt.pointName}
                  </span>
                  <span className="text-sm text-zinc-500 mr-2">
                    {pt.orderCount} הזמנות · {pt.paidCount} שולמו
                  </span>
                </div>
                <span className="font-bold text-brand-rust">
                  {pt.finalTotal > 0 ? fmt(pt.finalTotal) : `~${fmt(pt.estimatedTotal)}`}
                </span>
              </button>

              {openPoint === pt.pointId && (
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
                                className={`badge ${
                                  o.paymentStatus === "PAID"
                                    ? "bg-green-100 text-green-700"
                                    : "bg-amber-100 text-amber-700"
                                }`}
                              >
                                {PAYMENT_STATUS_LABELS[o.paymentStatus] ?? o.paymentStatus}
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
