"use client";

// §20: מסך הנציג למכירה - הזנת משקלים + מזדמנים + סיכום חי
// טאבים: הזמנות רשומות | מזדמנים | סיכום וסגירה

import { useEffect, useMemo, useState, useCallback } from "react";
import Link from "next/link";
import { OrderRow } from "./OrderRow";
import { WalkinList } from "./WalkinList";
import { SummaryPanel } from "./SummaryPanel";

type Product = {
  id: string;
  name: string;
  unit: string;
  cartonPrice: number;
  singlesMode: string;
  singleUnitPrice: number | null;
  singleSurcharge: number | null;
  avgWeightPerUnit: number | null;
  imageUrl: string | null;
};

export type OrderItem = {
  id: string;
  productId: string;
  productName: string;
  unit: string;
  isSingle: boolean;
  quantity: number;
  unitPrice: number;
  estimatedWeight: number | null;
  actualWeight: number | null;
  agentEnteredWeight: number | null;
  agentNote: string | null;
  isCancelled: boolean;
  originalProductId: string | null;
  product: Product;
};

export type Order = {
  id: string;
  orderNumber: number;
  customerName: string;
  phone: string;
  status: string;
  finalTotal: number | null;
  point: { id: string; name: string; city: string | null } | null;
  items: OrderItem[];
};

export type Walkin = {
  id: string;
  walkinNumber: number;
  customerName: string;
  customerPhone: string | null;
  paymentMethod: string;
  paymentReceived: boolean;
  paymentNote: string | null;
  totalAmount: number;
  notes: string | null;
  items: Array<{
    id: string;
    productId: string;
    productName: string;
    weight: number;
    unitPrice: number;
    isSingle: boolean;
    totalPrice: number;
  }>;
  createdAt: string;
};

export type AvailableProduct = {
  productId: string;
  price: number;
  product: {
    id: string;
    name: string;
    unit: string;
    categoryId: string;
    category: { name: string };
    cartonPrice: number;
    singlesMode: string;
    singleUnitPrice: number | null;
    singleSurcharge: number | null;
  };
};

export type SaleData = {
  pricelist: {
    id: string;
    name: string;
    status: string;
    deliveryDateText: string | null;
    editDeadline: string | null;
  };
  agent: {
    id: string;
    name: string;
    point: { id: string; name: string; city: string | null } | null;
    commissionRateCarton: number;
    commissionRateSingles: number;
  };
  orders: Order[];
  walkins: Walkin[];
  deliveryNotes: Array<{
    id: string;
    supplierName: string | null;
    noteNumber: string | null;
    confirmedAt: string;
    items: Array<{
      productId: string | null;
      productName: string;
      quantity: number;
      weight: number;
    }>;
  }>;
  productWeightsFromNotes: Record<string, number>;
  availableProducts: AvailableProduct[];
  summary: {
    id: string;
    status: string;
    totalCartonWeight: number;
    totalSinglesWeight: number;
    totalWalkinWeight: number;
    totalCustomers: number;
    totalWalkins: number;
    totalCommission: number;
    remainderNote: string | null;
    confirmedAt: string | null;
  };
};

type Tab = "orders" | "walkins" | "summary";

