"use client";
// §inbound: מה חזר במייל ומה נעשה איתו.
//
// ⚠️ שליחת הקובץ — רק ממסך "שליחת מייל ללקוחות" (📊 צירוף קובץ הזמנה),
// שם בוחרים גם את הנמענים. רשימת "מקבלי קובץ" נפרדת כאן הוסרה: הייתה
// דרך שנייה לאותו דבר, ורק בלבלה.
import { useEffect, useState } from "react";

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
  const [inbox, setInbox] = useState<{ address: string | null; rows: InboxRow[] } | null>(null);

  useEffect(() => {
    fetch("/api/admin/excel-inbox")
      .then((r) => r.json())
      .then(setInbox)
      .catch(() => {});
  }, []);

  return (
    <section className="card p-5 space-y-3">
      <div>
        <h2 className="text-lg font-extrabold text-brand-slatedark">📥 קבצים שחזרו במייל</h2>
        <p className="text-xs text-zinc-500 mt-0.5">
          את הקובץ שולחים ב<a href="/admin/broadcast" className="font-bold text-brand-rust hover:underline">שליחת מייל ללקוחות</a>{" "}
          (📊 לצרף קובץ הזמנה). הלקוח ממלא ועונה
          {inbox?.address ? (
            <>
              {" "}לכתובת <b dir="ltr">{inbox.address}</b>
            </>
          ) : null}{" "}
          — המערכת יוצרת את ההזמנה ושולחת לו אישור. כאן רואים מה הגיע ומה קרה איתו.
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
  );
}
