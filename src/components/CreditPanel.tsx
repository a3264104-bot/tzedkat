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

// §135: סיבות לחיוב נוסף - התמונה הראית של הזיכוי
const QUICK_CHARGE_REASONS = [
  "תוספת בחלוקה",
  "משקל עודף",
  "מוצר נוסף",
  "יתרת חוב קודם",
];

export function CreditPanel({
  orderId,
  currentAmount,
  currentReason,
  orderTotal,
  alreadyPaid,
  kind = "credit",
}: {
  orderId: string;
  currentAmount: number | null;
  currentReason: string | null;
  /** סכום ההזמנה - לתקרת הזיכוי ולתצוגה */
  orderTotal: number | null;
  /** הזמנה ששולמה - זיכוי דורש החזר בפועל ולכן חסום */
  alreadyPaid: boolean;
  /**
   * §135: "credit" = זיכוי (מוריד) · "charge" = חיוב נוסף (מוסיף).
   * אותו רכיב לשניהם: אותה ולידציה, אותה דרישת סיבה, אותה
   * התנהגות. שני רכיבים היו מתפצלים ביום שמישהו משנה אחד.
   */
  kind?: "credit" | "charge";
}) {
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState(
    currentAmount != null ? String(currentAmount) : ""
  );
  const [reason, setReason] = useState(currentReason ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const router = useRouter();

  // §135: כל הטקסטים והצבעים במקום אחד, לפי הסוג
  const isCharge = kind === "charge";
  const L = isCharge
    ? {
        title: "חיוב נוסף",
        button: "➕ חיוב נוסף ללקוח",
        icon: "➕",
        reasons: QUICK_CHARGE_REASONS,
        border: "border-orange-300",
        borderStrong: "border-orange-400",
        bg: "bg-orange-50",
        text: "text-orange-800",
        textDark: "text-orange-900",
        btn: "bg-orange-600",
        hint: "הסכום יתווסף לחיוב של הלקוח.",
        placeholder: "למשל: תוספת בחלוקה",
      }
    : {
        title: "זיכוי ללקוח",
        button: "↩️ זיכוי ללקוח",
        icon: "↩️",
        reasons: QUICK_REASONS,
        border: "border-emerald-300",
        borderStrong: "border-emerald-400",
        bg: "bg-emerald-50",
        text: "text-emerald-800",
        textDark: "text-emerald-900",
        btn: "bg-emerald-600",
        hint: "הסכום ינוכה מהחיוב של הלקוח.",
        placeholder: "למשל: מוצר פגום",
      };

  async function save(clear = false) {
    setError("");
    if (!clear) {
      const n = Number(amount);
      if (!Number.isFinite(n) || n <= 0) return setError("יש להזין סכום תקין");
      if (!reason.trim()) return setError("יש לציין את סיבת הזיכוי");
      // ⚠️ התקרה חלה **רק על זיכוי**. חיוב נוסף יכול לעלות על
      // סכום ההזמנה (למשל יתרת חוב קודם), ואין סיבה לחסום.
      if (!isCharge && orderTotal != null && n > orderTotal) {
        return setError(`הזיכוי גבוה מסכום ההזמנה (${fmt(orderTotal)})`);
      }
    }
    setBusy(true);
    try {
      // §135: חיוב נוסף יושב ב-route של המשלוח - אותה משפחת
      // פעולות על הסכום, ואותה נוסחת חישוב.
      const res = await fetch(
        isCharge
          ? `/api/agent/orders/${orderId}/delivery`
          : `/api/agent/orders/${orderId}/credit`,
        {
        method: isCharge ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          clear ? { amount: null } : { amount: Number(amount), reason: reason.trim() }
        ),
      }
      );
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
      <div className={`${L.bg} border-2 ${L.border} rounded-xl p-3`}>
        <div className="flex items-start justify-between gap-2">
          <div>
            <div className={`font-bold ${L.text} text-sm`}>
              {L.icon} {L.title}: {fmt(currentAmount)}
            </div>
            {currentReason && (
              <div className={`text-xs ${L.text} mt-0.5`}>{currentReason}</div>
            )}
            <div className="text-[11px] text-emerald-600 mt-1">
              {alreadyPaid
                ? isCharge
                  ? "ההזמנה שולמה — יש לגבות במזומן."
                  : "ההזמנה שולמה — הסכום נזקף כיתרת זכות ויקוזז מההזמנה הבאה."
                : L.hint}
            </div>
          </div>
          {!alreadyPaid && (
            <button
              onClick={() => setOpen(true)}
              className={`text-xs ${L.text} underline shrink-0`}
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
        className={`w-full py-2 rounded-xl border-2 ${L.borderStrong} ${L.text} font-bold text-sm hover:${L.bg}`}
      >
        {L.button}
        {/* §124: הזמנה ששולמה כבר אינה חסומה - הזיכוי הופך ליתרת
            זכות שתקוזז בהזמנה הבאה. */}
        {alreadyPaid && (
          <span className="block text-[10px] font-normal text-zinc-500">
            {isCharge
              ? "ההזמנה שולמה — חיוב נוסף לא ייגבה בכרטיס"
              : "ההזמנה שולמה — הזיכוי ייזקף כיתרה להזמנה הבאה"}
          </span>
        )}
      </button>
    );
  }

  return (
    <div className={`${L.bg} border-2 ${L.borderStrong} rounded-xl p-3 space-y-2.5`}>
      <div className="flex items-center justify-between">
        <span className={`font-bold ${L.textDark} text-sm`}>{L.title}</span>
        <button
          onClick={() => setOpen(false)}
          className="text-zinc-400 text-xl leading-none px-1"
        >
          ×
        </button>
      </div>

      <div>
        <label className={`text-[11px] ${L.text} block mb-0.5`}>
          סכום (₪)
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
        <label className={`text-[11px] ${L.text} block mb-0.5`}>
          הסיבה — <b>הלקוח יראה אותה</b>
        </label>
        <input
          type="text"
          maxLength={200}
          className="input w-full"
          placeholder={L.placeholder}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          disabled={busy}
        />
        {/* סיבות מהירות - בחלוקה אין זמן להקליד */}
        <div className="flex flex-wrap gap-1 mt-1.5">
          {L.reasons.map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => setReason(r)}
              disabled={busy}
              className={`text-[11px] bg-white border ${L.border} ${L.text} rounded-full px-2 py-0.5`}
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
            ביטול
          </button>
        )}
        <button
          type="button"
          onClick={() => save(false)}
          disabled={busy}
          className={`flex-1 py-2.5 rounded-xl ${L.btn} text-white font-bold text-sm disabled:opacity-40`}
        >
          {busy ? "שומר…" : `שמור ${L.title}`}
        </button>
      </div>
    </div>
  );
}
