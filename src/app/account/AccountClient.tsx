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
        {/* פרטי לקוח - עם avatar ועיצוב מוקפץ */}
        <div className="bg-white rounded-2xl shadow-lg border border-zinc-200 overflow-hidden">
          {/* Header עם רקע gradient עדין */}
          <div className="relative bg-gradient-to-br from-brand-yellow/40 via-brand-yellow/20 to-transparent px-6 py-5 border-b border-zinc-100">
            <div className="flex items-start gap-4">
              {/* Avatar עם initials */}
              <div className="shrink-0 w-16 h-16 rounded-full bg-gradient-to-br from-brand-rust to-[#a83a15] flex items-center justify-center text-white text-2xl font-extrabold shadow-md">
                {customer.name.trim().charAt(0)}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-xl font-extrabold text-brand-slatedark truncate">
                  {customer.name}
                </div>
                <div className="text-xs text-zinc-500 mt-0.5">
                  ברוכ/ה הבא/ה
                </div>
              </div>
              <button
                onClick={() => signOut({ callbackUrl: "/" })}
                className="shrink-0 text-xs text-zinc-500 hover:text-brand-rust flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-zinc-200 hover:border-brand-rust bg-white/60 backdrop-blur-sm transition-all"
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                </svg>
                יציאה
              </button>
            </div>
          </div>

          {/* Details עם אייקונים */}
          <div className="divide-y divide-zinc-100">
            {customer.phone && (
              <InfoRow
                iconPath="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z"
                label="טלפון"
                value={customer.phone}
              />
            )}
            {customer.email && (
              <InfoRow
                iconPath="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
                label="דוא״ל"
                value={customer.email}
              />
            )}
            {customer.cardLast4 && (
              <InfoRow
                iconPath="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z"
                label="כרטיס אשראי"
                value={`•••• ${customer.cardLast4}`}
              />
            )}
          </div>
        </div>

        {/* תחנה שמורה - מעוצב מחדש */}
        <div className="bg-white rounded-2xl border border-zinc-200 shadow-sm overflow-hidden">
          <div className="px-5 py-3.5 flex items-center justify-between border-b border-zinc-100 bg-zinc-50/50">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-brand-rust/10 flex items-center justify-center">
                <svg className="w-4 h-4 text-brand-rust" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
              </div>
              <span className="font-bold text-brand-slatedark text-sm">תחנת חלוקה שמורה</span>
            </div>
            <button
              onClick={() => setShowStationEdit(!showStationEdit)}
              className="text-xs text-brand-rust font-medium hover:underline"
            >
              {showStationEdit ? "ביטול" : "שינוי"}
            </button>
          </div>
          <div className="p-4">
          {!showStationEdit ? (
            <div className="text-sm text-brand-slatedark font-medium">
              {customer.defaultPointName || <span className="text-zinc-400 font-normal">לא נבחרה תחנה</span>}
              {pointSaved && (
                <span className="text-emerald-600 mr-2 text-xs inline-flex items-center gap-1">
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                  נשמר
                </span>
              )}
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
              <a
                href="/order"
                className="mt-4 inline-flex items-center gap-2 bg-brand-rust text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-[#a83a15] transition-all shadow-sm"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z" />
                </svg>
                להתחלת הזמנה
              </a>
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

// InfoRow - שורת פרטים עם אייקון SVG (בהגדרות אישיות)
function InfoRow({ iconPath, label, value }: { iconPath: string; label: string; value: string }) {
  return (
    <div className="px-5 py-3 flex items-center gap-3">
      <div className="shrink-0 w-9 h-9 rounded-lg bg-zinc-100 flex items-center justify-center">
        <svg className="w-4 h-4 text-zinc-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
          <path strokeLinecap="round" strokeLinejoin="round" d={iconPath} />
        </svg>
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-[11px] text-zinc-500 font-medium">{label}</div>
        <div className="text-sm text-brand-slatedark font-semibold truncate" dir="auto">{value}</div>
      </div>
    </div>
  );
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
