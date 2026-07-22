"use client";

// §20: מסך היתרה של הנציג - צפייה בלבד
import { useEffect, useState } from "react";
import Link from "next/link";

type Data = {
  agent: {
    name: string;
    point: { id: string; name: string; city: string | null } | null;
    commissionRateCarton: number;
    commissionRateSingles: number;
  };
  summaries: Array<{
    id: string;
    pricelistId: string;
    pricelistName: string;
    deliveryDate: string | null;
    status: string;
    totalCartonWeight: number;
    totalSinglesWeight: number;
    totalWalkinWeight: number;
    totalCustomers: number;
    totalWalkins: number;
    totalCommission: number;
    remainderNote: string | null;
    confirmedAt: string | null;
  }>;
  payments: Array<{
    id: string;
    amount: number;
    type: string;
    method: string | null;
    note: string | null;
    pricelistName: string | null;
    createdAt: string;
  }>;
  totals: {
    totalCommission: number;
    totalPaid: number;
    totalCollected: number;
    totalCashCollected: number;
    balance: number;
    debtDirection: "OWED_TO_AGENT" | "OWED_BY_AGENT" | "SETTLED";
  };
};

const METHOD_LABELS: Record<string, string> = {
  BANK_TRANSFER: "העברה בנקאית",
  CASH: "מזומן",
  CHECK: "צ׳ק",
  OTHER: "אחר",
};

