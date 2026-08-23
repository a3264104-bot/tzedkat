"use client";

// §133: הערת הלקוח לנציג, ותשובת הנציג.
//
// אותו רכיב משרת את שני הצדדים - הלקוח כותב, הנציג עונה - כדי
// ששניהם יראו בדיוק את אותו דבר. שני רכיבים נפרדים היו נפרדים
// ביום שמישהו משנה אחד מהם.
//
// ⚠️ **לא צ'אט.** הערה אחת ותשובה אחת, וזהו. התכתבות מלאה הייתה
// הופכת את הנציג למוקד שירות בזמן שהוא מחלק סחורה.

import { useState } from "react";
// §200: תאריכים בשעון ישראל — השרת רץ ב-UTC
import { fmtDateTime } from "@/lib/date-lib";
import { useRouter } from "next/navigation";

export function OrderNotePanel({
  orderId,
  note,
  noteAt,
  reply,
  replyAt,
  replyByName,
  /** "customer" = הלקוח כותב · "agent" = הנציג עונה */
  mode,
  /** האם ניתן לערוך (הזמנה פעילה) */
  editable = true,
}: {
  orderId: string;
  note: string | null;
  noteAt: string | null;
  reply: string | null;
  replyAt: string | null;
  replyByName?: string | null;
  mode: "customer" | "agent";
  editable?: boolean;
}) {
  const [draft, setDraft] = useState(mode === "customer" ? note ?? "" : "");
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const router = useRouter();

  async function save() {
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/orders/${orderId}/note`, {
        method: mode === "customer" ? "POST" : "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          mode === "customer" ? { note: draft } : { reply: draft }
        ),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "שגיאה");
      setEditing(false);
      if (mode === "agent") setDraft("");
      router.refresh();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  const hasNote = !!note?.trim();

  // ─── צד הנציג ───
  if (mode === "agent") {
    // ⚠️ בלי הערה אין מה להציג. פאנל ריק בכל הזמנה היה רעש שהנציג
    // לומד להתעלם ממנו, וביום שתגיע הערה אמיתית הוא יפספס אותה.
    if (!hasNote) return null;

    return (
      <div className="bg-blue-50 border-2 border-blue-300 rounded-xl p-3 space-y-2">
        <div>
          <div className="text-[11px] font-bold text-blue-900 mb-1">
            💬 הערה מהלקוח
          </div>
          <div className="bg-white rounded-lg p-2.5 text-sm text-zinc-700">
            {note}
          </div>
          {noteAt && (
            <div className="text-[10px] text-blue-600 mt-0.5">
              {fmtDateTime(noteAt)}
            </div>
          )}
        </div>

        {reply && !editing ? (
          <div>
            <div className="text-[11px] font-bold text-emerald-800 mb-1">
              ✓ תשובתך
            </div>
            <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-2.5 text-sm text-emerald-900">
              {reply}
            </div>
            <button
              onClick={() => {
                setDraft(reply);
                setEditing(true);
              }}
              className="text-[11px] text-blue-700 underline mt-1"
            >
              שינוי התשובה
            </button>
          </div>
        ) : (
          <div className="space-y-1.5">
            <textarea
              className="input w-full text-sm"
              rows={2}
              maxLength={500}
              placeholder="תשובה ללקוח — הוא יקבל אותה במייל ובאזור האישי"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              disabled={busy}
            />
            {error && <p className="text-red-700 text-xs">{error}</p>}
            <button
              onClick={save}
              disabled={busy || !draft.trim()}
              className="w-full py-2 rounded-lg bg-blue-600 text-white font-bold text-sm disabled:opacity-40"
            >
              {busy ? "שולח…" : "שלח תשובה ללקוח"}
            </button>
          </div>
        )}
      </div>
    );
  }

  // ─── צד הלקוח ───
  return (
    <div className="border border-zinc-200 rounded-xl p-3 space-y-2">
      <div className="text-xs font-bold text-zinc-600">
        💬 הערה לנציג
        <span className="font-normal text-zinc-400">
          {" "}
          — בקשה מיוחדת, מוצר שאינו ברשימה, או כל דבר אחר
        </span>
      </div>

      {hasNote && !editing ? (
        <>
          <div className="bg-zinc-50 rounded-lg p-2.5 text-sm text-zinc-700">
            {note}
          </div>
          {editable && (
            <button
              onClick={() => {
                setDraft(note ?? "");
                setEditing(true);
              }}
              className="text-[11px] text-brand-rust underline"
            >
              עריכה
            </button>
          )}
        </>
      ) : editable ? (
        <div className="space-y-1.5">
          <textarea
            className="input w-full text-sm"
            rows={2}
            maxLength={500}
            placeholder="למשל: אפשר להוסיף ראש? / לחתוך דק / אאסוף מאוחר"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            disabled={busy}
          />
          {error && <p className="text-red-700 text-xs">{error}</p>}
          <div className="flex gap-2">
            {hasNote && (
              <button
                onClick={() => {
                  setDraft(note ?? "");
                  setEditing(false);
                }}
                disabled={busy}
                className="btn-ghost btn-sm"
              >
                ביטול
              </button>
            )}
            <button
              onClick={save}
              disabled={busy}
              className="flex-1 py-2 rounded-lg bg-brand-rust text-white font-bold text-sm disabled:opacity-40"
            >
              {busy ? "שומר…" : hasNote ? "עדכן הערה" : "שלח הערה"}
            </button>
          </div>
          <p className="text-[10px] text-zinc-400">
            הנציג יראה את ההערה ויוכל להשיב. התשובה תגיע אליך במייל.
          </p>
        </div>
      ) : (
        <p className="text-xs text-zinc-400">
          לא ניתן להוסיף הערה להזמנה שהסתיימה.
        </p>
      )}

      {/* ⚠️ התשובה מוצגת בולטת: זה מה שהלקוח חיכה לו, ואם היא
          תיראה כמו עוד טקסט אפור הוא יפספס אותה. */}
      {reply && (
        <div className="bg-emerald-50 border-2 border-emerald-300 rounded-lg p-3 mt-2">
          <div className="text-[11px] font-bold text-emerald-800">
            ✓ תשובה{replyByName ? ` מ${replyByName}` : ""}
          </div>
          <div className="text-sm text-emerald-900 mt-1">{reply}</div>
          {replyAt && (
            <div className="text-[10px] text-emerald-600 mt-1">
              {fmtDateTime(replyAt)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
