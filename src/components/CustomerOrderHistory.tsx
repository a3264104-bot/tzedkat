"use client";

// היסטוריית ההזמנות בכרטיס הלקוח (מסך הלקוחות של המנהל).
//
// ⚠️ מקופל כברירת מחדל ונטען רק בפתיחה: רוב הפתיחות של הכרטיס הן
// לעריכה או להזמנה, ואין טעם למשוך 200 הזמנות בכל פעם.

import { useState } from "react";
import Link from "next/link";
import { fmt } from "@/lib/pricing";
import { payStatusLabel, payStatusColor } from "@/lib/pay-status-lib";

type Row = {
  id: string;
  orderNumber: number;
  createdAt: string;
  status: string;
  paymentStatus: string | null;
  source: string;
  estimatedTotal: number;
  finalTotal: number | null;
  amountPaid: number;
  delivered: boolean;
  pointName: string | null;
  saleName: string | null;
  itemCount: number;
};

type Data = {
  total: number;
  shown: number;
  activeCount: number;
  paidSum: number;
  debtBalance: number;
  creditBalance: number;
  orders: Row[];
};

// §24: אותן תוויות כמו ברשימת ההזמנות
const SOURCE_LABELS: Record<string, string> = {
  WEB: "אתר",
  PHONE: "טלפון",
  EXCEL: "אקסל",
  AGENT: "נציג",
  ADMIN: "מנהל",
  WALKIN: "מזדמן",
};

function stateOf(o: Row): { label: string; cls: string } {
  if (o.status === "CANCELLED") return { label: "בוטלה", cls: "bg-zinc-200 text-zinc-500" };
  if (o.delivered) return { label: "נמסרה", cls: "bg-green-100 text-green-700" };
  return { label: payStatusLabel(o.paymentStatus), cls: payStatusColor(o.paymentStatus) };
}

export function CustomerOrderHistory({
  customerId,
  orderCount,
}: {
  customerId: string;
  orderCount?: number;
}) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<Data | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function toggle() {
    const next = !open;
    setOpen(next);
    if (!next || data) return;
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/admin/customers/${customerId}/orders`, { cache: "no-store" });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || `שגיאה (${res.status})`);
      setData(d);
    } catch (e: any) {
      setError(e?.message || "שגיאה בטעינה");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="rounded-xl border border-zinc-200 bg-white overflow-hidden">
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        className="w-full flex items-center justify-between gap-2 px-3 py-2.5 text-sm font-bold text-brand-slatedark hover:bg-zinc-50 transition-colors"
      >
        <span>
          🧾 היסטוריית הזמנות
          {orderCount != null && (
            <span className="font-normal text-zinc-500"> · {orderCount}</span>
          )}
        </span>
        <svg
          className={`w-4 h-4 shrink-0 transition-transform ${open ? "rotate-180" : ""}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2.5}
          aria-hidden="true"
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <div className="border-t border-zinc-100">
          {loading && <p className="px-3 py-3 text-sm text-zinc-500">טוען...</p>}
          {error && <p className="px-3 py-3 text-sm text-red-600">{error}</p>}

          {data && (
            <>
              {/* סיכום */}
              <div className="px-3 py-2 bg-zinc-50 flex flex-wrap gap-x-4 gap-y-1 text-xs text-zinc-600">
                <span>
                  <b className="text-brand-slatedark tabular-nums">{data.activeCount}</b> הזמנות
                  {data.total !== data.activeCount && (
                    <span className="text-zinc-400"> ({data.total - data.activeCount} בוטלו)</span>
                  )}
                </span>
                <span>
                  שולם בסך הכל <b className="text-brand-slatedark tabular-nums">{fmt(data.paidSum)}</b>
                </span>
                {data.debtBalance > 0 && (
                  <span className="text-red-700 font-bold">חוב פתוח {fmt(data.debtBalance)}</span>
                )}
                {data.creditBalance > 0 && (
                  <span className="text-emerald-700 font-bold">יתרת זכות {fmt(data.creditBalance)}</span>
                )}
              </div>

              {data.orders.length === 0 ? (
                <p className="px-3 py-3 text-sm text-zinc-500">ללקוח עדיין אין הזמנות.</p>
              ) : (
                <ul className="divide-y divide-zinc-100 max-h-80 overflow-y-auto overscroll-contain">
                  {data.orders.map((o) => {
                    const st = stateOf(o);
                    const amount = o.finalTotal ?? o.estimatedTotal;
                    return (
                      <li key={o.id}>
                        <Link
                          href={`/admin/orders/${o.id}`}
                          className={`flex items-center justify-between gap-3 px-3 py-2.5 hover:bg-zinc-50 transition-colors ${
                            o.status === "CANCELLED" ? "opacity-60" : ""
                          }`}
                        >
                          <span className="min-w-0">
                            <span className="block text-sm font-bold text-brand-slatedark truncate">
                              {o.saleName ?? "ללא מכירה"}
                            </span>
                            <span className="block text-xs text-zinc-500 truncate">
                              #{o.orderNumber} ·{" "}
                              {new Date(o.createdAt).toLocaleDateString("he-IL", {
                                timeZone: "Asia/Jerusalem",
                              })}
                              {o.pointName && ` · ${o.pointName}`}
                              {o.source !== "WEB" && ` · ${SOURCE_LABELS[o.source] ?? o.source}`}
                            </span>
                          </span>
                          <span className="shrink-0 flex flex-col items-end gap-1">
                            <span className="text-sm font-bold tabular-nums text-brand-slatedark">
                              {o.finalTotal == null && <span className="text-xs font-normal text-zinc-400">משוער </span>}
                              {fmt(amount)}
                            </span>
                            <span className={`badge ${st.cls} whitespace-nowrap`}>{st.label}</span>
                          </span>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              )}
              {data.total > data.shown && (
                <p className="px-3 py-2 text-xs text-zinc-500 border-t border-zinc-100">
                  מוצגות {data.shown} ההזמנות האחרונות מתוך {data.total}.
                </p>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
