"use client";

// §20: מסך המנהל לניהול חובות ותשלומים לנציגים
// מציג: רשימת נציגים עם יתרות + היסטוריה + הוספת תשלום/גבייה

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";

type AgentData = {
  agent: {
    id: string;
    name: string;
    phone: string | null;
    email: string | null;
    point: { id: string; name: string } | null;
    commissionRateCarton: number;
    commissionRateSingles: number;
  };
  summaries: Array<{
    id: string;
    pricelistId: string;
    pricelistName: string;
    deliveryDate: string | null;
    pricelistStatus: string;
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
    pricelistId: string | null;
    pricelistName: string | null;
    createdAt: string;
    createdById: string | null;
  }>;
  /** §292: שמות הנקודות של הנציג */
  points?: string[];
  totals: {
    /** §292: כמה נגבה באשראי מהנקודות שלו */
    cardCollected?: number;
    cardOrders?: number;
    /**
     * §294: מזומן מ**לקוחות רגילים** — לא רק ממזדמנים.
     *
     * totalCashCollected סופר walkinOrder בלבד. נציג שגבה מזומן
     * מלקוח שהזמין מראש (§130) - הכסף אצלו, ולא הופיע בשום מקום.
     */
    cashFromOrders?: number;
    cashOrders?: number;
    /** §397: מזומן שהמנהל קיבל ישירות מלקוחות הנקודה */
    cashToAdmin?: number;
    cashToAdminOrders?: number;
    /** §397: כמה מזדמנים שילמו מזומן */
    walkinCashCount?: number;
    pendingCollection?: number;
    pendingOrders?: number;
    totalCommission: number;
    totalPaid: number;
    totalCollected: number;
    totalCashCollected: number;
    balance: number;
    debtDirection: "OWED_TO_AGENT" | "OWED_BY_AGENT" | "SETTLED";
  };
};

// §397: פורמט אחיד לכל הסכומים במסך
const money = (n: number | undefined | null) =>
  "₪" +
  Number(n ?? 0).toLocaleString("he-IL", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

export default function AdminAgentDebtsClient() {
  const [data, setData] = useState<AgentData[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedAgent, setExpandedAgent] = useState<string | null>(null);
  const [showPaymentForm, setShowPaymentForm] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/agent-payments", { cache: "no-store" });
      const json = await res.json();
      setData(Array.isArray(json) ? json : []);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div dir="rtl" className="min-h-screen bg-brand-cream pb-20">
      <header className="bg-brand-yellow border-b-4 border-brand-rust/20">
        <div className="mx-auto max-w-6xl px-4 py-3 flex items-center justify-between">
          <Link href="/admin" className="text-brand-slate font-medium text-sm">
            ← חזרה לניהול
          </Link>
          <h1 className="font-extrabold text-brand-slatedark">
            💰 חובות ותשלומים לנציגים
          </h1>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-6">
        {loading ? (
          <div className="text-center text-zinc-500 py-10">טוען...</div>
        ) : data.length === 0 ? (
          <div className="bg-white rounded-2xl border border-zinc-200 p-10 text-center">
            <p className="text-brand-slatedark font-semibold">אין נציגים במערכת</p>
            <p className="text-xs text-zinc-500 mt-1">
              הוסף נציגים דרך "לקוחות" - שנה role ל-AGENT
            </p>
          </div>
        ) : (
          <>
            {/* סיכום כללי */}
            <SummaryCards data={data} />

            {/* רשימת נציגים */}
            <div className="mt-5 space-y-3">
              {data.map((item) => (
                <AgentCard
                  key={item.agent.id}
                  data={item}
                  expanded={expandedAgent === item.agent.id}
                  onToggle={() =>
                    setExpandedAgent(
                      expandedAgent === item.agent.id ? null : item.agent.id
                    )
                  }
                  showPaymentForm={showPaymentForm === item.agent.id}
                  onOpenPaymentForm={() => setShowPaymentForm(item.agent.id)}
                  onClosePaymentForm={() => setShowPaymentForm(null)}
                  onReload={load}
                />
              ))}
            </div>
          </>
        )}
      </main>
    </div>
  );
}

function SummaryCards({ data }: { data: AgentData[] }) {
  const totalOwedToAgents = data.reduce(
    (s, d) => (d.totals.balance > 0 ? s + d.totals.balance : s),
    0
  );
  const totalOwedByAgents = data.reduce(
    (s, d) => (d.totals.balance < 0 ? s + Math.abs(d.totals.balance) : s),
    0
  );
  const totalCommissionsAll = data.reduce(
    (s, d) => s + d.totals.totalCommission,
    0
  );

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
      <SummaryCard
        label="סה״כ עמלות שהצטברו"
        value={`₪${totalCommissionsAll.toFixed(2)}`}
        color="rust"
        subtitle={`${data.length} נציגים פעילים`}
      />
      <SummaryCard
        label="המנהל חייב לנציגים"
        value={`₪${totalOwedToAgents.toFixed(2)}`}
        color="red"
        subtitle="יש לשלם"
        highlight={totalOwedToAgents > 0}
      />
      <SummaryCard
        label="נציגים חייבים למנהל"
        value={`₪${totalOwedByAgents.toFixed(2)}`}
        color="emerald"
        subtitle="לגבייה"
        highlight={totalOwedByAgents > 0}
      />
    </div>
  );
}

