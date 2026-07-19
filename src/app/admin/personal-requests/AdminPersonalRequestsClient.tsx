"use client";

import { useEffect, useState } from "react";
import { PersonalRequestMessages } from "@/components/PersonalRequestMessages";

// §9: עמוד ניהול בקשות אישיות למנהל
// - רשימה עם בקשות
// - סינון לפי סטטוס
// - פרטים מלאים כולל צ'אט
// - שינוי סטטוס

type Request = {
  id: string;
  requestNumber: number;
  customerName: string;
  phone: string;
  notes: string | null;
  status: string;
  createdAt: string;
  updatedAt: string;
  hasUnreadForAdmin: boolean;
  hasUnreadForCustomer: boolean;
  items: { productName: string; quantity: number }[];
};

const STATUS_OPTIONS = [
  { value: "NEW", label: "חדשה", color: "bg-blue-100 text-blue-800" },
  { value: "IN_PROGRESS", label: "בטיפול", color: "bg-amber-100 text-amber-800" },
  { value: "CONTACTED", label: "פנינו ללקוח", color: "bg-purple-100 text-purple-800" },
  { value: "WAITING", label: "ממתין ללקוח", color: "bg-zinc-100 text-zinc-800" },
  { value: "DONE", label: "הושלמה", color: "bg-emerald-100 text-emerald-800" },
  { value: "CANCELLED", label: "בוטלה", color: "bg-red-100 text-red-800" },
];

const STATUS_MAP = Object.fromEntries(STATUS_OPTIONS.map((s) => [s.value, s]));

