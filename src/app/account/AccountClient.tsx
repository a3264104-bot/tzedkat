"use client";

import { useState } from "react";
import Link from "next/link";
import { signOut } from "next-auth/react";
import { Logo } from "@/components/Logo";
import { CustomerOrderActions } from "@/components/CustomerOrderActions";
import { STATUS_LABELS, PAYMENT_METHOD_LABELS, fmt } from "@/lib/pricing";

type OrderItem = {
  productName: string;
  unit: string;
  quantity: number;
  isSingle: boolean;
  imageUrl: string | null;
};

type Order = {
  id: string;
  orderNumber: number;
  status: string;
  paymentStatus: string;
  paymentMethod: string | null;
  paymentLink: string | null;
  pointName: string;
  pointAddress: string | null;
  pointDeliveryHours: string | null;
  deliveryDate: string | null;
  estimatedTotal: number;
  finalTotal: number | null;
  createdAt: string;
  itemCount: number;
  items: OrderItem[];
  // שדות ל-§16: עריכה/ביטול
  customerName: string;
  phone: string;
  phone2: string | null;
  pointId: string;
  notes: string | null;
  pricelistCloseDate: string | null;
  pricelistEditDeadline: string | null;
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
        <div className="mx-auto max-w-md md:max-w-4xl px-4 py-3 flex items-center justify-between">
          <Link href="/" className="text-brand-slate text-sm font-medium">
            דף הבית
          </Link>
          <span className="font-extrabold text-brand-rust">האזור האישי</span>
        </div>
      </header>

      <div className="mx-auto max-w-md md:max-w-4xl px-4 pt-6 space-y-5">
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
          <div className="flex items-center gap-3 mb-3">
            <div className="w-1 h-6 bg-brand-rust rounded-full"></div>
            <h2 className="font-extrabold text-brand-slatedark text-lg">ההזמנות שלי</h2>
            <div className="flex-1 h-px bg-zinc-200"></div>
            {orders.length > 0 && (
              <span className="text-xs text-zinc-400 font-medium">{orders.length}</span>
            )}
          </div>
          {orders.length === 0 ? (
            <div className="bg-white rounded-2xl border border-zinc-200 p-8 text-center">
              <div className="w-14 h-14 mx-auto mb-3 rounded-full bg-zinc-100 flex items-center justify-center">
                <svg className="w-7 h-7 text-zinc-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                </svg>
              </div>
              <p className="text-brand-slatedark font-semibold">אין הזמנות עדיין</p>
              <p className="text-sm text-zinc-500 mt-1">
                כשתבצע הזמנה, היא תוצג כאן.
              </p>
            </div>
          ) : (
            <div className="space-y-3 md:grid md:grid-cols-2 md:gap-3 md:space-y-0">
              {orders.map((o) => (
                <div key={o.id} className="bg-white rounded-2xl border border-zinc-200 shadow-sm overflow-hidden">
                  {/* Header with status */}
                  <div className="px-4 py-3 border-b border-zinc-100 flex justify-between items-center">
                    <div>
                      <div className="font-bold text-brand-slatedark">
                        הזמנה #{o.orderNumber}
                      </div>
                      <div className="text-xs text-zinc-400 mt-0.5">
                        {new Date(o.createdAt).toLocaleDateString("he-IL")}
                      </div>
                    </div>
                    <span
                      className={`px-3 py-1 rounded-full text-xs font-medium ${statusColors[o.status] ?? "bg-zinc-100 text-zinc-600"}`}
                    >
                      {STATUS_LABELS[o.status] ?? o.status}
                    </span>
                  </div>

                  {/* Timeline של סטטוס */}
                  <OrderTimeline status={o.status} paymentStatus={o.paymentStatus} />

                  <div className="px-4 py-3">

                  {/* §7: רשימת מוצרים עם תמונות */}
                  {o.items.length > 0 && (
                    <div className="mt-3 space-y-2">
                      {o.items.map((item, idx) => (
                        <div key={idx} className="flex items-center gap-3 text-sm">
                          {item.imageUrl && (
                            <img
                              src={item.imageUrl}
                              alt={item.productName}
                              className="w-10 h-10 rounded-lg object-cover flex-shrink-0"
                            />
                          )}
                          <div>
                            <span className="text-brand-slatedark font-medium">{item.productName}</span>
                            <span className="text-zinc-500 mr-2">
                              {item.quantity} {item.isSingle ? (item.unit === "ק\"ג" ? "ק\"ג" : "יח'") : item.unit}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* §7: פרטי איסוף — נקודה, תאריך, שעות */}
                  <div className="mt-3 pt-3 border-t border-zinc-100 text-sm text-zinc-600 space-y-1">
                    <div>📍 {o.pointName}{o.pointAddress ? ` — ${o.pointAddress}` : ""}</div>
                    {o.deliveryDate && <div>📦 חלוקה: {o.deliveryDate}</div>}
                    {o.pointDeliveryHours && <div>🕐 שעות: {o.pointDeliveryHours}</div>}
                  </div>

                  {/* כפתור תשלום - רק אם ממתין לתשלום ויש לינק */}
                  {o.status === "PAYMENT_PENDING" && o.paymentLink && (
                    <a
                      href={o.paymentLink}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="btn-primary w-full block text-center mt-3 btn-sm"
                    >
                      לתשלום ←
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
                      (o.pricelistEditDeadline || o.pricelistCloseDate)
                        ? new Date((o.pricelistEditDeadline || o.pricelistCloseDate)!).toLocaleDateString("he-IL", {
                            day: "2-digit",
                            month: "2-digit",
                            year: "numeric",
                            hour: "2-digit",
                            minute: "2-digit",
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
// עדיפות: editDeadline > closeDate (זהה לחוקי הבדיקה בשרת ב-/api/customer/orders/[id]):
function computeIsEditable(o: Order): boolean {
  if (o.status === "CANCELLED" || o.status === "COMPLETED") return false;
  if (o.finalTotal !== null) return false;
  const deadline = o.pricelistEditDeadline || o.pricelistCloseDate;
  if (deadline) {
    if (new Date(deadline) < new Date()) return false;
  }
  return true;
}

// Timeline של סטטוס הזמנה - 4 שלבים חזותיים
function OrderTimeline({ status, paymentStatus }: { status: string; paymentStatus?: string | null }) {
  if (status === "CANCELLED") return null;

  const steps = [
    { key: "received", label: "התקבלה", done: true },
    {
      key: "processing",
      label: "בטיפול",
      done: ["IN_PROGRESS", "READY", "COMPLETED"].includes(status) || paymentStatus === "PAID",
    },
    {
      key: "ready",
      label: "מוכן לאיסוף",
      done: ["READY", "COMPLETED"].includes(status),
    },
    {
      key: "paid",
      label: "חויב",
      done: paymentStatus === "PAID",
    },
  ];

  return (
    <div className="px-4 py-3 bg-zinc-50/50 border-b border-zinc-100">
      <div className="flex items-center">
        {steps.map((step, idx) => (
          <div key={step.key} className="flex items-center flex-1 last:flex-none">
            {/* Circle */}
            <div className="flex flex-col items-center">
              <div
                className={`w-6 h-6 rounded-full flex items-center justify-center transition-all ${
                  step.done
                    ? "bg-emerald-500 text-white shadow-sm"
                    : "bg-zinc-200 text-zinc-400"
                }`}
              >
                {step.done ? (
                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                ) : (
                  <span className="text-[9px] font-bold">{idx + 1}</span>
                )}
              </div>
              <span
                className={`text-[10px] mt-1 font-medium whitespace-nowrap ${
                  step.done ? "text-brand-slatedark" : "text-zinc-400"
                }`}
              >
                {step.label}
              </span>
            </div>
            {/* Connector line */}
            {idx < steps.length - 1 && (
              <div
                className={`flex-1 h-0.5 mx-1 -mt-4 ${
                  steps[idx + 1].done ? "bg-emerald-500" : "bg-zinc-200"
                }`}
              ></div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
