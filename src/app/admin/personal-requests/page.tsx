"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/client";

type Request = {
  id: string;
  requestNumber: number;
  customerName: string;
  phone: string;
  email: string | null;
  notes: string | null;
  status: string;
  createdAt: string;
  items: { productName: string; quantity: number }[];
};

const STATUS_LABELS: Record<string, string> = {
  NEW: "חדשה",
  IN_PROGRESS: "בטיפול",
  CONTACTED: "נוצר קשר",
  WAITING: "ממתין ללקוח",
  DONE: "הושלמה",
  CANCELLED: "בוטלה",
};

const STATUS_COLORS: Record<string, string> = {
  NEW: "bg-red-100 text-red-700",
  IN_PROGRESS: "bg-amber-100 text-amber-700",
  CONTACTED: "bg-blue-100 text-blue-700",
  WAITING: "bg-violet-100 text-violet-700",
  DONE: "bg-green-100 text-green-700",
  CANCELLED: "bg-zinc-200 text-zinc-600",
};

export default function PersonalRequestsPage() {
  const [requests, setRequests] = useState<Request[]>([]);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    setRequests(await api("/api/admin/personal-requests"));
    setLoading(false);
  }
  useEffect(() => {
    load();
  }, []);

  async function updateStatus(id: string, status: string) {
    await api("/api/admin/personal-requests", {
      method: "PATCH",
      body: JSON.stringify({ id, status }),
    });
    load();
  }

  function waLink(r: Request) {
    const phone = r.phone.replace(/\D/g, "").replace(/^0/, "972");
    const text = encodeURIComponent(
      `שלום ${r.customerName}, לגבי בקשת ההזמנה האישית שלך (#${r.requestNumber})...`
    );
    return `https://wa.me/${phone}?text=${text}`;
  }

  const newCount = requests.filter((r) => r.status === "NEW").length;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-extrabold text-brand-slatedark">בקשות הזמנה אישית</h1>
        <p className="text-sm text-zinc-500">
          {newCount > 0 ? `${newCount} בקשות חדשות ממתינות לטיפול` : "ניהול בקשות ההזמנה האישית"}
        </p>
      </div>

      {loading ? (
        <p className="text-zinc-500">טוען...</p>
      ) : requests.length === 0 ? (
        <div className="card p-6 text-center text-zinc-500">אין עדיין בקשות</div>
      ) : (
        <div className="space-y-3">
          {requests.map((r) => (
            <div key={r.id} className="card p-4">
              <div className="flex flex-wrap justify-between items-start gap-2">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-brand-slatedark">#{r.requestNumber}</span>
                    <span className={`badge ${STATUS_COLORS[r.status]}`}>
                      {STATUS_LABELS[r.status]}
                    </span>
                  </div>
                  <div className="text-sm text-brand-slatedark font-medium mt-1">
                    {r.customerName}
                  </div>
                  <div className="text-xs text-zinc-500" dir="ltr">
                    {r.phone}
                    {r.email && ` · ${r.email}`}
                  </div>
                </div>
                <div className="flex gap-1">
                  {r.phone && (
                    <a
                      href={waLink(r)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="btn-ghost btn-sm"
                    >
                      💬 וואטסאפ
                    </a>
                  )}
                </div>
              </div>

              <div className="mt-2 text-sm text-zinc-600">
                {r.items.map((it) => `${it.productName} × ${it.quantity}`).join(" · ")}
              </div>
              {r.notes && (
                <div className="mt-1 text-xs text-zinc-500 bg-zinc-50 rounded p-2">
                  הערה: {r.notes}
                </div>
              )}

              <div className="mt-3 flex items-center gap-2">
                <span className="text-xs text-zinc-400">עדכון סטטוס:</span>
                <select
                  value={r.status}
                  onChange={(e) => updateStatus(r.id, e.target.value)}
                  className="input py-1 text-sm w-auto"
                >
                  {Object.entries(STATUS_LABELS).map(([v, l]) => (
                    <option key={v} value={v}>
                      {l}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
