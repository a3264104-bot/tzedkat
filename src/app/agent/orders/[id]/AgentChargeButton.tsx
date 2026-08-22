"use client";

// כפתור חיוב לנציג - קורא לאותו endpoint מאובטח כמו המנהל (/api/admin/charge)
// ה-endpoint בעצמו בודק הרשאת AGENT (agentCanCharge + נקודה/יוצר)
//
// §189: פריסה לתשלומים ברגע החיוב.
//
// 🐛 מה שהיה: confirm() פשוט, והתשלומים נקבעו **רק** ממה שהלקוח
// ביקש באתר - ורק אם הסכום עלה על 800. הנציג שעמד מול הלקוח ושמע
// "אפשר לפרוס?" לא יכול היה לעשות כלום.

import { useState } from "react";
import { useRouter } from "next/navigation";

// ⚠️ 1-12 הוא הטווח שנדרים תומכים בו. מעבר לזה החיוב נדחה אצלם
// עם שגיאה גנרית שקשה לאבחן.
const INSTALLMENT_OPTIONS = [1, 2, 3, 4, 6, 10, 12];

export default function AgentChargeButton({
  orderId,
  orderNumber,
  customerName,
  amount,
  cardLast4,
  enabled,
  disabledReason,
  /**
   * §189: מה שהלקוח ביקש בהזמנה. משמש כברירת מחדל בבורר,
   * כדי שהנציג יראה מה הלקוח כבר בחר ולא יצטרך לשאול שוב.
   */
  requestedInstallments = 1,
}: {
  orderId: string;
  orderNumber: number;
  customerName: string;
  amount: number;
  cardLast4: string | null;
  enabled: boolean;
  disabledReason: string | null;
  requestedInstallments?: number;
}) {
  const router = useRouter();
  const [charging, setCharging] = useState(false);
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null);
  // §189: המודל מחליף את confirm(). confirm לא יכול להכיל בורר,
  // וזו הסיבה שהתשלומים לא היו נגישים כאן מלכתחילה.
  const [open, setOpen] = useState(false);
  const [installments, setInstallments] = useState(
    Math.min(Math.max(requestedInstallments || 1, 1), 12)
  );

  async function handleCharge() {
    setCharging(true);
    setMessage(null);
    setOpen(false);
    try {
      const res = await fetch("/api/admin/charge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // §189: מספר התשלומים נשלח במפורש. השרת מאמת 1-12.
        body: JSON.stringify({ orderId, installments }),
      });
      const data = await res.json();
      if (res.ok && data.ok) {
        setMessage({
          text:
            `החיוב הצליח! ₪${amount.toFixed(2)}` +
            (installments > 1 ? ` ב-${installments} תשלומים` : ""),
          ok: true,
        });
        setTimeout(() => router.refresh(), 1200);
      } else {
        setMessage({ text: data.error || "החיוב נכשל", ok: false });
      }
    } catch (e: any) {
      setMessage({ text: e.message || "שגיאת רשת", ok: false });
    } finally {
      setCharging(false);
    }
  }

  // ⚠️ העיגול: נדרים מחייבים סכומים שלמים באגורות, והתשלום
  // האחרון סופג את ההפרש. מוצג כך כדי שהנציג יידע מה הלקוח
  // יראה בחשבון ולא יופתע.
  const perPayment = Math.floor((amount / installments) * 100) / 100;
  const lastPayment =
    Math.round((amount - perPayment * (installments - 1)) * 100) / 100;

  return (
    <div className="mt-2">
      <button
        onClick={() => setOpen(true)}
        disabled={!enabled || charging}
        className="w-full py-2.5 rounded-xl bg-emerald-600 text-white font-bold hover:bg-emerald-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
      >
        {charging ? "מחייב..." : "💳 חייב עכשיו"}
      </button>
      {!enabled && disabledReason && (
        <p className="text-[11px] text-zinc-500 mt-1 text-center">{disabledReason}</p>
      )}
      {message && (
        <div
          className={`mt-2 rounded-lg p-2 text-xs text-center font-medium ${
            message.ok
              ? "bg-emerald-50 text-emerald-800 border border-emerald-200"
              : "bg-red-50 text-red-800 border border-red-200"
          }`}
        >
          {message.text}
        </div>
      )}

      {/* §189: מסך האישור עם בורר התשלומים */}
      {open && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-end sm:items-center justify-center p-0 sm:p-4">
          <div className="bg-white w-full max-w-sm sm:rounded-2xl rounded-t-2xl p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-extrabold text-brand-slatedark">
                💳 חיוב הזמנה #{orderNumber}
              </h3>
              <button
                onClick={() => setOpen(false)}
                className="text-zinc-400 text-2xl leading-none px-1"
              >
                ×
              </button>
            </div>

            <div className="bg-zinc-50 rounded-xl p-3 space-y-1 text-sm">
              <div className="flex justify-between">
                <span className="text-zinc-500">לקוח</span>
                <span className="font-bold text-brand-slatedark">{customerName}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-zinc-500">כרטיס</span>
                <span className="font-mono" dir="ltr">
                  {cardLast4 ? "****" + cardLast4 : "לא ידוע"}
                </span>
              </div>
              <div className="flex justify-between border-t border-zinc-200 pt-1 mt-1">
                <span className="font-bold text-brand-slatedark">סכום</span>
                <span className="font-extrabold text-brand-rust">
                  ₪{amount.toFixed(2)}
                </span>
              </div>
            </div>

            <div>
              <label className="text-xs font-bold text-zinc-600 block mb-1.5">
                מספר תשלומים
              </label>
              <div className="grid grid-cols-4 gap-1.5">
                {INSTALLMENT_OPTIONS.map((n) => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => setInstallments(n)}
                    className={`py-2 rounded-lg border-2 font-bold text-sm transition-colors ${
                      installments === n
                        ? "border-emerald-600 bg-emerald-50 text-emerald-800"
                        : "border-zinc-200 text-zinc-600 hover:border-zinc-400"
                    }`}
                  >
                    {n}
                  </button>
                ))}
              </div>

              {/* ⚠️ הפירוט מוצג רק בפריסה: בתשלום אחד הוא רק רעש,
                  והסכום כבר מופיע למעלה. */}
              {installments > 1 && (
                <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-2.5 mt-2 text-sm">
                  <div className="font-bold text-emerald-900">
                    {installments} תשלומים של ₪{perPayment.toFixed(2)}
                  </div>
                  {Math.abs(lastPayment - perPayment) > 0.001 && (
                    <div className="text-[11px] text-emerald-800 mt-0.5">
                      התשלום האחרון: ₪{lastPayment.toFixed(2)} (הפרש עיגול)
                    </div>
                  )}
                </div>
              )}

              {/* ⚠️ אזהרה על פריסה בסכום נמוך: חלק מחברות האשראי
                  דוחות פריסה מתחת לסכום מינימלי, והחיוב ייכשל עם
                  שגיאה גנרית. עדיף שהנציג יידע מראש. */}
              {installments > 1 && amount < 300 && (
                <p className="text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded p-2 mt-2 leading-relaxed">
                  ⚠️ פריסה בסכום נמוך עלולה להידחות ע&quot;י חברת האשראי. אם
                  החיוב נכשל — נסה בתשלום אחד.
                </p>
              )}
            </div>

            <div className="flex gap-2">
              <button
                onClick={() => setOpen(false)}
                className="flex-1 py-3 rounded-xl border-2 border-zinc-300 font-bold text-sm"
              >
                ביטול
              </button>
              <button
                onClick={handleCharge}
                className="flex-[2] py-3 rounded-xl bg-emerald-600 text-white font-bold"
              >
                חייב ₪{amount.toFixed(2)}
                {installments > 1 && ` ב-${installments} תשלומים`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
