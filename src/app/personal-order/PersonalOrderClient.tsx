"use client";

import { useEffect, useMemo, useState } from "react";
// §200: תאריכים בשעון ישראל — השרת רץ ב-UTC
import { fmtDate } from "@/lib/date-lib";
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
  category: string | null; // §9: לקיבוץ במקום נקודה
  kashrut: string | null;
  // §73: תמונת הכשרות - כמו בהזמנה הרגילה
  kashrutImageUrl: string | null;
  // §73: לבורר בודדים/קרטונים
  allowSingles?: boolean;
  singlesMode?: string | null;
  unit?: string | null;
};

type Customer = {
  name: string;
  phone: string | null;
  email: string | null;
  /**
   * §248: האם ניתן לגבות מהלקוח.
   *
   * כרטיס **בתוקף**, או לקוח מזומן. נקבע בשרת (§202) כדי שהמסך
   * לא יצטרך להכיר את כללי התוקף.
   */
  canPay?: boolean;
  /** יש כרטיס אך פג תוקפו — משנה את נוסח ההודעה */
  cardExpired?: boolean;
};

type ExistingRequest = {
  id: string;
  requestNumber: number;
  status: string;
  createdAt: string;
  hasUnreadForCustomer: boolean;
  items: { productName: string; quantity: number; isSingle?: boolean }[];
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
  // §248: 🚫 בקשה אישית דורשת אמצעי תשלום.
  //
  // ⚠️ הבדיקה **לפני** שהלקוח בונה עגלה: בקשה אישית היא תהליך
  // ארוך (בחירת מוצרים, כמויות, הערות), ולגלות בסוף שאי אפשר
  // לשלוח זו חוויה גרועה בהרבה מהודעה מראש.
  const blocked = customer != null && customer.canPay === false;
  // §73: עותק מקומי - ביטול בקשה מעדכן את הסטטוס במסך בלי טעינה מחדש
  const [requests, setRequests] = useState<ExistingRequest[]>(existingRequests);
  const [cancelling, setCancelling] = useState<string | null>(null);
  // §73: אילו מוצרים בעגלה סומנו כבודדים (productId -> true)
  const [singles, setSingles] = useState<Record<string, boolean>>({});
  // עגלה: productId -> quantity
  const [cart, setCart] = useState<Record<string, number>>({});
  const [customerName, setCustomerName] = useState(customer?.name || "");
  const [phone, setPhone] = useState(customer?.phone || "");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successNumber, setSuccessNumber] = useState<number | null>(null);
  const [expandedRequestId, setExpandedRequestId] = useState<string | null>(null);

  // קיבוץ מוצרים לפי קטגוריה (כמו במכירה רגילה)
  const groupedProducts = useMemo(() => {
    const groups = new Map<string, PersonalProduct[]>();
    const noCat: PersonalProduct[] = [];
    for (const p of products) {
      if (p.category) {
        if (!groups.has(p.category)) groups.set(p.category, []);
        groups.get(p.category)!.push(p);
      } else {
        noCat.push(p);
      }
    }
    return { groups: Array.from(groups.entries()), noCat };
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
        // §73: בודדים רק אם המוצר בכלל מאפשר
        return p
          ? { product: p, quantity: qty, isSingle: !!singles[id] && !!p.allowSingles }
          : null;
      })
      .filter(
        (x): x is { product: PersonalProduct; quantity: number; isSingle: boolean } =>
          x !== null
      );
  }, [cart, products, singles]);

  const canSubmit = cartItems.length > 0 && customerName.trim() && phone.trim();

  // §73: ביטול בקשה ע"י הלקוח.
  // מותר כל עוד הבקשה לא הסתיימה (DONE) ולא בוטלה. אין כאן שלב
  // "אושרה" שחוסם - המודל הוא שיחה: אם המנהל כבר הזמין מהספק,
  // הוא יראה את הביטול בצ'אט (הודעת מערכת + סימון "לא נקרא")
  // ויחזור ללקוח.
  async function cancelRequest(requestId: string) {
    if (
      !window.confirm(
        "לבטל את הבקשה? המנהל יקבל הודעה על הביטול. לא ניתן לשחזר בקשה שבוטלה."
      )
    )
      return;
    setCancelling(requestId);
    try {
      const res = await fetch("/api/personal-request", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestId, action: "cancel" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "שגיאה בביטול");
      setRequests((rs) =>
        rs.map((r) => (r.id === requestId ? { ...r, status: "CANCELLED" } : r))
      );
    } catch (e: any) {
      alert(e.message);
    } finally {
      setCancelling(null);
    }
  }

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
            // §73: קרטון או בודדים - המנהל חייב לדעת מה מבקשים
            isSingle: c.isSingle,
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

  // §248: מסך חסימה במקום העגלה.
  //
  // ⚠️ מסך מלא ולא באנר: אין טעם להציג רשימת מוצרים שאי אפשר
  // להזמין. הלקוח יבחר, ימלא, וייתקל בקיר.
  if (blocked) {
    return (
      <div className="min-h-screen bg-brand-cream flex items-center justify-center p-6">
        <div className="bg-white rounded-2xl shadow-lg p-6 max-w-sm w-full text-center">
          <div className="text-4xl mb-3">💳</div>
          <h1 className="text-lg font-extrabold text-brand-slatedark">
            {customer?.cardExpired
              ? "תוקף כרטיס האשראי שלך פג"
              : "נדרש אמצעי תשלום"}
          </h1>
          <p className="text-sm text-zinc-600 mt-2 leading-relaxed">
            {customer?.cardExpired
              ? "כדי לשלוח בקשה אישית יש לעדכן כרטיס אשראי בתוקף."
              : "כדי לשלוח בקשה אישית יש להזין כרטיס אשראי באזור האישי."}
          </p>
          {/* ⚠️ ההסבר חשוב: הלקוח לא מבין למה דווקא כאן צריך
              כרטיס, אם בהזמנה רגילה הוא כבר עבר את השלב הזה. */}
          <p className="text-[11px] text-zinc-500 mt-2 leading-relaxed">
            בקשה אישית היא מוצר שמוזמן במיוחד עבורך, ולכן נדרש אמצעי
            תשלום מראש.
          </p>
          <Link
            href="/account"
            className="mt-5 block w-full py-3 rounded-xl bg-brand-rust text-white font-bold"
          >
            לעדכון כרטיס אשראי ←
          </Link>
          <Link
            href="/"
            className="mt-2 block text-xs text-zinc-500 underline"
          >
            חזרה לדף הבית
          </Link>
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
        {requests.length > 0 && (
          <section className="card p-4">
            <h2 className="font-bold text-brand-slatedark mb-3">
              הבקשות שלי ({requests.length})
            </h2>
            <div className="space-y-2">
              {requests.map((r) => {
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
                          {r.items.length} פריטים · {fmtDate(r.createdAt)}
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
                                {/* §73: מה שהוזמן - קרטון או בודדים */}
                                {item.isSingle && (
                                  <span className="text-amber-700 text-xs mr-1">
                                    (בודדים)
                                  </span>
                                )}
                              </li>
                            ))}
                          </ul>
                        </div>
                        <PersonalRequestMessages
                          requestId={r.id}
                          currentUserType="CUSTOMER"
                          readOnly={r.status === "CANCELLED" || r.status === "DONE"}
                        />

                        {/* §73: ביטול הבקשה - כל עוד היא לא הסתיימה */}
                        {r.status !== "CANCELLED" && r.status !== "DONE" && (
                          <button
                            onClick={() => cancelRequest(r.id)}
                            disabled={cancelling === r.id}
                            className="w-full text-sm text-red-600 border border-red-300 rounded-lg py-2 hover:bg-red-50 disabled:opacity-50"
                          >
                            {cancelling === r.id ? "מבטל..." : "🗑️ ביטול הבקשה"}
                          </button>
                        )}
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
            <div className="space-y-6">
              {/* מוצרים מקובצים לפי קטגוריה - זהה למכירה רגילה */}
              {groupedProducts.groups.map(([cat, items]) => (
                <div key={cat}>
                  <div className="flex items-center gap-3 mb-3">
                    <div className="w-1 h-6 bg-brand-rust rounded-full"></div>
                    <h3 className="font-extrabold text-brand-slatedark text-lg">
                      {cat}
                    </h3>
                    <div className="flex-1 h-px bg-zinc-200"></div>
                    <span className="text-xs text-zinc-400 font-medium">{items.length} מוצרים</span>
                  </div>
                  <div className="space-y-2 md:grid md:grid-cols-2 md:gap-3 md:space-y-0">
                    {items.map((p) => (
                      <ProductRow
                        key={p.id}
                        product={p}
                        qty={cart[p.id] || 0}
                        onChange={(v) => setQty(p.id, v)}
                        isSingle={!!singles[p.id]}
                        onToggleSingle={(v) => setSingles((x) => ({ ...x, [p.id]: v }))}
                      />
                    ))}
                  </div>
                </div>
              ))}
              {groupedProducts.noCat.length > 0 && (
                <div>
                  {groupedProducts.groups.length > 0 && (
                    <div className="flex items-center gap-3 mb-3">
                      <div className="w-1 h-6 bg-zinc-300 rounded-full"></div>
                      <h3 className="font-extrabold text-brand-slatedark text-lg">
                        אחרים
                      </h3>
                      <div className="flex-1 h-px bg-zinc-200"></div>
                    </div>
                  )}
                  <div className="space-y-2 md:grid md:grid-cols-2 md:gap-3 md:space-y-0">
                    {groupedProducts.noCat.map((p) => (
                      <ProductRow
                        key={p.id}
                        product={p}
                        qty={cart[p.id] || 0}
                        onChange={(v) => setQty(p.id, v)}
                        isSingle={!!singles[p.id]}
                        onToggleSingle={(v) => setSingles((x) => ({ ...x, [p.id]: v }))}
                      />
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
  isSingle,
  onToggleSingle,
}: {
  product: PersonalProduct;
  qty: number;
  onChange: (v: number) => void;
  // §73: בודדים או קרטון - כמו במכירה הרגילה
  isSingle: boolean;
  onToggleSingle: (v: boolean) => void;
}) {
  const max = 99;
  return (
    <div
      className={`flex items-center gap-3 p-2.5 bg-white rounded-xl border transition-all ${
        qty > 0
          ? "border-brand-yellow ring-2 ring-brand-yellow/60"
          : "border-zinc-200/70 shadow-sm"
      }`}
    >
      {product.imageUrl && (
        <img
          src={product.imageUrl}
          alt={product.name}
          className="w-14 h-14 object-cover rounded-lg shrink-0 border border-zinc-200"
        />
      )}
      <div className="flex-1 min-w-0">
        <div className="font-medium text-brand-slatedark text-sm">
          {product.name}
        </div>
        {/* §73: תמונת הכשרות + השם, בדיוק כמו בהזמנה הרגילה.
            קודם הוצג רק טקסט, והלקוח לא זיהה את סמל הכשרות. */}
        {(product.kashrut || product.kashrutImageUrl) && (
          <div className="flex items-center gap-1.5 mt-1">
            {product.kashrutImageUrl && (
              <img
                src={product.kashrutImageUrl}
                alt={product.kashrut || "כשרות"}
                className="h-5 w-auto object-contain shrink-0"
              />
            )}
            {product.kashrut && (
              <span className="badge bg-sky-100 text-sky-700 text-xs">
                {product.kashrut}
              </span>
            )}
          </div>
        )}

        {/* §73: בורר קרטון/בודדים - מוצג רק כשהמוצר מאפשר, ורק
            אחרי שנבחרה כמות. לפני כן זו הצפה של שורה שלא נבחרה. */}
        {product.allowSingles && qty > 0 && (
          <div className="flex gap-1 mt-1.5">
            <button
              type="button"
              onClick={() => onToggleSingle(false)}
              className={`px-2 py-0.5 rounded text-[11px] font-bold border transition-colors ${
                !isSingle
                  ? "border-brand-rust bg-orange-50 text-brand-rust"
                  : "border-zinc-300 bg-white text-zinc-500"
              }`}
            >
              {product.unit === 'ק"ג' || !product.unit ? "קרטון" : product.unit}
            </button>
            <button
              type="button"
              onClick={() => onToggleSingle(true)}
              className={`px-2 py-0.5 rounded text-[11px] font-bold border transition-colors ${
                isSingle
                  ? "border-amber-600 bg-amber-50 text-amber-800"
                  : "border-zinc-300 bg-white text-zinc-500"
              }`}
            >
              {product.singlesMode === "UNITS" ? "יחידות" : 'בודדים (ק"ג)'}
            </button>
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
