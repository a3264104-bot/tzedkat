"use client";

// §20: מסך מפורט של פעילות נציג במכירה + כפתור איפוס סיסמא
// - כל פרטי הנציג (כולל טלפון + אימייל)
// - כפתור לאיפוס סיסמא
// - כל ההזמנות שהוא טיפל בהן
// - כל המזדמנים שהוא הזין
// - סיכום כספי + עמלות + היסטוריית תשלומים
//
// §43: פירוט לפי נקודת חלוקה - נציג יכול להיות משויך לכמה נקודות,
// והמנהל צריך לראות כמה כל נקודה הניבה כדי להתחשבן איתו לפי נקודה.

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";

type Data = {
  agent: {
    id: string;
    name: string;
    phone: string | null;
    email: string | null;
    point: { id: string; name: string; city: string | null } | null;
    commissionRateCarton: number;
    commissionRateSingles: number;
  };
  pricelist: {
    id: string;
    name: string;
    status: string;
    deliveryDate: string | null;
    deliveryDateText: string | null;
  };
  stats: {
    totalOrders: number;
    totalWalkins: number;
    itemsTotal: number;
    itemsEntered: number;
    itemsCancelled: number;
    totalOrderRevenue: number;
    walkinRevenue: number;
    walkinCash: number;
    totalRevenue: number;
  };
  orders: Array<{
    id: string;
    orderNumber: number;
    customerName: string;
    phone: string;
    status: string;
    finalTotal: number | null;
    point: { id: string; name: string } | null;
    createdAt: string;
    items: Array<{
      id: string;
      productName: string;
      unit: string;
      isSingle: boolean;
      quantity: number;
      unitPrice: number;
      estimatedWeight: number | null;
      actualWeight: number | null;
      agentEnteredWeight: number | null;
      finalPrice: number | null;
      agentNote: string | null;
      isCancelled: boolean;
      originalProductId: string | null;
    }>;
  }>;
  walkins: Array<{
    id: string;
    walkinNumber: number;
    // §44: שיוך לנקודת חלוקה - נדרש לפירוט העמלות
    pointId?: string | null;
    pointName?: string | null;
    customerName: string;
    customerPhone: string | null;
    customerEmail: string | null;
    paymentMethod: string;
    paymentReceived: boolean;
    paymentNote: string | null;
    totalAmount: number;
    notes: string | null;
    summarySentAt: string | null;
    createdAt: string;
    items: Array<{
      id: string;
      productName: string;
      weight: number;
      unitPrice: number;
      totalPrice: number;
      isSingle: boolean;
    }>;
  }>;
  summary: {
    status: string;
    totalCartonWeight: number;
    totalSinglesWeight: number;
    totalWalkinWeight: number;
    totalCommission: number;
    cartonCommission: number;
    singlesCommission: number;
    remainderNote: string | null;
    confirmedAt: string | null;
  } | null;
  payments: Array<{
    id: string;
    amount: number;
    type: string;
    method: string | null;
    note: string | null;
    createdAt: string;
  }>;
};

const PAYMENT_LABELS: Record<string, string> = {
  CASH: "מזומן",
  CARD_TERMINAL: "אשראי במסוף",
  TRANSFER: "העברה בנקאית",
  ONLINE: "אשראי אונליין",
};

const PAYMENT_ICONS: Record<string, string> = {
  CASH: "💵",
  CARD_TERMINAL: "💳",
  TRANSFER: "🏦",
  ONLINE: "🌐",
};

