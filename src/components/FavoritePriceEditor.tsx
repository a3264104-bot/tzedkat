"use client";

// ═══════════════════════════════════════════════════════════════
// §339: עריכת מחיר במוצר מועדף — אחרי ההוספה
// ═══════════════════════════════════════════════════════════════
// הצורך: הנציג הוסיף מוצר מועדף, ואז הלקוח ביקש כמות אחרת או
// שסוכם מחיר שונה. עד היום הדרך היחידה הייתה למחוק את הפריט
// ולהוסיף מחדש.
//
// ⚠️ **רק מוצר מועדף**: זו כל מהות התכונה (§119). מוצר רגיל
// מתומחר לפי המחירון, ופתיחת עריכה שם הייתה נותנת לנציג לקבוע
// מחירים שרירותיים.
//
// ⚠️ **העלאה בלבד**: הורדה מתחת למחירון פוגעת בהכנסה של המכירה,
// לא בעמלה של הנציג.
//
// ⚠️ **עד החיוב**: אחרי שהכסף נגבה, שינוי מחיר יוצר פער בין מה
// שהלקוח שילם למה שרשום — פער שאי אפשר לתקן בדיעבד.

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function FavoritePriceEditor({
  itemId,
  productName,
  unitPrice,
  agentSetPrice,
  quantity,
  isFavorite,
  locked,
}: {
  itemId: string;
  productName: string;
  /** מחיר המחירון — הרצפה */
  unitPrice: number;
  agentSetPrice: number | null;
  quantity: number;
  isFavorite: boolean;
  /** ההזמנה חויבה או נעולה (§309) */
  locked: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [val, setVal] = useState(
    agentSetPrice != null ? String(agentSetPrice) : ""
  );
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // ⚠️ מוצר רגיל — אין מה לערוך, והכפתור רק היה מבלבל.
  if (!isFavorite) return null;

  const current = agentSetPrice ?? unitPrice;
  const commission =
    agentSetPrice != null
      ? Math.round((agentSetPrice - unitPrice) * quantity * 100) / 100
      : 0;

  async function save() {
    setErr(null);
    const n = val === "" ? null : Number(val);

    if (n != null && (!Number.isFinite(n) || n < unitPrice)) {
      setErr(`לא ניתן לקבוע מחיר נמוך מ-${unitPrice.toFixed(2)} ₪`);
      return;
    }

    setBusy(true);
    try {
      const res = await fetch(`/api/agent/order-item/${itemId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agentSetPrice: n }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || `שגיאה (${res.status})`);
      setOpen(false);
      router.refresh();
    } catch (e: any) {
      setErr(e?.message || "שגיאה");
    } finally {
      setBusy(false);
    }
  }

  if (locked) {
    // ⚠️ מציגים את המחיר בלי אפשרות לערוך: הנציג צריך לדעת מה
    // נקבע, גם אחרי שההזמנה נסגרה.
    return agentSetPrice != null ? (
      <span className="text-[10px] text-amber-700 font-bold">
        ⭐ {agentSetPrice.toFixed(2)}
      </span>
    ) : null;
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className={`text-[10px] px-1.5 py-0.5 rounded font-bold ${
          agentSetPrice != null
            ? "bg-amber-100 text-amber-800"
            : "bg-zinc-100 text-zinc-500 hover:bg-amber-50"
        }`}
        title="מוצר מועדף — ניתן לקבוע מחיר גבוה יותר"
      >
        ⭐ {agentSetPrice != null ? agentSetPrice.toFixed(2) : "מחיר"}
      </button>
    );
  }

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="bg-white w-full max-w-sm sm:rounded-2xl rounded-t-2xl p-5 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="font-extrabold text-brand-slatedark">
            ⭐ מחיר מותאם
          </h3>
          <button
            onClick={() => setOpen(false)}
            className="text-zinc-400 text-2xl leading-none px-1"
          >
            ×
          </button>
        </div>

        <p className="text-xs text-zinc-600">
          {productName} · {quantity}
        </p>

        <div>
          <label className="text-xs font-bold text-zinc-500 block mb-1">
            מחיר ליחידה
          </label>
          <input
            type="number"
            step="0.01"
            min={unitPrice}
            dir="ltr"
            autoFocus
            value={val}
            onChange={(e) => setVal(e.target.value)}
            placeholder={`מחירון: ${unitPrice.toFixed(2)}`}
            className="w-full px-3 py-2.5 border-2 border-amber-300 rounded-lg text-center font-bold text-lg"
          />
          <p className="text-[11px] text-zinc-500 mt-1">
            מחירון: {unitPrice.toFixed(2)} ₪ · ריק = חזרה למחירון
          </p>
        </div>

        {/* ⚠️ העמלה מיידית: זה מה שמעניין את הנציג, לא המחיר. */}
        {val !== "" && Number(val) > unitPrice && (
          <div className="rounded-lg bg-emerald-50 border border-emerald-200 px-3 py-2 text-sm">
            <span className="font-bold text-emerald-800">
              העמלה שלך: ₪
              {(
                Math.round((Number(val) - unitPrice) * quantity * 100) / 100
              ).toFixed(2)}
            </span>
          </div>
        )}

        {err && <p className="text-sm text-red-600 font-bold">{err}</p>}

        <div className="flex gap-2">
          <button
            onClick={() => setOpen(false)}
            disabled={busy}
            className="flex-1 py-3 rounded-xl border-2 border-zinc-300 font-bold"
          >
            ביטול
          </button>
          <button
            onClick={save}
            disabled={busy}
            className="flex-[2] py-3 rounded-xl bg-amber-600 text-white font-bold disabled:opacity-50"
          >
            {busy ? "שומר..." : "שמור"}
          </button>
        </div>
      </div>
    </div>
  );
}
