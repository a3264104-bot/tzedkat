"use client";

// §20: לוח בקרת מכירה למנהל - כל התמונה בעמוד אחד

import { useEffect, useState } from "react";
import Link from "next/link";

type Data = {
  pricelist: {
    id: string;
    name: string;
    status: string;
    deliveryDate: string | null;
    deliveryDateText: string | null;
    closeDate: string | null;
  };
  financialSummary: {
    totalRevenue: number;
    orderRevenue: number;
    walkinRevenue: number;
    walkinCash: number;
    walkinCardTerminal: number;
    walkinTransferPending: number;
    walkinTransferReceived: number;
    walkinOnline: number;
    totalCommissions: number;
    netRevenue: number;
  };
  progress: {
    totalOrders: number;
    ordersFullyEntered: number;
    ordersWithData: number;
    pendingOrders: number;
    totalItems: number;
    itemsEntered: number;
    completionPercent: number;
    totalWalkins: number;
  };
  productComparison: Array<{
    productId: string;
    productName: string;
    receivedWeight: number;
    receivedCartons: number;
    distributedWeight: number;
    difference: number;
    differencePercent: number;
    status: "OK" | "OVER" | "UNDER" | "SIGNIFICANT_UNDER" | "NO_NOTE";
  }>;
  agents: Array<{
    agentId: string;
    agentName: string;
    phone: string | null;
    pointName: string | null;
    status: string;
    confirmedAt: string | null;
    totalCartonWeight: number;
    totalSinglesWeight: number;
    totalWalkinWeight: number;
    totalCustomers: number;
    totalWalkins: number;
    totalCommission: number;
    cashCollected: number;
    cashHandedIn: number;
    paidToAgent: number;
    balance: number;
    remainderNote: string | null;
  }>;
  alerts: Array<{ type: "info" | "warning" | "danger"; message: string }>;
};

