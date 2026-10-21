"use client";
// §inbound: ניהול ההזמנות במייל — מי מקבל את הקובץ, ומה חזר
import { useCallback, useEffect, useState } from "react";

type Person = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  pointName: string | null;
  canOrder: boolean;
};
type InboxRow = {
  id: string;
  at: string;
  who: string | null;
  from: string | null;
  subject: string | null;
  result: string;
  orderNumber: number | null;
  error: string | null;
  issues: number | null;
};

const RESULT: Record<string, { text: string; cls: string }> = {
  "order-created": { text: "✅ נוצרה הזמנה", cls: "bg-emerald-50 text-emerald-800" },
  "refused:NO_PAYMENT": { text: "💳 אין כרטיס — נשלחה בקשה להסדיר", cls: "bg-amber-50 text-amber-800" },
  "refused:CARD_PROBLEM": { text: "💳 כרטיס לא תקין — נשלחה בקשה לעדכן", cls: "bg-amber-50 text-amber-800" },
  "refused:SALE_CLOSED": { text: "🔒 אחרי הסגירה — נענה שההרשמה נסגרה", cls: "bg-zinc-100 text-zinc-700" },
  "refused:SALE_NOT_ACTIVE": { text: "מכירה לא פעילה", cls: "bg-zinc-100 text-zinc-700" },
  "unknown-sender": { text: "❓ שולח לא מזוהה", cls: "bg-red-50 text-red-800" },
  "bad-file": { text: "📄 קובץ לא קריא", cls: "bg-red-50 text-red-800" },
  "no-items": { text: "אין כמויות בקובץ", cls: "bg-zinc-100 text-zinc-700" },
  "no-attachment": { text: "✉️ מייל בלי קובץ (הועבר אליך)", cls: "bg-blue-50 text-blue-800" },
  "ignored-auto": { text: "תשובה אוטומטית — התעלמנו", cls: "bg-zinc-100 text-zinc-500" },
  "rejected-spoof": { text: "🚫 שולח מזויף — נחסם", cls: "bg-red-50 text-red-800" },
};

export function ExcelEmailPanel() {
  const [list, setList] = useState<Person[]>([]);
  const [found, setFound] = useState<Person[]>([]);
  const [q, setQ] = useState("");
  const [inbox, setInbox] = useState<{ address: string | null; rows: InboxRow[] } | null>(null);
  const [err, setErr] = useState("");

  const load = useCallback(async (query: string) => {
    const r = await fetch(`/api/admin/excel-recipients${query ? `?q=${encodeURIComponent(query)}` : ""}`);
    const j = await r.json();
    setList(j.list ?? []);
    setFound(j.found ?? []);
  }, []);

  useEffect(() => {
    fetch("/api/admin/excel-inbox")
      .then((r) => r.json())
      .then(setInbox)
      .catch(() => {});
  }, []);

  useEffect(() => {
    const t = setTimeout(() => load(q.trim()), 300);
    return () => clearTimeout(t);
  }, [q, load]);

  async function toggle(p: Person, wants: boolean) {
    setErr("");
    const r = await fetch("/api/admin/excel-recipients", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ customerId: p.id, wants }),
    });
    const j = await r.json();
    if (!r.ok) setErr(j.error || "שגיאה");
    load(q.trim());
  }

  return (
    <div className="space-y-5 mt-8">
      <section className="card p-5 space-y-3">
        <div>
          <h2 className="text-lg font-extrabold text-brand-slatedark">
            📧 מקבלי קובץ ההזמנה במייל ({list.length})
          </h2>
          <p className="text-xs text-zinc-500 mt-0.5">
            בכל פתיחת מכירה הם מקבלים מייל עם קובץ כל המוצרים. מי שמחזיר את הקובץ מלא — מקבל הזמנה
            אוטומטית{inbox?.address ? "" : " (אחרי שתוגדר כתובת הקליטה)"} ואישור במייל.
          </p>
        </div>

        <input
          className="input"
          placeholder="הוספת לקוח: חיפוש לפי שם, מייל או טלפון…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        {found.length > 0 && (
          <div className="rounded-xl border border-zinc-200 divide-y">
            {found.map((p) => (
              <div key={p.id} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
                <span className="min-w-0 truncate">
                  <b>{p.name}</b> · {p.email || <span className="text-red-600">אין מייל</span>}
                  {p.pointName && <span className="text-zinc-500"> · {p.pointName}</span>}
                </span>
                <button
                  onClick={() => toggle(p, true)}
                  disabled={!p.email}
                  className="btn-sm rounded-lg bg-brand-rust px-3 font-bold text-white disabled:opacity-40"
                >
                  + הוסף
                </button>
              </div>
            ))}
          </div>
        )}
        {err && <p className="text-sm text-red-700">{err}</p>}

        <div className="rounded-xl border border-zinc-200 divide-y max-h-80 overflow-y-auto">
          {list.length === 0 && <p className="p-4 text-center text-sm text-zinc-400">עדיין אין לקוחות ברשימה.</p>}
          {list.map((p) => (
            <div key={p.id} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
              <span className="min-w-0 truncate">
                <b>{p.name}</b> · <span dir="ltr">{p.email}</span>
                {p.pointName && <span className="text-zinc-500"> · {p.pointName}</span>}
                {!p.canOrder && (
                  <span className="mr-1 rounded bg-amber-100 px-1.5 text-[11px] text-amber-800">אין כרטיס</span>
                )}
              </span>
              <button onClick={() => toggle(p, false)} className="text-xs text-zinc-500 hover:text-red-700">
                הסר
              </button>
            </div>
          ))}
        </div>
      </section>

      <section className="card p-5 space-y-3">
        <div>
          <h2 className="text-lg font-extrabold text-brand-slatedark">📥 קבצים שחזרו במייל</h2>
          <p className="text-xs text-zinc-500 mt-0.5">
            {inbox?.address ? (
              <>
                כתובת הקליטה: <b dir="ltr">{inbox.address}</b> — כל מייל מגיע גם אליך ל-Gmail.
              </>
            ) : (
              "כתובת הקליטה עוד לא הוגדרה — הלקוחות מחזירים את הקובץ למייל שלך, ואתה מעלה אותו למעלה."
            )}
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs text-zinc-500">
              <tr>
                <th className="py-1 text-right">מתי</th>
                <th className="py-1 text-right">מי</th>
                <th className="py-1 text-right">מה קרה</th>
              </tr>
            </thead>
            <tbody>
              {(inbox?.rows ?? []).map((r) => {
                const res = RESULT[r.result] ?? { text: r.result, cls: "bg-zinc-100 text-zinc-700" };
                return (
                  <tr key={r.id} className="border-t border-zinc-100">
                    <td className="py-1.5 whitespace-nowrap text-xs text-zinc-500">
                      {new Date(r.at).toLocaleString("he-IL", {
                        timeZone: "Asia/Jerusalem",
                        day: "2-digit",
                        month: "2-digit",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </td>
                    <td className="py-1.5">{r.who}</td>
                    <td className="py-1.5">
                      <span className={`rounded px-2 py-0.5 text-xs font-bold ${res.cls}`}>
                        {res.text}
                        {r.orderNumber ? ` #${r.orderNumber}` : ""}
                      </span>
                      {!!r.issues && <span className="mr-1 text-xs text-amber-700">{r.issues} שורות לא נקלטו</span>}
                    </td>
                  </tr>
                );
              })}
              {inbox && inbox.rows.length === 0 && (
                <tr>
                  <td colSpan={3} className="py-4 text-center text-zinc-400">
                    עוד לא התקבלו קבצים במייל.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
