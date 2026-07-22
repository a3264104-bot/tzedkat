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
  totals: {
    totalCommission: number;
    totalPaid: number;
    totalCollected: number;
    totalCashCollected: number;
    balance: number;
    debtDirection: "OWED_TO_AGENT" | "OWED_BY_AGENT" | "SETTLED";
  };
};

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
      {expanded && (
        <div className="border-t border-zinc-100">
          {/* פירוט חשבון */}
          <div className="p-4 grid grid-cols-2 md:grid-cols-4 gap-3 bg-zinc-50">
            <StatItem
              label="סה״כ עמלה שהצטברה"
              value={`₪${totals.totalCommission.toFixed(2)}`}
            />
            <StatItem
              label="שולם עד כה"
              value={`₪${totals.totalPaid.toFixed(2)}`}
              color="red"
            />
            <StatItem
              label="מזומן שאסף (מזדמנים)"
              value={`₪${totals.totalCashCollected.toFixed(2)}`}
              color="amber"
            />
            <StatItem
              label="העביר למנהל"
              value={`₪${totals.totalCollected.toFixed(2)}`}
              color="emerald"
            />
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
}: {
  label: string;
  value: string;
  color?: "red" | "amber" | "emerald";
}) {
  const colorMap = {
    red: "text-red-700",
    amber: "text-amber-700",
    emerald: "text-emerald-700",
  };
  const c = color ? colorMap[color] : "text-brand-slatedark";
  return (
    <div>
      <div className="text-[10px] font-bold text-zinc-500">{label}</div>
      <div className={`font-extrabold text-sm mt-0.5 ${c}`}>{value}</div>
    </div>
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
