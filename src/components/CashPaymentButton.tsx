"use client";

// §91: כפתור "שולם במזומן" לנציג.
//
// הפעולה הזו מונעת תשלום כפול: לקוח שהוציא כסף בחלוקה מסומן כאן,
// והכרטיס שלו לא יחויב בערב. לכן הכפתור צריך להיות **במקום שבו
// הנציג עומד**, ולא במסך שצריך לחפור אליו.
//
// הסכום מתמלא מראש במחיר הסופי - זה המקרה הנפוץ, והנציג רק מאשר.
// שינוי הסכום אפשרי לתשלום חלקי, ואז ההערה חובה (נאכף גם בשרת).

import { useState } from "react";
import { fmt } from "@/lib/pricing";

export function CashPaymentButton({
  orderId,
  finalTotal,
  paymentStatus,
  customerName,
  onDone,
  compact,
}: {
  orderId: string;
  /** null = טרם נקבע מחיר סופי; הכפתור לא יוצג */
  finalTotal: number | null;
  paymentStatus?: string | null;
  customerName: string;
  onDone: () => void;
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  // כבר שולם - מציגים סימון ולא כפתור
  if (paymentStatus === "PAID") {
    return (
      <span className="text-[11px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-300 rounded-lg px-2 py-1">
        ✓ שולם
      </span>
    );
  }

  // ⚠️ בלי מחיר סופי אין מה לסמן - השרת חוסם ממילא, ואין טעם
  // בכפתור שקיים רק כדי להיכשל.
  if (finalTotal === null) {
    return compact ? null : (
      <span className="text-[11px] text-zinc-400">
        סימון תשלום אפשרי לאחר קביעת מחיר סופי
      </span>
    );
  }

  async function submit() {
    setError("");
    const n = Number(amount);
    if (!Number.isFinite(n) || n <= 0) {
      setError("יש להזין סכום תקין");
      return;
    }
    if (n < (finalTotal ?? 0) && !note.trim()) {
      setError("הסכום נמוך מהמחיר הסופי — חובה להוסיף הערה");
      return;
    }
    setSaving(true);
    try {
      // §91: 🐛 הנתיב היה /api/agent/orders/[id]/cash-payment - route
      // שמעולם לא נבנה. הכפתור הוצג, נלחץ, וקיבל 404 בשקט; הנציג
      // חשב שסימן והכרטיס חויב בערב.
      // ה-route האמיתי הוא של המנהל, והוא מקבל עכשיו גם נציגים.
      const res = await fetch(`/api/admin/orders/${orderId}/cash-payment`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amountPaid: n, note: note.trim() || null }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "שגיאה");
      setOpen(false);
      onDone();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => {
          // ברירת המחדל היא הסכום המלא - המקרה הנפוץ ביותר
          setAmount(String(finalTotal));
          setNote("");
          setError("");
          setOpen(true);
        }}
        className={`font-bold border-2 border-amber-500 text-amber-800 rounded-lg hover:bg-amber-500 hover:text-white transition-colors ${
          compact ? "text-[11px] px-2 py-1" : "text-xs px-3 py-2 w-full"
        }`}
      >
        💵 שולם במזומן
      </button>
    );
  }

  return (
    <div className="bg-amber-50 border-2 border-amber-400 rounded-lg p-3 space-y-2">
      <div className="text-xs font-bold text-amber-900">
        תשלום מזומן — {customerName}
      </div>
      <div className="text-[11px] text-amber-800">
        מחיר סופי: <b>{fmt(finalTotal)}</b>
      </div>

      <div>
        <label className="text-[11px] text-amber-900 font-bold block mb-0.5">
          סכום שהתקבל
        </label>
        <input
          type="number"
          step="0.01"
          min={0}
          dir="ltr"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          className="input w-full text-center font-bold"
        />
      </div>

      {/* ההערה חובה רק בתשלום חלקי - מוצגת תמיד כדי שלא תיראה
          כשדה שקפץ בגלל שגיאה */}
      <div>
        <label className="text-[11px] text-amber-900 block mb-0.5">
          הערה {Number(amount) < finalTotal && <b>(חובה — סכום חלקי)</b>}
        </label>
        <input
          type="text"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="לדוגמה: שילם 200 והשאר בשבוע הבא"
          className="input w-full text-xs"
        />
      </div>

      {error && <p className="text-red-700 text-[11px] font-bold">{error}</p>}

      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => setOpen(false)}
          disabled={saving}
          className="btn-ghost btn-sm flex-1"
        >
          ביטול
        </button>
        <button
          type="button"
          onClick={submit}
          disabled={saving}
          className="flex-1 bg-amber-600 text-white rounded-lg py-2 text-xs font-bold hover:bg-amber-700 disabled:opacity-50"
        >
          {saving ? "שומר..." : "אישור קבלת מזומן"}
        </button>
      </div>
    </div>
  );
}