export function AgentSaleClient({ pricelistId }: { pricelistId: string }) {
  const [data, setData] = useState<SaleData | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>("orders");
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/agent/sale/${pricelistId}`, {
        cache: "no-store",
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "שגיאה בטעינה");
      setData(json);
      setError(null);
    } catch (e: any) {
      setError(e.message || "שגיאה");
    } finally {
      setLoading(false);
    }
  }, [pricelistId]);

  useEffect(() => {
    load();
  }, [load]);

  // חישוב חי של סיכומים (מעדכן מיד בזמן הקלדה - השרת מעדכן אח"כ)
  const liveSummary = useMemo(() => {
    if (!data) return null;
    const rateCarton = data.agent.commissionRateCarton;
    const rateSingles = data.agent.commissionRateSingles;

    let totalCartonWeight = 0;
    let totalSinglesWeight = 0;
    let customersServed = 0;

    for (const order of data.orders) {
      let hasData = false;
      for (const it of order.items) {
        if (it.isCancelled) continue;
        const w = it.agentEnteredWeight || 0;
        if (w > 0) {
          hasData = true;
          if (it.isSingle) totalSinglesWeight += w;
          else totalCartonWeight += w;
        }
      }
      if (hasData) customersServed++;
    }

    let walkinCarton = 0;
    let walkinSingles = 0;
    let walkinCash = 0;
    let walkinCard = 0;
    let walkinTransfer = 0;
    for (const w of data.walkins) {
      for (const it of w.items) {
        if (it.isSingle) walkinSingles += it.weight;
        else walkinCarton += it.weight;
      }
      if (w.paymentMethod === "CASH") walkinCash += w.totalAmount;
      else if (w.paymentMethod === "CARD_TERMINAL" || w.paymentMethod === "ONLINE")
        walkinCard += w.totalAmount;
      else if (w.paymentMethod === "TRANSFER") walkinTransfer += w.totalAmount;
    }

    const cartonCommission = (totalCartonWeight + walkinCarton) * rateCarton;
    const singlesCommission = (totalSinglesWeight + walkinSingles) * rateSingles;

    return {
      totalCartonWeight,
      totalSinglesWeight,
      totalWalkinCartonWeight: walkinCarton,
      totalWalkinSinglesWeight: walkinSingles,
      customersServed,
      walkinsCount: data.walkins.length,
      cartonCommission,
      singlesCommission,
      totalCommission: cartonCommission + singlesCommission,
      walkinCash,
      walkinCard,
      walkinTransfer,
    };
  }, [data]);

  // סינון הזמנות לפי חיפוש
  const filteredOrders = useMemo(() => {
    if (!data) return [];
    if (!filter.trim()) return data.orders;
    const q = filter.trim().toLowerCase();
    return data.orders.filter(
      (o) =>
        o.customerName.toLowerCase().includes(q) ||
        o.phone.includes(q) ||
        String(o.orderNumber).includes(q)
    );
  }, [data, filter]);

  const updateOrderItem = useCallback(
    (orderId: string, itemId: string, updates: Partial<OrderItem>) => {
      setData((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          orders: prev.orders.map((o) =>
            o.id === orderId
              ? {
                  ...o,
                  items: o.items.map((it) =>
                    it.id === itemId ? { ...it, ...updates } : it
                  ),
                }
              : o
          ),
        };
      });
    },
    []
  );

  if (loading) {
    return (
      <div dir="rtl" className="min-h-screen bg-brand-cream flex items-center justify-center">
        <div className="text-brand-slatedark">טוען...</div>
      </div>
    );
  }
  if (error || !data) {
    return (
      <div dir="rtl" className="min-h-screen bg-brand-cream flex items-center justify-center p-6">
        <div className="bg-white rounded-2xl p-6 text-center max-w-md shadow-lg">
          <p className="text-red-600 font-semibold">{error || "שגיאה בטעינה"}</p>
          <button
            onClick={load}
            className="mt-4 px-4 py-2 bg-brand-rust text-white rounded-lg font-medium"
          >
            נסה שוב
          </button>
        </div>
      </div>
    );
  }

  const isSealed = data.summary.status === "CONFIRMED";

  return (
    <div dir="rtl" className="min-h-screen bg-brand-cream pb-32">
      {/* Header */}
      <header className="bg-brand-yellow border-b-4 border-brand-rust/20 sticky top-0 z-30">
        <div className="mx-auto max-w-6xl px-4 py-2.5 flex items-center justify-between gap-2">
          <div className="flex items-center gap-3">
            <Link href="/agent" className="text-brand-slate font-medium text-sm">
              ← לרשימת המכירות
            </Link>
          </div>
          <div className="text-right">
            <div className="font-extrabold text-brand-slatedark text-sm">
              {data.pricelist.name}
            </div>
            {data.agent.point && (
              <div className="text-xs text-brand-slate">
                נקודה: {data.agent.point.name}
              </div>
            )}
          </div>
        </div>
      </header>

      {/* Sticky summary bar */}
      <div className="sticky top-[52px] z-20 bg-white border-b border-zinc-200 shadow-sm">
        <div className="mx-auto max-w-6xl px-4 py-3">
          <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
            <StatMini
              label='קרטונים ק"ג'
              value={liveSummary?.totalCartonWeight.toFixed(2) || "0"}
              color="rust"
            />
            <StatMini
              label='בודדים ק"ג'
              value={liveSummary?.totalSinglesWeight.toFixed(2) || "0"}
              color="amber"
            />
            <StatMini
              label="לקוחות"
              value={String(liveSummary?.customersServed || 0)}
              color="slate"
            />
            <StatMini
              label="מזדמנים"
              value={String(liveSummary?.walkinsCount || 0)}
              color="slate"
            />
            <StatMini
              label="עמלה סה״כ"
              value={"₪" + (liveSummary?.totalCommission.toFixed(2) || "0")}
              color="emerald"
              highlight
            />
          </div>

          {/* Tabs */}
          <div className="flex gap-1 mt-3 border-b border-zinc-100 -mb-3">
            <TabBtn active={tab === "orders"} onClick={() => setTab("orders")}>
              הזמנות ({data.orders.length})
            </TabBtn>
            <TabBtn active={tab === "walkins"} onClick={() => setTab("walkins")}>
              מזדמנים ({data.walkins.length})
            </TabBtn>
            <TabBtn active={tab === "summary"} onClick={() => setTab("summary")}>
              סיכום וסגירה
            </TabBtn>
          </div>
        </div>
      </div>

      {/* Main content */}
      <main className="mx-auto max-w-6xl px-4 py-5">
        {isSealed && (
          <div className="mb-4 bg-emerald-50 border border-emerald-200 rounded-xl p-4 flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-emerald-500 flex items-center justify-center shrink-0">
              <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <div>
              <div className="font-bold text-emerald-800">המכירה נסגרה</div>
              <div className="text-xs text-emerald-700">
                לצפייה בלבד. לפניה למנהל לשינויים.
              </div>
            </div>
          </div>
        )}

        {tab === "orders" && (
          <div className="space-y-3">
            {/* Search */}
            <div className="bg-white rounded-xl border border-zinc-200 shadow-sm p-3">
              <input
                type="text"
                placeholder="חיפוש לפי שם, טלפון, מספר הזמנה..."
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                className="w-full px-3 py-2 border border-zinc-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-rust"
              />
            </div>
            {filteredOrders.length === 0 ? (
              <div className="bg-white rounded-2xl border border-zinc-200 p-8 text-center text-zinc-500">
                {filter ? "לא נמצאו הזמנות מתאימות לחיפוש" : "אין הזמנות במכירה זו"}
              </div>
            ) : (
              filteredOrders.map((order) => (
                <OrderRow
                  key={order.id}
                  order={order}
                  availableProducts={data.availableProducts}
                  readOnly={isSealed}
                  onItemUpdate={(itemId, updates) =>
                    updateOrderItem(order.id, itemId, updates)
                  }
                  onNeedsReload={load}
                />
              ))
            )}
          </div>
        )}

        {tab === "walkins" && (
          <WalkinList
            pricelistId={pricelistId}
            walkins={data.walkins}
            availableProducts={data.availableProducts}
            readOnly={isSealed}
            onChange={load}
          />
        )}

        {tab === "summary" && liveSummary && (
          <SummaryPanel
            pricelistId={pricelistId}
            summary={data.summary}
            liveSummary={liveSummary}
            deliveryNotes={data.deliveryNotes}
            productWeightsFromNotes={data.productWeightsFromNotes}
            orders={data.orders}
            walkins={data.walkins}
            commissionRateCarton={data.agent.commissionRateCarton}
            commissionRateSingles={data.agent.commissionRateSingles}
            readOnly={isSealed}
            onChange={load}
          />
        )}
      </main>
    </div>
  );
}

function StatMini({
  label,
  value,
  color,
  highlight,
}: {
  label: string;
  value: string;
  color: "rust" | "amber" | "slate" | "emerald";
  highlight?: boolean;
}) {
  const colorMap = {
    rust: "bg-orange-50 text-brand-rust border-orange-200",
    amber: "bg-amber-50 text-amber-800 border-amber-200",
    slate: "bg-zinc-50 text-brand-slatedark border-zinc-200",
    emerald: "bg-emerald-50 text-emerald-700 border-emerald-200",
  }[color];
  return (
    <div
      className={`rounded-lg border p-2 ${colorMap} ${
        highlight ? "ring-2 ring-emerald-300 shadow-sm" : ""
      }`}
    >
      <div className="text-[10px] font-medium opacity-80">{label}</div>
      <div className={`font-extrabold ${highlight ? "text-lg" : "text-sm"}`}>{value}</div>
    </div>
  );
}

function TabBtn({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`px-4 py-2 text-sm font-bold rounded-t-lg transition-colors ${
        active
          ? "bg-brand-rust text-white shadow-sm"
          : "text-brand-slate hover:bg-zinc-50"
      }`}
    >
      {children}
    </button>
  );
}
