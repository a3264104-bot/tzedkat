"use client";

// §20: מסך פרופיל נציג מלא
// - פרטים אישיים: שם, טלפון (שם משתמש), מייל, נקודה
// - עמלות (עריכה)
// - הרשאות
// - איפוס סיסמא
// - היסטוריית מכירות עם קישור לפירוט של כל אחת
// - יתרת חוב + היסטוריית תשלומים

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";

type Data = {
  agent: {
    id: string;
    name: string;
    phone: string | null;
    email: string | null;
    role: string;
    passwordPlain: string | null;
    point: { id: string; name: string; city: string | null } | null;
    agentPointId: string | null;
    agentPoints: Array<{ id: string; name: string; city: string | null }>;
    canSetFinalPrice: boolean;
    canSendPaymentLink: boolean;
    canCharge: boolean;
    canUpdateCards: boolean;
    canResetPassword: boolean;
    commissionRateCarton: number;
    commissionRateSingles: number;
    createdAt: string;
  };
  points: Array<{ id: string; name: string; city: string | null }>;
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
    pricelistName: string | null;
    pricelistId: string | null;
    createdAt: string;
  }>;
  totals: {
    totalCommission: number;
    totalPaid: number;
    totalCollected: number;
    totalCashCollected: number;
    balance: number;
    debtDirection: "OWED_TO_AGENT" | "OWED_BY_AGENT" | "SETTLED";
    totalSales: number;
    totalCashCollectedCount: number;
  };
};

const METHOD_LABELS: Record<string, string> = {
  BANK_TRANSFER: "העברה בנקאית",
  CASH: "מזומן",
  CHECK: "צ׳ק",
  OTHER: "אחר",
};

