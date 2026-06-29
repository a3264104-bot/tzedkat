"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api, download } from "@/lib/client";
import { STATUS_LABELS, STATUS_ORDER, fmt } from "@/lib/pricing";

const statusColor: Record<string, string> = {
  NEW: "bg-red-100 text-red-700",
  CONFIRMED: "bg-blue-100 text-blue-700",
  PROCESSING: "bg-amber-100 text-amber-700",
  READY: "bg-purple-100 text-purple-700",
  DELIVERED: "bg-green-100 text-green-700",
  CANCELLED: "bg-zinc-200 text-zinc-500",
};

export default function OrdersPage() {
  const [orders, setOrders] = useState<any[]>([]);
  const [points, setPoints] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [fPoint, setFPoint] = useState("");
  const [fStatus, setFStatus] = useState("");

  async function load() {
    setLoading(true);
    const q = new URLSearchParams();
    if (fPoint) q.set("pointId", fPoint);
    if (fStatus) q.set("status", fStatus);
    const [o, p] = await Promise.all([
      api(`/api/orders?${q.toString()}`),
      points.length ? Promise.resolve(points) : api("/api/admin/points"),
    ]);
    setOrders(o);
    setPoints(p);
    setLoading(false);
  }
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fPoint, fStatus]);

  const exportUrl = () => {
    const q = new URLSearchParams({ type: "orders" });
    if (fPoint) q.set("pointId", fPoint);
    return `/api/admin/export?${q.toString()}`;
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-extrabold text-brand-slatedark">הזמנות</h1>
        <button onClick={() => download(exportUrl())} className="btn-ghost btn-sm">
          ייצוא לאקסל
        </button>
      </div>

      <div className="flex flex-wrap gap-2">
        <select className="input max-w-[180px]" value={fPoint} onChange={(e) => setFPoint(e.target.value)}>
          <option value="">כל הנקודות</option>
          {points.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <select className="input max-w-[160px]" value={fStatus} onChange={(e) => setFStatus(e.target.value)}>
          <option value="">כל הסטטוסים</option>
          {STATUS_ORDER.map((s) => (
            <option key={s} value={s}>
              {STATUS_LABELS[s]}
            </option>
          ))}
        </select>
      </div>

      {loading ? (
        <p className="text-zinc-500">טוען...</p>
      ) : orders.length === 0 ? (
        <p className="text-zinc-400">אין הזמנות</p>
      ) : (
        <div className="table-wrap">
          <table className="admin">
            <thead>
              <tr>
                <th>#</th>
                <th>תאריך</th>
                <th>לקוח</th>
                <th>טלפון</th>
                <th>נקודה</th>
                <th>משוער</th>
                <th>סופי</th>
                <th>סטטוס</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {orders.map((o) => (
                <tr key={o.id}>
                  <td className="font-bold">{o.orderNumber}</td>
                  <td className="text-zinc-500 whitespace-nowrap">
                    {new Date(o.createdAt).toLocaleDateString("he-IL")}
                  </td>
                  <td className="font-medium">{o.customerName}</td>
                  <td className="text-zinc-500" dir="ltr">{o.phone}</td>
                  <td className="text-zinc-500">{o.point.name}</td>
                  <td>{fmt(o.estimatedTotal)}</td>
                  <td>{o.finalTotal ? fmt(o.finalTotal) : "—"}</td>
                  <td>
                    <span className={`badge ${statusColor[o.status]}`}>{STATUS_LABELS[o.status]}</span>
                  </td>
                  <td>
                    <Link href={`/admin/orders/${o.id}`} className="btn-ghost btn-sm">
                      פתח
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
