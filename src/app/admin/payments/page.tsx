"use client";

// מסך ניהול תשלומים.
//
// 🆕 נוסף פילטר מכירה. ברירת המחדל היא *כל המכירות* בכוונה - בניגוד למסך
//    ההזמנות. הסיבה: חיובים שנכשלו במכירות קודמות הם בדיוק מה שהמסך אמור
//    לתפוס, ופילטר שמסתיר אותם כברירת מחדל היה מסתיר כסף שממתין לגבייה.

import { useEffect, useState, useCallback } from "react";
import { payStatusLabel, payStatusColor, payStatusNeedsAttention } from "@/lib/pay-status-lib";

// מבנה PayOrder כפי שמוחזר מ-/api/admin/payments
type PayOrder = {
  id: string;
  orderNumber: number;
  customerName: string;
  phone: string;
  paymentStatus: string;
  paymentMethod: string | null;
  estimatedTotal: number | null;
  finalTotal: number | null;
  amountPaid: number | null;
  paidAt: string | null;
  paymentTransactionId: string | null;
  chargeAttempts: number;
  lastChargeError: string | null;
  lastChargeAt: string | null;
  createdAt: string;
  updatedAt: string;
  pointNameSnapshot: string | null;
  deliveryDateSnapshot: string | null;
  customer: {
    id: string;
    name: string;
    email: string | null;
    phone: string | null;
    hasToken: boolean;
    cardLast4: string | null;
    cardExpiry: string | null;
    cardVerifiedAt: string | null;
    cardNeedsUpdate: boolean;
    creditVerificationCharged: boolean;
  };
};

type Message = { text: string; type: "success" | "error" };
type Pricelist = { id: string; name: string; status: string };

const ALL = "__all__";

// אפשרויות סינון סטטוס
const FILTER_OPTIONS: { value: string; label: string }[] = [
  { value: "default", label: "פעולות פתוחות (ברירת מחדל)" },
  { value: "all", label: "כל הסטטוסים" },
  { value: "READY_TO_CHARGE", label: "מוכן לחיוב בלבד" },
  { value: "FAILED", label: "חיוב נכשל בלבד" },
  { value: "CARD_UPDATE_NEEDED", label: "נדרש עדכון כרטיס בלבד" },
  { value: "TOKEN_CREATED", label: "כרטיס נשמר בלבד" },
  { value: "AWAITING_WEIGHING", label: "ממתין לשקילה בלבד" },
  { value: "CHARGING", label: "בחיוב בלבד" },
  { value: "PAID", label: "שולם בלבד" },
];

// אילו סטטוסים מאפשרים ללחוץ "חייב עכשיו"?
//
// §250: 🐛 **הכפתור לא הופיע אף פעם.**
//
// התנאי היה READY_TO_CHARGE בלבד - אבל **אין בקוד שום מקום
// שמסמן הזמנה בסטטוס הזה**. הוא נקרא ב-admin-charge ונבדק כאן,
// ואף אחד לא כותב אותו.
//
// התוצאה: 4 הזמנות עם מחיר סופי נתקעו ב-PENDING, והמנהל ראה
// אותן במסך התשלומים בלי שום דרך לחייב.
//
// ⚠️ הקריטריון האמיתי הוא **מחיר סופי + לא שולם**, לא סטטוס.
// מחיר סופי אומר שהשקילה הסתיימה ויש מה לגבות.
//
// ⚠️ READY_TO_CHARGE נשאר ברשימה לתאימות אחורה - אם בעתיד
// יתווסף קוד שמסמן אותו, הוא ימשיך לעבוד.
function canCharge(
  status: string,
  finalTotal?: number | null,
  paymentStatus?: string
): boolean {
  if (status === "READY_TO_CHARGE" || status === "FAILED") return true;

  // ⚠️ כבר שולם - אין מה לחייב שוב.
  if (paymentStatus === "PAID") return false;

  // ⚠️ ממתין לתשלום אונליין: הלקוח באמצע תהליך, וחיוב מקביל
  // היה גובה פעמיים.
  if (paymentStatus === "PAYMENT_PENDING") return false;

  return finalTotal != null && finalTotal > 0;
}