export default function AgentProfileClient({ agentId }: { agentId: string }) {
  const [data, setData] = useState<Data | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [resetResult, setResetResult] = useState<{
    newPassword: string;
    identifier: string;
  } | null>(null);
  const [resetting, setResetting] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/admin/agents/${agentId}/profile`, {
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
  }, [agentId]);

  useEffect(() => {
    load();
  }, [load]);

  async function resetPassword() {
    if (
      !confirm(
        "לאפס את הסיסמא של הנציג? הסיסמא הישנה תבוטל והוא יצטרך להתחבר מחדש."
      )
    )
      return;
    setResetting(true);
    try {
      const res = await fetch(`/api/admin/agents/${agentId}/reset-password`, {
        method: "POST",
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error);
      setResetResult({
        newPassword: json.newPassword,
        identifier: json.agent.phone || json.agent.email || "—",
      });
    } catch (e: any) {
      alert("שגיאה: " + e.message);
    } finally {
      setResetting(false);
    }
  }

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
        <div className="bg-white rounded-2xl p-8 shadow-lg text-center max-w-md">
          <p className="text-red-600 font-semibold">{error || "שגיאה"}</p>
          <Link
            href="/admin/agents"
            className="mt-4 inline-block px-4 py-2 bg-brand-rust text-white rounded-lg font-bold"
          >
            חזרה לנציגים
          </Link>
        </div>
      </div>
    );
  }

  const { agent, points, summaries, payments, totals } = data;

  const balanceLabel =
    totals.debtDirection === "OWED_TO_AGENT"
      ? `חייבים לו ₪${totals.balance.toFixed(2)}`
      : totals.debtDirection === "OWED_BY_AGENT"
      ? `הוא חייב ₪${Math.abs(totals.balance).toFixed(2)}`
      : "מאוזן";
  const balanceColor =
    totals.debtDirection === "OWED_TO_AGENT"
      ? "from-red-500 to-red-600"
      : totals.debtDirection === "OWED_BY_AGENT"
      ? "from-emerald-500 to-emerald-600"
      : "from-zinc-400 to-zinc-500";

  return (
    <div dir="rtl" className="min-h-screen bg-brand-cream pb-20">
      <header className="bg-brand-yellow border-b-4 border-brand-rust/20 sticky top-0 z-30">
        <div className="mx-auto max-w-5xl px-4 py-3 flex items-center justify-between">
          <Link href="/admin/agents" className="text-brand-slate font-medium text-sm">
            ← לרשימת נציגים
          </Link>
          <h1 className="font-extrabold text-brand-slatedark">
            👤 פרופיל נציג
          </h1>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-5 space-y-4">
        {/* פרטי הנציג + כפתורים */}
        <div className="bg-white rounded-2xl border border-zinc-200 shadow-sm p-5">
          <div className="flex items-start gap-4 flex-wrap">
            <div className="w-20 h-20 rounded-full bg-gradient-to-br from-brand-rust to-[#a83a15] flex items-center justify-center text-white text-3xl font-extrabold shadow-md shrink-0">
              {agent.name.charAt(0)}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="font-extrabold text-brand-slatedark text-xl">
                  {agent.name}
                </h2>
                <span
                  className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                    agent.role === "AGENT"
                      ? "bg-purple-100 text-purple-700"
                      : agent.role === "ADMIN"
                      ? "bg-red-100 text-red-700"
                      : "bg-zinc-100 text-zinc-600"
                  }`}
                >
                  {agent.role === "AGENT" ? "נציג" : agent.role}
                </span>
              </div>
              <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm">
                {agent.phone && (
                  <div className="flex items-center gap-2">
                    <span className="text-zinc-500">📞</span>
                    <a
                      href={`tel:${agent.phone}`}
                      className="text-brand-rust font-mono hover:underline"
                      dir="ltr"
                    >
                      {agent.phone}
                    </a>
                    <span className="text-[10px] bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded font-bold">
                      שם משתמש
                    </span>
                  </div>
                )}
                {agent.email && (
                  <div className="flex items-center gap-2">
                    <span className="text-zinc-500">📧</span>
                    <a
                      href={`mailto:${agent.email}`}
                      className="text-brand-rust hover:underline"
                      dir="ltr"
                    >
                      {agent.email}
                    </a>
                  </div>
                )}
                {agent.agentPoints && agent.agentPoints.length > 0 ? (
                  <div className="flex items-start gap-2">
                    <span className="text-zinc-500">📍</span>
                    <div className="flex flex-wrap gap-1.5">
                      {agent.agentPoints.map((p) => (
                        <span
                          key={p.id}
                          className="text-brand-slatedark font-medium bg-zinc-100 rounded-md px-2 py-0.5 text-sm"
                        >
                          {p.name}
                          {p.city && <span className="text-zinc-500"> — {p.city}</span>}
                        </span>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <span className="text-amber-600">⚠️</span>
                    <span className="text-amber-700 text-sm font-medium">
                      אין נקודת חלוקה משויכת
                    </span>
                  </div>
                )}
                <div className="flex items-center gap-2 text-xs">
                  <span className="text-zinc-500">📅</span>
                  <span className="text-brand-slate">
                    נרשם: {new Date(agent.createdAt).toLocaleDateString("he-IL")}
                  </span>
                </div>
              </div>
            </div>
            <div className="flex flex-col gap-2 shrink-0">
              <button
                onClick={() => setEditing(true)}
                className="px-4 py-2 bg-brand-rust text-white rounded-lg font-bold text-sm hover:bg-[#a83a15] shadow-sm whitespace-nowrap"
              >
                ✏️ ערוך פרטים
              </button>
              <button
                onClick={resetPassword}
                disabled={resetting}
                className="px-4 py-2 bg-amber-500 text-white rounded-lg font-bold text-sm hover:bg-amber-600 shadow-sm disabled:opacity-50 whitespace-nowrap"
              >
                {resetting ? "מאפס..." : "🔑 אפס סיסמא"}
              </button>
            </div>
          </div>

          {/* פרטי כניסה - שם משתמש + סיסמא */}
          <div className="mt-4 pt-4 border-t border-zinc-100">
            <div className="text-xs font-bold text-zinc-500 mb-2 flex items-center gap-2">
              🔐 פרטי כניסה למערכת
            </div>
            <CredentialsBlock
              identifier={agent.phone || agent.email || "—"}
              password={agent.passwordPlain}
              onResetClick={resetPassword}
            />
          </div>

          {/* עמלות */}
          <div className="mt-4 pt-4 border-t border-zinc-100">
            <div className="text-xs font-bold text-zinc-500 mb-2">שיעורי עמלה</div>
            <div className="flex gap-3 flex-wrap">
              <div className="bg-orange-50 border border-orange-200 rounded-lg px-3 py-2">
                <div className="text-[10px] text-orange-700 font-bold">קרטונים</div>
                <div className="text-brand-rust font-extrabold text-lg">
                  ₪{agent.commissionRateCarton.toFixed(2)}/ק"ג
                </div>
              </div>
              <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                <div className="text-[10px] text-amber-700 font-bold">בודדים</div>
                <div className="text-amber-800 font-extrabold text-lg">
                  ₪{agent.commissionRateSingles.toFixed(2)}/ק"ג
                </div>
              </div>
            </div>
          </div>

          {/* תוצאת איפוס סיסמא */}
          {resetResult && (
            <div className="mt-4 bg-amber-50 border-2 border-amber-400 rounded-xl p-4">
              <div className="font-bold text-amber-900 mb-2">
                ⚠️ סיסמא חדשה — שמור עכשיו!
              </div>
              <div className="text-xs text-amber-700 mb-3">
                הסיסמא לא תוצג שוב. שמור אותה במקום בטוח ושלח לנציג.
              </div>
              <div className="bg-white rounded-lg p-3 border border-amber-300 space-y-2">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <span className="text-xs font-bold text-zinc-500">שם משתמש:</span>
                  <span
                    className="font-mono text-brand-slatedark font-bold select-all"
                    dir="ltr"
                  >
                    {resetResult.identifier}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <span className="text-xs font-bold text-zinc-500">סיסמא חדשה:</span>
                  <span
                    className="font-mono text-brand-rust font-bold text-lg select-all bg-yellow-100 px-3 py-1 rounded"
                    dir="ltr"
                  >
                    {resetResult.newPassword}
                  </span>
                </div>
              </div>
              <div className="mt-3 flex gap-2 flex-wrap">
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(
                      `שם משתמש: ${resetResult.identifier}\nסיסמא: ${resetResult.newPassword}`
                    );
                    alert("הועתק ללוח!");
                  }}
                  className="text-xs px-3 py-1.5 bg-amber-600 text-white hover:bg-amber-700 rounded font-bold"
                >
                  📋 העתק
                </button>
                <button
                  onClick={() => setResetResult(null)}
                  className="text-xs px-3 py-1.5 bg-zinc-100 text-zinc-700 hover:bg-zinc-200 rounded font-medium"
                >
                  סגור
                </button>
              </div>
            </div>
          )}
        </div>

        {/* כרטיס יתרה */}
        {totals.totalSales > 0 && (
          <div
            className={`rounded-2xl p-5 text-white shadow-lg bg-gradient-to-br ${balanceColor}`}
          >
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div>
                <div className="text-xs font-bold opacity-80">יתרה כוללת</div>
                <div className="text-3xl font-extrabold mt-1">{balanceLabel}</div>
              </div>
              <div className="text-right text-xs opacity-90 space-y-0.5">
                <div>
                  עמלה שהצטברה: <b>₪{totals.totalCommission.toFixed(2)}</b>
                </div>
                {totals.totalPaid > 0 && (
                  <div>
                    שולם לנציג: <b>₪{totals.totalPaid.toFixed(2)}</b>
                  </div>
                )}
                {totals.totalCashCollected > 0 && (
                  <div>
                    אסף מזומן: <b>₪{totals.totalCashCollected.toFixed(2)}</b>
                    {totals.totalCollected > 0 && (
                      <> (העביר ₪{totals.totalCollected.toFixed(2)})</>
                    )}
                  </div>
                )}
                <div className="opacity-70 mt-1">
                  {totals.totalSales} מכירות
                </div>
              </div>
            </div>
          </div>
        )}

        {/* היסטוריית מכירות */}
        {summaries.length > 0 && (
          <div className="bg-white rounded-2xl border border-zinc-200 shadow-sm overflow-hidden">
            <div className="px-5 py-3 border-b border-zinc-200 bg-zinc-50">
              <div className="font-bold text-brand-slatedark">
                📊 היסטוריית מכירות ({summaries.length})
              </div>
            </div>
            <div className="divide-y divide-zinc-100">
              {summaries.map((s) => (
                <Link
                  key={s.id}
                  href={`/admin/agents/${agentId}/sale-detail?pricelistId=${s.pricelistId}`}
                  className="block p-4 hover:bg-zinc-50 transition-colors"
                >
                  <div className="flex items-center justify-between gap-3 flex-wrap">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-bold text-brand-slatedark truncate">
                          {s.pricelistName}
                        </span>
                        {s.status === "CONFIRMED" ? (
                          <span className="text-[10px] bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full font-bold">
                            ✓ סגור
                          </span>
                        ) : (
                          <span className="text-[10px] bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full font-bold">
                            פתוח
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-zinc-500 mt-0.5 flex gap-3 flex-wrap">
                        {s.deliveryDate && (
                          <span>
                            📅 {new Date(s.deliveryDate).toLocaleDateString("he-IL")}
                          </span>
                        )}
                        <span>
                          {(s.totalCartonWeight + s.totalWalkinWeight).toFixed(1)} ק"ג קרטונים ·{" "}
                          {s.totalSinglesWeight.toFixed(1)} ק"ג בודדים
                        </span>
                        <span>
                          {s.totalCustomers} לקוחות
                          {s.totalWalkins > 0 && ` · ${s.totalWalkins} מזדמנים`}
                        </span>
                      </div>
                    </div>
                    <div className="text-brand-rust font-extrabold whitespace-nowrap">
                      ₪{s.totalCommission.toFixed(2)}
                    </div>
                    <svg className="w-4 h-4 text-zinc-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
                    </svg>
                  </div>
                </Link>
              ))}
            </div>
          </div>
        )}

        {/* היסטוריית תשלומים */}
        {payments.length > 0 && (
          <div className="bg-white rounded-2xl border border-zinc-200 shadow-sm overflow-hidden">
            <div className="px-5 py-3 border-b border-zinc-200 bg-zinc-50">
              <div className="font-bold text-brand-slatedark">
                💰 היסטוריית תשלומים ({payments.length})
              </div>
            </div>
            <div className="divide-y divide-zinc-100">
              {payments.map((p) => {
                const isPaid = p.type === "PAID";
                return (
                  <div
                    key={p.id}
                    className={`p-4 ${
                      isPaid ? "bg-red-50/30" : "bg-emerald-50/30"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span
                            className={`font-bold text-sm ${
                              isPaid ? "text-red-700" : "text-emerald-700"
                            }`}
                          >
                            {isPaid ? "שילמנו לו" : "העביר לנו"}
                          </span>
                          {p.method && (
                            <span className="text-[10px] text-zinc-500">
                              {METHOD_LABELS[p.method] || p.method}
                            </span>
                          )}
                          {p.pricelistName && (
                            <span className="text-[10px] bg-zinc-100 text-zinc-600 px-2 py-0.5 rounded font-medium">
                              {p.pricelistName}
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-zinc-500 mt-1">
                          {new Date(p.createdAt).toLocaleDateString("he-IL")}
                        </div>
                        {p.note && (
                          <div className="text-xs text-zinc-600 mt-1 bg-white/70 rounded px-2 py-1">
                            {p.note}
                          </div>
                        )}
                      </div>
                      <div
                        className={`font-extrabold ${
                          isPaid ? "text-red-700" : "text-emerald-700"
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

        {summaries.length === 0 && payments.length === 0 && (
          <div className="bg-white rounded-2xl border border-zinc-200 p-8 text-center">
            <p className="text-brand-slatedark font-semibold">
              עדיין אין פעילות לנציג הזה
            </p>
            <p className="text-xs text-zinc-500 mt-1">
              היסטוריה תופיע לאחר המכירה הראשונה
            </p>
          </div>
        )}
      </main>

      {/* Modal עריכה */}
      {editing && (
        <EditModal
          agent={agent}
          points={points}
          onClose={() => setEditing(false)}
          onSaved={() => {
            setEditing(false);
            load();
          }}
        />
      )}
    </div>
  );
}

function EditModal({
  agent,
  points,
  onClose,
  onSaved,
}: {
  agent: Data["agent"];
  points: Data["points"];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(agent.name);
  const [phone, setPhone] = useState(agent.phone || "");
  const [email, setEmail] = useState(agent.email || "");
  // 🆕 ריבוי נקודות: הנציג יכול להיות משויך לכמה נקודות חלוקה במקביל.
  // נטען מ-agentPoints (עם נפילה לנקודה הישנה בתוך ה-API).
  const [pointIds, setPointIds] = useState<string[]>(
    agent.agentPoints?.map((p) => p.id) ?? (agent.agentPointId ? [agent.agentPointId] : [])
  );
  const [cartonRate, setCartonRate] = useState(agent.commissionRateCarton.toString());
  const [singlesRate, setSinglesRate] = useState(agent.commissionRateSingles.toString());
  // 🆕 הרשאות הנציג. עד כה הן היו ניתנות לעריכה רק ממסך הלקוחות,
  // למרות שזה המסך הטבעי לניהול נציג.
  const [canSetFinalPrice, setCanSetFinalPrice] = useState(!!agent.canSetFinalPrice);
  const [canSendPaymentLink, setCanSendPaymentLink] = useState(!!agent.canSendPaymentLink);
  const [canCharge, setCanCharge] = useState(!!agent.canCharge);
  const [canUpdateCards, setCanUpdateCards] = useState(!!agent.canUpdateCards);
  const [canResetPassword, setCanResetPassword] = useState(!!agent.canResetPassword);
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!name.trim() || !phone.trim()) {
      alert("שם וטלפון חובה");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/admin/agents/${agent.id}/profile`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          phone: phone.trim(),
          email: email.trim() || null,
          agentPointIds: pointIds,
          commissionRateCarton: parseFloat(cartonRate) || 0,
          commissionRateSingles: parseFloat(singlesRate) || 0,
          agentCanSetFinalPrice: canSetFinalPrice,
          agentCanSendPaymentLink: canSendPaymentLink,
          agentCanCharge: canCharge,
          agentCanUpdateCards: canUpdateCards,
          agentCanResetPassword: canResetPassword,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error);
      onSaved();
    } catch (e: any) {
      alert("שגיאה: " + e.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="bg-white w-full max-w-lg sm:rounded-2xl rounded-t-2xl max-h-[95vh] overflow-y-auto shadow-2xl">
        <div className="sticky top-0 bg-white border-b border-zinc-200 px-5 py-3 flex items-center justify-between z-10">
          <h3 className="font-extrabold text-brand-slatedark text-lg">
            ✏️ עריכת פרטי נציג
          </h3>
          <button
            onClick={onClose}
            className="text-zinc-400 hover:text-zinc-600 text-2xl leading-none px-2"
          >
            ×
          </button>
        </div>

        <div className="p-5 space-y-3">
          <label className="block">
            <span className="text-xs font-bold text-zinc-500">שם *</span>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full mt-1 px-3 py-2 border border-zinc-300 rounded-lg text-sm"
            />
          </label>

          <label className="block">
            <span className="text-xs font-bold text-zinc-500">
              טלפון * <span className="font-normal text-amber-700">(שם משתמש לכניסה)</span>
            </span>
            <input
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              dir="ltr"
              className="w-full mt-1 px-3 py-2 border border-zinc-300 rounded-lg text-sm font-mono"
            />
          </label>

          <label className="block">
            <span className="text-xs font-bold text-zinc-500">מייל</span>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              dir="ltr"
              className="w-full mt-1 px-3 py-2 border border-zinc-300 rounded-lg text-sm"
            />
          </label>

          <div className="block">
            <span className="text-xs font-bold text-zinc-500">
              נקודות חלוקה{" "}
              <span className="font-normal text-zinc-400">
                (אפשר לבחור כמה)
              </span>
            </span>
            <div className="mt-1 border border-zinc-300 rounded-lg divide-y divide-zinc-100 max-h-52 overflow-y-auto">
              {points.length === 0 && (
                <div className="px-3 py-2 text-sm text-zinc-400">
                  אין נקודות חלוקה פעילות
                </div>
              )}
              {points.map((p) => {
                const checked = pointIds.includes(p.id);
                return (
                  <label
                    key={p.id}
                    className="flex items-center gap-2 px-3 py-2 text-sm cursor-pointer hover:bg-zinc-50"
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={(e) => {
                        setPointIds((prev) =>
                          e.target.checked
                            ? [...prev, p.id]
                            : prev.filter((x) => x !== p.id)
                        );
                      }}
                      className="w-4 h-4 accent-brand-rust shrink-0"
                    />
                    <span>
                      {p.name}
                      {p.city && <span className="text-zinc-400"> ({p.city})</span>}
                    </span>
                  </label>
                );
              })}
            </div>
            <p className="text-[11px] text-zinc-500 mt-1">
              {pointIds.length === 0
                ? "לא נבחרה נקודה — הנציג לא יראה הזמנות."
                : `נבחרו ${pointIds.length} נקודות. הנציג יראה את ההזמנות והעמלות מכולן.`}
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="text-xs font-bold text-zinc-500">
                עמלת קרטונים (₪/ק"ג)
              </span>
              <input
                type="number"
                step="0.01"
                min="0"
                value={cartonRate}
                onChange={(e) => setCartonRate(e.target.value)}
                className="w-full mt-1 px-3 py-2 border border-zinc-300 rounded-lg text-sm text-center font-bold"
              />
            </label>
            <label className="block">
              <span className="text-xs font-bold text-zinc-500">
                עמלת בודדים (₪/ק"ג)
              </span>
              <input
                type="number"
                step="0.01"
                min="0"
                value={singlesRate}
                onChange={(e) => setSinglesRate(e.target.value)}
                className="w-full mt-1 px-3 py-2 border border-zinc-300 rounded-lg text-sm text-center font-bold"
              />
            </label>
          </div>

          {/* 🆕 הרשאות הנציג.
              עד כה ארבע ההרשאות היו ניתנות לעריכה רק ממסך הלקוחות, למרות
              שזה המסך הטבעי לניהול נציג. כולן נאכפות בשרת:
              agentCanCharge ב-/api/admin/charge,
              agentCanUpdateCards ב-/api/customer/save-token. */}
          <div>
            <span className="text-xs font-bold text-zinc-500">הרשאות</span>
            <div className="mt-1 border border-zinc-300 rounded-lg divide-y divide-zinc-100">
              <PermToggle
                checked={canSetFinalPrice}
                onChange={setCanSetFinalPrice}
                label="לקבוע מחיר סופי"
                hint="הנציג יוכל לסגור מחיר להזמנה אחרי שקילה"
              />
              <PermToggle
                checked={canSendPaymentLink}
                onChange={setCanSendPaymentLink}
                label="לשלוח קישור תשלום"
                hint="שליחת לינק תשלום ללקוח"
              />
              <PermToggle
                checked={canCharge}
                onChange={setCanCharge}
                label="לחייב כרטיס אשראי"
                hint="הנציג יוכל לגבות כסף מהכרטיס השמור של הלקוח"
                sensitive
              />
              <PermToggle
                checked={canUpdateCards}
                onChange={setCanUpdateCards}
                label="לעדכן פרטי כרטיס"
                hint="עדכון כרטיס אשראי של לקוח בשם הלקוח"
                sensitive
              />
              <PermToggle
                checked={canResetPassword}
                onChange={setCanResetPassword}
                label="לאפס סיסמה ללקוח"
                hint="נדרש ללקוחות טלפוניים שאין להם מייל ולא יכולים לאפס בעצמם"
                sensitive
              />
            </div>
          </div>
        </div>

        <div className="sticky bottom-0 bg-white border-t border-zinc-200 p-4 flex gap-2">
          <button
            onClick={onClose}
            disabled={saving}
            className="flex-1 py-3 rounded-xl border border-zinc-300 text-brand-slatedark font-bold hover:bg-zinc-50"
          >
            ביטול
          </button>
          <button
            onClick={save}
            disabled={saving}
            className="flex-1 py-3 rounded-xl bg-brand-rust text-white font-bold hover:bg-[#a83a15] disabled:opacity-50 shadow-md"
          >
            {saving ? "שומר..." : "שמור"}
          </button>
        </div>
      </div>
    </div>
  );
}

function CredentialsBlock({
  identifier,
  password,
  onResetClick,
}: {
  identifier: string;
  password: string | null;
  onResetClick: () => void;
}) {
  const [visible, setVisible] = useState(false);
  const [copiedField, setCopiedField] = useState<string | null>(null);

  function copy(text: string, field: string) {
    navigator.clipboard.writeText(text);
    setCopiedField(field);
    setTimeout(() => setCopiedField(null), 1500);
  }

  return (
    <div className="bg-gradient-to-br from-zinc-50 to-zinc-100 border border-zinc-300 rounded-xl overflow-hidden">
      {/* שם משתמש */}
      <div className="flex items-center justify-between gap-3 p-3 border-b border-zinc-200">
        <div className="flex-1 min-w-0">
          <div className="text-[10px] font-bold text-zinc-500 mb-0.5">שם משתמש</div>
          <div className="font-mono font-bold text-brand-slatedark select-all" dir="ltr">
            {identifier}
          </div>
        </div>
        <button
          onClick={() => copy(identifier, "identifier")}
          className={`text-xs px-3 py-1.5 rounded-md font-bold shrink-0 transition-colors ${
            copiedField === "identifier"
              ? "bg-emerald-500 text-white"
              : "bg-white border border-zinc-300 text-brand-slatedark hover:bg-zinc-50"
          }`}
        >
          {copiedField === "identifier" ? "✓ הועתק" : "📋 העתק"}
        </button>
      </div>

      {/* סיסמא */}
      <div className="flex items-center justify-between gap-3 p-3">
        <div className="flex-1 min-w-0">
          <div className="text-[10px] font-bold text-zinc-500 mb-0.5">סיסמא</div>
          {password ? (
            <div className="flex items-center gap-2">
              <span
                className={`font-mono font-bold text-lg select-all ${
                  visible
                    ? "text-brand-rust bg-yellow-100 px-2 py-0.5 rounded"
                    : "text-zinc-400 tracking-widest"
                }`}
                dir="ltr"
              >
                {visible ? password : "••••••••"}
              </span>
              <button
                onClick={() => setVisible((v) => !v)}
                className="text-xs px-2 py-1 rounded bg-zinc-200 text-brand-slatedark hover:bg-zinc-300 font-bold"
                title={visible ? "הסתר סיסמא" : "הצג סיסמא"}
              >
                {visible ? "🙈 הסתר" : "👁️ הצג"}
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-zinc-400 text-sm italic">סיסמא לא זמינה</span>
              <span className="text-[10px] bg-amber-100 text-amber-700 px-2 py-0.5 rounded font-bold">
                מוצפנת - צריך לאפס
              </span>
            </div>
          )}
        </div>
        <div className="flex flex-col gap-1 shrink-0">
          {password && (
            <button
              onClick={() => copy(password, "password")}
              className={`text-xs px-3 py-1.5 rounded-md font-bold transition-colors ${
                copiedField === "password"
                  ? "bg-emerald-500 text-white"
                  : "bg-white border border-zinc-300 text-brand-slatedark hover:bg-zinc-50"
              }`}
            >
              {copiedField === "password" ? "✓ הועתק" : "📋 העתק"}
            </button>
          )}
          <button
            onClick={onResetClick}
            className="text-xs px-3 py-1.5 rounded-md font-bold bg-amber-500 text-white hover:bg-amber-600"
          >
            🔑 אפס
          </button>
        </div>
      </div>

      {/* כפתור העתקת שניהם + הסבר */}
      <div className="bg-white border-t border-zinc-200 px-3 py-2 flex items-center justify-between gap-2 flex-wrap">
        <div className="text-[10px] text-zinc-500">
          {password
            ? "💡 שמור בטוח - הסיסמא ניתנת לצפייה בכל עת"
            : "⚠️ סיסמא ישנה מוצפנת - יש לאפס כדי לראות אותה"}
        </div>
        {password && (
          <button
            onClick={() => {
              copy(
                `שם משתמש: ${identifier}\nסיסמא: ${password}`,
                "both"
              );
            }}
            className={`text-xs px-3 py-1 rounded-md font-bold transition-colors ${
              copiedField === "both"
                ? "bg-emerald-500 text-white"
                : "bg-brand-slatedark text-white hover:bg-zinc-700"
            }`}
          >
            {copiedField === "both" ? "✓ הועתק" : "📋 העתק שניהם"}
          </button>
        )}
      </div>
    </div>
  );
}

// שורת הרשאה בטופס עריכת הנציג.
// sensitive מסמן הרשאות שנוגעות ישירות בכסף/כרטיסי אשראי - הן מקבלות
// הדגשה ויזואלית כדי שלא יסומנו בהיסח הדעת.
function PermToggle({
  checked,
  onChange,
  label,
  hint,
  sensitive,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  hint: string;
  sensitive?: boolean;
}) {
  return (
    <label
      className={`flex items-start gap-2.5 px-3 py-2.5 cursor-pointer hover:bg-zinc-50 ${
        checked && sensitive ? "bg-amber-50" : ""
      }`}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className={`w-4 h-4 mt-0.5 shrink-0 ${
          sensitive ? "accent-amber-600" : "accent-brand-rust"
        }`}
      />
      <span className="min-w-0">
        <span className="block text-sm font-medium text-brand-slatedark">
          {label}
          {sensitive && <span className="text-amber-700 text-xs mr-1">רגיש</span>}
        </span>
        <span className="block text-[11px] text-zinc-500">{hint}</span>
      </span>
    </label>
  );
}