function SummaryCard({
  label,
  value,
  color,
  subtitle,
  highlight,
}: {
  label: string;
  value: string;
  color: "rust" | "red" | "emerald";
  subtitle?: string;
  highlight?: boolean;
}) {
  const colorMap = {
    rust: "bg-orange-50 text-brand-rust border-orange-200",
    red: "bg-red-50 text-red-700 border-red-200",
    emerald: "bg-emerald-50 text-emerald-700 border-emerald-200",
  }[color];
  return (
    <div
      className={`rounded-2xl border p-4 ${colorMap} ${
        highlight ? "ring-2 ring-current/30 shadow-md" : "shadow-sm"
      }`}
    >
      <div className="text-xs font-bold opacity-80">{label}</div>
      <div className="text-2xl font-extrabold mt-1">{value}</div>
      {subtitle && (
        <div className="text-[10px] opacity-70 mt-1">{subtitle}</div>
      )}
    </div>
  );
}

function AgentCard({
  data,
  expanded,
  onToggle,
  showPaymentForm,
  onOpenPaymentForm,
  onClosePaymentForm,
  onReload,
}: {
  data: AgentData;
  expanded: boolean;
  onToggle: () => void;
  showPaymentForm: boolean;
  onOpenPaymentForm: () => void;
  onClosePaymentForm: () => void;
  onReload: () => void;
}) {
  const { agent, totals, summaries, payments } = data;
  // §397: 🔍 איזה פירוט פתוח (null = אף אחד)
  const [detail, setDetail] = useState<DetailKind | null>(null);
  const toggleDetail = (k: DetailKind) => setDetail(detail === k ? null : k);
  const cashHeld = (totals.totalCashCollected ?? 0) + (totals.cashFromOrders ?? 0);

  const balanceLabel =
    totals.debtDirection === "OWED_TO_AGENT"
      ? `המנהל חייב ₪${totals.balance.toFixed(2)}`
      : totals.debtDirection === "OWED_BY_AGENT"
      ? `הנציג חייב ₪${Math.abs(totals.balance).toFixed(2)}`
      : "סגור";
  const balanceColor =
    totals.debtDirection === "OWED_TO_AGENT"
      ? "text-red-700 bg-red-100"
      : totals.debtDirection === "OWED_BY_AGENT"
      ? "text-emerald-700 bg-emerald-100"
      : "text-zinc-600 bg-zinc-100";

  return (
    <div className="bg-white rounded-2xl border border-zinc-200 shadow-sm overflow-hidden">
      {/* Header */}
      <button
        onClick={onToggle}
        className="w-full px-4 py-3 flex items-center gap-3 hover:bg-zinc-50 text-right"
      >
        <div className="shrink-0 w-11 h-11 rounded-full bg-gradient-to-br from-brand-rust to-[#a83a15] flex items-center justify-center text-white text-lg font-extrabold shadow-sm">
          {agent.name.charAt(0)}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-bold text-brand-slatedark">{agent.name}</span>
            {agent.point && (
              <span className="text-xs text-zinc-500">
                📍 {agent.point.name}
              </span>
            )}
          </div>
          <div className="text-xs text-zinc-500 mt-0.5">
            {summaries.length} מכירות · {payments.length} תשלומים
          </div>
        </div>
        <div className="flex flex-col items-end gap-1 shrink-0">
          <span
            className={`text-xs font-bold px-2.5 py-1 rounded-full ${balanceColor}`}
          >
            {balanceLabel}
          </span>
        </div>
        <svg
          className={`w-5 h-5 text-zinc-400 shrink-0 transition-transform ${
            expanded ? "rotate-180" : ""
          }`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* Expanded content */}
      {/* §292: 💳 האשראי שנגבה מהנקודות של הנציג.
          
          הבעיה מהשטח: חברת האשראי מעבירה סכום אחד לכל
          המכירות ולכל הנקודות. המנהל מקבל ₪40,000 ואין לו
          דרך לדעת כמה מזה ברכפלד.
          
          המערכת כן יודעת: כל הזמנה משויכת לנקודה, וכל חיוב
          מוצלח יודע כמה נגבה. */}
      {(totals.cardCollected ?? 0) > 0 ||
      (totals.pendingCollection ?? 0) > 0 ||
      // §397: גם כשיש רק מזומן (למשל רק מזדמנים) — אחרת ה-260 לא מוסבר
      cashHeld > 0 ||
      (totals.cashToAdmin ?? 0) > 0 ? (
        <div className="mt-3 rounded-xl border-2 border-blue-200 bg-blue-50 p-3">
          <div className="text-xs font-bold text-blue-900 mb-2">
            💳 גבייה מהנקודות של הנציג
            {data.points && data.points.length > 0 && (
              <span className="font-normal text-blue-700">
                {" · "}
                {data.points.join(" · ")}
              </span>
            )}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => toggleDetail("CARD")}
              className="text-right rounded-lg hover:bg-blue-100 p-1 -m-1"
            >
              <div className="text-[10px] text-blue-700">
                נגבה באשראי · <span className="underline">פירוט</span>
              </div>
              <div className="text-lg font-extrabold text-blue-900 tabular-nums">
                ₪{(totals.cardCollected ?? 0).toLocaleString("he-IL", {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })}
              </div>
              <div className="text-[10px] text-blue-700">
                {totals.cardOrders ?? 0} הזמנות
              </div>
            </button>
        {/* ⚠️ כתום לממתין: זה מה שעדיין לא נכנס, וזו
                השורה שאומרת למנהל שהנקודה לא סגורה. */}
            <button
              type="button"
              onClick={() => toggleDetail("PENDING")}
              className="text-right rounded-lg hover:bg-amber-50 p-1 -m-1"
            >
              <div className="text-[10px] text-amber-800">
                ⏳ טרם נגבה · <span className="underline">פירוט</span>
              </div>
              <div className="text-lg font-extrabold text-amber-800 tabular-nums">
                ₪{(totals.pendingCollection ?? 0).toLocaleString("he-IL", {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })}
              </div>
              <div className="text-[10px] text-amber-800">
                {totals.pendingOrders ?? 0} הזמנות
              </div>
            </button>
          </div>
          {/* §294: 💵 מזומן מלקוחות רגילים.
              
              הפער: "מזומן שאסף" סופר רק מזדמנים. נציג שגבה
              מזומן מלקוח שהזמין מראש (§130) - הכסף אצלו, ולא
              הופיע בשום מקום. */}
          {/* §397: כל מקור מזומן בשורה משלו, וכל שורה נפתחת לפירוט */}
          <div className="mt-2 pt-2 border-t border-blue-200 space-y-1 text-xs">
            <DetailLine
              label={`💵 מזומן שגבה מלקוחות שהזמינו (${totals.cashOrders ?? 0} הזמנות)`}
              value={money(totals.cashFromOrders)}
              onClick={() => toggleDetail("CASH_AGENT")}
            />
            <DetailLine
              label={`🚶 מזומן ממזדמנים — לקוחות שלא הזמינו מראש (${totals.walkinCashCount ?? 0})`}
              value={money(totals.totalCashCollected)}
              onClick={() => toggleDetail("WALKINS")}
            />
            {(totals.cashToAdmin ?? 0) > 0 && (
              <DetailLine
                label={`🏦 מזומן שהמנהל קיבל ישירות (${totals.cashToAdminOrders ?? 0}) — לא אצל הנציג`}
                value={money(totals.cashToAdmin)}
                onClick={() => toggleDetail("CASH_ADMIN")}
                muted
              />
            )}
          </div>

          {/* §294: 🧮 שורת ההצלבה — "כמה כסף אצלו עכשיו".
              
              מזומן שגבה (מזדמנים + לקוחות) פחות מה שהעביר. זה
              הסכום שהוא אמור למסור, וזו השאלה שהמנהל שואל. */}
          <div className="mt-2 pt-2 border-t-2 border-blue-300 flex items-center justify-between">
            <span className="text-xs font-bold text-blue-900">
              💰 מזומן שאמור להיות אצלו
              <span className="block font-normal text-[10px] text-blue-800">
                {money(totals.cashFromOrders)} מלקוחות + {money(totals.totalCashCollected)} ממזדמנים − {money(totals.totalCollected)} שהעביר
              </span>
            </span>
            <span
              className={`text-base font-extrabold tabular-nums ${
                (totals.totalCashCollected ?? 0) +
                  (totals.cashFromOrders ?? 0) -
                  (totals.totalCollected ?? 0) >
                0.01
                  ? "text-amber-700"
                  : "text-emerald-700"
              }`}
            >
              ₪
              {Math.max(
                0,
                (totals.totalCashCollected ?? 0) +
                  (totals.cashFromOrders ?? 0) -
                  (totals.totalCollected ?? 0)
              ).toLocaleString("he-IL", {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })}
            </span>
          </div>

          <p className="text-[10px] text-blue-800 mt-2 leading-relaxed">
            הסכומים לפי ההזמנות בנקודות של הנציג. חברת האשראי מעבירה
            הכל יחד, וזה הפירוק לפי נקודה. <b>לחיצה על כל סכום פותחת את
            השורות שהוא בנוי מהן.</b>
          </p>
        </div>
      ) : null}

      {/* §397: 🔍 הפירוט — נטען רק כשנפתח */}
      {detail && (
        <BreakdownPanel
          agentId={agent.id}
          kind={detail}
          totals={totals}
          summaries={summaries}
          onClose={() => setDetail(null)}
        />
      )}

      {expanded && (
        <div className="border-t border-zinc-100">
          {/* פירוט חשבון */}
          <div className="p-4 grid grid-cols-2 md:grid-cols-4 gap-3 bg-zinc-50">
            <StatItem
              label="סה״כ עמלה שהצטברה · פירוט"
              value={money(totals.totalCommission)}
              onClick={() => toggleDetail("COMMISSION")}
            />
            <StatItem
              label="המנהל שילם לו · פירוט"
              value={money(totals.totalPaid)}
              color="red"
              onClick={() => toggleDetail("PAYMENTS")}
            />
            <StatItem
              label="מזומן אצלו (לקוחות + מזדמנים) · פירוט"
              value={money(cashHeld)}
              color="amber"
              onClick={() => toggleDetail("CASH_ALL")}
            />
            <StatItem
              label="העביר למנהל · פירוט"
              value={money(totals.totalCollected)}
              color="emerald"
              onClick={() => toggleDetail("PAYMENTS")}
            />
          </div>

          {/* §397: 🧮 הנוסחה — במפורש. "המנהל חייב 182.90" בלי חשבון
              הוא מספר שאי אפשר לבדוק. */}
          <div className="px-4 py-3 bg-white border-t border-zinc-100 text-xs text-zinc-700 leading-relaxed">
            <div className="font-bold text-brand-slatedark mb-1">איך מחושבת היתרה</div>
            <div className="tabular-nums">
              עמלה {money(totals.totalCommission)} − שולם לו {money(totals.totalPaid)} − (מזומן
              אצלו {money(cashHeld)} − העביר {money(totals.totalCollected)}) ={" "}
              <b
                className={
                  totals.balance > 0
                    ? "text-red-700"
                    : totals.balance < 0
                      ? "text-emerald-700"
                      : ""
                }
              >
                {totals.balance > 0
                  ? `המנהל חייב לו ${money(totals.balance)}`
                  : totals.balance < 0
                    ? `הנציג חייב למנהל ${money(Math.abs(totals.balance))}`
                    : "מאוזן"}
              </b>
            </div>
            <div className="text-[10px] text-zinc-500 mt-1">
              המזומן שאצל הנציג מתקזז מהעמלה שמגיעה לו: הוא כבר מחזיק כסף של המכירה.
            </div>
          </div>



          {/* מכירות */}
          {summaries.length > 0 && (
            <div className="p-4 border-t border-zinc-100">
              <div className="font-bold text-brand-slatedark text-sm mb-2">
                מכירות ({summaries.length})
              </div>
              <div className="space-y-2">
                {summaries.map((s) => (
                  <div
                    key={s.id}
                    className="bg-zinc-50 rounded-lg p-3 text-sm flex flex-wrap items-center gap-3"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="font-semibold text-brand-slatedark">
                        {s.pricelistName}
                        {s.deliveryDate && (
                          <span className="text-xs text-zinc-500 mr-2">
                            {new Date(s.deliveryDate).toLocaleDateString("he-IL")}
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-zinc-500 mt-0.5">
                        {(s.totalCartonWeight + s.totalWalkinWeight).toFixed(2)} ק"ג קרטונים · {s.totalSinglesWeight.toFixed(2)} ק"ג בודדים · {s.totalCustomers} לקוחות · {s.totalWalkins} מזדמנים
                      </div>
                      {s.remainderNote && (
                        <div className="text-[10px] text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1 mt-1 inline-block">
                          הערה: {s.remainderNote}
                        </div>
                      )}
                    </div>
                    <div className="text-brand-rust font-bold whitespace-nowrap">
                      ₪{s.totalCommission.toFixed(2)}
                    </div>
                    <span
                      className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${
                        s.status === "CONFIRMED"
                          ? "bg-emerald-100 text-emerald-700"
                          : "bg-amber-100 text-amber-700"
                      }`}
                    >
                      {s.status === "CONFIRMED" ? "✓ נסגר" : "פתוח"}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* היסטוריית תשלומים */}
          {payments.length > 0 && (
            <div className="p-4 border-t border-zinc-100">
              <div className="font-bold text-brand-slatedark text-sm mb-2">
                היסטוריית תשלומים ({payments.length})
              </div>
              <div className="space-y-2">
                {payments.map((p) => (
                  <PaymentRow key={p.id} payment={p} onDeleted={onReload} />
                ))}
              </div>
            </div>
          )}

          {/* פעולות */}
          <div className="p-4 border-t border-zinc-100 bg-zinc-50">
            {showPaymentForm ? (
              <PaymentForm
                agentId={agent.id}
                onCancel={onClosePaymentForm}
                onDone={() => {
                  onClosePaymentForm();
                  onReload();
                }}
              />
            ) : (
              <button
                onClick={onOpenPaymentForm}
                className="w-full py-3 rounded-xl bg-brand-rust text-white font-bold hover:bg-[#a83a15] shadow-md"
              >
                + הוסף תשלום / גבייה
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function StatItem({
  label,
  value,
  color,
  onClick,
}: {
  label: string;
  value: string;
  color?: "red" | "amber" | "emerald";
  /** §397: לחיצה פותחת פירוט */
  onClick?: () => void;
}) {
  const colorMap = {
    red: "text-red-700",
    amber: "text-amber-700",
    emerald: "text-emerald-700",
  };
  const c = color ? colorMap[color] : "text-brand-slatedark";
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!onClick}
      className="text-right rounded-lg p-1 -m-1 hover:bg-white disabled:hover:bg-transparent"
    >
      <div className="text-[10px] font-bold text-zinc-500">{label}</div>
      <div className={`font-extrabold text-sm mt-0.5 ${c}`}>{value}</div>
    </button>
  );
}

function PaymentRow({
  payment,
  onDeleted,
}: {
  payment: AgentData["payments"][number];
  onDeleted: () => void;
}) {
  const [deleting, setDeleting] = useState(false);

  const isPaid = payment.type === "PAID";
  const label = isPaid ? "שולם לנציג" : "העביר למנהל";
  const bg = isPaid ? "bg-red-50 border-red-200" : "bg-emerald-50 border-emerald-200";
  const txt = isPaid ? "text-red-700" : "text-emerald-700";

  async function del() {
    if (!confirm("למחוק את הרשומה?")) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/admin/agent-payments/${payment.id}`, {
        method: "DELETE",
      });
      if (res.ok) onDeleted();
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className={`rounded-lg border p-2.5 text-sm flex items-center gap-3 ${bg}`}>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className={`font-bold ${txt}`}>{label}</span>
          <span className="text-xs text-zinc-500">
            {new Date(payment.createdAt).toLocaleDateString("he-IL")}
          </span>
        </div>
        {payment.method && (
          <div className="text-[10px] text-zinc-500 mt-0.5">
            {METHOD_LABELS[payment.method] || payment.method}
          </div>
        )}
        {payment.note && (
          <div className="text-xs text-zinc-600 mt-1 bg-white/50 rounded px-2 py-1">
            {payment.note}
          </div>
        )}
        {payment.pricelistName && (
          <div className="text-[10px] text-zinc-500 mt-1">
            מכירה: {payment.pricelistName}
          </div>
        )}
      </div>
      <div className={`font-extrabold ${txt} whitespace-nowrap`}>
        ₪{payment.amount.toFixed(2)}
      </div>
      <button
        onClick={del}
        disabled={deleting}
        className="text-xs text-zinc-400 hover:text-red-600 px-1"
        title="מחק"
      >
        ✕
      </button>
    </div>
  );
}

const METHOD_LABELS: Record<string, string> = {
  BANK_TRANSFER: "העברה בנקאית",
  CASH: "מזומן",
  CHECK: "צ׳ק",
  OTHER: "אחר",
};

function PaymentForm({
  agentId,
  onCancel,
  onDone,
}: {
  agentId: string;
  onCancel: () => void;
  onDone: () => void;
}) {
  const [type, setType] = useState<"PAID" | "COLLECTED">("PAID");
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("BANK_TRANSFER");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  async function save() {
    const amt = parseFloat(amount);
    if (!amt || amt <= 0) {
      alert("יש להזין סכום חיובי");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/admin/agent-payments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          agentId,
          amount: amt,
          type,
          method,
          note: note.trim() || null,
        }),
      });
      if (!res.ok) {
        const j = await res.json();
        alert(j.error || "שגיאה");
        return;
      }
      onDone();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="bg-white rounded-xl border border-zinc-200 p-4 space-y-3">
      <div className="font-bold text-brand-slatedark">
        רישום תשלום / גבייה
      </div>

      {/* סוג */}
      <div className="grid grid-cols-2 gap-2">
        <button
          onClick={() => setType("PAID")}
          className={`p-3 rounded-lg font-bold text-sm border-2 transition-colors ${
            type === "PAID"
              ? "bg-red-50 border-red-500 text-red-700"
              : "bg-zinc-50 border-zinc-200 text-zinc-500"
          }`}
        >
          המנהל שילם לנציג
        </button>
        <button
          onClick={() => setType("COLLECTED")}
          className={`p-3 rounded-lg font-bold text-sm border-2 transition-colors ${
            type === "COLLECTED"
              ? "bg-emerald-50 border-emerald-500 text-emerald-700"
              : "bg-zinc-50 border-zinc-200 text-zinc-500"
          }`}
        >
          הנציג העביר למנהל
        </button>
      </div>

      {/* סכום */}
      <label className="block">
        <span className="text-xs font-bold text-zinc-500">סכום (₪)</span>
        <input
          type="number"
          inputMode="decimal"
          min="0"
          step="0.01"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="0.00"
          className="w-full mt-1 px-3 py-2 border border-zinc-300 rounded-lg text-lg font-bold text-center"
        />
      </label>

      {/* אמצעי */}
      <label className="block">
        <span className="text-xs font-bold text-zinc-500">אמצעי</span>
        <select
          value={method}
          onChange={(e) => setMethod(e.target.value)}
          className="w-full mt-1 px-3 py-2 border border-zinc-300 rounded-lg text-sm"
        >
          <option value="BANK_TRANSFER">העברה בנקאית</option>
          <option value="CASH">מזומן</option>
          <option value="CHECK">צ׳ק</option>
          <option value="OTHER">אחר</option>
        </select>
      </label>

      {/* הערה */}
      <label className="block">
        <span className="text-xs font-bold text-zinc-500">
          הערה{" "}
          <span className="font-normal text-zinc-400">
            (למשל: "מזומן שאסף בחלוקה")
          </span>
        </span>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={2}
          className="w-full mt-1 px-3 py-2 border border-zinc-300 rounded-lg text-sm"
        />
      </label>

      {/* Actions */}
      <div className="flex gap-2 pt-2">
        <button
          onClick={onCancel}
          disabled={saving}
          className="flex-1 py-2 rounded-lg border border-zinc-300 text-brand-slatedark font-bold hover:bg-zinc-50"
        >
          ביטול
        </button>
        <button
          onClick={save}
          disabled={saving}
          className="flex-1 py-2 rounded-lg bg-brand-rust text-white font-bold hover:bg-[#a83a15] shadow-sm"
        >
          {saving ? "שומר..." : "שמור"}
        </button>
      </div>
    </div>
  );
}


// ═══════════════════════════════════════════════════════════════
// §397: 🔍 פירוט — ממה בנוי כל סכום
// ═══════════════════════════════════════════════════════════════

type DetailKind =
  | "CARD"
  | "PENDING"
  | "CASH_AGENT"
  | "CASH_ADMIN"
  | "WALKINS"
  | "CASH_ALL"
  | "COMMISSION"
  | "PAYMENTS";

type Breakdown = {
  orders: Array<{
    id: string;
    orderNumber: number;
    customerName: string;
    pointName: string;
    pricelistId: string | null;
    pricelistName: string;
    paymentStatus: string | null;
    paymentMethod: string | null;
    receivedBy: string | null;
    paidAt: string | null;
    total: number;
    weighed: boolean;
    debtPart: number;
    collected: number;
    pending: number;
    collectedBucket: "CARD" | "CASH_AGENT" | "CASH_ADMIN" | null;
    bucket: string;
    /** §398: הסכומים שנספרים בכרטיס — לפי מי שמחזיק בכסף */
    status?: string;
    inPoints?: boolean;
    cardRev?: number;
    adminCashRev?: number;
    agentCash?: number;
  }>;
  walkins: Array<{
    id: string;
    walkinNumber: number;
    customerName: string;
    customerPhone: string | null;
    paymentMethod: string;
    paymentReceived: boolean;
    paymentNote: string | null;
    totalAmount: number;
    createdAt: string;
    pricelistId: string;
    pricelistName: string;
    pointName: string;
    countsAsCashHeld: boolean;
  }>;
  sales: Array<{
    pricelistId: string;
    pricelistName: string;
    cartonKg: number;
    singlesKg: number;
    cartonCommission: number;
    singlesCommission: number;
    customCommission: number;
    totalCommission: number;
    status: string;
  }>;
};

const DETAIL_TITLES: Record<DetailKind, { title: string; hint: string }> = {
  CARD: {
    title: "💳 נגבה באשראי",
    hint: "הזמנות בנקודות של הנציג ששולמו בכרטיס או בהעברה. הכסף אצל העסק — לא אצל הנציג. בהזמנה ששולמה חלק במזומן וחלק באשראי, מוצג כאן רק החלק שבאשראי.",
  },
  PENDING: {
    title: "⏳ טרם נגבה",
    hint: "הזמנות שעוד לא שולמו, או ששולמו חלקית (מוצגת היתרה בלבד).",
  },
  CASH_AGENT: {
    title: "💵 מזומן שהנציג גבה מלקוחות",
    hint: "מזומן שהנציג הזה סימן שקיבל — בכל נקודה, כולל הזמנה שבוטלה אחרי התשלום. הכסף אצלו עד שיעביר למנהל.",
  },
  CASH_ADMIN: {
    title: "🏦 מזומן שהמנהל קיבל ישירות",
    hint: "הזמנות שהמנהל סימן כשולמו במזומן. לא נספר כמזומן אצל הנציג.",
  },
  WALKINS: {
    title: "🚶 מזדמנים",
    hint: "לקוחות מזדמנים שקנו בחלוקה בלי הזמנה מראש. הם לא מופיעים ברשימת ההזמנות — רק כאן ובמסך המכירה של הנציג (לשונית מזדמנים). רק מזומן שהתקבל נספר כמזומן אצלו.",
  },
  CASH_ALL: {
    title: "💰 כל המזומן שאצל הנציג",
    hint: "מזומן מלקוחות שהזמינו + מזומן ממזדמנים.",
  },
  COMMISSION: {
    title: "🧾 עמלה לפי מכירה",
    hint: "העמלה מחושבת לפי הק\"ג שהנציג שקל: קרטונים × תעריף קרטון, בודדים × תעריף בודדים, ועמלה על מחירים מותאמים.",
  },
  PAYMENTS: {
    title: "🔁 תשלומים והעברות",
    hint: "כל מה שהמנהל שילם לנציג, וכל מה שהנציג העביר למנהל.",
  },
};

function DetailLine({
  label,
  value,
  onClick,
  muted,
}: {
  label: string;
  value: string;
  onClick: () => void;
  muted?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full flex items-center justify-between gap-2 rounded px-1 py-0.5 hover:bg-blue-100 text-right ${
        muted ? "text-zinc-600" : "text-blue-900"
      }`}
    >
      <span>
        {label} · <span className="underline">פירוט</span>
      </span>
      <span className="font-bold tabular-nums shrink-0">{value}</span>
    </button>
  );
}

function BreakdownPanel({
  agentId,
  kind,
  totals,
  summaries,
  onClose,
}: {
  agentId: string;
  kind: DetailKind;
  totals: AgentData["totals"];
  summaries: AgentData["summaries"];
  onClose: () => void;
}) {
  const [data, setData] = useState<Breakdown | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (kind === "PAYMENTS") return; // ההיסטוריה כבר בכרטיס
    let cancelled = false;
    setError("");
    fetch(`/api/admin/agent-breakdown?agentId=${encodeURIComponent(agentId)}`, {
      cache: "no-store",
    })
      .then(async (r) => {
        const j = await r.json();
        if (!r.ok) throw new Error(j.error || "שגיאה בטעינת הפירוט");
        if (!cancelled) setData(j);
      })
      .catch((e) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
    };
  }, [agentId, kind]);

  const t = DETAIL_TITLES[kind];

  // §398: הסכום של כל שורה **בדיוק** כפי שנספר בכרטיס. הזמנה אחת
  // יכולה להופיע גם ב"אשראי" וגם ב"מזומן אצל הנציג" — כל חלק במקומו.
  const amountOf = (o: Breakdown["orders"][number]): number => {
    if (kind === "CARD") return o.cardRev ?? 0;
    if (kind === "CASH_AGENT" || kind === "CASH_ALL") return o.agentCash ?? 0;
    if (kind === "CASH_ADMIN") return o.adminCashRev ?? 0;
    if (kind === "PENDING") return o.pending;
    return 0;
  };
  const orderRows = data?.orders.filter((o) => amountOf(o) > 0) ?? [];
  const walkinRows =
    kind === "WALKINS"
      ? data?.walkins ?? []
      : kind === "CASH_ALL"
        ? (data?.walkins ?? []).filter((w) => w.countsAsCashHeld)
        : [];

  const orderSum = orderRows.reduce(
    (s, o) => s + amountOf(o),
    0
  );
  const walkinSum = walkinRows
    .filter((w) => w.countsAsCashHeld)
    .reduce((s, w) => s + w.totalAmount, 0);

  return (
    <div className="mt-3 rounded-xl border-2 border-zinc-300 bg-white p-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="font-extrabold text-brand-slatedark text-sm">{t.title}</div>
          <div className="text-[11px] text-zinc-600 mt-0.5 leading-relaxed">{t.hint}</div>
        </div>
        <button onClick={onClose} className="text-zinc-400 text-lg leading-none px-1" title="סגירה">
          ×
        </button>
      </div>

      {error && <p className="text-xs text-red-700 mt-2">{error}</p>}
      {!data && kind !== "PAYMENTS" && !error && (
        <p className="text-xs text-zinc-500 mt-2">טוען פירוט…</p>
      )}

      {/* הזמנות */}
      {orderRows.length > 0 && (
        <div className="mt-2 max-h-80 overflow-y-auto border rounded-lg divide-y">
          {orderRows.map((o) => (
            <a
              key={o.id}
              href={`/admin/orders/${o.id}`}
              target="_blank"
              className="flex items-center gap-2 px-2 py-1.5 text-xs hover:bg-zinc-50"
            >
              <span className="font-bold text-brand-rust shrink-0">#{o.orderNumber}</span>
              <span className="flex-1 min-w-0 truncate">
                {o.customerName}
                <span className="text-zinc-500">
                  {" · "}
                  {o.pricelistName}
                  {o.pointName ? ` · ${o.pointName}` : ""}
                  {kind === "PENDING" && o.collected > 0
                    ? ` · שולם ${money(o.collected)} מתוך ${money(o.total - o.debtPart)}`
                    : ""}
                  {kind === "PENDING" && !o.weighed ? " · טרם נשקל (משוער)" : ""}
                  {o.debtPart > 0
                    ? kind === "CASH_AGENT" || kind === "CASH_ALL"
                      ? ` · כולל חוב קודם ${money(o.debtPart)} שגבה (הכסף אצלו)`
                      : ` · כולל חוב קודם ${money(o.debtPart)} (לא נספר)`
                    : ""}
                  {o.status === "CANCELLED" ? " · ⚠️ ההזמנה בוטלה — המזומן עדיין אצלו" : ""}
                  {(kind === "CASH_AGENT" || kind === "CASH_ALL") && o.inPoints === false && o.status !== "CANCELLED"
                    ? " · בנקודה שאינה שלו"
                    : ""}
                  {(kind === "CASH_AGENT" || kind === "CASH_ADMIN" || kind === "CASH_ALL") && o.receivedBy
                    ? ` · סימן: ${o.receivedBy}`
                    : ""}
                </span>
              </span>
              <span className="font-bold tabular-nums shrink-0">
                {money(amountOf(o))}
              </span>
            </a>
          ))}
        </div>
      )}

      {/* מזדמנים */}
      {walkinRows.length > 0 && (
        <div className="mt-2">
          {kind === "CASH_ALL" && (
            <div className="text-[11px] font-bold text-zinc-600 mb-1">ממזדמנים:</div>
          )}
          {/* §398: מזדמן = קונה שלא נרשם. הופכים אותו ללקוח, והשורה
              עוברת ל"מזומן מלקוחות" — אותו סכום, עם שם והזמנה. */}
          <Link
            href="/admin/walkins"
            className="block mb-1.5 text-[11px] font-bold text-violet-700 bg-violet-50 border border-violet-200 rounded px-2 py-1 hover:bg-violet-100"
          >
            👤 להפוך את המזדמנים ללקוחות רשומים — הסכום לא משתנה, רק עובר לשם הלקוח ←
          </Link>
          <div className="max-h-80 overflow-y-auto border rounded-lg divide-y">
            {walkinRows.map((w) => (
              <a
                key={w.id}
                href={`/agent/sale/${w.pricelistId}`}
                target="_blank"
                className={`flex items-center gap-2 px-2 py-1.5 text-xs hover:bg-zinc-50 ${
                  w.countsAsCashHeld ? "" : "opacity-60"
                }`}
              >
                <span className="font-bold text-violet-700 shrink-0">מזדמן {w.walkinNumber}</span>
                <span className="flex-1 min-w-0 truncate">
                  {w.customerName}
                  <span className="text-zinc-500">
                    {" · "}
                    {w.pricelistName}
                    {w.pointName ? ` · ${w.pointName}` : ""}
                    {" · "}
                    {WALKIN_METHOD[w.paymentMethod] ?? w.paymentMethod}
                    {!w.paymentReceived ? " · טרם התקבל" : ""}
                    {" · "}
                    {new Date(w.createdAt).toLocaleDateString("he-IL", { timeZone: "Asia/Jerusalem" })}
                  </span>
                </span>
                <span className="font-bold tabular-nums shrink-0">{money(w.totalAmount)}</span>
              </a>
            ))}
          </div>
        </div>
      )}

      {/* עמלה */}
      {kind === "COMMISSION" && (
        <div className="mt-2 border rounded-lg divide-y">
          {(data?.sales ?? []).map((sl) => (
            <a
              key={sl.pricelistId}
              href={`/admin/agents/${agentId}/sale-detail?pricelistId=${sl.pricelistId}`}
              target="_blank"
              className="block px-2 py-1.5 text-xs hover:bg-zinc-50"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-bold text-brand-slatedark">{sl.pricelistName}</span>
                <span className="font-bold tabular-nums">{money(sl.totalCommission)}</span>
              </div>
              <div className="text-[11px] text-zinc-500 tabular-nums">
                קרטונים {sl.cartonKg.toFixed(2)} ק״ג → {money(sl.cartonCommission)} · בודדים{" "}
                {sl.singlesKg.toFixed(2)} ק״ג → {money(sl.singlesCommission)}
                {sl.customCommission > 0 ? ` · מחירים מותאמים ${money(sl.customCommission)}` : ""}
                {sl.status === "CONFIRMED" ? " · ✓ נסגר" : " · פתוח"}
              </div>
            </a>
          ))}
          {data && data.sales.length === 0 && (
            <p className="text-xs text-zinc-500 p-2">אין עדיין סיכומי מכירה לנציג.</p>
          )}
        </div>
      )}

      {kind === "PAYMENTS" && (
        <p className="text-xs text-zinc-600 mt-2">
          הרשימה המלאה מופיעה למטה תחת "היסטוריית תשלומים" — כל רשומה עם תאריך,
          אמצעי ומכירה. סה״כ שולם לנציג {money(totals.totalPaid)}, סה״כ העביר למנהל{" "}
          {money(totals.totalCollected)}.
        </p>
      )}

      {/* שורת סיכום — חייבת להיות שווה לסכום בכרטיס */}
      {data && kind !== "COMMISSION" && kind !== "PAYMENTS" && (
        <div className="mt-2 flex items-center justify-between text-xs font-bold border-t pt-2">
          <span>
            סה״כ {orderRows.length > 0 ? `${orderRows.length} הזמנות` : ""}
            {orderRows.length > 0 && walkinRows.length > 0 ? " + " : ""}
            {walkinRows.length > 0 ? `${walkinRows.filter((w) => w.countsAsCashHeld).length} מזדמנים במזומן` : ""}
            {orderRows.length === 0 && walkinRows.length === 0 ? "אין שורות" : ""}
          </span>
          <span className="tabular-nums">{money(orderSum + walkinSum)}</span>
        </div>
      )}
      {kind === "COMMISSION" && (
        <div className="mt-2 flex items-center justify-between text-xs font-bold border-t pt-2">
          <span>סה״כ {summaries.length} מכירות</span>
          <span className="tabular-nums">{money(totals.totalCommission)}</span>
        </div>
      )}
    </div>
  );
}

const WALKIN_METHOD: Record<string, string> = {
  CASH: "מזומן",
  CARD_TERMINAL: "אשראי במסוף",
  TRANSFER: "העברה",
  ONLINE: "אונליין",
  CARD_ONLINE: "אשראי אונליין",
};
