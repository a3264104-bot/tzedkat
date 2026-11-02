"use client";

// ↩️ זיכוי ללקוח מכרטיס הלקוח — הצד ההפוך של DebtPanel.
// הסכום נשמר כיתרת זכות (§124) ומקוזז אוטומטית מההזמנה הבאה.
// ⚠️ לא CreditPanel: ההוא זיכוי על הזמנה מסוימת (§123).

import { useState } from "react";

export function CustomerCreditPanel({
  customerId,
  customerName,
  creditBalance,
  onDone,
}: {
  customerId: string;
  customerName: string;
  creditBalance: number;
  onDone?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  function openPanel() {
    setAmount(creditBalance > 0 ? String(creditBalance) : "");
    setNote("");
    setErr(null);
    setOpen(true);
  }

  async function save() {
    const n = Number(amount || 0);
    if (!Number.isFinite(n) || n < 0) return setErr("סכום לא תקין");
    if (n > 0 && !note.trim()) return setErr("יש לציין על מה הזיכוי");
    setSaving(true);
    setErr(null);
    try {
      const res = await fetch(`/api/admin/customers/${customerId}/credit`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount: n, note: note.trim() }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || "שמירה נכשלה");
      if (d.message) alert(d.message);
      setOpen(false);
      onDone?.();
    } catch (e: any) {
      setErr(e?.message || "שגיאה");
    } finally {
      setSaving(false);
    }
  }

  const has = creditBalance > 0;
  return (
    <>
      <button
        onClick={openPanel}
        className={`w-full flex items-center justify-between gap-2 rounded-xl px-3 py-2.5 border-2 transition-colors ${
          has ? "border-blue-400 bg-blue-50 hover:bg-blue-100" : "border-zinc-300 bg-white hover:bg-zinc-50"
        }`}
      >
        <div className="text-right min-w-0">
          <div className={`font-bold text-sm ${has ? "text-blue-900" : "text-zinc-700"}`}>
            {has ? `↩️ יתרת זכות: ₪${creditBalance.toFixed(2)}` : "↩️ רישום זיכוי"}
          </div>
          <div className="text-[11px] text-zinc-500 mt-0.5">יקוזז אוטומטית מההזמנה הבאה</div>
        </div>
        <span className="text-zinc-400 shrink-0">←</span>
      </button>

      {open && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-sm p-5 space-y-3">
            <div className="font-extrabold text-brand-slatedark">↩️ זיכוי — {customerName}</div>
            <p className="text-[11px] text-zinc-600 leading-relaxed">
              הסכום נשמר כיתרת זכות ויורד אוטומטית מההזמנה הבאה של הלקוח. הלקוח רואה אותו באזור האישי.
            </p>
            <div>
              <label className="text-xs font-bold text-zinc-600">סכום הזיכוי (₪)</label>
              <input
                type="number"
                inputMode="decimal"
                step="0.01"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="w-full mt-1 rounded-lg border-2 border-zinc-300 px-3 py-2 font-bold"
                placeholder="0.00"
              />
              <p className="text-[10px] text-zinc-400 mt-1">זו היתרה הכוללת (לא תוספת). 0 = ביטול הזיכוי</p>
            </div>
            <div>
              <label className="text-xs font-bold text-zinc-600">על מה הזיכוי *</label>
              <input
                value={note}
                onChange={(e) => setNote(e.target.value)}
                className="w-full mt-1 rounded-lg border-2 border-zinc-300 px-3 py-2 text-sm"
                placeholder="למשל: מוצר פגום במכירה הקודמת"
                maxLength={120}
              />
            </div>
            {err && <p className="text-sm text-red-600 font-bold">{err}</p>}
            <div className="flex gap-2 pt-1">
              <button
                onClick={() => setOpen(false)}
                disabled={saving}
                className="flex-1 py-2.5 rounded-xl border-2 border-zinc-300 font-bold"
              >
                ביטול
              </button>
              <button
                onClick={save}
                disabled={saving}
                className="flex-1 py-2.5 rounded-xl bg-blue-700 text-white font-bold disabled:opacity-50"
              >
                {saving ? "שומר..." : "שמור"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
