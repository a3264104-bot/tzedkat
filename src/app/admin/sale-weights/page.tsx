"use client";

// ⚖️ סיכום משקלים — מכירה שהסתיימה (למשל ראש השנה).
// כל ההזמנות וכל המשקלים שהוזנו, לפי נקודת חלוקה, עם הורדה לאקסל
// מסודר (גיליון לכל נקודה).

import { useEffect, useState } from "react";
import { useSelectedPricelist, PricelistSelector, isAggregateSelection } from "@/components/useSelectedPricelist";
import type { WeightPoint } from "@/lib/sale-weights-lib";

type Data = {
  pricelist: { id: string; name: string; status: string; deliveryDateText: string | null };
  points: WeightPoint[];
  totals: { orders: number; weight: number; final: number; missing: number };
};

const money = (n: number) => `₪${n.toLocaleString("he-IL", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default function SaleWeightsPage() {
  const { lists, selected, setSelected } = useSelectedPricelist({ allowAll: false });
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openPoint, setOpenPoint] = useState<string | null>(null);
  const [q, setQ] = useState("");

  useEffect(() => {
    if (!selected || isAggregateSelection(selected)) return;
    setData(null);
    setError(null);
    fetch(`/api/admin/sale-weights/${selected}`, { cache: "no-store" })
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw new Error(d.error || "שגיאה");
        setData(d);
      })
      .catch((e) => setError(e?.message || "שגיאה"));
  }, [selected]);

  const words = q.trim().split(/\s+/).filter(Boolean);
  const match = (name: string, num: number) =>
    words.every((w) => name.includes(w) || String(num).includes(w));

  return (
    <div className="space-y-4 max-w-6xl mx-auto">
      <div>
        <h1 className="text-2xl font-extrabold text-brand-slatedark">⚖️ סיכום משקלים</h1>
        <p className="text-sm text-zinc-600 mt-1">
          כל ההזמנות וכל המשקלים שהוזנו במכירה, לפי נקודת חלוקה. האקסל כולל גיליון סיכום וגיליון לכל נקודה.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <PricelistSelector lists={lists} selected={selected} onChange={setSelected} />
        {data && (
          <a
            href={`/api/admin/sale-weights/${data.pricelist.id}?xlsx=1`}
            className="px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm font-bold"
          >
            📥 הורד אקסל (גיליון לכל נקודה)
          </a>
        )}
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="🔍 חיפוש לקוח / מספר הזמנה"
          className="flex-1 min-w-[180px] rounded-lg border-2 border-zinc-300 px-3 py-2 text-sm"
        />
      </div>

      {error && <div className="text-red-700 font-bold">{error}</div>}
      {!data && !error && <div className="text-zinc-500">טוען…</div>}

      {data && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            <Kpi label="הזמנות" value={String(data.totals.orders)} />
            <Kpi label='סה"כ משקל' value={`${data.totals.weight} ק"ג`} />
            <Kpi label='סה"כ לחיוב' value={money(data.totals.final)} />
            <Kpi label="פריטים בלי משקל" value={String(data.totals.missing)} warn={data.totals.missing > 0} />
          </div>

          <div className="space-y-2">
            {data.points.map((p) => {
              const orders = p.orders.filter((o) => match(o.customerName, o.orderNumber));
              const isOpen = openPoint === p.pointId || words.length > 0;
              if (words.length > 0 && orders.length === 0) return null;
              return (
                <div key={p.pointId} className="rounded-xl bg-white border border-zinc-200">
                  <button
                    onClick={() => setOpenPoint(openPoint === p.pointId ? null : p.pointId)}
                    className="w-full flex flex-wrap items-center justify-between gap-2 p-3 text-right"
                  >
                    <span className="font-extrabold text-brand-slatedark">📍 {p.pointName}</span>
                    <span className="text-sm text-zinc-600">
                      {p.orders.length} הזמנות · {p.totalWeight} ק&quot;ג · {money(p.totalFinal)}
                      {p.missing > 0 && <span className="text-red-700 font-bold"> · ⚠️ {p.missing} חסרים</span>}
                      <span className="mr-2">{isOpen ? "▲" : "▼"}</span>
                    </span>
                  </button>
                  {isOpen && (
                    <div className="border-t border-zinc-100 p-3 space-y-3">
                      {orders.map((o) => (
                        <div key={o.orderNumber} className="rounded-lg border border-zinc-200">
                          <div className="flex flex-wrap items-center justify-between gap-2 bg-brand-cream/60 px-3 py-1.5">
                            <span className="font-bold">
                              #{o.orderNumber} {o.customerName}
                              <span className="text-xs text-zinc-500"> {o.phone}</span>
                            </span>
                            <span className="text-xs">
                              {o.locked ? "🔒 ננעל" : "⏳ לא ננעל"}
                              {o.finalTotal != null && <b className="mr-2">{money(o.finalTotal)}</b>}
                            </span>
                          </div>
                          <table className="w-full text-sm">
                            <tbody>
                              {o.items.map((it, i) => (
                                <tr
                                  key={i}
                                  className={`border-t border-zinc-100 ${
                                    it.cancelled ? "line-through text-zinc-400" : it.weight == null ? "bg-red-50" : ""
                                  }`}
                                >
                                  <td className="px-3 py-1">
                                    {it.productName}
                                    {it.isSingle && <span className="text-xs text-amber-700"> (בודדים)</span>}
                                  </td>
                                  <td className="px-2 py-1 text-zinc-500 tabular-nums">× {it.quantity}</td>
                                  <td className="px-2 py-1 text-xs text-zinc-500 tabular-nums" dir="ltr">
                                    {it.parts && it.parts.length > 1
                                      ? it.parts.map((x) => (x == null ? "—" : x)).join(" + ")
                                      : ""}
                                  </td>
                                  <td className="px-2 py-1 font-bold tabular-nums" dir="ltr">
                                    {it.cancelled ? "בוטל" : it.weight == null ? "⚠️ חסר" : it.weight}
                                  </td>
                                  <td className="px-3 py-1 text-left tabular-nums" dir="ltr">
                                    {it.finalPrice != null ? money(it.finalPrice) : ""}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      ))}
                      <div className="rounded-lg bg-zinc-50 p-2">
                        <div className="text-xs font-bold text-zinc-600 mb-1">סיכום לפי מוצר בנקודה</div>
                        <div className="grid sm:grid-cols-2 gap-x-4 text-sm">
                          {p.products.map((pr) => (
                            <div key={pr.name} className="flex justify-between border-b border-zinc-100 py-0.5">
                              <span>{pr.name}</span>
                              <span className="tabular-nums text-zinc-600">
                                {pr.quantity} · {pr.weight} ק&quot;ג
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

function Kpi({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div className={`rounded-xl border p-3 ${warn ? "bg-red-50 border-red-200" : "bg-white border-zinc-200"}`}>
      <div className="text-xs text-zinc-600">{label}</div>
      <div className="text-xl font-extrabold text-brand-slatedark tabular-nums">{value}</div>
    </div>
  );
}
