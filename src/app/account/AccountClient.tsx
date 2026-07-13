"use client";

import { useState } from "react";
import Link from "next/link";
import { signOut } from "next-auth/react";
import { Logo } from "@/components/Logo";
import { CustomerOrderActions } from "@/components/CustomerOrderActions";
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
  // שדות ל-§16: עריכה/ביטול
  customerName: string;
  phone: string;
  phone2: string | null;
  pointId: string;
  notes: string | null;
  pricelistCloseDate: string | null;
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
  // ניהול מייל + איפוס סיסמה עצמאי
  const [email, setEmail] = useState(customer.email ?? "");
  const [showEmailEdit, setShowEmailEdit] = useState(false);
  const [emailMsg, setEmailMsg] = useState("");
  const [emailErr, setEmailErr] = useState("");
  const [savingEmail, setSavingEmail] = useState(false);
  const [resetMsg, setResetMsg] = useState("");
  const [resetErr, setResetErr] = useState("");
  const [sendingReset, setSendingReset] = useState(false);
  const [currentEmail, setCurrentEmail] = useState(customer.email ?? "");

  async function saveEmail() {
    setEmailErr("");
    setEmailMsg("");
    setSavingEmail(true);
    try {
      const res = await fetch("/api/account", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "update-email", email }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "שגיאה");
      setCurrentEmail(data.email);
      setEmailMsg("המייל נשמר בהצלחה");
      setShowEmailEdit(false);
    } catch (e: any) {
      setEmailErr(e.message);
    } finally {
      setSavingEmail(false);
    }
  }

  async function sendPasswordReset() {
    setResetErr("");
    setResetMsg("");
    setSendingReset(true);
    try {
      const res = await fetch("/api/account", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "send-reset" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "שגיאה");
      setResetMsg(`נשלח קישור לאיפוס סיסמה אל ${data.sentTo}. בדוק גם בתיקיית הספאם.`);
    } catch (e: any) {
      setResetErr(e.message);
    } finally {
      setSendingReset(false);
    }
  }

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

        {/* הגדרות חשבון: מייל + סיסמה */}
        <div className="card p-5 space-y-4">
          <span className="font-bold text-brand-slatedark">הגדרות חשבון</span>

          {/* ניהול מייל */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <span className="text-sm text-zinc-600">כתובת מייל</span>
              <button
                onClick={() => {
                  setShowEmailEdit(!showEmailEdit);
                  setEmailErr("");
                  setEmailMsg("");
                }}
                className="text-sm text-brand-rust font-medium"
              >
                {showEmailEdit ? "ביטול" : currentEmail ? "שינוי" : "הוספת מייל"}
              </button>
            </div>
            {!showEmailEdit ? (
              <div className="text-sm text-zinc-500">
                {currentEmail || (
                  <span className="text-amber-600">
                    לא הוגדר מייל — הוסף כדי שתוכל לאפס סיסמה בעצמך
                  </span>
                )}
                {emailMsg && <span className="text-green-600 mr-2">✓ {emailMsg}</span>}
              </div>
            ) : (
              <div className="space-y-2">
                <input
                  className="input"
                  type="email"
                  dir="ltr"
                  placeholder="your@email.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
                {emailErr && <p className="text-sm text-red-600">{emailErr}</p>}
                <button
                  onClick={saveEmail}
                  disabled={savingEmail}
                  className="btn-primary btn-sm w-full"
                >
                  {savingEmail ? "שומר..." : "שמירת מייל"}
                </button>
              </div>
            )}
          </div>

          {/* איפוס סיסמה עצמאי */}
          <div className="border-t pt-3">
            <div className="text-sm text-zinc-600 mb-1">סיסמה</div>
            {currentEmail ? (
              <>
                <button
                  onClick={sendPasswordReset}
                  disabled={sendingReset}
                  className="btn-ghost btn-sm"
                >
                  {sendingReset ? "שולח..." : "שליחת קישור לאיפוס סיסמה למייל שלי"}
                </button>
                {resetMsg && (
                  <p className="text-sm text-green-700 bg-green-50 border border-green-200 rounded-lg p-2 mt-2">
                    {resetMsg}
                  </p>
                )}
                {resetErr && <p className="text-sm text-red-600 mt-2">{resetErr}</p>}
              </>
            ) : (
              <p className="text-xs text-zinc-400">
                כדי לאפס סיסמה בעצמך, הוסף תחילה כתובת מייל למעלה.
              </p>
            )}
          </div>
        </div>

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

                  {/* §16: כפתורי עריכה/ביטול לפני חתימת המכירה */}
                  <CustomerOrderActions
                    orderId={o.id}
                    orderNumber={o.orderNumber}
                    isEditable={computeIsEditable(o)}
                    editableUntil={
                      o.pricelistCloseDate
                        ? new Date(o.pricelistCloseDate).toLocaleDateString("he-IL", {
                            day: "2-digit",
                            month: "2-digit",
                            year: "numeric",
                          })
                        : null
                    }
                    currentValues={{
                      customerName: o.customerName,
                      phone: o.phone,
                      phone2: o.phone2,
                      pointId: o.pointId,
                      notes: o.notes,
                    }}
                    points={points}
                  />
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </main>
  );
}

// חישוב אם הזמנה ניתנת לעריכה/ביטול על ידי הלקוח.
// חוקים (זהים לחוקי הבדיקה בשרת ב-/api/customer/orders/[id]):
//   1. סטטוס לא CANCELLED / COMPLETED
//   2. finalTotal עדיין null (עוד לא נשקלה)
//   3. closeDate של המחירון בעתיד (או null)
function computeIsEditable(o: Order): boolean {
  if (o.status === "CANCELLED" || o.status === "COMPLETED") return false;
  if (o.finalTotal !== null) return false;
  if (o.pricelistCloseDate) {
    const closeDate = new Date(o.pricelistCloseDate);
    if (closeDate < new Date()) return false;
  }
  return true;
}