export default function AdminPersonalRequestsClient() {
  const [requests, setRequests] = useState<Request[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<string>("ACTIVE"); // ACTIVE | ALL | סטטוס ספציפי
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [updating, setUpdating] = useState<string | null>(null);

  useEffect(() => {
    load();
    // רענון אוטומטי כל 30 שניות
    const interval = setInterval(load, 30000);
    return () => clearInterval(interval);
  }, []);

  async function load() {
    try {
      const res = await fetch("/api/admin/personal-requests");
      const data = await res.json();
      if (Array.isArray(data)) {
        setRequests(data);
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }

  async function changeStatus(id: string, status: string) {
    setUpdating(id);
    try {
      const res = await fetch(`/api/admin/personal-requests/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (res.ok) {
        await load();
      }
    } catch {
      // ignore
    } finally {
      setUpdating(null);
    }
  }

  const filtered = requests.filter((r) => {
    if (filter === "ALL") return true;
    if (filter === "ACTIVE") return r.status !== "DONE" && r.status !== "CANCELLED";
    return r.status === filter;
  });

  const unreadCount = requests.filter((r) => r.hasUnreadForAdmin).length;

  return (
    <div className="min-h-screen bg-brand-cream">
      <header className="bg-brand-yellow border-b-4 border-brand-rust/20 sticky top-0 z-20">
        <div className="mx-auto max-w-md md:max-w-6xl px-4 py-2.5 flex items-center justify-between">
          <a href="/admin" className="text-brand-slate font-medium text-sm">
            ← ניהול
          </a>
          <div className="font-extrabold text-brand-slatedark flex items-center gap-2">
            בקשות אישיות
            {unreadCount > 0 && (
              <span className="bg-brand-rust text-white text-xs px-2 py-0.5 rounded-full">
                {unreadCount}
              </span>
            )}
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-md md:max-w-6xl px-4 pt-4 space-y-3">
        {/* פילטרים */}
        <div className="card p-3">
          <div className="flex gap-2 flex-wrap">
            <button
              onClick={() => setFilter("ACTIVE")}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium ${
                filter === "ACTIVE"
                  ? "bg-brand-rust text-white"
                  : "bg-zinc-100 text-brand-slatedark"
              }`}
            >
              פעילות ({requests.filter((r) => r.status !== "DONE" && r.status !== "CANCELLED").length})
            </button>
            <button
              onClick={() => setFilter("ALL")}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium ${
                filter === "ALL"
                  ? "bg-brand-rust text-white"
                  : "bg-zinc-100 text-brand-slatedark"
              }`}
            >
              כולן ({requests.length})
            </button>
            {STATUS_OPTIONS.map((s) => (
              <button
                key={s.value}
                onClick={() => setFilter(s.value)}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium ${
                  filter === s.value ? "bg-brand-rust text-white" : "bg-zinc-100 text-brand-slatedark"
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>

        {/* רשימה */}
        {loading ? (
          <div className="text-center text-zinc-500 py-8">טוען...</div>
        ) : filtered.length === 0 ? (
          <div className="card p-6 text-center text-zinc-500">אין בקשות בקטגוריה זו.</div>
        ) : (
          <div className="space-y-3">
            {filtered.map((r) => {
              const status = STATUS_MAP[r.status] || STATUS_OPTIONS[0];
              const isExpanded = expandedId === r.id;
              return (
                <div
                  key={r.id}
                  className={`card overflow-hidden ${
                    r.hasUnreadForAdmin ? "ring-2 ring-brand-rust" : ""
                  }`}
                >
                  <div className="p-4">
                    <div className="flex items-center justify-between gap-2 mb-2">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-bold text-brand-slatedark">
                          #{r.requestNumber}
                        </span>
                        <span className={`badge ${status.color} text-xs`}>
                          {status.label}
                        </span>
                        {r.hasUnreadForAdmin && (
                          <span className="text-xs bg-brand-rust text-white px-2 py-0.5 rounded-full font-bold">
                            💬 חדשה
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-zinc-500">
                        {new Date(r.createdAt).toLocaleDateString("he-IL")}
                      </div>
                    </div>

                    <div className="text-sm space-y-1">
                      <div>
                        <span className="text-zinc-500">לקוח:</span>{" "}
                        <strong>{r.customerName}</strong>
                      </div>
                      <div>
                        <span className="text-zinc-500">טלפון:</span>{" "}
                        <a href={`tel:${r.phone}`} className="text-blue-600 underline" dir="ltr">
                          {r.phone}
                        </a>
                      </div>
                      {r.notes && (
                        <div>
                          <span className="text-zinc-500">הערות:</span> {r.notes}
                        </div>
                      )}
                    </div>

                    <div className="mt-2">
                      <div className="text-xs font-bold text-zinc-500 mb-1">
                        פריטים ({r.items.length}):
                      </div>
                      <ul className="text-sm text-brand-slatedark">
                        {r.items.map((it, i) => (
                          <li key={i}>
                            • {it.productName} × {it.quantity}
                          </li>
                        ))}
                      </ul>
                    </div>

                    {/* שינוי סטטוס */}
                    <div className="mt-3 flex gap-2 items-center">
                      <span className="text-xs text-zinc-500 font-medium">סטטוס:</span>
                      <select
                        value={r.status}
                        onChange={(e) => changeStatus(r.id, e.target.value)}
                        disabled={updating === r.id}
                        className="text-sm px-2 py-1 border border-zinc-300 rounded-lg"
                      >
                        {STATUS_OPTIONS.map((s) => (
                          <option key={s.value} value={s.value}>
                            {s.label}
                          </option>
                        ))}
                      </select>
                      <button
                        onClick={() => setExpandedId(isExpanded ? null : r.id)}
                        className="mr-auto text-sm text-brand-rust font-medium"
                      >
                        {isExpanded ? "סגור צ׳אט ▲" : "פתח צ׳אט ▼"}
                      </button>
                    </div>
                  </div>

                  {isExpanded && (
                    <div className="border-t border-zinc-200 p-4 bg-zinc-50">
                      <PersonalRequestMessages
                        requestId={r.id}
                        currentUserType="ADMIN"
                        readOnly={r.status === "CANCELLED"}
                      />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
