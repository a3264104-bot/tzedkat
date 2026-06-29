"use client";

import { useEffect, useState } from "react";
import { api, download } from "@/lib/client";
import { STATUS_LABELS, fmt } from "@/lib/pricing";

type Tab = "summary" | "products" | "bypoint" | "customers" | "financial";

const TABS: { id: Tab; label: string }[] = [
  { id: "summary", label: "סיכום כללי" },
  { id: "products", label: "סיכום מוצרים להכנה" },
  { id: "bypoint", label: "לפי נקודת חלוקה" },
  { id: "customers", label: "לקוחות" },
  { id: "financial", label: "דוח כספי" },
];

export default function ReportsPage() {
  const [tab, setTab] = useState<Tab>("summary");
  const [pricelists, setPricelists] = useState<any[]>([]);
  const [pricelistId, setPricelistId] = useState("");
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    const q = new URLSearchParams();
    if (pricelistId) q.set("pricelistId", pricelistId);
    const [rep, pls] = await Promise.all([
      api(`/api/admin/reports?${q.toString()}`),
      pricelists.length ? Promise.resolve(pricelists) : api("/api/admin/pricelists"),
    ]);
    setData(rep);
    setPricelists(pls);
    setLoading(false);
  }
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pricelistId]);

  function exportUrl(type: string) {
    const q = new URLSearchParams({ type });
    if (pricelistId) q.set("pricelistId", pricelistId);
    return `/api/admin/export?${q.toString()}`;
  }

  return (
    <div className="space-y-5">
      <div className="no-print flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-extrabold text-brand-slatedark">דוחות</h1>
        <div className="flex items-center gap-2">
          <select
            className="input max-w-[220px]"
            value={pricelistId}
            onChange={(e) => setPricelistId(e.target.value)}
          >
            <option value="">כל המכירות</option>
            {pricelists.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <button onClick={() => window.print()} className="btn-ghost btn-sm">
            הדפסה
          </button>
        </div>
      </div>

      <div className="no-print flex flex-wrap gap-2">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`btn-sm rounded-lg border ${
              tab === t.id
                ? "bg-brand-rust text-white border-brand-rust"
                : "bg-white text-brand-slate border-zinc-200 hover:bg-zinc-50"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {loading || !data ? (
        <div className="card p-8 text-center text-zinc-400">טוען…</div>
      ) : (
        <>
          {tab === "summary" && <SummaryReport data={data} />}
          {tab === "products" && (
            <ProductsReport data={data} onExport={() => download(exportUrl("products"))} />
          )}
          {tab === "bypoint" && (
            <ByPointReport data={data} onExport={() => download(exportUrl("bypoint"))} />
          )}
          {tab === "customers" && (
            <CustomersReport data={data} onExport={() => download(exportUrl("customers"))} />
          )}
          {tab === "financial" && <FinancialReport data={data} />}
        </>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="card p-4">
      <div className="text-sm text-zinc-500">{label}</div>
      <div className="text-2xl font-extrabold text-brand-slatedark mt-1">{value}</div>
    </div>
  );
}

function LimitedWarnings({ warnings }: { warnings: any[] }) {
  if (!warnings || warnings.length === 0) return null;
  return (
    <div className="card p-4 border-amber-300 bg-amber-50/60">
      <h3 className="font-bold text-amber-800 mb-2">⚠️ אזהרות כמות מוגבלת</h3>
      <div className="space-y-1.5">
        {warnings.map((w) => (
          <div
            key={w.name}
            className={`flex justify-between text-sm ${
              w.level === "over" ? "text-red-700 font-semibold" : "text-amber-800"
            }`}
          >
            <span>
              {w.name}
              {w.level === "over" ? " — חריגה מהמגבלה!" : " — מתקרב למגבלה"}
            </span>
            <span>
              {w.ordered} / {w.limit} {w.unit}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function SummaryReport({ data }: { data: any }) {
  return (
    <div className="space-y-5">
      <LimitedWarnings warnings={data.limitedWarnings} />
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Stat label="סה״כ הזמנות" value={data.totalOrders} />
        <Stat label="סך מכירות משוער" value={fmt(data.estimatedSales)} />
        <Stat label="סך מכירות סופי" value={fmt(data.finalSales)} />
        <Stat label="נקודות חלוקה" value={data.byPoint.length} />
      </div>

      <div className="grid lg:grid-cols-2 gap-5">
        <div className="card p-4">
          <h3 className="font-bold text-brand-slatedark mb-3">פילוח לפי סטטוס</h3>
          <div className="space-y-2">
            {Object.entries(data.statusCounts as Record<string, number>).map(([s, n]) => (
              <div key={s} className="flex justify-between text-sm border-b border-zinc-100 pb-1.5">
                <span>{STATUS_LABELS[s] ?? s}</span>
                <span className="font-semibold">{n}</span>
              </div>
            ))}
            {Object.keys(data.statusCounts).length === 0 && (
              <div className="text-zinc-400 text-sm">אין נתונים</div>
            )}
          </div>
        </div>

        <div className="card p-4">
          <h3 className="font-bold text-brand-slatedark mb-3">מוצרים מובילים</h3>
          <div className="space-y-2">
            {data.topProducts.map((p: any) => (
              <div
                key={p.name}
                className="flex justify-between text-sm border-b border-zinc-100 pb-1.5"
              >
                <span>{p.name}</span>
                <span className="font-semibold">
                  {p.qty} {p.unit}
                </span>
              </div>
            ))}
            {data.topProducts.length === 0 && (
              <div className="text-zinc-400 text-sm">אין נתונים</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function ProductsReport({ data, onExport }: { data: any; onExport: () => void }) {
  return (
    <div className="space-y-3">
      <LimitedWarnings warnings={data.limitedWarnings} />
      <div className="no-print flex justify-end">
        <button onClick={onExport} className="btn-ghost btn-sm">
          ייצוא לאקסל
        </button>
      </div>
      <div className="table-wrap">
        <table className="admin">
          <thead>
            <tr>
              <th>מוצר</th>
              <th>כמות להכנה</th>
              <th>יחידה</th>
              <th>סה"כ</th>
            </tr>
          </thead>
          <tbody>
            {data.products.map((p: any) => (
              <tr key={p.name}>
                <td className="font-medium">{p.name}</td>
                <td className="font-bold">{p.qty}</td>
                <td>{p.unit}</td>
                <td>{fmt(p.total)}</td>
              </tr>
            ))}
            {data.products.length === 0 && (
              <tr>
                <td colSpan={4} className="text-center text-zinc-400 py-6">
                  אין נתונים
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ByPointReport({ data, onExport }: { data: any; onExport: () => void }) {
  return (
    <div className="space-y-3">
      <div className="no-print flex justify-end">
        <button onClick={onExport} className="btn-ghost btn-sm">
          ייצוא לאקסל
        </button>
      </div>
      <div className="table-wrap">
        <table className="admin">
          <thead>
            <tr>
              <th>נקודת חלוקה</th>
              <th>מספר הזמנות</th>
              <th>סך מכירות</th>
            </tr>
          </thead>
          <tbody>
            {data.byPoint.map((p: any) => (
              <tr key={p.name}>
                <td className="font-medium">{p.name}</td>
                <td className="font-bold">{p.orders}</td>
                <td>{fmt(p.total)}</td>
              </tr>
            ))}
            {data.byPoint.length === 0 && (
              <tr>
                <td colSpan={3} className="text-center text-zinc-400 py-6">
                  אין נתונים
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function CustomersReport({ data, onExport }: { data: any; onExport: () => void }) {
  return (
    <div className="space-y-3">
      <div className="no-print flex justify-end">
        <button onClick={onExport} className="btn-ghost btn-sm">
          ייצוא לאקסל
        </button>
      </div>
      <div className="table-wrap">
        <table className="admin">
          <thead>
            <tr>
              <th>שם</th>
              <th>טלפון</th>
              <th>הזמנות</th>
              <th>סך רכישות</th>
              <th>נקודה מועדפת</th>
            </tr>
          </thead>
          <tbody>
            {data.customers.map((c: any) => (
              <tr key={c.phone}>
                <td className="font-medium">{c.name}</td>
                <td dir="ltr" className="text-right">
                  {c.phone}
                </td>
                <td className="font-bold">{c.orders}</td>
                <td>{fmt(c.total)}</td>
                <td>{c.point}</td>
              </tr>
            ))}
            {data.customers.length === 0 && (
              <tr>
                <td colSpan={5} className="text-center text-zinc-400 py-6">
                  אין נתונים
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function FinancialReport({ data }: { data: any }) {
  const delivered = data.statusCounts?.DELIVERED ?? 0;
  const cancelled = data.statusCounts?.CANCELLED ?? 0;
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Stat label="סך מכירות משוער" value={fmt(data.estimatedSales)} />
        <Stat label="סך מכירות סופי" value={fmt(data.finalSales)} />
        <Stat label="הזמנות שנמסרו" value={delivered} />
        <Stat label="הזמנות שבוטלו" value={cancelled} />
      </div>

      <div className="card p-4">
        <h3 className="font-bold text-brand-slatedark mb-3">מכירות לפי נקודת חלוקה</h3>
        <div className="space-y-2">
          {data.byPoint.map((p: any) => (
            <div key={p.name} className="flex justify-between text-sm border-b border-zinc-100 pb-1.5">
              <span>{p.name}</span>
              <span className="font-semibold">{fmt(p.total)}</span>
            </div>
          ))}
          {data.byPoint.length === 0 && <div className="text-zinc-400 text-sm">אין נתונים</div>}
        </div>
      </div>

      <div className="card p-4">
        <h3 className="font-bold text-brand-slatedark mb-3">מכירות לפי מוצר</h3>
        <div className="space-y-2">
          {data.products.map((p: any) => (
            <div key={p.name} className="flex justify-between text-sm border-b border-zinc-100 pb-1.5">
              <span>
                {p.name}{" "}
                <span className="text-zinc-400">
                  ({p.qty} {p.unit})
                </span>
              </span>
              <span className="font-semibold">{fmt(p.total)}</span>
            </div>
          ))}
          {data.products.length === 0 && <div className="text-zinc-400 text-sm">אין נתונים</div>}
        </div>
      </div>
    </div>
  );
}
