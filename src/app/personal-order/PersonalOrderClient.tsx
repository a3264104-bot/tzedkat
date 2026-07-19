"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { PersonalRequestMessages } from "@/components/PersonalRequestMessages";

// §9: הזמנה אישית מחודשת
// - רשימת מוצרים מאוחדת (מקובצת לפי נקודת חלוקה אם קיימת)
// - הזמנה מרובת פריטים בעגלה
// - עבור לקוח מחובר - טעינת פרטים אוטומטית
// - צ'אט עם המנהל בבקשות קיימות

type PersonalProduct = {
  id: string;
  name: string;
  imageUrl: string | null;
  description: string | null;
  maxQuantity: number | null;
  pointId: string | null;
  point: { id: string; name: string; city: string | null } | null;
};

type Customer = {
  name: string;
  phone: string | null;
  email: string | null;
};

type ExistingRequest = {
  id: string;
  requestNumber: number;
  status: string;
  createdAt: string;
  hasUnreadForCustomer: boolean;
  items: { productName: string; quantity: number }[];
};

type Props = {
  products: PersonalProduct[];
  customer: Customer | null;
  existingRequests: ExistingRequest[];
};

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  NEW: { label: "חדשה", color: "bg-blue-100 text-blue-800" },
  IN_PROGRESS: { label: "בטיפול", color: "bg-amber-100 text-amber-800" },
  CONTACTED: { label: "פנינו אליך", color: "bg-purple-100 text-purple-800" },
  WAITING: { label: "ממתין", color: "bg-zinc-100 text-zinc-800" },
  DONE: { label: "הושלמה", color: "bg-emerald-100 text-emerald-800" },
  CANCELLED: { label: "בוטלה", color: "bg-red-100 text-red-800" },
};