export default function AdminSaleControlClient({
  pricelistId,
}: {
  pricelistId: string;
}) {
  const [data, setData] = useState<Data | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`/api/admin/sale-control/${pricelistId}`, {
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
    })();
  }, [pricelistId]);

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

  const { financialSummary: fin, progress, productComparison, agents, alerts } = data;

  return (
    <div dir="rtl" className="min-h-screen bg-brand-cream pb-20">
      <header className="bg-brand-yellow border-b-4 border-brand-rust/20">
        <div className="mx-auto max-w-7xl px-4 py-3 flex items-center justify-between">
          <Link href="/admin/pricelists" className="text-brand-slate font-medium text-sm">
            ← חזרה למחירונים
          </Link>
          <div className="text-right">
            <h1 className="font-extrabold text-brand-slatedark">
              📊 בקרת מכירה
            </h1>
            <div className="text-xs text-brand-slate mt-0.5">
              {data.pricelist.name}
              {data.pricelist.deliveryDateText && ` · ${data.pricelist.deliveryDateText}`}
            </div>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-5 space-y-5">
        {/* Alerts */}
        {alerts.length > 0 && (
          <div className="space-y-2">
            {alerts.map((alert, idx) => (
              <AlertBanner key={idx} type={alert.type} message={alert.message} />
            ))}
          </div>
        )}

        {/* התקדמות */}
        <div className="bg-white rounded-2xl border border-zinc-200 shadow-sm p-5">
          <div className="flex items-center justify-between mb-3">
            <div>
              <div className="font-bold text-brand-slatedark">התקדמות המכירה</div>
              <div className="text-xs text-zinc-500 mt-0.5">
                {progress.itemsEntered} מתוך {progress.totalItems} פריטים הוזנו
              </div>
            </div>
            <div className="text-3xl font-extrabold text-brand-rust">
              {progress.completionPercent}%
            </div>
          </div>
          <div className="h-3 bg-zinc-100 rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-l from-emerald-400 to-emerald-600 transition-all duration-500"
              style={{ width: `${progress.completionPercent}%` }}
            />
          </div>
          <div className="mt-3 grid grid-cols-4 gap-3 text-xs">
            <MiniStat label="הזמנות" value={String(progress.totalOrders)} />
            <MiniStat
              label="הושלמו במלואן"
              value={String(progress.ordersFullyEntered)}
              color="emerald"
            />
            <MiniStat
              label="ממתינים"
              value={String(progress.pendingOrders)}
              color="amber"
            />
            <MiniStat label="מזדמנים" value={String(progress.totalWalkins)} />
          </div>
        </div>

        {/* סיכום כספי */}
        <div className="bg-white rounded-2xl border border-zinc-200 shadow-sm p-5">
          <div className="font-bold text-brand-slatedark mb-3">סיכום כספי</div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <FinancialCard
              label="הכנסה כוללת"
              amount={fin.totalRevenue}
              color="emerald"
              big
            />
            <FinancialCard
              label="עמלות לנציגים"
              amount={-fin.totalCommissions}
              color="red"
            />
            <FinancialCard
              label="הכנסה נטו"
              amount={fin.netRevenue}
              color="emerald"
              big
            />
            <div />
          </div>

          <div className="mt-4 pt-4 border-t border-zinc-100">
            <div className="text-xs font-bold text-zinc-500 mb-2">פירוט הכנסות</div>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              <SubStat label="הזמנות מהאתר" value={`₪${fin.orderRevenue.toFixed(2)}`} />
              <SubStat label="מזדמנים - סה״כ" value={`₪${fin.walkinRevenue.toFixed(2)}`} />
              <SubStat
                label="מזומן שנאסף"
                value={`₪${fin.walkinCash.toFixed(2)}`}
                color="amber"
              />
              {fin.walkinCardTerminal > 0 && (
                <SubStat
                  label="אשראי במסוף פיזי"
                  value={`₪${fin.walkinCardTerminal.toFixed(2)}`}
                />
              )}
              {fin.walkinOnline > 0 && (
                <SubStat label="אשראי אונליין" value={`₪${fin.walkinOnline.toFixed(2)}`} />
              )}
              {fin.walkinTransferReceived > 0 && (
                <SubStat
                  label="העברות שהתקבלו"
                  value={`₪${fin.walkinTransferReceived.toFixed(2)}`}
                  color="emerald"
                />
              )}
              {fin.walkinTransferPending > 0 && (
                <SubStat
                  label="העברות ממתינות"
                  value={`₪${fin.walkinTransferPending.toFixed(2)}`}
                  color="amber"
                />
              )}
            </div>
          </div>
        </div>

        {/* השוואת מוצרים - תעודה מול חלוקה בפועל */}
        {productComparison.length > 0 && (
          <div className="bg-white rounded-2xl border border-zinc-200 shadow-sm overflow-hidden">
            <div className="px-5 py-3 border-b border-zinc-200 bg-zinc-50">
              <div className="font-bold text-brand-slatedark">
                📄 השוואת מוצרים - תעודה מול חלוקה בפועל
              </div>
              <div className="text-xs text-zinc-500 mt-0.5">
                בקרת איכות - מזהה חריגות, פערים ומוצרים שלא נשקלו
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-zinc-50">
                  <tr className="text-[10px] font-bold text-zinc-500 uppercase">
                    <th className="text-right px-3 py-2">מוצר</th>
                    <th className="text-center px-3 py-2">בתעודה</th>
                    <th className="text-center px-3 py-2">חילקנו</th>
                    <th className="text-center px-3 py-2">פער ק"ג</th>
                    <th className="text-center px-3 py-2">אחוז</th>
                    <th className="text-center px-3 py-2">סטטוס</th>
                  </tr>
                </thead>
                <tbody>
                  {productComparison.map((p) => (
                    <ProductComparisonRow key={p.productId} product={p} />
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* נציגים */}
        {agents.length > 0 && (
          <div className="bg-white rounded-2xl border border-zinc-200 shadow-sm overflow-hidden">
            <div className="px-5 py-3 border-b border-zinc-200 bg-zinc-50">
              <div className="font-bold text-brand-slatedark">
                👥 סיכום נציגים ({agents.length})
              </div>
            </div>
            <div className="divide-y divide-zinc-100">
              {agents.map((a) => (
                <AgentSummaryRow key={a.agentId} agent={a} />
              ))}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

function AlertBanner({
  type,
  message,
}: {
  type: "info" | "warning" | "danger";
  message: string;
}) {
  const config = {
    info: { bg: "bg-blue-50 border-blue-200", text: "text-blue-800", icon: "ℹ️" },
    warning: { bg: "bg-amber-50 border-amber-300", text: "text-amber-800", icon: "⚠️" },
    danger: { bg: "bg-red-50 border-red-300", text: "text-red-800", icon: "🚨" },
  }[type];
  return (
    <div className={`${config.bg} border rounded-xl p-3 flex items-start gap-2`}>
      <span className="text-xl leading-none">{config.icon}</span>
      <div className={`text-sm font-medium ${config.text} flex-1`}>{message}</div>
    </div>
  );
}

function MiniStat({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color?: "emerald" | "amber";
}) {
  const bgColor = color === "emerald"
    ? "bg-emerald-50 text-emerald-700"
    : color === "amber"
    ? "bg-amber-50 text-amber-700"
    : "bg-zinc-50 text-brand-slatedark";
  return (
    <div className={`rounded-lg px-3 py-2 ${bgColor}`}>
      <div className="text-[10px] font-bold opacity-80">{label}</div>
      <div className="text-xl font-extrabold">{value}</div>
    </div>
  );
}

function FinancialCard({
  label,
  amount,
  color,
  big,
}: {
  label: string;
  amount: number;
  color: "emerald" | "red";
  big?: boolean;
}) {
  const c = color === "emerald" ? "text-emerald-700 bg-emerald-50 border-emerald-200" : "text-red-700 bg-red-50 border-red-200";
  return (
    <div className={`rounded-xl border p-3 ${c}`}>
      <div className="text-[10px] font-bold opacity-80">{label}</div>
      <div className={`font-extrabold mt-1 ${big ? "text-2xl" : "text-xl"}`}>
        ₪{amount.toFixed(2)}
      </div>
    </div>
  );
}

function SubStat({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color?: "emerald" | "amber" | "red";
}) {
  const colors = {
    emerald: "text-emerald-700",
    amber: "text-amber-700",
    red: "text-red-700",
  };
  const c = color ? colors[color] : "text-brand-slatedark";
  return (
    <div>
      <div className="text-[10px] text-zinc-500">{label}</div>
      <div className={`font-bold text-sm ${c}`}>{value}</div>
    </div>
  );
}

function ProductComparisonRow({
  product: p,
}: {
  product: Data["productComparison"][number];
}) {
  const statusConfig = {
    OK: { bg: "bg-emerald-100", text: "text-emerald-700", label: "✓ תקין" },
    UNDER: { bg: "bg-amber-100", text: "text-amber-700", label: "פער קטן" },
    SIGNIFICANT_UNDER: { bg: "bg-red-100", text: "text-red-700", label: "פער משמעותי" },
    OVER: { bg: "bg-red-100", text: "text-red-700", label: "🚨 חריגה" },
    NO_NOTE: { bg: "bg-zinc-100", text: "text-zinc-600", label: "אין תעודה" },
  }[p.status];

  return (
    <tr className="border-b border-zinc-100 hover:bg-zinc-50">
      <td className="px-3 py-2 font-medium text-brand-slatedark">
        {p.productName}
        {p.receivedCartons > 0 && (
          <span className="text-[10px] text-zinc-400 mr-2">
            ({p.receivedCartons} קרטונים)
          </span>
        )}
      </td>
      <td className="px-3 py-2 text-center font-bold text-brand-slatedark">
        {p.receivedWeight > 0 ? `${p.receivedWeight.toFixed(2)} ק"ג` : "—"}
      </td>
      <td className="px-3 py-2 text-center font-bold text-brand-slatedark">
        {p.distributedWeight.toFixed(2)} ק"ג
      </td>
      <td className="px-3 py-2 text-center font-bold">
        {p.receivedWeight > 0 ? (
          <span className={p.difference < 0 ? "text-red-700" : "text-brand-slatedark"}>
            {p.difference > 0 ? "+" : ""}
            {p.difference.toFixed(2)}
          </span>
        ) : (
          "—"
        )}
      </td>
      <td className="px-3 py-2 text-center text-xs">
        {p.receivedWeight > 0 ? (
          <span className={Math.abs(p.differencePercent) > 5 ? "text-red-700 font-bold" : "text-zinc-500"}>
            {p.differencePercent.toFixed(1)}%
          </span>
        ) : (
          "—"
        )}
      </td>
      <td className="px-3 py-2 text-center">
        <span
          className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${statusConfig.bg} ${statusConfig.text}`}
        >
          {statusConfig.label}
        </span>
      </td>
    </tr>
  );
}

function AgentSummaryRow({
  agent: a,
}: {
  agent: Data["agents"][number];
}) {
  const balanceLabel =
    a.balance > 0.01
      ? `יש לשלם ₪${a.balance.toFixed(2)}`
      : a.balance < -0.01
      ? `חייב ₪${Math.abs(a.balance).toFixed(2)}`
      : "סגור";
  const balanceColor =
    a.balance > 0.01
      ? "text-red-700 bg-red-100"
      : a.balance < -0.01
      ? "text-emerald-700 bg-emerald-100"
      : "text-zinc-600 bg-zinc-100";

  return (
    <div className="p-4 flex flex-col md:flex-row items-start gap-3">
      <div className="shrink-0 w-10 h-10 rounded-full bg-gradient-to-br from-brand-rust to-[#a83a15] flex items-center justify-center text-white font-bold shadow-sm">
        {a.agentName.charAt(0)}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-bold text-brand-slatedark">{a.agentName}</span>
          {a.pointName && (
            <span className="text-xs text-zinc-500">📍 {a.pointName}</span>
          )}
          {a.status === "CONFIRMED" ? (
            <span className="text-[10px] bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full font-bold">
              ✓ סגור
            </span>
          ) : (
            <span className="text-[10px] bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full font-bold">
              פתוח
            </span>
          )}
        </div>
        <div className="text-xs text-zinc-500 mt-1 flex flex-wrap gap-x-3 gap-y-0.5">
          <span>ק"ג: <b>{(a.totalCartonWeight + a.totalWalkinWeight).toFixed(1)}</b> קרטונים · <b>{a.totalSinglesWeight.toFixed(1)}</b> בודדים</span>
          <span>לקוחות: <b>{a.totalCustomers}</b></span>
          {a.totalWalkins > 0 && <span>מזדמנים: <b>{a.totalWalkins}</b></span>}
          {a.cashCollected > 0 && (
            <span className="text-amber-700">
              מזומן שאסף: <b>₪{a.cashCollected.toFixed(2)}</b>
              {a.cashHandedIn > 0 && ` (העביר ${a.cashHandedIn.toFixed(2)})`}
            </span>
          )}
        </div>
        {a.remainderNote && (
          <div className="text-[11px] mt-1 bg-amber-50 border border-amber-200 rounded px-2 py-1 text-amber-800 inline-block">
            הערה: {a.remainderNote}
          </div>
        )}
      </div>
      <div className="flex flex-col items-end gap-1.5 shrink-0">
        <div className="text-lg font-extrabold text-brand-rust">
          ₪{a.totalCommission.toFixed(2)}
        </div>
        <span className={`text-[10px] font-bold px-2.5 py-1 rounded-full ${balanceColor}`}>
          {balanceLabel}
        </span>
      </div>
    </div>
  );
}
