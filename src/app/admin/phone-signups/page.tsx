"use client";

// §24: בקשות פתיחת חשבון מהמערכת הטלפונית.
//
// המסך משרת גם מנהל וגם נציג:
//   מנהל - רואה את כל הבקשות, משייך נציג, משנה נקודה
//   נציג - רואה רק את הנקודות שלו, מסמן יצירת קשר
//
// עקרון מרכזי: "הושלם" נקבע לפי paymentToken אמיתי ולא לפי סטטוס
// שמישהו לחץ. הסטטוס יכול להיות לא מעודכן; הטוקן לא משקר.

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { api } from "@/lib/client";

type Row = {
  id: string;
  customerId: string;
  customerName: string;
  phone: string;
  email: string | null;
  pointId: string;
  pointName: string;
  pointCity: string | null;
  assignedAgentId: string | null;
  status: string;
  contactedAt: string | null;
  completedAt: string | null;
  failReason: string | null;
  note: string | null;
  createdAt: string;
  hasToken: boolean;
  cardLast4: string | null;
  daysWaiting: number;
};

const STATUS_LABELS: Record<string, string> = {
  NEW: "חדש",
  ASSIGNED: "שויך לנציג",
  CONTACTED: "יצרו קשר",
  COMPLETED: "הושלם",
  FAILED: "לא הושלם",
};

const STATUS_COLORS: Record<string, string> = {
  NEW: "bg-red-100 text-red-700",
  ASSIGNED: "bg-blue-100 text-blue-700",
  CONTACTED: "bg-amber-100 text-amber-800",
  COMPLETED: "bg-emerald-100 text-emerald-700",
  FAILED: "bg-zinc-200 text-zinc-600",
};