export default function AgentMyDebtsClient() {
  const [data, setData] = useState<Data | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/agent/my-debts", { cache: "no-store" });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || "שגיאה");
        setData(json);
      } catch (e: any) {
        setError(e.message);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

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

  const { totals } = data;
  const balanceLabel =
    totals.debtDirection === "OWED_TO_AGENT"
      ? `מגיע לך ₪${totals.balance.toFixed(2)}`
      : totals.debtDirection === "OWED_BY_AGENT"
      ? `אתה חייב ₪${Math.abs(totals.balance).toFixed(2)}`
      : "היתרה מאוזנת";
  const balanceColor =
    totals.debtDirection === "OWED_TO_AGENT"
      ? "from-emerald-500 to-emerald-600"
      : totals.debtDirection === "OWED_BY_AGENT"
      ? "from-red-500 to-red-600"
      : "from-zinc-400 to-zinc-500";

  return (
    <div dir="rtl" className="min-h-screen bg-brand-cream pb-20">
      <header className="bg-brand-yellow border-b-4 border-brand-rust/20">
        <div className="mx-auto max-w-3xl px-4 py-3 flex items-center justify-between">
          <Link href="/agent" className="text-brand-slate font-medium text-sm">
            ← חזרה
          </Link>
          <h1 className="font-extrabold text-brand-slatedark">
            💰 היתרה שלי
          </h1>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 py-6 space-y-5">
        {/* יתרה בולטת */}
        <div
          className={`rounded-2xl p-6 text-white shadow-lg bg-gradient-to-br ${balanceColor}`}
        >
          <div className="text-xs font-bold opacity-80">היתרה הנוכחית שלך</div>
          <div className="text-3xl font-extrabold mt-1">{balanceLabel}</div>
        </div>

        {/* פירוט */}
        <div className="bg-white rounded-2xl border border-zinc-200 shadow-sm p-5">
          <div className="font-bold text-brand-slatedark mb-3">
            סיכום חשבון
          </div>
          <div className="space-y-2 text-sm">
            <BreakdownRow
              label="סה״כ עמלה שהצטברה"
              value={`₪${totals.totalCommission.toFixed(2)}`}
              positive
            />
            <BreakdownRow
              label="שולם לי עד כה"
              value={`-₪${totals.totalPaid.toFixed(2)}`}
              color="text-red-600"
            />
            {totals.totalCashCollected > 0 && (
              <>
                <BreakdownRow
                  label="מזומן שאספתי (מזדמנים)"
                  value={`-₪${totals.totalCashCollected.toFixed(2)}`}
                  color="text-amber-700"
                />
                <BreakdownRow
                  label="העברתי למנהל"
                  value={`+₪${totals.totalCollected.toFixed(2)}`}
                  color="text-emerald-700"
                />
              </>
            )}
            <div className="border-t border-zinc-200 pt-2 mt-2">
              <BreakdownRow
                label="יתרה"
                value={`₪${totals.balance.toFixed(2)}`}
                bold
                color={
                  totals.balance > 0
                    ? "text-emerald-700"
                    : totals.balance < 0
                    ? "text-red-700"
                    : "text-zinc-700"
                }
              />
            </div>
          </div>
        </div>

        {/* מכירות שלי */}
        {data.summaries.length > 0 && (
          <div className="bg-white rounded-2xl border border-zinc-200 shadow-sm overflow-hidden">
            <div className="px-5 py-3 border-b border-zinc-100 bg-zinc-50 font-bold text-brand-slatedark">
              היסטוריית מכירות ({data.summaries.length})
            </div>
            <div className="divide-y divide-zinc-100">
              {data.summaries.map((s) => (
                <Link
                  key={s.id}
                  href={`/agent/sale/${s.pricelistId}`}
                  className="block px-5 py-3 hover:bg-zinc-50"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="font-semibold text-brand-slatedark truncate">
                        {s.pricelistName}
                      </div>
                      <div className="text-xs text-zinc-500 mt-0.5">
                        {(s.totalCartonWeight + s.totalWalkinWeight).toFixed(1)} ק״ג קרטונים ·{" "}
                        {s.totalSinglesWeight.toFixed(1)} ק״ג בודדים ·{" "}
                        {s.totalCustomers} לקוחות
                        {s.totalWalkins > 0 && ` · ${s.totalWalkins} מזדמנים`}
                      </div>
                    </div>
                    <div className="text-brand-rust font-extrabold whitespace-nowrap">
                      ₪{s.totalCommission.toFixed(2)}
                    </div>
                    {s.status === "CONFIRMED" && (
                      <span className="text-[10px] bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full font-bold whitespace-nowrap">
                        ✓ סגור
                      </span>
                    )}
                  </div>
                </Link>
              ))}
            </div>
          </div>
        )}

        {/* היסטוריית תשלומים */}
        {data.payments.length > 0 && (
          <div className="bg-white rounded-2xl border border-zinc-200 shadow-sm overflow-hidden">
            <div className="px-5 py-3 border-b border-zinc-100 bg-zinc-50 font-bold text-brand-slatedark">
              היסטוריית תשלומים ({data.payments.length})
            </div>
            <div className="divide-y divide-zinc-100">
              {data.payments.map((p) => {
                const isPaid = p.type === "PAID";
                return (
                  <div
                    key={p.id}
                    className={`px-5 py-3 ${
                      isPaid ? "bg-emerald-50/30" : "bg-amber-50/30"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span
                            className={`font-bold text-sm ${
                              isPaid ? "text-emerald-700" : "text-amber-700"
                            }`}
                          >
                            {isPaid ? "קיבלתי מהמנהל" : "העברתי למנהל"}
                          </span>
                          <span className="text-xs text-zinc-500">
                            {new Date(p.createdAt).toLocaleDateString("he-IL")}
                          </span>
                        </div>
                        {p.method && (
                          <div className="text-[10px] text-zinc-500 mt-0.5">
                            {METHOD_LABELS[p.method] || p.method}
                          </div>
                        )}
                        {p.note && (
                          <div className="text-xs text-zinc-600 mt-1 bg-white/70 rounded px-2 py-1">
                            {p.note}
                          </div>
                        )}
                      </div>
                      <div
                        className={`font-extrabold ${
                          isPaid ? "text-emerald-700" : "text-amber-700"
                        } whitespace-nowrap`}
                      >
                        ₪{p.amount.toFixed(2)}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* אין כלום */}
        {data.summaries.length === 0 && data.payments.length === 0 && (
          <div className="bg-white rounded-2xl border border-zinc-200 p-8 text-center">
            <p className="text-brand-slatedark font-semibold">
              עדיין לא ביצעת מכירות
            </p>
            <p className="text-xs text-zinc-500 mt-1">
              היסטוריה תופיע כאן לאחר סגירת מכירה ראשונה
            </p>
          </div>
        )}
      </main>
    </div>
  );
}

function BreakdownRow({
  label,
  value,
  color,
  bold,
  positive,
}: {
  label: string;
  value: string;
  color?: string;
  bold?: boolean;
  positive?: boolean;
}) {
  return (
    <div className="flex justify-between items-center">
      <span className="text-brand-slate">{label}</span>
      <span
        className={`${bold ? "text-lg font-extrabold" : "font-bold"} ${
          color || (positive ? "text-brand-slatedark" : "text-brand-slatedark")
        }`}
      >
        {value}
      </span>
    </div>
  );
}
