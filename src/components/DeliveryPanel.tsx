"use client";

// §134: סימון משלוח ע"י הנציג.
//
// התרחיש: משלוח אינו שירות רשמי בתפריט. הלקוח מבקש בהערה (§133),
// הנציג רואה ומסמן כאן - והסכום מתווסף לחיוב.
//
// ⚠️ העלות אינה קבועה: היא משתנה לפי עיר ומרחק, ולכן הנציג מזין
// אותה ידנית. טבלת מחירים קבועה הייתה דורשת תחזוקה שאיש לא יעשה,
// והמספר היה מתיישן בשקט.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { fmt } from "@/lib/pricing";

export function DeliveryPanel({
  orderId,
  requested,
  fee,
  address,
  note,
  defaultAddress,
  alreadyPaid,
  deliveredAt,
}: {
  orderId: string;
  requested: boolean;
  fee: number | null;
  address: string | null;
  note: string | null;
  /** כתובת ברירת מחדל - חוסכת הקלדה */
  defaultAddress?: string | null;
  alreadyPaid: boolean;
  /** §135: מתי המשלוח הגיע ליעד. null = עוד בדרך. */
  deliveredAt?: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [feeInput, setFeeInput] = useState(fee != null ? String(fee) : "");
  const [addr, setAddr] = useState(address ?? defaultAddress ?? "");
  const [noteInput, setNoteInput] = useState(note ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const router = useRouter();

  // §135: סימון מסירה. נפרד מהשמירה כי זו פעולה אחרת לגמרי -
  // הראשונה קובעת מה יגבו, וזו מתעדת שהסחורה הגיעה.
  async function markDelivered(done: boolean) {
    setBusy(true);
    try {
      const res = await fetch(`/api/agent/orders/${orderId}/delivery`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ delivered: done }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "שגיאה");
      router.refresh();
    } catch (e: any) {
      alert(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function save(clear = false) {
    setError("");
    if (!clear && !addr.trim()) return setError("יש להזין כתובת למשלוח");
    setBusy(true);
    try {
      const res = await fetch(`/api/agent/orders/${orderId}/delivery`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          clear
            ? { requested: false }
            : {
                requested: true,
                fee: feeInput === "" ? 0 : Number(feeInput),
                address: addr.trim(),
                note: noteInput.trim() || null,
              }
        ),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "שגיאה");
      setOpen(false);
      router.refresh();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  // ─── משלוח מסומן ───
  if (requested && !open) {
    return (
      <div className="bg-violet-50 border-2 border-violet-300 rounded-xl p-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="font-bold text-violet-900 text-sm">
              🚚 משלוח · {fee != null && fee > 0 ? fmt(fee) : "בלי חיוב"}
            </div>
            <div className="text-xs text-violet-800 mt-0.5 break-words">
              {address}
            </div>
            {note && (
              <div className="text-[11px] text-violet-700 mt-0.5">{note}</div>
            )}
          </div>
          {!alreadyPaid && (
            <button
              onClick={() => setOpen(true)}
              className="text-xs text-violet-800 underline shrink-0"
            >
              שינוי
            </button>
          )}
        </div>

        {/* §135: מעקב מסירה.
            
            ⚠️ בלי זה אי אפשר לדעת אילו משלוחים עוד בדרך. הנציג
            יוצא עם חמישה, חוזר, ואיש לא יודע מי קיבל. */}
        <div className="mt-2 pt-2 border-t border-violet-200">
          {deliveredAt ? (
            <div className="flex items-center justify-between gap-2">
              <div className="text-xs font-bold text-emerald-700">
                ✓ נמסר ללקוח
                <span className="font-normal text-emerald-600">
                  {" "}
                  · {new Date(deliveredAt).toLocaleString("he-IL")}
                </span>
              </div>
              <button
                onClick={() => markDelivered(false)}
                disabled={busy}
                className="text-[11px] text-zinc-500 underline shrink-0"
              >
                ביטול
              </button>
            </div>
          ) : (
            <button
              onClick={() => markDelivered(true)}
              disabled={busy}
              className="w-full py-2 rounded-lg bg-emerald-600 text-white font-bold text-xs disabled:opacity-40"
            >
              {busy ? "…" : "✓ סמן שהמשלוח נמסר"}
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
        disabled={alreadyPaid}
        title={alreadyPaid ? "ההזמנה כבר שולמה — דמי משלוח לא ייגבו" : undefined}
        className="w-full py-2 rounded-xl border-2 border-violet-400 text-violet-700 font-bold text-sm hover:bg-violet-50 disabled:opacity-40 disabled:cursor-not-allowed"
      >
        🚚 סמן משלוח ללקוח
        {alreadyPaid && (
          <span className="block text-[10px] font-normal text-zinc-500">
            ההזמנה שולמה — לא ניתן להוסיף חיוב
          </span>
        )}
      </button>
    );
  }

  return (
    <div className="bg-violet-50 border-2 border-violet-400 rounded-xl p-3 space-y-2.5">
      <div className="flex items-center justify-between">
        <span className="font-bold text-violet-900 text-sm">🚚 משלוח</span>
        <button
          onClick={() => setOpen(false)}
          className="text-zinc-400 text-xl leading-none px-1"
        >
          ×
        </button>
      </div>

      <div>
        <label className="text-[11px] text-violet-800 block mb-0.5">
          כתובת למשלוח
        </label>
        <input
          type="text"
          maxLength={300}
          className="input w-full"
          placeholder="רחוב, מספר, עיר, קומה"
          value={addr}
          onChange={(e) => setAddr(e.target.value)}
          disabled={busy}
        />
      </div>

      <div>
        <label className="text-[11px] text-violet-800 block mb-0.5">
          דמי משלוח (₪) — <b>משתנה לפי עיר</b>
        </label>
        <input
          type="number"
          step="0.01"
          min={0}
          dir="ltr"
          className="input w-full text-center font-bold"
          placeholder="0 = בלי חיוב"
          value={feeInput}
          onChange={(e) => setFeeInput(e.target.value)}
          disabled={busy}
        />
        {/* ⚠️ ההסבר חיוני: נציג שמשאיר ריק צריך לדעת שזה נשמר
            כ"בלי חיוב" ולא כ"אחר כך אחליט". */}
        <p className="text-[10px] text-violet-700 mt-0.5">
          הסכום יתווסף לחיוב של הלקוח. ריק או 0 = משלוח בלי חיוב.
        </p>
      </div>

      <div>
        <label className="text-[11px] text-violet-800 block mb-0.5">
          הערה (אופציונלי)
        </label>
        <input
          type="text"
          maxLength={300}
          className="input w-full text-sm"
          placeholder="למשל: להתקשר לפני / להשאיר אצל השכן"
          value={noteInput}
          onChange={(e) => setNoteInput(e.target.value)}
          disabled={busy}
        />
      </div>

      {error && <p className="text-red-700 text-xs font-medium">{error}</p>}

      <div className="flex gap-2">
        {requested && (
          <button
            onClick={() => save(true)}
            disabled={busy}
            className="btn-ghost btn-sm text-red-700"
          >
            בטל משלוח
          </button>
        )}
        <button
          onClick={() => save(false)}
          disabled={busy}
          className="flex-1 py-2.5 rounded-xl bg-violet-600 text-white font-bold text-sm disabled:opacity-40"
        >
          {busy ? "שומר…" : "שמור משלוח"}
        </button>
      </div>
    </div>
  );
}
