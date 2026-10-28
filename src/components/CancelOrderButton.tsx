"use client";

// 🗑️ ביטול הזמנה שלמה — נציג ומנהל.
//
// התרחיש: הסחורה לא הגיעה ללקוח. במקום לבטל מוצר-מוצר (ועדיין לחייב
// ₪3), מבטלים את ההזמנה כולה — והיא לא נגבית בכלל.
//
// ⚠️ אישור כפול: שלב 1 — "בטוח?" + סיבה. שלב 2 — "אישור אחרון".
// ⚠️ לפני הביטול השרת שומר גיבוי מלא; המנהל יכול לשחזר.

import { useState } from "react";

export function CancelOrderButton({
  orderId,
  orderNumber,
  customerName,
  isPaid,
  isAdmin,
  onDone,
}: {
  orderId: string;
  orderNumber: number;
  customerName: string;
  /** שולמה (גם חלקית) — נציג לא יכול לבטל */
  isPaid?: boolean;
  isAdmin?: boolean;
  onDone?: () => void;
}) {
  const [step, setStep] = useState<0 | 1 | 2>(0);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  if (isPaid && !isAdmin) {
    return (
      <p className="text-xs text-zinc-500">
        ההזמנה שולמה — לביטול יש לפנות למנהל (הסכום יחזור ללקוח כזיכוי).
      </p>
    );
  }

  function close() {
    if (busy) return;
    setStep(0);
    setErr(null);
  }

  async function doCancel() {
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch(`/api/orders/${orderId}/cancel`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: reason.trim(), confirm: "CANCEL" }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || `שגיאה (${res.status})`);
      setStep(0);
      alert(
        `✓ הזמנה #${orderNumber} בוטלה — לא ייגבה עליה כלום.` +
          (d.creditedAmount > 0 ? `\n₪${Number(d.creditedAmount).toFixed(2)} נזקפו ללקוח כזיכוי.` : "") +
          `\nנשמר גיבוי מלא${isAdmin ? " — אפשר לשחזר ממסך ההזמנה." : " — המנהל יכול לשחזר."}`
      );
      if (onDone) onDone();
      else window.location.reload();
    } catch (e: any) {
      setErr(e?.message || "שגיאה");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        onClick={() => setStep(1)}
        className="w-full py-2 rounded-lg border-2 border-red-300 text-red-700 text-sm font-bold hover:bg-red-50"
      >
        🗑️ ביטול כל ההזמנה (הסחורה לא הגיעה)
      </button>

      {step > 0 && (
        <div className="fixed inset-0 z-[90] bg-black/50 flex items-center justify-center p-4" onClick={close}>
          <div dir="rtl" className="bg-white rounded-2xl w-full max-w-sm p-5 space-y-3" onClick={(e) => e.stopPropagation()}>
            {step === 1 ? (
              <>
                <div className="font-extrabold text-red-800 text-lg">בטוח לבטל את ההזמנה?</div>
                <p className="text-sm text-zinc-700 leading-relaxed">
                  הזמנה <b>#{orderNumber}</b> של <b>{customerName}</b> תבוטל כולה.
                  <br />
                  הלקוח <b>לא יחויב בכלל</b> — גם לא ₪3 דמי הזמנה.
                  {isPaid && (
                    <>
                      <br />
                      <span className="text-amber-800 font-bold">
                        ⚠️ ההזמנה כבר שולמה — הסכום יחזור ללקוח כיתרת זכות (לא החזר בנדרים).
                      </span>
                    </>
                  )}
                </p>
                <div>
                  <label className="text-xs font-bold text-zinc-600">סיבת הביטול *</label>
                  <input
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    maxLength={300}
                    placeholder="למשל: הסחורה לא הגיעה"
                    className="w-full mt-1 rounded-lg border-2 border-zinc-300 px-3 py-2 text-sm"
                    autoFocus
                  />
                </div>
                <div className="flex gap-2">
                  <button onClick={close} className="flex-1 py-2.5 rounded-xl border-2 border-zinc-300 font-bold">
                    לא, חזרה
                  </button>
                  <button
                    onClick={() => (reason.trim() ? setStep(2) : setErr("יש לכתוב סיבה"))}
                    className="flex-1 py-2.5 rounded-xl bg-red-600 text-white font-bold"
                  >
                    כן, המשך
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className="font-extrabold text-red-800 text-lg">אישור אחרון</div>
                <p className="text-sm text-zinc-700 leading-relaxed">
                  לבטל סופית את הזמנה <b>#{orderNumber}</b> ({customerName})?
                  <br />
                  סיבה: <i>{reason.trim()}</i>
                  <br />
                  <span className="text-xs text-zinc-500">נשמר גיבוי מלא של ההזמנה לפני הביטול.</span>
                </p>
                <div className="flex gap-2">
                  <button
                    onClick={() => setStep(1)}
                    disabled={busy}
                    className="flex-1 py-2.5 rounded-xl border-2 border-zinc-300 font-bold"
                  >
                    חזרה
                  </button>
                  <button
                    onClick={doCancel}
                    disabled={busy}
                    className="flex-1 py-2.5 rounded-xl bg-red-700 text-white font-extrabold disabled:opacity-50"
                  >
                    {busy ? "מבטל..." : "✗ בטל סופית"}
                  </button>
                </div>
              </>
            )}
            {err && <p className="text-sm text-red-600 font-bold">{err}</p>}
          </div>
        </div>
      )}
    </>
  );
}

/** ♻️ שחזור הזמנה שבוטלה (מנהל) — מהגיבוי האחרון */
export function RestoreOrderButton({ orderId, orderNumber, onDone }: { orderId: string; orderNumber: number; onDone?: () => void }) {
  const [busy, setBusy] = useState(false);
  async function restore() {
    if (!window.confirm(`לשחזר את הזמנה #${orderNumber} מהגיבוי?\n\nההזמנה תחזור למצב שהיה לפני הביטול.`)) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/orders/${orderId}/restore`, { method: "POST" });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || `שגיאה (${res.status})`);
      alert(`✓ הזמנה #${orderNumber} שוחזרה`);
      if (onDone) onDone();
      else window.location.reload();
    } catch (e: any) {
      alert(e?.message || "שגיאה");
    } finally {
      setBusy(false);
    }
  }
  return (
    <button
      onClick={restore}
      disabled={busy}
      className="w-full py-2 rounded-lg border-2 border-emerald-400 text-emerald-800 text-sm font-bold hover:bg-emerald-50 disabled:opacity-50"
    >
      {busy ? "משחזר..." : "♻️ שחזור ההזמנה מהגיבוי"}
    </button>
  );
}
