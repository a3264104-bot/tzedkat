"use client";

// §149: בקשות הרשמה טלפוניות - מסך הנציג.
//
// הלקוח מתקשר, נרשם, ובוחר נקודת חלוקה. הנציג של אותה נקודה
// מכיר אותו, יכול לאמת שהוא אמיתי, ולאשר מיד.
//
// ⚠️ רואה **רק** את הנקודות שלו. הסינון בשרת ולא כאן - סינון
// בקליינט בלבד הוא הצגה ולא הגנה.

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";

type SignupRequest = {
  id: string;
  customerId: string;
  spokenName: string;
  currentName: string | null;
  phone: string;
  status: string;
  note: string | null;
  failReason: string | null;
  pointName: string | null;
  pointCity: string | null;
  createdAt: string;
  contactedAt: string | null;
  completedAt: string | null;
  hasCard: boolean;
  isCash: boolean;
  hasCode: boolean;
  hasEmail: boolean;
  orderCount: number;
  customerActive: boolean;
};

const STATUS_LABEL: Record<string, string> = {
  NEW: "חדשה",
  ASSIGNED: "משויכת",
  CONTACTED: "יצרתי קשר",
  COMPLETED: "אושרה",
  FAILED: "נדחתה",
};

export default function AgentSignupsPage() {
  const [requests, setRequests] = useState<SignupRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showDone, setShowDone] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [codeShown, setCodeShown] = useState<{ id: string; code: string } | null>(
    null
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/agent/signups${showDone ? "?done=1" : ""}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "שגיאה");
      setRequests(data.requests ?? []);
    } catch (e: any) {
      setError(e.message);
      setRequests([]);
    } finally {
      setLoading(false);
    }
  }, [showDone]);

  useEffect(() => {
    load();
  }, [load]);

  async function act(r: SignupRequest, action: string, extra?: any) {
    setBusyId(r.id);
    try {
      const res = await fetch("/api/agent/signups", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: r.id, action, ...extra }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "שגיאה");

      // ⚠️ הקוד מוצג **מיד** ובבירור. הנציג על הקו עם הלקוח,
      // וקוד שנוצר בשקט הוא חסר ערך - הוא לא ידע שהוא קיים.
      if (action === "approve" && data.loginCode) {
        setCodeShown({ id: r.id, code: data.loginCode });
      }
      await load();
    } catch (e: any) {
      alert(e.message);
    } finally {
      setBusyId(null);
    }
  }

  function approve(r: SignupRequest) {
    if (
      !window.confirm(
        `לאשר את ${r.spokenName} (${r.phone})?\n\n` +
          `הלקוח ישויך לנקודה ויקבל קוד כניסה.\n` +
          `⚠️ ברירת המחדל היא תשלום באשראי — הוא לא יוכל להזמין עד ` +
          `שיוזן לו כרטיס. ניתן לשנות למזומן בכרטיס הלקוח.`
      )
    )
      return;
    act(r, "approve");
  }

  function reject(r: SignupRequest) {
    const reason = window.prompt(
      `לדחות את ${r.spokenName}?\n\nסיבה (המנהל יראה אותה):`
    );
    if (reason === null) return;
    if (!reason.trim()) {
      alert("יש לציין סיבה");
      return;
    }
    act(r, "fail", { reason: reason.trim() });
  }

  if (loading && requests.length === 0) {
    return <main className="p-6 text-zinc-500">טוען…</main>;
  }

  return (
    <main dir="rtl" className="p-4 max-w-3xl mx-auto space-y-4">
      <div>
        <h1 className="text-xl font-extrabold text-brand-slatedark">
          📞 בקשות הרשמה
        </h1>
        <p className="text-sm text-zinc-500 mt-1">
          לקוחות שנרשמו במערכת הטלפונית ובחרו את נקודת החלוקה שלך.
        </p>
      </div>

      <div className="flex gap-1 border-b border-zinc-200">
        <button
          onClick={() => setShowDone(false)}
          className={`px-4 py-2 text-sm font-bold border-b-2 -mb-px ${
            !showDone
              ? "border-brand-rust text-brand-rust"
              : "border-transparent text-zinc-500"
          }`}
        >
          ממתינות
        </button>
        <button
          onClick={() => setShowDone(true)}
          className={`px-4 py-2 text-sm font-bold border-b-2 -mb-px ${
            showDone
              ? "border-brand-rust text-brand-rust"
              : "border-transparent text-zinc-500"
          }`}
        >
          טופלו
        </button>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-3 text-sm text-red-800">
          {error}
        </div>
      )}

      {requests.length === 0 && !error ? (
        <div className="bg-white border border-zinc-200 rounded-xl p-8 text-center text-zinc-500 text-sm">
          {showDone ? "אין בקשות שטופלו" : "אין בקשות ממתינות"}
        </div>
      ) : (
        <div className="space-y-3">
          {requests.map((r) => (
            <div
              key={r.id}
              className={`bg-white border-2 rounded-xl p-3.5 ${
                r.status === "NEW"
                  ? "border-amber-300"
                  : r.status === "COMPLETED"
                    ? "border-emerald-200"
                    : r.status === "FAILED"
                      ? "border-zinc-200 opacity-70"
                      : "border-blue-200"
              }`}
            >
              <div className="flex items-start justify-between gap-2 flex-wrap">
                <div className="min-w-0">
                  <div className="font-bold text-brand-slatedark">
                    {r.spokenName}
                    {/* ⚠️ השם נקלט מזיהוי דיבור. אם המנהל תיקן אותו
                        מאז, שני השמות מוצגים - כדי שהנציג יזהה. */}
                    {r.currentName && r.currentName !== r.spokenName && (
                      <span className="text-xs font-normal text-zinc-500 mr-1.5">
                        (בכרטיס: {r.currentName})
                      </span>
                    )}
                  </div>
                  <a
                    href={`tel:${r.phone}`}
                    className="text-sm text-brand-rust font-medium"
                    dir="ltr"
                  >
                    {r.phone}
                  </a>
                  <div className="text-[11px] text-zinc-400 mt-0.5">
                    {r.pointName}
                    {r.pointCity ? ` · ${r.pointCity}` : ""} ·{" "}
                    {new Date(r.createdAt).toLocaleDateString("he-IL")}
                  </div>
                </div>
                <span
                  className={`text-[10px] font-bold rounded px-2 py-1 shrink-0 ${
                    r.status === "NEW"
                      ? "bg-amber-100 text-amber-800"
                      : r.status === "COMPLETED"
                        ? "bg-emerald-100 text-emerald-800"
                        : r.status === "FAILED"
                          ? "bg-zinc-100 text-zinc-600"
                          : "bg-blue-100 text-blue-800"
                  }`}
                >
                  {STATUS_LABEL[r.status] ?? r.status}
                </span>
              </div>

              {/* מצב הלקוח - מה עוד חסר לו כדי להזמין */}
              <div className="flex flex-wrap gap-1.5 mt-2">
                {r.hasCard ? (
                  <Tag color="emerald">💳 יש כרטיס</Tag>
                ) : r.isCash ? (
                  <Tag color="amber">💵 מזומן</Tag>
                ) : (
                  <Tag color="red">⚠️ אין אמצעי תשלום</Tag>
                )}
                {r.hasCode && <Tag color="zinc">יש קוד</Tag>}
                {r.hasEmail && <Tag color="zinc">יש מייל</Tag>}
                {r.orderCount > 0 && (
                  <Tag color="zinc">{r.orderCount} הזמנות</Tag>
                )}
              </div>

              {r.note && (
                <p className="text-[11px] text-zinc-600 bg-zinc-50 rounded p-2 mt-2">
                  {r.note}
                </p>
              )}
              {r.failReason && (
                <p className="text-[11px] text-red-700 bg-red-50 rounded p-2 mt-2">
                  סיבת דחייה: {r.failReason}
                </p>
              )}

              {/* הקוד שהופק - מוצג עד שהנציג סוגר */}
              {codeShown?.id === r.id && (
                <div className="bg-emerald-50 border-2 border-emerald-400 rounded-lg p-3 mt-2 text-center">
                  <div className="text-[11px] text-emerald-700">
                    קוד הכניסה — יש למסור ללקוח
                  </div>
                  <div
                    className="text-2xl font-extrabold text-emerald-800 tracking-widest my-1"
                    dir="ltr"
                  >
                    {codeShown.code}
                  </div>
                  <button
                    onClick={() => setCodeShown(null)}
                    className="text-[11px] text-emerald-700 underline"
                  >
                    מסרתי
                  </button>
                </div>
              )}

              {/* פעולות - רק בבקשות ממתינות */}
              {["NEW", "ASSIGNED", "CONTACTED"].includes(r.status) && (
                <div className="flex gap-2 mt-3 flex-wrap">
                  {r.status !== "CONTACTED" && (
                    <button
                      onClick={() => act(r, "contacted")}
                      disabled={busyId === r.id}
                      className="flex-1 min-w-[90px] py-2 rounded-lg border-2 border-blue-300 text-blue-800 text-xs font-bold disabled:opacity-50"
                    >
                      📞 יצרתי קשר
                    </button>
                  )}
                  <button
                    onClick={() => reject(r)}
                    disabled={busyId === r.id}
                    className="flex-1 min-w-[80px] py-2 rounded-lg border-2 border-zinc-300 text-zinc-600 text-xs font-bold disabled:opacity-50"
                  >
                    ✗ דחה
                  </button>
                  <button
                    onClick={() => approve(r)}
                    disabled={busyId === r.id}
                    className="flex-[2] min-w-[110px] py-2 rounded-lg bg-emerald-600 text-white text-xs font-bold disabled:opacity-50"
                  >
                    {busyId === r.id ? "…" : "✓ אשר לקוח"}
                  </button>
                </div>
              )}

              {r.status === "COMPLETED" && (
                <Link
                  href={`/agent/customer/${r.customerId}`}
                  className="block text-center text-xs text-brand-rust font-bold border border-brand-rust/40 rounded-lg py-2 mt-3"
                >
                  לכרטיס הלקוח ←
                </Link>
              )}
            </div>
          ))}
        </div>
      )}

      <p className="text-[11px] text-zinc-400 leading-relaxed pt-2">
        לקוח שאושר מקבל קוד כניסה ומשויך לנקודה שלך. ברירת המחדל היא תשלום
        באשראי — לקוח שמשלם במזומן יש לסמן ככזה בכרטיס הלקוח, ורק אז הוא
        יוכל להזמין בעצמו.
      </p>
    </main>
  );
}

function Tag({
  children,
  color,
}: {
  children: React.ReactNode;
  color: "emerald" | "amber" | "red" | "zinc";
}) {
  const c = {
    emerald: "bg-emerald-50 text-emerald-800 border-emerald-200",
    amber: "bg-amber-50 text-amber-800 border-amber-200",
    red: "bg-red-50 text-red-700 border-red-200",
    zinc: "bg-zinc-50 text-zinc-600 border-zinc-200",
  }[color];
  return (
    <span className={`text-[10px] border rounded px-1.5 py-0.5 ${c}`}>
      {children}
    </span>
  );
}
