"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type MissingItem = {
  id: string;
  productName: string;
  unit: string;
  isSingle: boolean;
  quantity: number;
  estimatedWeight: number | null;
};

type PendingOrder = {
  id: string;
  orderNumber: number;
  customerName: string;
  phone: string;
  status: string;
  estimatedTotal: number | null;
  pointName: string | null;
  deliveryDate: string | null;
  createdAt: string;
  missingItems: MissingItem[];
  missingCount: number;
};

type ApiResponse = {
  orders: PendingOrder[];
  ordersCount: number;
  totalMissingItems: number;
};

function fmtDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString("he-IL", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    });
  } catch {
    return iso;
  }
}

function fmtIls(n: number | null): string {
  if (n === null) return "—";
  return `${n.toFixed(2)} ₪`;
}

export default function PendingWeightsPage() {
  const [data, setData] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/pending-weights", { cache: "no-store" });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        setError(err.error || `שגיאה ${res.status}`);
        return;
      }
      const json = await res.json();
      setData(json);
    } catch (e: any) {
      setError(`שגיאת רשת: ${e.message || "לא ידוע"}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto">
      {/* כותרת */}
      <div className="flex flex-wrap items-center justify-between gap-4 mb-4">
        <div>
          <h1 className="text-2xl font-bold text-brand-slatedark">⚖️ משקלים ממתינים</h1>
          <p className="text-sm text-zinc-500 mt-1">
            הזמנות שיש בהן מוצרים שעדיין לא הוזן להם משקל בפועל
          </p>
        </div>
        <button
          onClick={fetchData}
          className="px-3 py-2 bg-white border border-zinc-300 rounded-lg text-sm hover:bg-zinc-50"
          disabled={loading}
        >
          🔄 רענן
        </button>
      </div>

      {/* טעינה */}
      {loading && <div className="text-center py-12 text-zinc-500">טוען...</div>}

      {/* שגיאה */}
      {error && (
        <div className="bg-red-50 text-red-800 border border-red-200 rounded-lg p-4 mb-4 text-sm">
          שגיאה: {error}
        </div>
      )}

      {/* מצב ריק - כל המשקלים הוזנו! */}
      {!loading && !error && data && data.ordersCount === 0 && (
        <div className="text-center py-16 bg-emerald-50 border border-emerald-200 rounded-xl">
          <div className="text-5xl mb-3" aria-hidden="true">
            ✅
          </div>
          <div className="text-emerald-800 font-bold text-lg">כל המשקלים הוזנו!</div>
          <div className="text-emerald-700 text-sm mt-1">אין הזמנות שממתינות לשקילה</div>
        </div>
      )}

      {/* יש רשימה */}
      {!loading && !error && data && data.ordersCount > 0 && (
        <>
          {/* סיכום */}
          <div className="bg-amber-50 border border-amber-300 rounded-xl p-4 mb-4 flex items-center gap-3">
            <span className="text-3xl" aria-hidden="true">
              ⚠️
            </span>
            <div>
              <div className="font-bold text-amber-900">
                חסרים משקלים ל-{data.totalMissingItems} מוצרים
              </div>
              <div className="text-sm text-amber-800">
                ב-{data.ordersCount}{" "}
                {data.ordersCount === 1 ? "הזמנה" : "הזמנות"} פעילות
              </div>
            </div>
          </div>

          {/* רשימת הזמנות */}
          <div className="space-y-3">
            {data.orders.map((order) => (
              <OrderCard key={order.id} order={order} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function OrderCard({ order }: { order: PendingOrder }) {
  return (
    <div className="bg-white rounded-xl border border-zinc-200 p-4 shadow-sm">
      {/* שורה עליונה */}
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <div className="flex items-center gap-3">
          <span className="text-lg font-bold text-brand-slatedark">
            #{order.orderNumber}
          </span>
          <span className="bg-amber-100 text-amber-800 px-2.5 py-1 rounded-full text-xs font-medium">
            {order.missingCount} {order.missingCount === 1 ? "פריט" : "פריטים"} ללא משקל
          </span>
        </div>
        <Link
          href={`/admin/orders/${order.id}`}
          className="text-sm bg-brand-rust text-white px-4 py-2 rounded-lg hover:opacity-90 font-medium"
        >
          פתח הזמנה להזנת משקלים ←
        </Link>
      </div>

      {/* פרטי הזמנה */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-2 text-sm mb-3">
        <div>
          <span className="text-zinc-500">לקוח:</span>{" "}
          <span className="font-medium">{order.customerName}</span>
        </div>
        <div>
          <span className="text-zinc-500">טלפון:</span>{" "}
          <span dir="ltr">{order.phone}</span>
        </div>
        <div>
          <span className="text-zinc-500">סכום משוער:</span>{" "}
          <span>{fmtIls(order.estimatedTotal)}</span>
        </div>
        {order.pointName && (
          <div>
            <span className="text-zinc-500">נקודה:</span> {order.pointName}
          </div>
        )}
        {order.deliveryDate && (
          <div>
            <span className="text-zinc-500">חלוקה:</span> {order.deliveryDate}
          </div>
        )}
        <div>
          <span className="text-zinc-500">נוצר:</span> {fmtDate(order.createdAt)}
        </div>
      </div>

      {/* פריטים ללא משקל - מודגשים */}
      <div className="mt-3 pt-3 border-t border-zinc-100">
        <div className="text-xs text-zinc-500 mb-2 font-medium">פריטים שממתינים לשקילה:</div>
        <div className="space-y-1.5">
          {order.missingItems.map((item) => (
            <div
              key={item.id}
              className="flex items-center justify-between gap-3 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2"
            >
              <div className="font-medium text-amber-900">
                {item.productName}
                {item.isSingle && (
                  <span className="mr-2 text-xs bg-amber-200 text-amber-800 px-2 py-0.5 rounded">
                    בודדים
                  </span>
                )}
              </div>
              <div className="text-sm text-amber-800 whitespace-nowrap">
                {item.quantity} {item.unit}
                {item.estimatedWeight && (
                  <span className="text-xs text-zinc-500 mr-2">
                    (משוער: {item.estimatedWeight.toFixed(1)} ק"ג)
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
