"use client";

// ═══════════════════════════════════════════════════════════════
// §298: פאנל הגדרת תשלומים — כמו משלוח, זיכוי וחיוב נוסף
// ═══════════════════════════════════════════════════════════════
// 🐛 מה שהיה: בורר התשלומים ישב **בתוך** מודל החיוב, וכדי להגיע
// אליו הנציג היה צריך ללחוץ "💳 חייב עכשיו". אבל הכפתור מושבת
// כשאין מחיר סופי - כלומר בדיוק בהזמנות שבהן צריך לרשום פריסה
// מראש.
//
// ⚠️ פאנל עצמאי ולא בורר בתוך משהו אחר: הגדרת תשלומים היא
// פעולה בפני עצמה, בדיוק כמו הוספת משלוח או זיכוי. היא לא
// קורית "תוך כדי חיוב" - היא קורית כשהלקוח מבקש, ימים לפני.
//
// ⚠️ אותו מבנה של CreditPanel: כפתור שפותח, שמירה, וסגירה.
// הנציג לומד דפוס אחד ומיישם אותו בארבעה מקומות.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { installmentOptionsFor } from "@/lib/installments-lib";

export default function AgentInstallmentsPanel({
  orderId,
  orderNumber,
  customerName,
  current,
  orderTotal,
  hasCard,
  alreadyPaid,
  isAdmin = false,
}: {
  orderId: string;
  orderNumber: number;
  customerName: string;
  /** מה שכבר מוגדר להזמנה */
  current: number;
  orderTotal: number | null;
  /** ללקוח מזומן אין מה לפרוס */
  hasCard: boolean;
  alreadyPaid: boolean;
  /** §295: מנהל עד 12, נציג עד 2 */
  isAdmin?: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(current || 1);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const options = installmentOptionsFor(isAdmin);

  async function save() {
    setSaving(true);
    setErr(null);
    try {
      const res = await fetch(`/api/admin/orders/${orderId}/installments`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ installments: value }),
      });
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        throw new Error(e.error || "שמירה נכשלה");
      }
      setOpen(false);
      // ⚠️ refresh ולא reload: הנציג לא מאבד את מקומו במסך.
      router.refresh();
    } catch (e: any) {
      setErr(e.message || "שגיאה");
    } finally {
      setSaving(false);
    }
  }

  // ⚠️ לקוח מזומן — אין מה לפרוס, והפאנל רק מבלבל.
  if (!hasCard) return null;

  const hasSplit = current > 1;

  // ⚠️ העיגול: התשלום האחרון סופג את ההפרש (849.80 ל-3 =
  // 283.26 + 283.26 + 283.28). הנציג צריך לדעת מה הלקוח יראה.
  const each =
    orderTotal && value > 1
      ? Math.floor((orderTotal / value) * 100) / 100
      : null;

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        disabled={alreadyPaid}
        className={`w-full flex items-center justify-between gap-2 rounded-xl px-3 py-2.5 border-2 transition-colors disabled:opacity-50 ${
          hasSplit
            ? "border-indigo-400 bg-indigo-50 hover:bg-indigo-100"
            : "border-zinc-300 bg-white hover:bg-zinc-50"
        }`}
      >
        <div className="text-right min-w-0">
          <div
            className={`font-bold text-sm ${
              hasSplit ? "text-indigo-900" : "text-zinc-700"
            }`}
          >
            {hasSplit ? `💳 ${current} תשלומים` : "💳 הגדרת תשלומים"}
          </div>
          <div
            className={`text-[11px] mt-0.5 ${
              hasSplit ? "text-indigo-800" : "text-zinc-500"
            }`}
          >
            {alreadyPaid
              ? "ההזמנה כבר חויבה"
              : hasSplit
                ? "ייושם בחיוב"
                : "פריסה לתשלומים — נשמר עד לחיוב"}
          </div>
        </div>
        <span className="text-zinc-400 shrink-0">←</span>
      </button>

      {open && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
          <div className="bg-white w-full max-w-sm sm:rounded-2xl rounded-t-2xl p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-extrabold text-brand-slatedark">
                💳 תשלומים — #{orderNumber}
              </h3>
              <button
                onClick={() => setOpen(false)}
                className="text-zinc-400 text-2xl leading-none px-1"
              >
                ×
              </button>
            </div>

            <p className="text-xs text-zinc-600">
              {customerName}
              {orderTotal != null && (
                <span className="font-bold"> · ₪{orderTotal.toFixed(2)}</span>
              )}
            </p>

            {/* ⚠️ כפתורים ולא select: בנייד עם ידיים רטובות, שטח
                מגע גדול הוא ההבדל בין בחירה נכונה לטעות. */}
            <div className="grid grid-cols-4 gap-2">
              {options.map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => setValue(n)}
                  className={`py-3 rounded-xl border-2 font-bold transition-colors ${
                    value === n
                      ? "border-indigo-600 bg-indigo-50 text-indigo-800"
                      : "border-zinc-200 text-zinc-600"
                  }`}
                >
                  {n}
                </button>
              ))}
            </div>

            {each != null && (
              <div className="bg-indigo-50 border border-indigo-200 rounded-xl p-3 text-sm">
                <div className="font-bold text-indigo-900">
                  {value} תשלומים של ₪{each.toFixed(2)}
                </div>
                <div className="text-[11px] text-indigo-800 mt-0.5">
                  התשלום האחרון סופג את הפרש העיגול
                </div>
              </div>
            )}

            {/* ⚠️ אזהרה בסכום נמוך: חברות האשראי דוחות פריסה מתחת
                לסכום מינימלי, והחיוב נכשל עם שגיאה גנרית. */}
            {value > 1 && orderTotal != null && orderTotal < 300 && (
              <p className="text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded p-2 leading-relaxed">
                ⚠️ פריסה בסכום נמוך עלולה להידחות ע&quot;י חברת האשראי.
              </p>
            )}

            {!isAdmin && (
              <p className="text-[11px] text-zinc-500">
                לפריסה מעבר ל-2 תשלומים יש לפנות למנהל.
              </p>
            )}

            {err && <p className="text-sm text-red-600 font-bold">{err}</p>}

            <div className="flex gap-2">
              <button
                onClick={() => setOpen(false)}
                disabled={saving}
                className="flex-1 py-3 rounded-xl border-2 border-zinc-300 font-bold"
              >
                ביטול
              </button>
              <button
                onClick={save}
                disabled={saving}
                className="flex-[2] py-3 rounded-xl bg-indigo-600 text-white font-bold disabled:opacity-50"
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
