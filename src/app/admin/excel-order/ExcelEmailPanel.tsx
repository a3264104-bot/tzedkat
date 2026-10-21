"use client";
// §inbound: ניהול ההזמנות במייל — מי מקבל את הקובץ (רשימה מלאה עם סימון), ומה חזר
import { useEffect, useMemo, useState } from "react";

type Person = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  wants: boolean;
  pointId: string | null;
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
  "refused:NO_ITEMS": { text: "אף שורה לא נקלטה", cls: "bg-zinc-100 text-zinc-700" },
  "unknown-sender": { text: "❓ שולח לא מזוהה", cls: "bg-red-50 text-red-800" },
  "bad-file": { text: "📄 קובץ לא קריא", cls: "bg-red-50 text-red-800" },
  "no-items": { text: "אין כמויות בקובץ", cls: "bg-zinc-100 text-zinc-700" },
  "no-attachment": { text: "✉️ מייל בלי קובץ (הועבר אליך)", cls: "bg-blue-50 text-blue-800" },
  "ignored-auto": { text: "תשובה אוטומטית — התעלמנו", cls: "bg-zinc-100 text-zinc-500" },
  "rejected-spoof": { text: "🚫 שולח לא מאומת — נחסם", cls: "bg-red-50 text-red-800" },
};

export function ExcelEmailPanel() {
  const [people, setPeople] = useState<Person[] | null>(null);
  const [q, setQ] = useState("");
  const [point, setPoint] = useState("");
  const [onlyMarked, setOnlyMarked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [inbox, setInbox] = useState<{ address: string | null; rows: InboxRow[] } | null>(null);
  const [err, setErr] = useState("");

  async function load() {
    const r = await fetch("/api/admin/excel-recipients");
    const j = await r.json();
    setPeople(j.customers ?? []);
  }

  useEffect(() => {
    load();
    fetch("/api/admin/excel-inbox")
      .then((r) => r.json())
      .then(setInbox)
      .catch(() => {});
  }, []);

  const points = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of people ?? []) if (p.pointId) m.set(p.pointId, p.pointName ?? "");
    return [...m].sort((a, b) => a[1].localeCompare(b[1], "he"));
  }, [people]);

  const shown = useMemo(() => {
    const t = q.trim().toLowerCase();
    const digits = q.replace(/\D/g, "");
    return (people ?? []).filter(
      (p) =>
        (!onlyMarked || p.wants) &&
        (!point || p.pointId === point) &&
        (!t ||
          p.name.toLowerCase().includes(t) ||
          (p.email ?? "").toLowerCase().includes(t) ||
          (!!digits && (p.phone ?? "").includes(digits)))
    );
  }, [people, q, point, onlyMarked]);

  const markedCount = (people ?? []).filter((p) => p.wants).length;
  const shownMarked = shown.filter((p) => p.wants).length;

  async function setWants(ids: string[], wants: boolean) {
    if (!ids.length) return;
    setErr("");
    setBusy(true);
    // עדכון מיידי במסך, ואז שמירה
    setPeople((list) => (list ?? []).map((p) => (ids.includes(p.id) ? { ...p, wants } : p)));
    try {
      const r = await fetch("/api/admin/excel-recipients", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ customerIds: ids, wants }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "שגיאה");
    } catch (e: any) {
      setErr(e.message);
      load();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      <section className="card p-5 space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h2 className="text-lg font-extrabold text-brand-slatedark">
              📧 מי מקבל את קובץ ההזמנה במייל — {markedCount} מסומנים
            </h2>
            <p className="text-xs text-zinc-500 mt-0.5">
              המסומנים מקבלים את הקובץ בכל פתיחת מכירה (או מ&quot;📊 שלח אקסל&quot; במסך המכירות, או בצירוף להודעה
              ב&quot;שליחת מייל ללקוחות&quot;). מי שמחזיר את הקובץ מלא — מקבל הזמנה ואישור במייל, אוטומטית.
            </p>
          </div>
        </div>

        <div className="grid gap-2 sm:grid-cols-[1fr_auto_auto]">
          <input className="input" placeholder="חיפוש לפי שם, מייל או טלפון…" value={q} onChange={(e) => setQ(e.target.value)} />
          <select className="input" value={point} onChange={(e) => setPoint(e.target.value)} aria-label="נקודת חלוקה">
            <option value="">📍 כל הנקודות</option>
            {points.map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </select>
          <label className="flex items-center gap-1.5 text-sm px-2">
            <input type="checkbox" checked={onlyMarked} onChange={(e) => setOnlyMarked(e.target.checked)} />
            רק מסומנים
          </label>
        </div>

        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="text-zinc-500">
            מוצגים {shown.length} · מסומנים מתוכם {shownMarked}
          </span>
          <button
            disabled={busy || shown.length === 0}
            onClick={() => setWants(shown.filter((p) => !p.wants).map((p) => p.id), true)}
            className="rounded-lg border border-emerald-400 px-2 py-1 font-bold text-emerald-800 hover:bg-emerald-50 disabled:opacity-40"
          >
            ✓ סמן את כל המוצגים
          </button>
          <button
            disabled={busy || shownMarked === 0}
            onClick={() => {
              if (window.confirm(`להסיר ${shownMarked} לקוחות מהרשימה?`)) setWants(shown.filter((p) => p.wants).map((p) => p.id), false);
            }}
            className="rounded-lg border border-zinc-300 px-2 py-1 text-zinc-600 hover:bg-zinc-50 disabled:opacity-40"
          >
            בטל סימון למוצגים
          </button>
        </div>
        {err && <p className="text-sm text-red-700">{err}</p>}

        <div className="rounded-xl border border-zinc-200 divide-y max-h-[28rem] overflow-y-auto">
          {people === null && <p className="p-4 text-center text-sm text-zinc-400">טוען…</p>}
          {people !== null && shown.length === 0 && <p className="p-4 text-center text-sm text-zinc-400">אין לקוחות להצגה.</p>}
          {shown.map((p) => (
            <label
              key={p.id}
              className={`flex cursor-pointer items-center gap-3 px-3 py-2 text-sm hover:bg-zinc-50 ${p.wants ? "bg-emerald-50/50" : ""}`}
            >
              <input
                type="checkbox"
                checked={p.wants}
                onChange={(e) => setWants([p.id], e.target.checked)}
                className="h-4 w-4 shrink-0 accent-emerald-600"
              />
              <span className="min-w-0 flex-1 truncate">
                <b>{p.name}</b> · <span dir="ltr">{p.email}</span>
                {p.pointName && <span className="text-zinc-500"> · {p.pointName}</span>}
              </span>
              {!p.canOrder && (
                <span className="shrink-0 rounded bg-amber-100 px-1.5 text-[11px] text-amber-800" title="הקובץ יישלח, אבל הזמנה ממנו תידחה עד שיוסיף כרטיס">
                  אין כרטיס
                </span>
              )}
            </label>
          ))}
        </div>
      </section>

      <section className="card p-5 space-y-3">
        <div>
          <h2 className="text-lg font-extrabold text-brand-slatedark">📥 קבצים שחזרו במייל</h2>
          <p className="text-xs text-zinc-500 mt-0.5">
            {inbox?.address ? (
              <>
                הלקוחות עונים לכתובת <b dir="ltr">{inbox.address}</b> — המערכת קולטת את הקובץ ויוצרת את ההזמנה לבד.
              </>
            ) : (
              "כתובת הקליטה עוד לא הוגדרה — הלקוחות מחזירים את הקובץ למייל שלך."
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
