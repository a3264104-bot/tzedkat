"use client";

// יומן שליחות המייל ללקוחות: לכל שליחה — כמה נשלחו, כמה נכשלו,
// והאם הסתיימה. לחיצה פותחת את רשימת הנמענים.
//
// ⚠️ "נשלח" = Resend קיבל את המייל ונתן לו מזהה. מסירה בפועל לתיבה
// (או חזרה) רואים בלוח הבקרה של Resend לפי המזהה.

import { useEffect, useState } from "react";
import Link from "next/link";

type Log = {
  id: string;
  createdAt: string;
  createdBy: string | null;
  subject: string;
  mode: string;
  saleName: string | null;
  attachmentCount: number;
  total: number;
  sent: number;
  failed: number;
  pending: number;
  state: "DONE" | "SENDING" | "INCOMPLETE";
  finishedAt: string | null;
};

type Recipient = {
  id: string;
  name: string;
  email: string;
  status: "PENDING" | "SENT" | "FAILED";
  error: string | null;
  resendId: string | null;
  sentAt: string | null;
};

const MODE: Record<string, string> = { all: "כל הלקוחות", point: "לפי נקודה", manual: "לקוחות נבחרים" };

const STATE: Record<Log["state"], { label: string; cls: string }> = {
  DONE: { label: "הושלמה", cls: "bg-emerald-100 text-emerald-800" },
  SENDING: { label: "בשליחה…", cls: "bg-blue-100 text-blue-800" },
  INCOMPLETE: { label: "לא הושלמה", cls: "bg-red-100 text-red-700" },
};

const R_STATUS: Record<Recipient["status"], { label: string; cls: string }> = {
  SENT: { label: "נשלח", cls: "bg-emerald-100 text-emerald-800" },
  FAILED: { label: "נכשל", cls: "bg-red-100 text-red-700" },
  PENDING: { label: "לא נשלח", cls: "bg-amber-100 text-amber-800" },
};