const FILTERS = [
  { value: "open", label: "פתוחות" },
  { value: "all", label: "הכל" },
  { value: "NEW", label: "חדשות" },
  { value: "ASSIGNED", label: "שויכו" },
  { value: "CONTACTED", label: "יצרו קשר" },
  { value: "COMPLETED", label: "הושלמו" },
  { value: "FAILED", label: "לא הושלמו" },
];

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("he-IL", {
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

export default function PhoneSignupsPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [isAgent, setIsAgent] = useState(false);
  const [filter, setFilter] = useState("open");
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [err, setErr] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setErr("");
    try {
      const qs = filter === "open" || filter === "all" ? "" : `?status=${filter}`;
      const res = await api(`/api/admin/phone-signups${qs}`);
      let list: Row[] = res.rows ?? [];
      // "פתוחות" = כל מה שעדיין דורש טיפול
      if (filter === "open") {
        list = list.filter((r) => r.status !== "COMPLETED" && r.status !== "FAILED");
      }
      setRows(list);
      setCounts(res.counts ?? {});
      setIsAgent(!!res.isAgent);
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => {
    load();
  }, [load]);

  async function act(id: string, action: string, extra?: Record<string, any>) {
    setBusyId(id);
    try {
      await api("/api/admin/phone-signups", {
        method: "PATCH",
        body: JSON.stringify({ id, action, ...extra }),
      });
      await load();
    } catch (e: any) {
      alert("שגיאה: " + e.message);
    } finally {
      setBusyId(null);
    }
  }

  const openCount = (counts.NEW ?? 0) + (counts.ASSIGNED ?? 0) + (counts.CONTACTED ?? 0);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-extrabold text-brand-slatedark">
          בקשות פתיחת חשבון בטלפון
        </h1>
        <p className="text-sm text-brand-slate/60 mt-0.5">
          לקוחות שנרשמו במערכת הטלפונית וממתינים שנציג יצור קשר ויעדכן פרטי
          אשראי. עד אז הם לא יכולים להזמין.
        </p>
      </div>

      {openCount > 0 && (
        <div className="card p-3 border-amber-300 bg-amber-50 text-sm text-amber-900">
          {openCount} בקשות ממתינות לטיפול.
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <select
          className="input max-w-[200px]"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          aria-label="סינון לפי סטטוס"
        >
          {FILTERS.map((f) => (
            <option key={f.value} value={f.value}>
              {f.label}
            </option>
          ))}
        </select>
        <button onClick={load} className="btn-ghost btn-sm" disabled={loading}>
          רענן
        </button>
        {!loading && (
          <span className="text-sm text-brand-slate/60 mr-auto">
            {rows.length} בקשות
          </span>
        )}
      </div>

      {err && (
        <div className="card p-4 border-red-200 bg-red-50 text-sm text-red-800">
          שגיאה: {err}
        </div>
      )}

      {loading ? (
        <p className="text-zinc-500">טוען...</p>
      ) : rows.length === 0 ? (
        <div className="card p-6 text-center">
          <p className="font-medium text-brand-slatedark">אין בקשות</p>
          <p className="text-sm text-brand-slate/60 mt-1">
            {isAgent
              ? "אין בקשות פתוחות בנקודות שלך."
              : "בקשה נוצרת כשלקוח נרשם דרך המערכת הטלפונית."}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {rows.map((r) => {
            // הטוקן הוא מקור האמת - סטטוס יכול להיות לא מעודכן
            const done = r.hasToken;
            const stale = done && r.status !== "COMPLETED";
            return (
              <div
                key={r.id}
                className={`card p-4 ${
                  done
                    ? "border-emerald-300"
                    : r.daysWaiting >= 3
                      ? "border-amber-300"
                      : ""
                }`}
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-bold text-brand-slatedark">
                        {r.customerName}
                      </span>
                      <span
                        className={`badge ${
                          STATUS_COLORS[done ? "COMPLETED" : r.status] ?? "bg-zinc-100"
                        }`}
                      >
                        {STATUS_LABELS[done ? "COMPLETED" : r.status] ?? r.status}
                      </span>
                      {done && r.cardLast4 && (
                        <span className="text-xs text-emerald-700" dir="ltr">
                          ****{r.cardLast4}
                        </span>
                      )}
                      {!done && r.daysWaiting > 0 && (
                        <span
                          className={`text-xs ${
                            r.daysWaiting >= 3 ? "text-red-700 font-bold" : "text-zinc-500"
                          }`}
                        >
                          ממתין <bdi>{r.daysWaiting}</bdi> ימים
                        </span>
                      )}
                    </div>
                    <div className="text-sm text-zinc-600 mt-1" dir="ltr">
                      {r.phone}
                    </div>
                    <div className="text-xs text-zinc-500 mt-0.5">
                      📍 {r.pointName}
                      {r.pointCity && ` — ${r.pointCity}`}
                    </div>
                    {r.note && (
                      <div className="text-xs text-zinc-600 mt-1">הערה: {r.note}</div>
                    )}
                    {r.failReason && (
                      <div className="text-xs text-red-700 mt-1">
                        סיבה: {r.failReason}
                      </div>
                    )}
                  </div>

                  <div className="text-xs text-zinc-400 shrink-0 text-left">
                    <div>נרשם: {fmtDate(r.createdAt)}</div>
                    {r.contactedAt && <div>יצרו קשר: {fmtDate(r.contactedAt)}</div>}
                  </div>
                </div>

                {stale && (
                  <p className="text-xs text-emerald-700 mt-2">
                    ללקוח כבר יש כרטיס שמור — הבקשה תיסגר אוטומטית.
                  </p>
                )}

                {!done && (
                  <div className="mt-3 pt-3 border-t border-zinc-100 flex flex-wrap gap-2">
                    <a href={`tel:${r.phone}`} className="btn-ghost btn-sm">
                      📞 חייג
                    </a>
                    <Link
                      href={`/admin/customers?q=${encodeURIComponent(r.phone)}`}
                      className="btn-primary btn-sm"
                    >
                      עדכון כרטיס ←
                    </Link>
                    {r.status !== "CONTACTED" && (
                      <button
                        onClick={() => act(r.id, "contacted")}
                        disabled={busyId === r.id}
                        className="btn-ghost btn-sm"
                      >
                        סמן שיצרתי קשר
                      </button>
                    )}
                    <button
                      onClick={() => {
                        const reason = prompt("סיבה שהטיפול לא הושלם:");
                        if (reason !== null) act(r.id, "fail", { reason });
                      }}
                      disabled={busyId === r.id}
                      className="btn-ghost btn-sm"
                    >
                      לא הושלם
                    </button>
                    <button
                      onClick={() => {
                        const note = prompt("הערה:", r.note || "");
                        if (note !== null) act(r.id, "note", { note });
                      }}
                      disabled={busyId === r.id}
                      className="btn-ghost btn-sm"
                    >
                      הערה
                    </button>
                  </div>
                )}

                {r.status === "FAILED" && (
                  <div className="mt-3 pt-3 border-t border-zinc-100">
                    <button
                      onClick={() => act(r.id, "reopen")}
                      disabled={busyId === r.id}
                      className="btn-ghost btn-sm"
                    >
                      פתח מחדש
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
