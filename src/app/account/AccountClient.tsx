"use client";

import { useState } from "react";
import Link from "next/link";
import { signOut } from "next-auth/react";
import { Logo } from "@/components/Logo";
import { STATUS_LABELS, PAYMENT_METHOD_LABELS, fmt } from "@/lib/pricing";

type Order = {
  id: string;
  orderNumber: number;
  status: string;
  paymentStatus: string;
  paymentMethod: string | null;
  paymentLink: string | null;
  pointName: string;
  deliveryDate: string | null;
  estimatedTotal: number;
  finalTotal: number | null;
  createdAt: string;
  itemCount: number;
};

type Point = { id: string; name: string; city: string | null };

type Customer = {
  name: string;
  phone: string | null;
  email: string | null;
  cardLast4: string | null;
  defaultPointId: string | null;
  defaultPointName: string | null;
};

const statusColors: Record<string, string> = {
  PENDING_REVIEW: "bg-zinc-100 text-zinc-600",
  FINAL_PRICE_SET: "bg-blue-100 text-blue-700",
  PAYMENT_PENDING: "bg-amber-100 text-amber-700",
  PAID: "bg-green-100 text-green-700",
  READY_FOR_PICKUP: "bg-violet-100 text-violet-700",
  COMPLETED: "bg-green-100 text-green-700",
  CANCELLED: "bg-red-100 text-red-600",
};

export function AccountClient({
  customer,
  orders,
  points,
  hasActiveSale,
}: {
  customer: Customer;
  orders: Order[];
  points: Point[];
  hasActiveSale: boolean;
}) {
  const [defaultPointId, setDefaultPointId] = useState(customer.defaultPointId ?? "");
  const [savingPoint, setSavingPoint] = useState(false);
  const [pointSaved, setPointSaved] = useState(false);
  const [showStationEdit, setShowStationEdit] = useState(false);

  async function saveStation() {
    setSavingPoint(true);
    setPointSaved(false);
    try {
      await fetch("/api/account", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ defaultPointId }),
      });
      setPointSaved(true);
      setShowStationEdit(false);
    } catch {
      // שקט - נסיון חוזר אפשרי
    } finally {
      setSavingPoint(false);
    }
  }

  return (
    <main dir="rtl" className="min-h-screen bg-[#faf6ec] pb-16">
      {/* header */}
      <header className="bg-brand-yellow border-b-4 border-brand-rust/20">
        <div className="mx-auto max-w-md px-4 py-3 flex items-center justify-between">
          <Link href="/" className="text-brand-slate text-sm font-medium">
            דף הבית
          </Link>
          <span className="font-extrabold text-brand-rust">האזור האישי</span>
        </div>
      </header>

      <div className="mx-auto max-w-md px-4 pt-6 space-y-5">
        {/* פרטי לקוח */}
        <div className="card p-5">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-lg font-extrabold text-brand-slatedark">{customer.name}</div>
              {customer.phone && <div className="text-sm text-zinc-500">{customer.phone}</div>}
              {customer.email && <div className="text-sm text-zinc-500">{customer.email}</div>}
              {customer.cardLast4 && (
                <div className="text-sm text-zinc-400 mt-1">
                  כרטיס: •••• {customer.cardLast4}
                </div>
              )}
            </div>
            <button
              onClick={() => signOut({ callbackUrl: "/" })}
              className="btn-ghost btn-sm"
            >
              יציאה
            </button>
          </div>
        </div>

        {/* תחנה שמורה */}
        <div className="card p-5">
          <div className="flex items-center justify-between mb-2">
            <span className="font-bold text-brand-slatedark">תחנת חלוקה שמורה</span>
            <button
              onClick={() => setShowStationEdit(!showStationEdit)}
              className="text-sm text-brand-rust font-medium"
            >
              {showStationEdit ? "ביטול" : "שינוי"}
            </button>
          </div>
          {!showStationEdit ? (
            <div className="text-sm text-zinc-600">
              {customer.defaultPointName || "לא נבחרה תחנה"}
              {pointSaved && <span className="text-green-600 mr-2">✓ נשמר</span>}
            </div>
          ) : (
            <div className="space-y-2">
              <select
                className="input"
                value={defaultPointId}
                onChange={(e) => setDefaultPointId(e.target.value)}
              >
                <option value="">בחר תחנה...</option>
                {points.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.city ? `${p.city} — ${p.name}` : p.name}
                  </option>
                ))}
              </select>
              <button
                onClick={saveStation}
                disabled={savingPoint}
                className="btn-primary w-full btn-sm"
              >
                {savingPoint ? "שומר..." : "שמירה"}
              </button>
            </div>
          )}
        </div>

        {/* כפתור הזמנה חדשה - רק אם יש מכירה פעילה */}
        {hasActiveSale && (
          <Link href="/order" className="btn-primary w-full block text-center">
            הזמנה חדשה ←
          </Link>
        )}

        {/* היסטוריית הזמנות */}
        <div>
          <h2 className="font-extrabold text-brand-slatedark mb-3">ההזמנות שלי</h2>
          {orders.length === 0 ? (
            <div className="card p-6 text-center text-zinc-500">
              עדיין אין הזמנות
            </div>
          ) : (
            <div className="space-y-3">
              {orders.map((o) => (
                <div key={o.id} className="card p-4">
                  <div className="flex justify-between items-start">
                    <div>
                      <div className="font-bold text-brand-slatedark">
                        הזמנה #{o.orderNumber}
                      </div>
                      <div className="text-xs text-zinc-400 mt-0.5">
                        {new Date(o.createdAt).toLocaleDateString("he-IL")} · {o.pointName}
                      </div>
                    </div>
                    <span
                      className={`badge ${statusColors[o.status] ?? "bg-zinc-100 text-zinc-600"}`}
                    >
                      {STATUS_LABELS[o.status] ?? o.status}
                    </span>
                  </div>

                  <div className="mt-3 flex justify-between items-center text-sm">
                    <span className="text-zinc-500">
                      {o.itemCount} פריטים
                      {o.deliveryDate && ` · חלוקה: ${o.deliveryDate}`}
                    </span>
                    <span className="font-bold text-brand-slatedark">
                      {o.finalTotal != null ? fmt(o.finalTotal) : `~${fmt(o.estimatedTotal)}`}
                    </span>
                  </div>

                  {/* כפתור תשלום - רק אם ממתין לתשלום ויש לינק */}
                  {o.status === "PAYMENT_PENDING" && o.paymentLink && (
                    <a
                      href={o.paymentLink}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="btn-primary w-full block text-center mt-3 btn-sm"
                    >
                      לתשלום {o.finalTotal != null ? fmt(o.finalTotal) : ""} ←
                    </a>
                  )}

                  {/* סטטוס תשלום אם שולם */}
                  {o.paymentStatus === "PAID" && (
                    <div className="mt-2 text-sm text-green-700 font-medium">
                      ✓ שולם
                      {o.paymentMethod && ` (${PAYMENT_METHOD_LABELS[o.paymentMethod] ?? ""})`}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
