"use client";

// §123: זיכוי ללקוח.
//
// התרחיש: מוצר הגיע פגום, חסר חצי קילו, או תקלה אחרת בחלוקה.
// הנציג מזכה סכום, והלקוח משלם פחות ורואה את זה בפירוט.
//
// ⚠️ הסיבה חובה. זיכוי בלי הסבר הוא כסף שיצא בלי תיעוד, והלקוח
// שיראה שורה במייל צריך לדעת על מה קיבל אותה.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { fmt } from "@/lib/pricing";

const QUICK_REASONS = [
  "מוצר פגום",
  "משקל חסר",
  "מוצר לא סופק",
  "פיצוי על עיכוב",
];

export function CreditPanel({
  orderId,
  currentAmount,
  currentReason,
  orderTotal,
  alreadyPaid,
}: {
  orderId: string;
  currentAmount: number | null;
  currentReason: string | null;
  /** סכום ההזמנה - לתקרת הזיכוי ולתצוגה */
  orderTotal: number | null;
  /** הזמנה ששולמה - זיכוי דורש החזר בפועל ולכן חסום */
  alreadyPaid: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState(
    currentAmount != null ? String(currentAmount) : ""
  );
  const [reason, setReason] = useState(currentReason ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const router = useRouter();

  async function save(clear = false) {
    setError("");
    if (!clear) {
      const n = Number(amount);
      if (!Number.isFinite(n) || n <= 0) return setError("יש להזין סכום תקין");
      if (!reason.trim()) return setError("יש לציין את סיבת הזיכוי");
      if (orderTotal != null && n > orderTotal) {
        return setError(
          `הזיכוי גבוה מסכום ההזמנה (${fmt(orderTotal)})`
        );
      }
    }
    setBusy(true);
    try {
      const res = await fetch(`/api/agent/orders/${orderId}/credit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          clear ? { amount: null } : { amount: Number(amount), reason: reason.trim() }
        ),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "שגיאה");
      if (clear) {
        setAmount("");
        setReason("");
      }
      setOpen(false);
      router.refresh();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  // ─── זיכוי קיים ───
  if (currentAmount != null && !open) {
    return (
      <div className="bg-emerald-50 border-2 border-emerald-300 rounded-xl p-3">
        <div className="flex items-start justify-between gap-2">
          <div>
            <div className="font-bold text-emerald-800 text-sm">
              ↩️ זיכוי: {fmt(currentAmount)}
            </div>
            {currentReason && (
              <div className="text-xs text-emerald-700 mt-0.5">{currentReason}</div>
            )}
            <div className="text-[11px] text-emerald-600 mt-1">
              {alreadyPaid
                ? "ההזמנה שולמה — הסכום נזקף כיתרת זכות ויקוזז מההזמנה הבאה."
                : "הזיכוי נוכה מהסכום, והלקוח יראה אותו בפירוט."}
            </div>
          </div>
          {!alreadyPaid && (
            <button
              onClick={() => setOpen(true)}
              className="text-xs text-emerald-800 underline shrink-0"
            >
              שינוי
            </button>
          )}
        </div>
      </div>
    );
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="w-full py-2 rounded-xl border-2 border-emerald-400 text-emerald-700 font-bold text-sm hover:bg-emerald-50"
      >
        ↩️ זיכוי ללקוח
        {/* §124: הזמנה ששולמה כבר אינה חסומה - הזיכוי הופך ליתרת
            זכות שתקוזז בהזמנה הבאה. */}
        {alreadyPaid && (
          <span className="block text-[10px] font-normal text-zinc-500">
            ההזמנה שולמה — הזיכוי ייזקף כיתרה להזמנה הבאה
          </span>
        )}
      </button>
    );
  }

  return (
    <div className="bg-emerald-50 border-2 border-emerald-400 rounded-xl p-3 space-y-2.5">
      <div className="flex items-center justify-between">
        <span className="font-bold text-emerald-900 text-sm">זיכוי ללקוח</span>
        <button
          onClick={() => setOpen(false)}
          className="text-zinc-400 text-xl leading-none px-1"
        >
          ×
        </button>
      </div>

      <div>
        <label className="text-[11px] text-emerald-800 block mb-0.5">
          סכום הזיכוי (₪)
          {orderTotal != null && (
            <span className="text-zinc-500"> · סכום ההזמנה: {fmt(orderTotal)}</span>
          )}
        </label>
        <input
          type="number"
          step="0.01"
          min={0}
          dir="ltr"
          className="input w-full text-center font-bold"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          disabled={busy}
        />
      </div>

      <div>
        <label className="text-[11px] text-emerald-800 block mb-0.5">
          סיבת הזיכוי — <b>הלקוח יראה אותה</b>
        </label>
        <input
          type="text"
          maxLength={200}
          className="input w-full"
          placeholder="למשל: מוצר פגום"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          disabled={busy}
        />
        {/* סיבות מהירות - בחלוקה אין זמן להקליד */}
        <div className="flex flex-wrap gap-1 mt-1.5">
          {QUICK_REASONS.map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => setReason(r)}
              disabled={busy}
              className="text-[11px] bg-white border border-emerald-300 text-emerald-800 rounded-full px-2 py-0.5"
            >
              {r}
            </button>
          ))}
        </div>
      </div>

      {error && <p className="text-red-700 text-xs font-medium">{error}</p>}

      <div className="flex gap-2">
        {currentAmount != null && (
          <button
            type="button"
            onClick={() => save(true)}
            disabled={busy}
            className="btn-ghost btn-sm text-red-700"
          >
            בטל זיכוי
          </button>
        )}
        <button
          type="button"
          onClick={() => save(false)}
          disabled={busy}
          className="flex-1 py-2.5 rounded-xl bg-emerald-600 text-white font-bold text-sm disabled:opacity-40"
        >
          {busy ? "שומר…" : "שמור זיכוי"}
        </button>
      </div>
    </div>
  );
}