export function PersonalOrderClient({ products, customer, existingRequests }: Props) {
  // עגלה: productId -> quantity
  const [cart, setCart] = useState<Record<string, number>>({});
  const [customerName, setCustomerName] = useState(customer?.name || "");
  const [phone, setPhone] = useState(customer?.phone || "");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successNumber, setSuccessNumber] = useState<number | null>(null);
  const [expandedRequestId, setExpandedRequestId] = useState<string | null>(null);

  // קיבוץ מוצרים לפי נקודה
  const groupedProducts = useMemo(() => {
    const groups = new Map<string, { pointName: string; city: string | null; products: PersonalProduct[] }>();
    const noPoint: PersonalProduct[] = [];
    for (const p of products) {
      if (p.point) {
        const key = p.point.id;
        if (!groups.has(key)) {
          groups.set(key, {
            pointName: p.point.name,
            city: p.point.city,
            products: [],
          });
        }
        groups.get(key)!.products.push(p);
      } else {
        noPoint.push(p);
      }
    }
    return { groups: Array.from(groups.entries()), noPoint };
  }, [products]);

  function setQty(id: string, qty: number) {
    setCart((c) => {
      const next = { ...c };
      if (qty <= 0) delete next[id];
      else next[id] = qty;
      return next;
    });
  }

  const cartItems = useMemo(() => {
    return Object.entries(cart)
      .map(([id, qty]) => {
        const p = products.find((x) => x.id === id);
        return p ? { product: p, quantity: qty } : null;
      })
      .filter((x): x is { product: PersonalProduct; quantity: number } => x !== null);
  }, [cart, products]);

  const canSubmit = cartItems.length > 0 && customerName.trim() && phone.trim();

  async function submit() {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/personal-request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customerName: customerName.trim(),
          phone: phone.trim(),
          notes: notes.trim() || null,
          items: cartItems.map((c) => ({
            productId: c.product.id,
            quantity: c.quantity,
          })),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "שגיאה בשליחת הבקשה");
      setSuccessNumber(data.requestNumber);
      setCart({});
      setNotes("");
    } catch (e: any) {
      setError(e.message || "שגיאה");
    } finally {
      setSubmitting(false);
    }
  }

  // מסך אישור אחרי שליחה
  if (successNumber !== null) {
    return (
      <div className="min-h-screen bg-brand-cream">
        <header className="bg-brand-yellow border-b-4 border-brand-rust/20 sticky top-0 z-20">
          <div className="mx-auto max-w-md md:max-w-4xl px-4 py-2.5 flex items-center justify-between gap-2">
            <Link href="/" className="text-brand-slate font-medium text-sm">
              דף הבית
            </Link>
            <div className="font-extrabold text-brand-slatedark">הזמנה אישית</div>
          </div>
        </header>
        <div className="mx-auto max-w-md md:max-w-2xl px-4 pt-8">
          <div className="card p-6 text-center space-y-4">
            <div className="text-6xl">✓</div>
            <h2 className="text-xl font-extrabold text-brand-slatedark">
              הבקשה נשלחה בהצלחה!
            </h2>
            <p className="text-sm text-zinc-600">
              מספר הבקשה: <strong>#{successNumber}</strong>
            </p>
            <p className="text-sm text-zinc-500">
              ניצור איתך קשר בהקדם. תוכל לעקוב אחר סטטוס הבקשה באזור האישי.
            </p>
            <div className="flex gap-2 mt-4">
              <Link
                href="/account"
                className="flex-1 bg-brand-rust text-white px-4 py-2.5 rounded-lg font-medium text-sm"
              >
                לאזור אישי
              </Link>
              <button
                onClick={() => setSuccessNumber(null)}
                className="flex-1 bg-white border border-zinc-300 text-brand-slatedark px-4 py-2.5 rounded-lg font-medium text-sm"
              >
                בקשה נוספת
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-brand-cream">
      <header className="bg-brand-yellow border-b-4 border-brand-rust/20 sticky top-0 z-20">
        <div className="mx-auto max-w-md md:max-w-4xl px-4 py-2.5 flex items-center justify-between gap-2">
          <Link href="/" className="text-brand-slate font-medium text-sm">
            דף הבית
          </Link>
          <div className="font-extrabold text-brand-slatedark">הזמנה אישית</div>
          {customer && (
            <Link href="/account" className="text-brand-slate font-medium text-sm">
              אזור אישי
            </Link>
          )}
        </div>
      </header>

      <div className="mx-auto max-w-md md:max-w-4xl px-4 pt-5 pb-8 space-y-4">
        {/* בקשות קיימות */}
        {existingRequests.length > 0 && (
          <section className="card p-4">
            <h2 className="font-bold text-brand-slatedark mb-3">
              הבקשות שלי ({existingRequests.length})
            </h2>
            <div className="space-y-2">
              {existingRequests.map((r) => {
                const status = STATUS_LABELS[r.status] || STATUS_LABELS.NEW;
                const isExpanded = expandedRequestId === r.id;
                return (
                  <div
                    key={r.id}
                    className={`border rounded-lg overflow-hidden ${
                      r.hasUnreadForCustomer ? "border-brand-rust bg-red-50" : "border-zinc-200"
                    }`}
                  >
                    <button
                      onClick={() => setExpandedRequestId(isExpanded ? null : r.id)}
                      className="w-full text-right p-3 flex items-center justify-between gap-2"
                    >
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="font-bold text-brand-slatedark">
                            בקשה #{r.requestNumber}
                          </span>
                          <span className={`badge ${status.color} text-xs`}>
                            {status.label}
                          </span>
                          {r.hasUnreadForCustomer && (
                            <span className="text-xs bg-brand-rust text-white px-1.5 py-0.5 rounded-full font-bold">
                              הודעה חדשה
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-zinc-500">
                          {r.items.length} פריטים · {new Date(r.createdAt).toLocaleDateString("he-IL")}
                        </div>
                      </div>
                      <span className="text-zinc-400">{isExpanded ? "▲" : "▼"}</span>
                    </button>
                    {isExpanded && (
                      <div className="p-3 border-t border-zinc-200 bg-white space-y-3">
                        <div>
                          <div className="text-xs font-bold text-zinc-500 mb-1">פריטים:</div>
                          <ul className="text-sm text-brand-slatedark space-y-0.5">
                            {r.items.map((item, i) => (
                              <li key={i}>
                                • {item.productName} × {item.quantity}
                              </li>
                            ))}
                          </ul>
                        </div>
                        <PersonalRequestMessages
                          requestId={r.id}
                          currentUserType="CUSTOMER"
                          readOnly={r.status === "CANCELLED" || r.status === "DONE"}
                        />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {/* בקשה חדשה */}
        <section className="card p-4">
          <h2 className="font-extrabold text-brand-slatedark text-lg mb-1">
            בקשה חדשה
          </h2>
          <p className="text-sm text-zinc-500 mb-4">
            בחר מוצרים והשאר פרטים. ניצור איתך קשר לתיאום.
          </p>

          {products.length === 0 ? (
            <div className="text-center text-zinc-500 py-6">
              אין מוצרים זמינים כרגע להזמנה אישית.
            </div>
          ) : (
            <div className="space-y-4">
              {/* מוצרים מקובצים לפי נקודה */}
              {groupedProducts.groups.map(([pointId, group]) => (
                <div key={pointId}>
                  <div className="text-sm font-bold text-brand-rust mb-2 pb-1 border-b border-brand-rust/20">
                    📍 {group.pointName}
                    {group.city && <span className="text-zinc-500 font-normal"> — {group.city}</span>}
                  </div>
                  <div className="space-y-2 md:grid md:grid-cols-2 md:gap-3 md:space-y-0">
                    {group.products.map((p) => (
                      <ProductRow key={p.id} product={p} qty={cart[p.id] || 0} onChange={(v) => setQty(p.id, v)} />
                    ))}
                  </div>
                </div>
              ))}
              {groupedProducts.noPoint.length > 0 && (
                <div>
                  {groupedProducts.groups.length > 0 && (
                    <div className="text-sm font-bold text-brand-slatedark mb-2 pb-1 border-b border-zinc-200">
                      מוצרים כלליים
                    </div>
                  )}
                  <div className="space-y-2 md:grid md:grid-cols-2 md:gap-3 md:space-y-0">
                    {groupedProducts.noPoint.map((p) => (
                      <ProductRow key={p.id} product={p} qty={cart[p.id] || 0} onChange={(v) => setQty(p.id, v)} />
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </section>

        {/* טופס פרטים - מוצג רק אם יש פריטים בעגלה */}
        {cartItems.length > 0 && (
          <section className="card p-4 space-y-3">
            <h2 className="font-bold text-brand-slatedark">פרטי יצירת קשר</h2>

            <label className="block">
              <span className="text-sm text-zinc-700 font-medium">שם מלא</span>
              <input
                className="input w-full mt-1"
                value={customerName}
                onChange={(e) => setCustomerName(e.target.value)}
                placeholder="שם"
              />
            </label>

            <label className="block">
              <span className="text-sm text-zinc-700 font-medium">טלפון</span>
              <input
                className="input w-full mt-1"
                type="tel"
                dir="ltr"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="050-1234567"
              />
            </label>

            <label className="block">
              <span className="text-sm text-zinc-700 font-medium">
                הערות (אופציונלי)
              </span>
              <textarea
                className="input w-full mt-1"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="פרטים נוספים, זמן זמין וכד'"
                rows={3}
              />
            </label>

            {/* סיכום */}
            <div className="bg-zinc-50 rounded-lg p-3">
              <div className="text-sm font-bold text-brand-slatedark mb-2">
                סיכום ({cartItems.length} פריטים)
              </div>
              <ul className="text-sm text-brand-slatedark space-y-1">
                {cartItems.map((c) => (
                  <li key={c.product.id} className="flex justify-between">
                    <span>{c.product.name}</span>
                    <span className="font-bold">× {c.quantity}</span>
                  </li>
                ))}
              </ul>
            </div>

            {error && (
              <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg p-3 text-sm">
                {error}
              </div>
            )}

            <button
              onClick={submit}
              disabled={!canSubmit || submitting}
              className="btn-primary w-full"
            >
              {submitting ? "שולח..." : "שלח בקשה"}
            </button>
          </section>
        )}
      </div>
    </div>
  );
}

function ProductRow({
  product,
  qty,
  onChange,
}: {
  product: PersonalProduct;
  qty: number;
  onChange: (v: number) => void;
}) {
  const max = product.maxQuantity || 99;
  return (
    <div className="flex items-center gap-3 p-2 bg-zinc-50 rounded-lg border border-zinc-100">
      {product.imageUrl && (
        <img
          src={product.imageUrl}
          alt={product.name}
          className="w-14 h-14 object-cover rounded-lg shrink-0 border border-zinc-200"
        />
      )}
      <div className="flex-1 min-w-0">
        <div className="font-medium text-brand-slatedark text-sm truncate">
          {product.name}
        </div>
        {product.description && (
          <div className="text-xs text-zinc-500 line-clamp-2">{product.description}</div>
        )}
        {product.maxQuantity && (
          <div className="text-xs text-amber-600 mt-0.5">
            עד {product.maxQuantity} יחידות
          </div>
        )}
      </div>
      <div className="flex items-center gap-1 shrink-0">
        <button
          onClick={() => onChange(Math.max(0, qty - 1))}
          disabled={qty === 0}
          className="w-8 h-8 rounded-lg bg-zinc-200 text-brand-slatedark font-bold disabled:opacity-30"
        >
          −
        </button>
        <span className="w-8 text-center font-bold text-brand-slatedark">{qty}</span>
        <button
          onClick={() => onChange(Math.min(max, qty + 1))}
          disabled={qty >= max}
          className="w-8 h-8 rounded-lg bg-brand-rust text-white font-bold disabled:opacity-30"
        >
          +
        </button>
      </div>
    </div>
  );
}
