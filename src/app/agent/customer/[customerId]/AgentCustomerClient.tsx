"use client";

import { useState } from "react";
import Link from "next/link";
import { STATUS_LABELS, fmt } from "@/lib/pricing";

type Item = {
  id: string;
  productName: string;
  unit: string;
  quantity: number;
  estimatedPrice: number;
  estimatedWeight: number | null;
  actualWeight: number | null;
  finalWeight: number | null;
  finalPrice: number | null;
  unitPrice: number;
};
type Order = {
  id: string;
  orderNumber: number;
  status: string;
  paymentStatus: string;
  pointName: string;
  createdAt: string;
  estimatedTotal: number;
  finalTotal: number | null;
  items: Item[];
};

export function AgentCustomerClient({
  customerName,
  customerPhone,
  orders: initialOrders,
  canSetFinalPrice,
  canSendPaymentLink,
}: {
  customerName: string;
  customerPhone: string | null;
  orders: Order[];
  canSetFinalPrice: boolean;
  canSendPaymentLink: boolean;
}) {
  const [orders, setOrders] = useState(initialOrders);
  const [openId, setOpenId] = useState<string | null>(null);
  // משקלים בעריכה: { [itemId]: value }
  const [weights, setWeights] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");

  function setWeight(itemId: string, value: string) {
    setWeights((w) => ({ ...w, [itemId]: value }));
  }

  async function saveOrder(order: Order, setFinal: boolean) {
    setSaving(true);
    setMsg("");
    try {
      const items = order.items.map((it) => ({
        id: it.id,
        actualWeight: weights[it.id] ?? (it.actualWeight != null ? String(it.actualWeight) : ""),
      }));
      const res = await fetch(`/api/agent/orders/${order.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items, setFinalPrice: setFinal }),
      });
      const data = await res.json();
      if (!res.ok) {
        setMsg(data.error || "שגיאה");
        return;
      }
      // עדכון מקומי
      setOrders((prev) =>
        prev.map((o) =>
          o.id === order.id
            ? {
                ...o,
                status: data.status ?? o.status,
                paymentStatus: data.paymentStatus ?? o.paymentStatus,
                finalTotal: data.finalTotal != null ? Number(data.finalTotal) : o.finalTotal,
                items: data.items
                  ? data.items.map((it: any) => ({
                      id: it.id,
                      productName: it.productName,
                      unit: it.unit,
                      quantity: Number(it.quantity),
                      estimatedPrice: Number(it.estimatedPrice),
                      actualWeight: it.actualWeight != null ? Number(it.actualWeight) : null,
                      finalWeight: it.finalWeight != null ? Number(it.finalWeight) : null,
                      finalPrice: it.finalPrice != null ? Number(it.finalPrice) : null,
                      unitPrice: Number(it.unitPrice),
                    }))
                  : o.items,
              }
            : o
        )
      );
      setMsg(
        setFinal
          ? canSendPaymentLink
            ? "המחיר הסופי נקבע ולינק התשלום נשלח ללקוח"
            : "המחיר הסופי נקבע. שליחת לינק התשלום תתבצע ע\"י המנהל."
          : "המשקלים נשמרו"
      );
    } catch {
      setMsg("שגיאת שרת");
    } finally {
      setSaving(false);
    }
  }

  return (
    <main dir="rtl" className="min-h-screen bg-[#faf6ec] pb-16">
      <header className="bg-brand-slatedark text-white">
        <div className="mx-auto max-w-lg px-4 py-3 flex items-center justify-between">
          <Link href="/agent" className="text-sm text-zinc-300">
            ← חזרה
          </Link>
          <div className="text-center">
            <div className="font-extrabold text-brand-yellow">{customerName}</div>
            {customerPhone && <div className="text-xs text-zinc-400">{customerPhone}</div>}
          </div>
          <Link href={`/agent/order/${orders[0]?.id ? "" : ""}`} className="text-sm invisible">
            .
          </Link>
        </div>
      </header>

      <div className="mx-auto max-w-lg px-4 pt-5 space-y-3">
        {msg && (
          <div className="card p-3 bg-green-50 border-green-200 text-sm text-green-800 font-medium">
            {msg}
          </div>
        )}

        {orders.length === 0 ? (
          <div className="card p-6 text-center text-zinc-500">אין הזמנות ללקוח זה</div>
        ) : (
          orders.map((o) => (
            <div key={o.id} className="card p-4">
              <button
                onClick={() => setOpenId(openId === o.id ? null : o.id)}
                className="w-full flex justify-between items-center text-right"
              >
                <div>
                  <div className="font-bold text-brand-slatedark">הזמנה #{o.orderNumber}</div>
                  <div className="text-xs text-zinc-400">
                    {new Date(o.createdAt).toLocaleDateString("he-IL")} · {o.pointName}
                  </div>
                </div>
                <div className="text-left">
                  <span className="badge bg-zinc-100 text-zinc-600">
                    {STATUS_LABELS[o.status] ?? o.status}
                  </span>
                  <div className="text-sm font-bold text-brand-rust mt-1">
                    {o.finalTotal != null ? fmt(o.finalTotal) : `~${fmt(o.estimatedTotal)}`}
                  </div>
                </div>
              </button>

              {openId === o.id && (
                <div className="mt-4 border-t pt-3 space-y-2">
                  {o.items.map((it) => (
                    <div key={it.id} className="flex items-center justify-between gap-2">
                      <div className="flex-1">
                        <div className="text-sm font-medium text-brand-slatedark">
                          {it.productName}
                        </div>
                        <div className="text-xs text-zinc-400">
                          {it.quantity} {it.unit} · {fmt(it.unitPrice)}/{it.unit}
                          {it.estimatedWeight != null && (
                            <span className="text-amber-600"> · משוער: {it.estimatedWeight} ק"ג</span>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-1">
                        <input
                          type="number"
                          step="0.1"
                          className="input w-20 text-center py-1"
                          placeholder="משקל"
                          value={
                            weights[it.id] ??
                            (it.actualWeight != null ? String(it.actualWeight) : "")
                          }
                          onChange={(e) => setWeight(it.id, e.target.value)}
                        />
                        <span className="text-xs text-zinc-400">ק"ג</span>
                      </div>
                    </div>
                  ))}

                  <div className="flex gap-2 pt-3">
                    <button
                      onClick={() => saveOrder(o, false)}
                      disabled={saving}
                      className="btn-ghost btn-sm flex-1"
                    >
                      {saving ? "שומר..." : "שמירת משקלים"}
                    </button>
                    {canSetFinalPrice && (
                      <button
                        onClick={() => saveOrder(o, true)}
                        disabled={saving}
                        className="btn-primary btn-sm flex-1"
                      >
                        {canSendPaymentLink ? "מחיר סופי + לינק תשלום" : "קביעת מחיר סופי"}
                      </button>
                    )}
                  </div>
                  {!canSetFinalPrice && (
                    <p className="text-xs text-zinc-400 text-center">
                      קביעת מחיר סופי מתבצעת ע"י המנהל
                    </p>
                  )}
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </main>
  );
}