export default function AgentSaleDetailClient({
  id,
  pricelistId,
}: {
  id: string;
  pricelistId: string;
}) {
  const [data, setData] = useState<Data | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<"orders" | "walkins" | "payments">("orders");
  const [resetResult, setResetResult] = useState<{
    newPassword: string;
    identifier: string;
  } | null>(null);
  const [resetting, setResetting] = useState(false);
  // §43: סינון לפי נקודה - כשנציג עובד בכמה נקודות, המנהל צריך
  // לבחון כל אחת בנפרד
  const [filterPoint, setFilterPoint] = useState("");

  const load = useCallback(async () => {
    if (!pricelistId) {
      setError("חסר pricelistId ב-URL");
      setLoading(false);
      return;
    }
    try {
      const res = await fetch(
        `/api/admin/agents/${id}/sale-detail?pricelistId=${pricelistId}`,
        { cache: "no-store" }
      );
      const json = await res.json();
      if (!res.ok) throw new Error(json.error);
      setData(json);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [id, pricelistId]);

  useEffect(() => {
    load();
  }, [load]);

  async function resetPassword() {
    if (
      !confirm(
        "לאפס את הסיסמא של הנציג? הסיסמא הישנה תבוטל והוא יצטרך להתחבר מחדש."
      )
    )
      return;
    setResetting(true);
    try {
      const res = await fetch(`/api/admin/agents/${id}/reset-password`, {
        method: "POST",
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error);
      setResetResult({
        newPassword: json.newPassword,
        identifier: json.agent.phone || json.agent.email || "—",
      });
    } catch (e: any) {
      alert("שגיאה: " + e.message);
    } finally {
      setResetting(false);
    }
  }

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
        <div className="bg-white rounded-2xl p-8 shadow-lg text-center max-w-md">
          <p className="text-red-600 font-semibold">{error || "שגיאה"}</p>
          <Link
            href="/admin"
            className="mt-4 inline-block px-4 py-2 bg-brand-rust text-white rounded-lg font-bold"
          >
            חזרה
          </Link>
        </div>
      </div>
    );
  }

  const { agent, pricelist, stats, orders, walkins, summary, payments } = data;

  // §43: הנקודות שיש להן פעילות. נגזר מההזמנות והמזדמנים בפועל ולא
  // משדה agent.point, שהוא השדה הישן ומחזיק נקודה אחת בלבד.
  const pointsInSale = collectPoints(orders, walkins);
  const shownOrders = filterPoint
    ? orders.filter((o) => o.point?.id === filterPoint)
    : orders;
  const shownWalkins = filterPoint
    ? walkins.filter((w) => (w.pointId ?? "__none__") === filterPoint)
    : walkins;

  return (
    <div dir="rtl" className="min-h-screen bg-brand-cream pb-20">
      <header className="bg-brand-yellow border-b-4 border-brand-rust/20 sticky top-0 z-30">
        <div className="mx-auto max-w-6xl px-4 py-3 flex items-center justify-between">
          <Link
            href={`/admin/sale-control/${pricelistId}`}
            className="text-brand-slate font-medium text-sm"
          >
            ← בקרת מכירה
          </Link>
          <div className="text-right">
            <h1 className="font-extrabold text-brand-slatedark">
              👤 פעילות נציג
            </h1>
            <div className="text-xs text-brand-slate mt-0.5">
              {pricelist.name}
            </div>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-5 space-y-4">
        {/* פרטי הנציג + כפתור איפוס */}
        <div className="bg-white rounded-2xl border border-zinc-200 shadow-sm p-5">
          <div className="flex items-start gap-4 flex-wrap">
            <div className="w-16 h-16 rounded-full bg-gradient-to-br from-brand-rust to-[#a83a15] flex items-center justify-center text-white text-2xl font-extrabold shadow-md shrink-0">
              {agent.name.charAt(0)}
            </div>
            <div className="flex-1 min-w-0">
              <div className="font-extrabold text-brand-slatedark text-lg">
                {agent.name}
              </div>
              <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm">
                {agent.phone && (
                  <div className="flex items-center gap-2">
                    <span className="text-zinc-500">📞</span>
                    <a
                      href={`tel:${agent.phone}`}
                      className="text-brand-rust font-mono hover:underline"
                      dir="ltr"
                    >
                      {agent.phone}
                    </a>
                    <span className="text-[10px] text-zinc-400">(שם משתמש)</span>
                  </div>
                )}
                {agent.email && (
                  <div className="flex items-center gap-2">
                    <span className="text-zinc-500">📧</span>
                    <a
                      href={`mailto:${agent.email}`}
                      className="text-brand-rust hover:underline"
                      dir="ltr"
                    >
                      {agent.email}
                    </a>
                  </div>
                )}
                {/* §43: כל הנקודות שבהן פעל, ולא רק agent.point היחיד */}
                {pointsInSale.length > 0 ? (
                  <div className="flex items-start gap-2">
                    <span className="text-zinc-500">📍</span>
                    <div className="flex flex-wrap gap-1">
                      {pointsInSale.map((p) => (
                        <span
                          key={p.id}
                          className="text-brand-slatedark font-medium bg-zinc-100 rounded px-1.5 py-0.5 text-xs"
                        >
                          {p.name}
                        </span>
                      ))}
                    </div>
                  </div>
                ) : (
                  agent.point && (
                    <div className="flex items-center gap-2">
                      <span className="text-zinc-500">📍</span>
                      <span className="text-brand-slatedark font-medium">
                        {agent.point.name}
                        {agent.point.city && ` — ${agent.point.city}`}
                      </span>
                    </div>
                  )
                )}
                <div className="flex items-center gap-2 text-xs">
                  <span className="text-zinc-500">💰</span>
                  <span className="text-brand-slate">
                    ₪{agent.commissionRateCarton.toFixed(0)} קרטונים · ₪
                    {agent.commissionRateSingles.toFixed(0)} בודדים
                  </span>
                </div>
              </div>
            </div>
            <button
              onClick={resetPassword}
              disabled={resetting}
              className="px-4 py-2 bg-amber-500 text-white rounded-lg font-bold text-sm hover:bg-amber-600 shadow-sm disabled:opacity-50 whitespace-nowrap"
            >
              {resetting ? "מאפס..." : "🔑 אפס סיסמא"}
            </button>
          </div>

          {/* תוצאת איפוס סיסמא */}
          {resetResult && (
            <div className="mt-4 bg-amber-50 border-2 border-amber-400 rounded-xl p-4">
              <div className="font-bold text-amber-900 mb-2">
                ⚠️ הסיסמא החדשה — שמור עכשיו!
              </div>
              <div className="text-xs text-amber-700 mb-3">
                הסיסמא לא תוצג שוב. אחרי סגירה זה יהיה בלתי אפשרי להציג אותה.
              </div>
              <div className="bg-white rounded-lg p-3 border border-amber-300 space-y-2">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <span className="text-xs font-bold text-zinc-500">שם משתמש:</span>
                  <span
                    className="font-mono text-brand-slatedark font-bold select-all"
                    dir="ltr"
                  >
                    {resetResult.identifier}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <span className="text-xs font-bold text-zinc-500">סיסמא חדשה:</span>
                  <span
                    className="font-mono text-brand-rust font-bold text-lg select-all bg-yellow-100 px-3 py-1 rounded"
                    dir="ltr"
                  >
                    {resetResult.newPassword}
                  </span>
                </div>
              </div>
              <div className="mt-3 flex gap-2 flex-wrap">
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(
                      `שם משתמש: ${resetResult.identifier}\nסיסמא: ${resetResult.newPassword}`
                    );
                    alert("הועתק ללוח!");
                  }}
                  className="text-xs px-3 py-1.5 bg-amber-600 text-white hover:bg-amber-700 rounded font-bold"
                >
                  📋 העתק
                </button>
                <button
                  onClick={() => setResetResult(null)}
                  className="text-xs px-3 py-1.5 bg-zinc-100 text-zinc-700 hover:bg-zinc-200 rounded font-medium"
                >
                  סגור
                </button>
              </div>
            </div>
          )}
        </div>

        {/* סטטיסטיקות */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <StatCard
            label="הזמנות"
            value={String(stats.totalOrders)}
            subtitle={`${stats.itemsEntered}/${stats.itemsTotal} פריטים הוזנו`}
            color="rust"
          />
          <StatCard
            label="מזדמנים"
            value={String(stats.totalWalkins)}
            subtitle={`₪${stats.walkinRevenue.toFixed(2)}`}
            color="purple"
          />
          <StatCard
            label="הכנסה סה״כ"
            value={`₪${stats.totalRevenue.toFixed(2)}`}
            color="emerald"
          />
          <StatCard
            label="עמלה"
            value={summary ? `₪${summary.totalCommission.toFixed(2)}` : "—"}
            subtitle={summary?.status === "CONFIRMED" ? "✓ נסגרה" : "פתוחה"}
            color="amber"
          />
        </div>

        {/* §43: פירוט לפי נקודת חלוקה */}
        <PointBreakdown
          orders={orders}
          walkins={walkins}
          rateCarton={agent.commissionRateCarton}
          rateSingles={agent.commissionRateSingles}
        />

        {/* מזומן שאסף (אם רלוונטי) */}
        {stats.walkinCash > 0 && (
          <div className="bg-amber-50 border border-amber-300 rounded-xl p-3 flex items-center gap-3">
            <div className="text-2xl">💵</div>
            <div className="flex-1">
              <div className="font-bold text-amber-900">
                אסף מזומן: ₪{stats.walkinCash.toFixed(2)}
              </div>
              <div className="text-xs text-amber-700">
                מ-{walkins.filter((w) => w.paymentMethod === "CASH" && w.paymentReceived).length}{" "}
                מזדמנים
              </div>
            </div>
          </div>
        )}

        {/* §43: בורר נקודה לרשימות - מוצג רק כשיש יותר מאחת */}
        {pointsInSale.length > 1 && (
          <div className="bg-white rounded-xl border border-zinc-200 p-3 flex gap-1.5 flex-wrap">
            <PointChip
              active={filterPoint === ""}
              onClick={() => setFilterPoint("")}
            >
              כל הנקודות · {orders.length + walkins.length}
            </PointChip>
            {pointsInSale.map((p) => (
              <PointChip
                key={p.id}
                active={filterPoint === p.id}
                onClick={() => setFilterPoint(p.id)}
              >
                📍 {p.name} · {p.count}
              </PointChip>
            ))}
          </div>
        )}

        {/* Tabs */}
        <div className="bg-white rounded-2xl border border-zinc-200 shadow-sm overflow-hidden">
          <div className="flex border-b border-zinc-200 bg-zinc-50">
            <TabBtn active={tab === "orders"} onClick={() => setTab("orders")}>
              הזמנות ({shownOrders.length})
            </TabBtn>
            <TabBtn active={tab === "walkins"} onClick={() => setTab("walkins")}>
              מזדמנים ({shownWalkins.length})
            </TabBtn>
            <TabBtn active={tab === "payments"} onClick={() => setTab("payments")}>
              תשלומים ({payments.length})
            </TabBtn>
          </div>

          {tab === "orders" && <OrdersTab orders={shownOrders} />}
          {tab === "walkins" && <WalkinsTab walkins={shownWalkins} />}
          {tab === "payments" && (
            <PaymentsTab payments={payments} summary={summary} />
          )}
        </div>
      </main>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// §43: פירוט לפי נקודת חלוקה
// ═══════════════════════════════════════════════════════════════════

type PointRow = {
  id: string;
  name: string;
  cartonWeight: number;
  singlesWeight: number;
  orders: number;
  walkins: number;
  revenue: number;
  commission: number;
};

// רשימת הנקודות שבהן הייתה פעילות, עם מונה לכל אחת
function collectPoints(
  orders: Data["orders"],
  walkins: Data["walkins"]
): { id: string; name: string; count: number }[] {
  const m = new Map<string, { id: string; name: string; count: number }>();
  for (const o of orders) {
    const id = o.point?.id ?? "__none__";
    const name = o.point?.name ?? "ללא נקודה";
    const cur = m.get(id) || { id, name, count: 0 };
    cur.count++;
    m.set(id, cur);
  }
  for (const w of walkins) {
    const id = w.pointId ?? "__none__";
    const name = w.pointName ?? "ללא נקודה";
    const cur = m.get(id) || { id, name, count: 0 };
    cur.count++;
    m.set(id, cur);
  }
  return Array.from(m.values()).sort((a, b) => a.name.localeCompare(b.name, "he"));
}

function calculateBreakdown(
  orders: Data["orders"],
  walkins: Data["walkins"],
  rateCarton: number,
  rateSingles: number
): PointRow[] {
  const m = new Map<string, PointRow>();
  const blank = (id: string, name: string): PointRow => ({
    id,
    name,
    cartonWeight: 0,
    singlesWeight: 0,
    orders: 0,
    walkins: 0,
    revenue: 0,
    commission: 0,
  });

  for (const o of orders) {
    const id = o.point?.id ?? "__none__";
    const name = o.point?.name ?? "ללא נקודה";
    let row = m.get(id);
    if (!row) {
      row = blank(id, name);
      m.set(id, row);
    }
    row.orders++;
    for (const it of o.items) {
      if (it.isCancelled) continue;
      // agentEnteredWeight ולא actualWeight: העמלה על מה שהנציג שקל,
      // לא על תיקוני מנהל. זהה לחישוב במסך הנציג.
      const w = it.agentEnteredWeight || 0;
      if (w > 0) {
        if (it.isSingle) row.singlesWeight += w;
        else row.cartonWeight += w;
      }
      row.revenue += it.finalPrice || 0;
    }
  }

  for (const w of walkins) {
    const id = w.pointId ?? "__none__";
    const name = w.pointName ?? "ללא נקודה";
    let row = m.get(id);
    if (!row) {
      row = blank(id, name);
      m.set(id, row);
    }
    row.walkins++;
    row.revenue += w.totalAmount;
    for (const it of w.items) {
      if (it.isSingle) row.singlesWeight += it.weight;
      else row.cartonWeight += it.weight;
    }
  }

  for (const row of m.values()) {
    row.commission = row.cartonWeight * rateCarton + row.singlesWeight * rateSingles;
  }

  return Array.from(m.values()).sort((a, b) => a.name.localeCompare(b.name, "he"));
}

function PointBreakdown({
  orders,
  walkins,
  rateCarton,
  rateSingles,
}: {
  orders: Data["orders"];
  walkins: Data["walkins"];
  rateCarton: number;
  rateSingles: number;
}) {
  const rows = calculateBreakdown(orders, walkins, rateCarton, rateSingles);
  // מוצג רק כשיש יותר מנקודה אחת - אחרת זו כפילות של הסטטיסטיקות
  if (rows.length <= 1) return null;

  const totalCommission = rows.reduce((s, r) => s + r.commission, 0);
  const totalRevenue = rows.reduce((s, r) => s + r.revenue, 0);

  return (
    <div className="bg-white rounded-2xl border border-zinc-200 shadow-sm overflow-hidden">
      <div className="px-5 py-3 bg-zinc-50 border-b border-zinc-100">
        <h3 className="font-extrabold text-brand-slatedark">פירוט לפי נקודת חלוקה</h3>
        <p className="text-xs text-zinc-500 mt-0.5">
          {rows.length} נקודות · העמלה מחושבת על המשקלים שהנציג הזין
        </p>
      </div>

      <div className="p-4 space-y-3">
        {rows.map((r) => (
          <div key={r.id} className="border border-zinc-200 rounded-xl p-3">
            <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
              <span className="font-bold text-brand-slatedark">📍 {r.name}</span>
              <div className="flex items-center gap-3">
                <span className="text-sm text-zinc-600">
                  הכנסה ₪{r.revenue.toFixed(2)}
                </span>
                <span className="text-lg font-extrabold text-emerald-600">
                  עמלה ₪{r.commission.toFixed(2)}
                </span>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="bg-orange-50 rounded-lg p-2">
                <div className="text-[10px] text-brand-rust font-bold">קרטונים</div>
                <div className="font-extrabold text-brand-rust">
                  {r.cartonWeight.toFixed(2)} ק״ג
                </div>
                <div className="text-[10px] text-zinc-500">
                  × ₪{rateCarton} = ₪{(r.cartonWeight * rateCarton).toFixed(2)}
                </div>
              </div>
              <div className="bg-amber-50 rounded-lg p-2">
                <div className="text-[10px] text-amber-800 font-bold">בודדים</div>
                <div className="font-extrabold text-amber-800">
                  {r.singlesWeight.toFixed(2)} ק״ג
                </div>
                <div className="text-[10px] text-zinc-500">
                  × ₪{rateSingles} = ₪{(r.singlesWeight * rateSingles).toFixed(2)}
                </div>
              </div>
            </div>

            <div className="flex items-center gap-4 mt-2 text-xs text-zinc-600 flex-wrap">
              <span>
                <bdi>{r.orders}</bdi> הזמנות
              </span>
              {r.walkins > 0 && (
                <span>
                  <bdi>{r.walkins}</bdi> מזדמנים
                </span>
              )}
            </div>
          </div>
        ))}

        <div className="border-t-2 border-zinc-200 pt-3 flex items-center justify-between flex-wrap gap-2">
          <span className="font-bold text-brand-slatedark">
            סה״כ · הכנסה ₪{totalRevenue.toFixed(2)}
          </span>
          <span className="text-2xl font-extrabold text-emerald-600">
            עמלה ₪{totalCommission.toFixed(2)}
          </span>
        </div>
      </div>
    </div>
  );
}

function PointChip({
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
      className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-colors ${
        active
          ? "bg-brand-rust text-white shadow-sm"
          : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200"
      }`}
    >
      {children}
    </button>
  );
}

function StatCard({
  label,
  value,
  subtitle,
  color,
}: {
  label: string;
  value: string;
  subtitle?: string;
  color: "rust" | "purple" | "emerald" | "amber";
}) {
  const colorMap = {
    rust: "bg-orange-50 text-brand-rust border-orange-200",
    purple: "bg-purple-50 text-purple-700 border-purple-200",
    emerald: "bg-emerald-50 text-emerald-700 border-emerald-200",
    amber: "bg-amber-50 text-amber-800 border-amber-200",
  }[color];
  return (
    <div className={`rounded-xl border p-3 ${colorMap}`}>
      <div className="text-xs font-bold opacity-80">{label}</div>
      <div className="text-xl font-extrabold mt-1">{value}</div>
      {subtitle && <div className="text-[10px] opacity-70 mt-0.5">{subtitle}</div>}
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
      className={`flex-1 px-4 py-3 text-sm font-bold transition-colors ${
        active
          ? "bg-white text-brand-rust border-b-2 border-brand-rust"
          : "text-zinc-500 hover:bg-zinc-100"
      }`}
    >
      {children}
    </button>
  );
}

function OrdersTab({ orders }: { orders: Data["orders"] }) {
  if (orders.length === 0) {
    return (
      <div className="p-8 text-center text-zinc-500">
        אין הזמנות של הנציג הזה במכירה
      </div>
    );
  }
  return (
    <div className="divide-y divide-zinc-100">
      {orders.map((order) => (
        <OrderCard key={order.id} order={order} />
      ))}
    </div>
  );
}

function OrderCard({ order }: { order: Data["orders"][number] }) {
  const [expanded, setExpanded] = useState(false);
  const activeItems = order.items.filter((i) => !i.isCancelled);
  const allEntered = activeItems.every((i) => i.agentEnteredWeight !== null && i.agentEnteredWeight > 0);
  const totalPrice = order.items.reduce((s, i) => s + (i.finalPrice || 0), 0);

  return (
    <div>
      <button
        onClick={() => setExpanded((v) => !v)}
        className="w-full p-4 hover:bg-zinc-50 text-right flex items-center gap-3"
      >
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-bold text-brand-slatedark">
              {order.customerName}
            </span>
            <span className="text-xs text-zinc-400">#{order.orderNumber}</span>
            {allEntered ? (
              <span className="text-[10px] bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full font-bold">
                ✓ הוזן
              </span>
            ) : (
              <span className="text-[10px] bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full font-bold">
                ממתין
              </span>
            )}
            {/* §43: הנקודה של ההזמנה - חשוב בתצוגה מאוחדת */}
            {order.point && (
              <span className="text-[10px] bg-zinc-100 text-zinc-600 px-2 py-0.5 rounded-full">
                📍 {order.point.name}
              </span>
            )}
          </div>
          <div className="text-xs text-zinc-500 mt-0.5" dir="ltr">
            {order.phone} · {activeItems.length} פריטים
          </div>
        </div>
        {totalPrice > 0 && (
          <div className="text-brand-rust font-extrabold whitespace-nowrap">
            ₪{totalPrice.toFixed(2)}
          </div>
        )}
        <svg
          className={`w-5 h-5 text-zinc-400 shrink-0 transition-transform ${
            expanded ? "rotate-180" : ""
          }`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {expanded && (
        <div className="bg-zinc-50 border-t border-zinc-100 p-3 space-y-1.5">
          {order.items.map((item) => (
            <div
              key={item.id}
              className={`bg-white rounded-lg p-2.5 text-sm flex flex-wrap items-center gap-2 ${
                item.isCancelled ? "opacity-50" : ""
              }`}
            >
              <div className="flex-1 min-w-0">
                <div
                  className={`font-semibold ${
                    item.isCancelled ? "line-through text-zinc-400" : "text-brand-slatedark"
                  }`}
                >
                  {item.productName}
                  {item.isSingle && (
                    <span className="mr-1 text-[9px] bg-amber-100 text-amber-700 px-1 py-0.5 rounded font-bold">
                      בודדים
                    </span>
                  )}
                  {item.originalProductId && (
                    <span className="mr-1 text-[9px] bg-blue-100 text-blue-700 px-1 py-0.5 rounded font-bold">
                      הוחלף
                    </span>
                  )}
                  {item.isCancelled && (
                    <span className="mr-1 text-[9px] bg-red-100 text-red-700 px-1 py-0.5 rounded font-bold">
                      ✗
                    </span>
                  )}
                </div>
                <div className="text-xs text-zinc-500">
                  {/* יחידה לפי unit האמיתי: מוצר ארוז נמכר ביחידות ולא
                      בקרטונים, והוצג כ"2 קרטון" */}
                  הוזמן:{" "}
                  {item.isSingle
                    ? `${item.quantity} ק"ג`
                    : `${item.quantity} ${packUnitLabel(item.unit)}`}
                  {item.agentEnteredWeight ? (
                    <>
                      {" · "}
                      <span className="text-emerald-700 font-bold">
                        הזין: {item.agentEnteredWeight.toFixed(2)} ק"ג
                      </span>
                    </>
                  ) : null}
                  {item.actualWeight !== null &&
                    item.agentEnteredWeight !== null &&
                    Math.abs(item.actualWeight - item.agentEnteredWeight) > 0.01 && (
                      <>
                        {" · "}
                        <span className="text-blue-700 font-bold">
                          תוקן: {item.actualWeight.toFixed(2)} ק"ג
                        </span>
                      </>
                    )}
                </div>
                {item.agentNote && (
                  <div className="text-[10px] mt-1 bg-yellow-50 border border-yellow-200 rounded px-2 py-1 text-yellow-800 inline-block">
                    💬 {item.agentNote}
                  </div>
                )}
              </div>
              {item.finalPrice ? (
                <div className="text-brand-rust font-bold whitespace-nowrap">
                  ₪{item.finalPrice.toFixed(2)}
                </div>
              ) : null}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// יחידת האריזה. מוצר ארוז ("בקר טחון 500 ג'") נמכר ביחידות ולא
// בקרטונים, והוצג בטעות כ"קרטון".
function packUnitLabel(unit?: string | null): string {
  const u = (unit || "").trim();
  return u && u !== 'ק"ג' ? u : "קרטון";
}

function WalkinsTab({ walkins }: { walkins: Data["walkins"] }) {
  if (walkins.length === 0) {
    return (
      <div className="p-8 text-center text-zinc-500">
        הנציג לא הזין מזדמנים במכירה הזאת
      </div>
    );
  }
  return (
    <div className="divide-y divide-zinc-100">
      {walkins.map((w) => (
        <div key={w.id} className="p-4">
          <div className="flex items-center gap-2 flex-wrap mb-2">
            <span className="font-bold text-brand-slatedark">{w.customerName}</span>
            <span className="text-xs text-zinc-400">#{w.walkinNumber}</span>
            <span
              className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${
                w.paymentReceived
                  ? "bg-emerald-100 text-emerald-700"
                  : "bg-amber-100 text-amber-700"
              }`}
            >
              {PAYMENT_ICONS[w.paymentMethod]} {PAYMENT_LABELS[w.paymentMethod]}
              {!w.paymentReceived && " — ממתין"}
            </span>
            {/* §44: הנקודה שאליה שויך המזדמן */}
            {w.pointName && (
              <span className="text-[10px] bg-zinc-100 text-zinc-600 px-2 py-0.5 rounded-full">
                📍 {w.pointName}
              </span>
            )}
            {w.summarySentAt && (
              <span className="text-[10px] bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full font-bold">
                ✓ נשלח
              </span>
            )}
          </div>
          <div className="text-xs text-zinc-500 mb-2" dir="ltr">
            {w.customerPhone && `${w.customerPhone} · `}
            {w.customerEmail && `${w.customerEmail} · `}
            {new Date(w.createdAt).toLocaleTimeString("he-IL", {
              hour: "2-digit",
              minute: "2-digit",
            })}
          </div>
          <div className="bg-zinc-50 rounded-lg p-2 space-y-1">
            {w.items.map((it) => (
              <div key={it.id} className="text-xs flex justify-between items-center">
                <span>
                  {it.productName}
                  {it.isSingle && (
                    <span className="mr-1 text-[9px] bg-amber-100 text-amber-700 px-1 py-0.5 rounded font-bold">
                      בודדים
                    </span>
                  )}
                  <span className="text-zinc-500 mr-2">
                    {it.weight.toFixed(2)} ק"ג × ₪{it.unitPrice.toFixed(2)}
                  </span>
                </span>
                <span className="text-brand-rust font-bold">₪{it.totalPrice.toFixed(2)}</span>
              </div>
            ))}
            <div className="border-t border-zinc-200 pt-1 mt-1 flex justify-between">
              <span className="text-xs font-bold text-brand-slatedark">סה"כ:</span>
              <span className="text-brand-rust font-extrabold">₪{w.totalAmount.toFixed(2)}</span>
            </div>
          </div>
          {(w.notes || w.paymentNote) && (
            <div className="mt-2 space-y-1">
              {w.paymentNote && (
                <div className="text-[10px] text-zinc-600 bg-yellow-50 border border-yellow-200 rounded px-2 py-1">
                  💳 {w.paymentNote}
                </div>
              )}
              {w.notes && (
                <div className="text-[10px] text-zinc-600 bg-blue-50 border border-blue-200 rounded px-2 py-1">
                  📝 {w.notes}
                </div>
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function PaymentsTab({
  payments,
  summary,
}: {
  payments: Data["payments"];
  summary: Data["summary"];
}) {
  return (
    <div className="p-4 space-y-3">
      {summary && (
        <div className="bg-gradient-to-r from-brand-yellow/30 to-transparent rounded-xl p-4 border border-brand-rust/20">
          <div className="font-bold text-brand-slatedark mb-3">חישוב עמלה</div>
          <div className="space-y-1.5 text-sm">
            <div className="flex justify-between">
              <span className="text-brand-slate">
                קרטונים: {summary.totalCartonWeight.toFixed(2)} ק"ג + מזדמנים{" "}
                {summary.totalWalkinWeight.toFixed(2)} ק"ג
              </span>
              <span className="font-bold text-brand-slatedark">
                ₪{summary.cartonCommission.toFixed(2)}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-brand-slate">
                בודדים: {summary.totalSinglesWeight.toFixed(2)} ק"ג
              </span>
              <span className="font-bold text-brand-slatedark">
                ₪{summary.singlesCommission.toFixed(2)}
              </span>
            </div>
            <div className="border-t border-zinc-300 pt-1.5 flex justify-between">
              <span className="font-bold text-brand-slatedark">סה"כ עמלה:</span>
              <span className="font-extrabold text-lg text-brand-rust">
                ₪{summary.totalCommission.toFixed(2)}
              </span>
            </div>
          </div>
          {summary.remainderNote && (
            <div className="mt-3 text-xs bg-amber-50 border border-amber-200 rounded px-2 py-1.5 text-amber-800">
              💬 <strong>הערת הנציג:</strong> {summary.remainderNote}
            </div>
          )}
        </div>
      )}

      {payments.length === 0 ? (
        <div className="text-center text-zinc-500 py-8">אין רישומי תשלום למכירה זו</div>
      ) : (
        <div className="space-y-2">
          <div className="text-xs font-bold text-brand-slatedark mb-1">
            תשלומים ({payments.length})
          </div>
          {payments.map((p) => {
            const isPaid = p.type === "PAID";
            return (
              <div
                key={p.id}
                className={`rounded-lg border p-3 text-sm flex items-center gap-3 ${
                  isPaid ? "bg-red-50 border-red-200" : "bg-emerald-50 border-emerald-200"
                }`}
              >
                <div className="flex-1">
                  <div className={`font-bold ${isPaid ? "text-red-700" : "text-emerald-700"}`}>
                    {isPaid ? "שולם לנציג" : "העביר למנהל"}
                  </div>
                  <div className="text-[10px] text-zinc-500 mt-0.5">
                    {new Date(p.createdAt).toLocaleDateString("he-IL")}
                    {p.method && ` · ${p.method}`}
                  </div>
                  {p.note && <div className="text-xs text-zinc-600 mt-1">{p.note}</div>}
                </div>
                <div
                  className={`font-extrabold whitespace-nowrap ${
                    isPaid ? "text-red-700" : "text-emerald-700"
                  }`}
                >
                  ₪{p.amount.toFixed(2)}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
