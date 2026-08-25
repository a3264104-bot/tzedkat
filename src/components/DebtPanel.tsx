"use client";

// ═══════════════════════════════════════════════════════════════
// §263: רישום חוב ללקוח
// ═══════════════════════════════════════════════════════════════
// שימוש: <DebtPanel customerId={id} customerName={name}
//                   debtBalance={n} debtNote={s} onDone={fn} />
//
// התרחיש: לקוח חייב כסף ממכירה קודמת - לפני שהאתר היה קיים, או
// פריט שלא שולם. המנהל או הנציג רושמים, והחוב נגבה עם ההזמנה
// הבאה.
//
// ⚠️ הרכיב זהה במנהל ובנציג: אותה פעולה, אותו מסך. הבדל היה
// אומר שהם רואים מצב שונה של אותו לקוח.

import { useState } from "react";

export function DebtPanel({
  customerId,
  customerName,
  debtBalance,
  debtNote,
  onDone,
}: {
  customerId: string;
  customerName: string;
  debtBalance: number;
  debtNote?: string | null;
  onDone?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState(String(debtBalance || ""));
  const [note, setNote] = useState(debtNote || "");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save() {
    const n = Number(amount);
    if (!Number.isFinite(n) || n < 0) {
      setErr("סכום לא תקין");
      return;
    }
    // ⚠️ בדיקה גם כאן וגם בשרת: המשתמש מקבל תשובה מיידית בלי
    // סיבוב לרשת, והשרת מגן מפני בקשה ישירה.
    if (n > 0 && !note.trim()) {
      setErr("יש לציין על מה החוב");
      return;
    }
    setSaving(true);
    setErr(null);
    try {
      const res = await fetch(`/api/admin/customers/${customerId}/debt`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount: n, note: note.trim(), mode: "set" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "שמירה נכשלה");
      setOpen(false);
      onDone?.();
    } catch (e: any) {
      setErr(e.message || "שגיאה");
    } finally {
      setSaving(false);
    }
  }

  const hasDebt = debtBalance > 0;

  return (
    <>
      {/* ⚠️ הכפתור משנה צורה לפי המצב: לקוח עם חוב הוא דבר
          שצריך לראות מיד, לא להתאמץ לחפש. */}
      <button
        onClick={() => setOpen(true)}
        className={`w-full flex items-center justify-between gap-2 rounded-xl px-3 py-2.5 border-2 transition-colors ${
          hasDebt
            ? "border-red-400 bg-red-50 hover:bg-red-100"
            : "border-zinc-300 bg-white hover:bg-zinc-50"
        }`}
      >
        <div className="text-right min-w-0">
          <div
            className={`font-bold text-sm ${
              hasDebt ? "text-red-900" : "text-zinc-700"
            }`}
          >
            {hasDebt ? `💸 חוב: ₪${debtBalance.toFixed(2)}` : "💸 רישום חוב"}
          </div>
          {hasDebt && debtNote && (
            <div className="text-[11px] text-red-800 mt-0.5 truncate">
              {debtNote}
            </div>
          )}
          {!hasDebt && (
            <div className="text-[11px] text-zinc-500 mt-0.5">
              חוב מהעבר — ייגבה עם ההזמנה הבאה
            </div>
          )}
        </div>
        <span className="text-zinc-400 shrink-0">←</span>
      </button>

      {open && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-sm p-5 space-y-3">
            <div className="font-extrabold text-brand-slatedark">
              💸 חוב — {customerName}
            </div>

            {/* ⚠️ ההסבר קונקרטי: המנהל צריך לדעת **מתי** זה ייגבה,
                אחרת הוא לא בטוח אם רשם או גבה. */}
            <p className="text-[11px] text-zinc-600 leading-relaxed">
              החוב יתווסף לחיוב של ההזמנה הבאה של הלקוח, ויוצג לו בפירוט
              עם ההסבר שתכתוב כאן.
            </p>

            <div>
              <label className="text-xs font-bold text-zinc-600">
                סכום החוב (₪)
              </label>
              <input
                type="number"
                inputMode="decimal"
                step="0.01"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="w-full mt-1 rounded-lg border-2 border-zinc-300 px-3 py-2 font-bold"
                placeholder="0.00"
              />
              {/* ⚠️ 0 מוחק: זו הדרך לסמן שהחוב שולם ידנית (מזומן),
                  בלי למחוק שדות במסד. */}
              <p className="text-[10px] text-zinc-400 mt-1">
                0 = ביטול החוב (למשל אם שולם במזומן)
              </p>
            </div>

            <div>
              <label className="text-xs font-bold text-zinc-600">
                על מה החוב *
              </label>
              <input
                value={note}
                onChange={(e) => setNote(e.target.value)}
                className="w-full mt-1 rounded-lg border-2 border-zinc-300 px-3 py-2 text-sm"
                placeholder="למשל: חוב ממכירת פסח תשפ״ו"
                maxLength={120}
              />
            </div>

            {err && (
              <p className="text-sm text-red-600 font-bold">{err}</p>
            )}

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
                className="flex-1 py-2.5 rounded-xl bg-brand-rust text-white font-bold disabled:opacity-50"
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