function fmtIls(n: number | null): string {
  if (n === null || n === undefined) return "—";
  return `${n.toFixed(2)} ₪`;
}

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    return d.toLocaleString("he-IL", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

export default function PaymentsPage() {
  const [orders, setOrders] = useState<PayOrder[]>([]);
  const [lists, setLists] = useState<Pricelist[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<string>("default");
  const [fPricelist, setFPricelist] = useState<string>(ALL);
  const [charging, setCharging] = useState<string | null>(null);
  const [message, setMessage] = useState<Message | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);

  // טעינת רשימת המכירות לבורר (ברירת המחדל נשארת "כל המכירות")
  useEffect(() => {
    fetch("/api/admin/pricelists", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : []))
      .then((res: Pricelist[]) => setLists(Array.isArray(res) ? res : []))
      .catch(() => setLists([]));
  }, []);

  const fetchOrders = useCallback(async () => {
    setLoading(true);
    setFetchError(null);
    try {
      const q = new URLSearchParams();
      if (filter !== "default") q.set("status", filter);
      if (fPricelist !== ALL) q.set("pricelistId", fPricelist);
      const qs = q.toString();
      const url = qs ? `/api/admin/payments?${qs}` : "/api/admin/payments";
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        setFetchError(err.error || `שגיאה ${res.status}`);
        setOrders([]);
        return;
      }
      const data = await res.json();
      setOrders(Array.isArray(data.orders) ? data.orders : []);
    } catch (e: any) {
      setFetchError(`שגיאת רשת: ${e.message || "לא ידוע"}`);
      setOrders([]);
    } finally {
      setLoading(false);
    }
  }, [filter, fPricelist]);

  useEffect(() => {
    fetchOrders();
  }, [fetchOrders]);

  async function handleCharge(order: PayOrder) {
    const amount = order.finalTotal;
    if (amount === null) {
      setMessage({ text: "אין מחיר סופי - לא ניתן לחייב", type: "error" });
      return;
    }

    const confirmMsg =
      `לחייב את הזמנה #${order.orderNumber}?\n\n` +
      `לקוח: ${order.customerName}\n` +
      `סכום סופי: ${fmtIls(amount)}\n` +
      `כרטיס: ${order.customer.cardLast4 ? "****" + order.customer.cardLast4 : "לא ידוע"}` +
      (order.customer.creditVerificationCharged ? "" : `\n\n(1₪ של האימות יקוזז מהסכום)`);

    if (!confirm(confirmMsg)) return;

    setCharging(order.id);
    setMessage(null);
    try {
      const res = await fetch("/api/admin/charge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId: order.id }),
      });
      const data = await res.json();
      if (res.ok && data.ok) {
        setMessage({
          text: `הזמנה #${order.orderNumber} חויבה בהצלחה — ${fmtIls(data.amountCharged)}`,
          type: "success",
        });
      } else {
        setMessage({
          text: `חיוב הזמנה #${order.orderNumber} נכשל: ${data.error || "שגיאה לא ידועה"}`,
          type: "error",
        });
      }
    } catch (e: any) {
      setMessage({ text: `שגיאת רשת: ${e.message || "לא ידוע"}`, type: "error" });
    } finally {
      setCharging(null);
      await fetchOrders();
    }
  }

  const needAttentionCount = orders.filter((o) => payStatusNeedsAttention(o.paymentStatus)).length;
  const currentList = lists?.find((l) => l.id === fPricelist) ?? null;

  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto">
      {/* כותרת + סיכום */}
      <div className="flex flex-wrap items-center justify-between gap-4 mb-4">
        <div>
          <h1 className="text-2xl font-bold text-brand-slatedark">💳 ניהול תשלומים</h1>
          <p className="text-sm text-zinc-500 mt-1">
            {fPricelist === ALL
              ? "חיוב הזמנות בכרטיס השמור — כל המכירות"
              : currentList
                ? `חיוב הזמנות במכירה: ${currentList.name}`
                : "חיוב הזמנות בכרטיס השמור"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => fetchOrders()}
            className="px-3 py-2 bg-white border border-zinc-300 rounded-lg text-sm hover:bg-zinc-50"
            disabled={loading}
          >
            🔄 רענן
          </button>
        </div>
      </div>

      {/* באנר הודעה */}
      {message && (
        <div
          className={`mb-4 rounded-lg p-3 text-sm ${
            message.type === "success"
              ? "bg-emerald-50 text-emerald-800 border border-emerald-200"
              : "bg-red-50 text-red-800 border border-red-200"
          }`}
        >
          <div className="flex items-start justify-between gap-3">
            <div>{message.text}</div>
            <button
              onClick={() => setMessage(null)}
              className="text-lg leading-none opacity-70 hover:opacity-100"
            >
              ✕
            </button>
          </div>
        </div>
      )}

      {/* פילטרים */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        {/* מכירה - ברירת מחדל "כל המכירות" בכוונה */}
        <select
          value={fPricelist}
          onChange={(e) => setFPricelist(e.target.value)}
          disabled={!lists}
          aria-label="סינון לפי מכירה"
          className="px-3 py-2 bg-white border border-zinc-300 rounded-lg text-sm max-w-[240px]"
        >
          <option value={ALL}>כל המכירות</option>
          {lists?.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
              {l.status === "ACTIVE" ? " • פעילה" : ""}
            </option>
          ))}
        </select>

        <select
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          aria-label="סינון לפי סטטוס תשלום"
          className="px-3 py-2 bg-white border border-zinc-300 rounded-lg text-sm"
        >
          {FILTER_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>

        {needAttentionCount > 0 && filter === "default" && (
          <span className="text-sm bg-red-100 text-red-700 px-2.5 py-1 rounded-full font-medium">
            ⚠️ {needAttentionCount} דורש פעולה
          </span>
        )}

        {!loading && (
          <span className="text-sm text-zinc-500 mr-auto">{orders.length} הזמנות</span>
        )}
      </div>

      {/* שגיאת טעינה */}
      {fetchError && (
        <div className="bg-red-50 text-red-800 border border-red-200 rounded-lg p-4 mb-4 text-sm">
          שגיאה בטעינת רשימת התשלומים: {fetchError}
        </div>
      )}

      {loading && <div className="text-center py-12 text-zinc-500">טוען...</div>}

      {/* מצב ריק */}
      {!loading && !fetchError && orders.length === 0 && (
        <div className="text-center py-12 bg-white rounded-xl border border-zinc-200">
          <p className="font-medium text-brand-slatedark">אין הזמנות בסינון הנוכחי</p>
          <p className="text-sm text-zinc-500 mt-1">
            {fPricelist !== ALL
              ? "נסה לבחור מכירה אחרת או להציג את כל המכירות."
              : "אין כרגע הזמנות שדורשות פעולת תשלום."}
          </p>
        </div>
      )}

      {/* רשימת הזמנות */}
      {!loading && orders.length > 0 && (
        <div className="space-y-3">
          {orders.map((o) => (
            <OrderCard
              key={o.id}
              order={o}
              onCharge={() => handleCharge(o)}
              isCharging={charging === o.id}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// כרטיס הזמנה בודדת
// ═══════════════════════════════════════════════════════════════════
function OrderCard({
  order,
  onCharge,
  isCharging,
}: {
  order: PayOrder;
  onCharge: () => void;
  isCharging: boolean;
}) {
  const statusLabel = payStatusLabel(order.paymentStatus);
  const statusColor = payStatusColor(order.paymentStatus);
  const showCharge = canCharge(order.paymentStatus, order.finalTotal, order.paymentStatus);
  const cardBlocked = order.customer.cardNeedsUpdate;
  const hasFinalTotal = order.finalTotal !== null;

  return (
    <div className="bg-white rounded-xl border border-zinc-200 p-4 shadow-sm">
      {/* שורה עליונה: מספר + סטטוס + זמן */}
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <div className="flex items-center gap-3">
          <span className="text-lg font-bold text-brand-slatedark">#{order.orderNumber}</span>
          <span className={`px-2.5 py-1 rounded-full text-xs font-medium ${statusColor}`}>
            {statusLabel}
          </span>
          {order.chargeAttempts > 0 && (
            <span className="text-xs text-zinc-500">ניסיונות: {order.chargeAttempts}</span>
          )}
        </div>
        <div className="text-xs text-zinc-500">עודכן: {fmtDate(order.updatedAt)}</div>
      </div>

      {/* שורת פרטים */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-sm">
        <div>
          <div className="text-xs text-zinc-500 mb-0.5">לקוח</div>
          <div className="font-medium">{order.customerName}</div>
          <div dir="ltr" className="text-zinc-600 text-xs text-right">
            {order.phone}
          </div>
          {order.customer.email && (
            <div dir="ltr" className="text-zinc-500 text-xs text-right truncate">
              {order.customer.email}
            </div>
          )}
        </div>

        <div>
          <div className="text-xs text-zinc-500 mb-0.5">מחיר</div>
          {hasFinalTotal ? (
            <div>
              <div className="font-medium text-brand-slatedark">
                סופי: {fmtIls(order.finalTotal)}
              </div>
              {order.amountPaid !== null && (
                <div className="text-xs text-emerald-700">שולם: {fmtIls(order.amountPaid)}</div>
              )}
            </div>
          ) : (
            <div className="text-zinc-500">
              משוער: {fmtIls(order.estimatedTotal)}
              <div className="text-xs text-amber-700 mt-0.5">טרם נקבע מחיר סופי</div>
            </div>
          )}
        </div>

        <div>
          <div className="text-xs text-zinc-500 mb-0.5">כרטיס שמור</div>
          {order.customer.hasToken ? (
            <div>
              <div className="font-medium" dir="ltr">
                {order.customer.cardLast4 ? `****${order.customer.cardLast4}` : "טוקן שמור"}
              </div>
              {order.customer.cardExpiry && (
                <div className="text-xs text-zinc-600" dir="ltr">
                  תוקף: {order.customer.cardExpiry}
                </div>
              )}
              {cardBlocked && (
                <div className="text-xs text-orange-700 font-medium mt-1">⚠️ נדרש עדכון</div>
              )}
            </div>
          ) : (
            <div className="text-zinc-500 text-xs">אין כרטיס שמור</div>
          )}
        </div>
      </div>

      {/* נקודה + תאריך חלוקה */}
      {(order.pointNameSnapshot || order.deliveryDateSnapshot) && (
        <div className="mt-3 pt-3 border-t border-zinc-100 flex flex-wrap gap-x-4 gap-y-1 text-xs text-zinc-600">
          {order.pointNameSnapshot && <div>📍 {order.pointNameSnapshot}</div>}
          {order.deliveryDateSnapshot && <div>🗓 {order.deliveryDateSnapshot}</div>}
        </div>
      )}

      {/* שגיאה אחרונה */}
      {order.lastChargeError && (
        <div className="mt-3 bg-red-50 border border-red-200 rounded-lg p-2.5 text-xs text-red-800">
          <div className="font-medium mb-0.5">
            שגיאת חיוב אחרונה{order.lastChargeAt ? ` (${fmtDate(order.lastChargeAt)})` : ""}:
          </div>
          <div className="font-mono">{order.lastChargeError}</div>
        </div>
      )}

      {/* כפתור חיוב */}
      {showCharge && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            onClick={onCharge}
            disabled={isCharging || cardBlocked || !hasFinalTotal || !order.customer.hasToken}
            className="px-4 py-2 bg-brand-rust text-white rounded-lg text-sm font-medium hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {isCharging ? "מחייב..." : "💳 חייב עכשיו"}
          </button>
          {cardBlocked && (
            <span className="text-xs text-orange-700">
              הכרטיס מסומן כדורש עדכון - לא ניתן לחייב עד שהלקוח יזין כרטיס חדש
            </span>
          )}
          {!hasFinalTotal && (
            <span className="text-xs text-amber-700">יש לקבוע מחיר סופי לפני חיוב</span>
          )}
          {!order.customer.hasToken && (
            <span className="text-xs text-zinc-600">אין כרטיס שמור ללקוח</span>
          )}
        </div>
      )}
    </div>
  );
}