function when(iso: string) {
  return new Date(iso).toLocaleString("he-IL", {
    timeZone: "Asia/Jerusalem",
    day: "numeric",
    month: "numeric",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function BroadcastHistoryPage() {
  const [logs, setLogs] = useState<Log[] | null>(null);
  const [error, setError] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);

  async function load() {
    try {
      const res = await fetch("/api/admin/broadcast/logs", { cache: "no-store" });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || `שגיאה (${res.status})`);
      setLogs(d.logs);
    } catch (e: any) {
      setError(e?.message || "שגיאה בטעינה");
    }
  }

  useEffect(() => {
    load();
    // פתיחה ישירה משליחה שהרגע יצאה (?id=)
    try {
      const id = new URLSearchParams(window.location.search).get("id");
      if (id) setOpenId(id);
    } catch {
      // כתובת לא תקינה — מתעלמים
    }
  }, []);

  // רענון כל 5 שניות כל עוד יש שליחה שרצה
  const anySending = !!logs?.some((l) => l.state === "SENDING");
  useEffect(() => {
    if (!anySending) return;
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [anySending]);

  return (
    <div className="space-y-5 max-w-4xl">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold text-brand-slatedark">יומן שליחות מייל</h1>
          <p className="text-sm text-zinc-500 mt-0.5">מי קיבל כל הודעה, ומה נכשל</p>
        </div>
        <Link href="/admin/broadcast" className="btn-ghost btn-sm">
          ← לשליחת מייל
        </Link>
      </div>

      {error && <p className="card p-4 text-sm text-red-700">{error}</p>}
      {!logs && !error && <p className="text-sm text-zinc-500">טוען...</p>}

      {logs && logs.length === 0 && (
        <div className="card p-6 text-center">
          <p className="font-bold text-brand-slatedark">עוד אין שליחות ביומן</p>
          <p className="text-sm text-zinc-500 mt-1">
            היומן מתחיל מהשליחה הבאה. שליחות קודמות אפשר לראות רק בלוח הבקרה של Resend.
          </p>
        </div>
      )}

      {logs && logs.length > 0 && (
        <ul className="space-y-2">
          {logs.map((l) => {
            const st = STATE[l.state];
            const isOpen = openId === l.id;
            const pct = l.total > 0 ? Math.round(((l.sent + l.failed) / l.total) * 100) : 100;
            return (
              <li key={l.id} className="card overflow-hidden">
                <button
                  type="button"
                  onClick={() => setOpenId(isOpen ? null : l.id)}
                  aria-expanded={isOpen}
                  className="w-full text-right p-4 hover:bg-zinc-50 transition-colors"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-bold text-brand-slatedark truncate">{l.subject}</p>
                      <p className="text-xs text-zinc-500 mt-0.5">
                        {when(l.createdAt)} · {MODE[l.mode] ?? l.mode}
                        {l.saleName && ` · פתיחת ${l.saleName}`}
                        {l.attachmentCount > 0 && ` · ${l.attachmentCount} קבצים`}
                        {l.createdBy && ` · ${l.createdBy}`}
                      </p>
                    </div>
                    <span className={`badge ${st.cls} shrink-0`}>{st.label}</span>
                  </div>

                  <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm">
                    <span>
                      <b className="tabular-nums text-emerald-700">{l.sent}</b> נשלחו
                    </span>
                    {l.failed > 0 && (
                      <span>
                        <b className="tabular-nums text-red-700">{l.failed}</b> נכשלו
                      </span>
                    )}
                    {l.pending > 0 && (
                      <span>
                        <b className="tabular-nums text-amber-700">{l.pending}</b>{" "}
                        {l.state === "SENDING" ? "בתור" : "לא נשלחו"}
                      </span>
                    )}
                    <span className="text-zinc-400">מתוך {l.total}</span>
                  </div>
                  {l.state === "SENDING" && (
                    <div className="mt-2 h-1.5 bg-zinc-100 rounded-full overflow-hidden">
                      <div className="h-full bg-blue-500 transition-[width] duration-500" style={{ width: `${pct}%` }} />
                    </div>
                  )}
                </button>
                {isOpen && <Recipients logId={l.id} refreshKey={`${l.sent}-${l.failed}`} />}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function Recipients({ logId, refreshKey }: { logId: string; refreshKey: string }) {
  const [rows, setRows] = useState<Recipient[] | null>(null);
  const [filter, setFilter] = useState<"" | Recipient["status"]>("");
  const [q, setQ] = useState("");

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/admin/broadcast/logs/${logId}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => !cancelled && setRows(d.recipients ?? []))
      .catch(() => !cancelled && setRows([]));
    return () => {
      cancelled = true;
    };
  }, [logId, refreshKey]);

  if (!rows) return <p className="px-4 pb-4 text-sm text-zinc-500">טוען נמענים...</p>;

  const counts = { SENT: 0, FAILED: 0, PENDING: 0 } as Record<Recipient["status"], number>;
  for (const r of rows) counts[r.status]++;
  const words = q.trim().toLowerCase();
  const shown = rows.filter(
    (r) =>
      (!filter || r.status === filter) &&
      (!words || r.name.toLowerCase().includes(words) || r.email.toLowerCase().includes(words))
  );

  return (
    <div className="border-t border-zinc-100">
      <div className="p-3 flex flex-wrap items-center gap-2">
        {(["", "FAILED", "PENDING", "SENT"] as const).map((k) => {
          const n = k ? counts[k] : rows.length;
          if (k && n === 0) return null;
          return (
            <button
              key={k || "all"}
              type="button"
              onClick={() => setFilter(k)}
              aria-pressed={filter === k}
              className={`px-3 py-1.5 rounded-full text-xs font-bold border transition-colors ${
                filter === k
                  ? "bg-brand-slatedark text-white border-brand-slatedark"
                  : "bg-white text-brand-slatedark border-zinc-200 hover:border-zinc-300"
              }`}
            >
              {k ? R_STATUS[k].label : "הכל"} · {n}
            </button>
          );
        })}
        <input
          type="search"
          className="input !py-1.5 text-sm flex-1 min-w-[160px]"
          placeholder="חיפוש שם או מייל"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          aria-label="חיפוש נמען"
        />
      </div>
      <ul className="divide-y divide-zinc-100 max-h-[28rem] overflow-y-auto overscroll-contain">
        {shown.map((r) => {
          const s = R_STATUS[r.status];
          return (
            <li key={r.id} className="px-4 py-2.5 flex items-center justify-between gap-3">
              <span className="min-w-0">
                <span className="block text-sm font-medium text-brand-slatedark truncate">{r.name}</span>
                <span className="block text-xs text-zinc-500 truncate" dir="ltr">
                  {r.email}
                </span>
                {r.error && <span className="block text-xs text-red-600 truncate">{r.error}</span>}
              </span>
              <span className="shrink-0 flex flex-col items-end gap-1">
                <span className={`badge ${s.cls}`}>{s.label}</span>
                {r.sentAt && <span className="text-[11px] text-zinc-400 tabular-nums">{when(r.sentAt)}</span>}
              </span>
            </li>
          );
        })}
        {shown.length === 0 && <li className="px-4 py-3 text-sm text-zinc-500">אין נמענים שתואמים לסינון</li>}
      </ul>
    </div>
  );
}
