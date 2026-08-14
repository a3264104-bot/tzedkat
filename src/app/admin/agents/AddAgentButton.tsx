"use client";

// §40: הפיכת לקוח קיים לנציג.
//
// עד כה לא הייתה שום דרך לעשות זאת מהממשק - המסך עצמו הפנה למשתמש
// "להוסיף לקוחות עם role=AGENT מ-Prisma Studio". כלומר פעולה תפעולית
// שגרתית דרשה גישה לבסיס הנתונים.
//
// הזרימה: חיפוש לקוח קיים -> הפיכה לנציג -> מעבר לפרופיל להשלמת
// נקודות, עמלות והרשאות.

import { useState } from "react";
import { useRouter } from "next/navigation";

type Found = {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  role: string;
  passwordPlain: string | null;
};

export function AddAgentButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Found[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  // §40: אחרי ההפיכה לנציג מציגים את פרטי ההתחברות. בלי זה המנהל היה
  // צריך לחזור למסך הלקוחות ולאפס סיסמה כדי שהנציג יוכל להיכנס.
  const [done, setDone] = useState<{
    id: string;
    name: string;
    phone: string | null;
    password: string;
    wasReset: boolean;
  } | null>(null);

  async function search() {
    const term = q.trim();
    if (term.length < 2) {
      setErr("יש להזין לפחות 2 תווים");
      return;
    }
    setBusy(true);
    setErr("");
    try {
      const res = await fetch(`/api/admin/customers?q=${encodeURIComponent(term)}`);
      const data = await res.json();
      const list: Found[] = Array.isArray(data) ? data : (data.rows ?? data.customers ?? []);
      setResults(list.slice(0, 10));
    } catch (e: any) {
      setErr(e.message || "שגיאה בחיפוש");
    } finally {
      setBusy(false);
    }
  }

  // סיסמה קריאה לנציג: בלי תווים שקל לבלבל ביניהם (0/O, 1/l), כי היא
  // נמסרת בטלפון ונרשמת ביד.
  function genPassword(): string {
    const chars = "abcdefghjkmnpqrstuvwxyz23456789";
    let out = "";
    for (let i = 0; i < 8; i++) out += chars[Math.floor(Math.random() * chars.length)];
    return out;
  }

  async function promote(c: Found) {
    // ⚠️ אם ללקוח כבר יש סיסמה ידועה - משתמשים בה ולא מאפסים. איפוס
    // אוטומטי היה נועל אותו מחוץ לחשבון הקיים שלו בלי שידע.
    const existing = (c.passwordPlain || "").trim();
    const needsReset = existing.length < 6;
    const password = needsReset ? genPassword() : existing;

    if (
      !confirm(
        `להפוך את ${c.name} לנציג?` +
          (needsReset
            ? "\n\nתיווצר עבורו סיסמה חדשה להתחברות."
            : "\n\nהסיסמה הקיימת שלו תישאר ללא שינוי.")
      )
    )
      return;

    setBusy(true);
    setErr("");
    try {
      const res = await fetch(`/api/admin/users/${c.id}/role`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role: "AGENT" }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "שגיאה בעדכון התפקיד");

      if (needsReset) {
        const pw = await fetch(`/api/admin/customers/${c.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ passwordPlain: password }),
        });
        if (!pw.ok) {
          const d = await pw.json().catch(() => ({}));
          throw new Error(d.error || "התפקיד עודכן אך יצירת הסיסמה נכשלה");
        }
      }

      setDone({ id: c.id, name: c.name, phone: c.phone, password, wasReset: needsReset });
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="text-sm bg-brand-rust text-white font-bold px-4 py-2 rounded-lg hover:bg-[#a83a15] transition-colors"
      >
        + הוסף נציג
      </button>
    );
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-start justify-center p-4 overflow-y-auto">
      <div
        dir="rtl"
        className="bg-white rounded-2xl shadow-2xl w-full max-w-lg mt-16 overflow-hidden"
      >
        <div className="bg-brand-rust text-white px-5 py-3 flex items-center justify-between">
          <h2 className="font-extrabold">הוספת נציג</h2>
          <button
            onClick={() => {
              setOpen(false);
              setResults(null);
              setQ("");
              setErr("");
            }}
            className="text-white/90 hover:text-white text-xl leading-none px-1"
            aria-label="סגור"
          >
            ×
          </button>
        </div>

        {/* §40: מסך פרטי ההתחברות. מוצג מיד אחרי ההפיכה לנציג, כדי
            שהמנהל יוכל למסור אותם בטלפון בלי לחזור למסך אחר. */}
        {done ? (
          <div className="p-5 space-y-4">
            <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4">
              <p className="font-bold text-emerald-800">
                {done.name} הוגדר כנציג ✓
              </p>
              <p className="text-sm text-emerald-700 mt-1">
                {done.wasReset
                  ? "נוצרה עבורו סיסמה חדשה. מסור לו את הפרטים הבאים."
                  : "לנציג כבר הייתה סיסמה והיא נשארה ללא שינוי."}
              </p>
            </div>

            <div className="border border-zinc-200 rounded-xl divide-y divide-zinc-100">
              <div className="flex items-center justify-between p-3">
                <span className="text-sm text-zinc-500">שם משתמש (טלפון)</span>
                <span className="font-mono font-bold text-brand-slatedark" dir="ltr">
                  {done.phone || "—"}
                </span>
              </div>
              <div className="flex items-center justify-between p-3">
                <span className="text-sm text-zinc-500">סיסמה</span>
                <span className="font-mono font-bold text-lg text-brand-rust" dir="ltr">
                  {done.password}
                </span>
              </div>
            </div>

            <button
              onClick={() => {
                navigator.clipboard
                  ?.writeText(
                    `כניסה למערכת צדקת רבותינו\nטלפון: ${done.phone || ""}\nסיסמה: ${done.password}`
                  )
                  .then(() => alert("הפרטים הועתקו"))
                  .catch(() => alert("ההעתקה נכשלה, ניתן להעתיק ידנית"));
              }}
              className="w-full py-2.5 rounded-lg border border-zinc-300 text-sm font-bold text-brand-slatedark hover:bg-zinc-50"
            >
              העתק פרטי התחברות
            </button>

            <p className="text-xs text-zinc-500">
              נותר להשלים: שיוך נקודות חלוקה, עמלות והרשאות. בלעדיהם הנציג
              לא יראה הזמנות.
            </p>

            <button
              onClick={() => router.push(`/admin/agents/${done.id}/profile`)}
              className="w-full py-3 rounded-xl bg-brand-rust text-white font-bold hover:bg-[#a83a15]"
            >
              להשלמת ההגדרות בפרופיל ←
            </button>
          </div>
        ) : (
        <div className="p-5 space-y-3">
          <p className="text-sm text-zinc-600">
            נציג הוא לקוח קיים במערכת. חפש אותו לפי שם או טלפון, ואם הוא עדיין
            לא רשום — צור אותו קודם במסך הלקוחות.
          </p>

          <div className="flex gap-2">
            <input
              className="flex-1 px-3 py-2 border border-zinc-300 rounded-lg text-sm"
              placeholder="שם או טלפון"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && search()}
              autoFocus
            />
            <button
              onClick={search}
              disabled={busy}
              className="px-4 py-2 rounded-lg bg-brand-slatedark text-white text-sm font-bold disabled:opacity-50"
            >
              {busy ? "מחפש..." : "חפש"}
            </button>
          </div>

          {err && (
            <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg p-2">
              {err}
            </div>
          )}

          {results && results.length === 0 && (
            <div className="text-sm text-zinc-500 border border-zinc-200 rounded-lg p-3 text-center">
              לא נמצאו לקוחות מתאימים.
              <a href="/admin/customers" className="text-brand-rust font-bold mr-1">
                למסך הלקוחות ←
              </a>
            </div>
          )}

          {results && results.length > 0 && (
            <div className="border border-zinc-200 rounded-lg divide-y divide-zinc-100 max-h-72 overflow-y-auto">
              {results.map((c) => {
                const already = c.role === "AGENT" || c.role === "ADMIN";
                return (
                  <div
                    key={c.id}
                    className="flex items-center justify-between gap-3 p-3"
                  >
                    <div className="min-w-0">
                      <div className="font-medium text-brand-slatedark">{c.name}</div>
                      <div className="text-xs text-zinc-500" dir="ltr">
                        {c.phone}
                        {c.email ? ` · ${c.email}` : ""}
                      </div>
                    </div>
                    {already ? (
                      <a
                        href={`/admin/agents/${c.id}/profile`}
                        className="text-xs text-brand-rust font-bold shrink-0"
                      >
                        כבר נציג — לפרופיל ←
                      </a>
                    ) : (
                      <button
                        onClick={() => promote(c)}
                        disabled={busy}
                        className="text-xs bg-brand-rust text-white font-bold px-3 py-1.5 rounded-lg shrink-0 disabled:opacity-50"
                      >
                        הפוך לנציג
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
        )}
      </div>
    </div>
  );
}
