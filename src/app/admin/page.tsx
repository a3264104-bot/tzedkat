"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/client";
import { fmt, STATUS_LABELS } from "@/lib/pricing";

export default function Dashboard() {
  const [data, setData] = useState<any>(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    api("/api/admin/reports").then(setData).catch((e) => setErr(e.message));
  }, []);

  if (err) return <p className="text-red-600">{err}</p>;
  if (!data) return <p className="text-zinc-500">טוען...</p>;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-extrabold text-brand-slatedark">דשבורד</h1>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Stat label="הזמנות" value={String(data.totalOrders)} />
        <Stat label="מכירות משוער" value={fmt(data.estimatedSales)} />
        <Stat label="מכירות סופי" value={fmt(data.finalSales)} />
        <Stat label="חדשות" value={String(data.statusCounts?.NEW ?? 0)} accent />
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        <div className="card p-5">
          <h2 className="font-bold text-brand-slatedark mb-3">הזמנות לפי נקודת חלוקה</h2>
          <div className="space-y-2">
            {data.byPoint.length === 0 && <p className="text-zinc-400 text-sm">אין נתונים</p>}
            {data.byPoint.map((p: any) => (
              <div key={p.name} className="flex justify-between text-sm">
                <span>{p.name}</span>
                <span className="text-zinc-500">
                  {p.orders} הזמנות · {fmt(p.total)}
                </span>
              </div>
            ))}
          </div>
        </div>

        <div className="card p-5">
          <h2 className="font-bold text-brand-slatedark mb-3">מוצרים הכי נמכרים</h2>
          <div className="space-y-2">
            {data.topProducts.length === 0 && <p className="text-zinc-400 text-sm">אין נתונים</p>}
            {data.topProducts.map((p: any) => (
              <div key={p.name} className="flex justify-between text-sm">
                <span>{p.name}</span>
                <span className="text-zinc-500">
                  {Math.round(p.qty * 100) / 100} {p.unit}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="card p-5">
        <div className="flex justify-between items-center mb-3">
          <h2 className="font-bold text-brand-slatedark">הזמנות חדשות לטיפול</h2>
          <Link href="/admin/orders" className="text-sm text-brand-rust">
            לכל ההזמנות ←
          </Link>
        </div>
        <div className="space-y-2">
          {data.newOrders.length === 0 && <p className="text-zinc-400 text-sm">אין הזמנות חדשות</p>}
          {data.newOrders.map((o: any) => (
            <Link
              key={o.id}
              href={`/admin/orders/${o.id}`}
              className="flex justify-between items-center p-2 rounded-lg hover:bg-amber-50 text-sm"
            >
              <span className="font-medium">
                #{o.orderNumber} · {o.customerName}
              </span>
              <span className="text-zinc-500">
                {o.point} · {fmt(o.total)}
              </span>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className={`card p-4 ${accent ? "bg-brand-rust text-white" : ""}`}>
      <div className={`text-sm ${accent ? "text-white/80" : "text-zinc-500"}`}>{label}</div>
      <div className="text-xl font-extrabold mt-1">{value}</div>
    </div>
  );
}
