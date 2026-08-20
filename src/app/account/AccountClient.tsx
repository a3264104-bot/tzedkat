"use client";

import { useState } from "react";
// §133: הערה לנציג ותשובתו
import { OrderNotePanel } from "@/components/OrderNotePanel";
import Link from "next/link";
import { signOut } from "next-auth/react";
import { CustomerOrderActions } from "@/components/CustomerOrderActions";
import { UpdateCardButton } from "@/components/UpdateCardButton";
import { RoleSwitcher } from "@/components/RoleSwitcher";
import { STATUS_LABELS, PAYMENT_METHOD_LABELS, fmt } from "@/lib/pricing";

type OrderItem = {
  id: string;
  productName: string;
  unit: string;
  quantity: number;
  isSingle: boolean;
  isCancelled: boolean;
  imageUrl: string | null;
  // §49: משקלים. estimatedWeight הוא הערכה ומוצג עם "כ-",
  // actualWeight הוא עובדה אחרי שקילה ומוצג בדיוק.
  // אופציונליים כי הזמנות ישנות עשויות להגיע בלעדיהם.
  estimatedWeight: number | null;
  actualWeight: number | null;
  // §59: פירוט חיוב. כולם snapshot מרגע ההזמנה/השקילה.
  unitPrice: number;
  estimatedPrice: number;
  finalPrice: number | null;
};

type Order = {
  id: string;
  orderNumber: number;
  status: string;
  paymentStatus: string;
  paymentMethod: string | null;
  paymentLink: string | null;
  // §133: הערת הלקוח ותשובת הנציג
  customerNote?: string | null;
  customerNoteAt?: string | null;
  agentReply?: string | null;
  agentReplyAt?: string | null;
  pointName: string;
  pointAddress: string | null;
  pointDeliveryHours: string | null;
  deliveryDate: string | null;
  estimatedTotal: number;
  finalTotal: number | null;
  amountPaid: number | null;
  createdAt: string;
  itemCount: number;
  items: OrderItem[];
  // §59: דמי הזמנה *נוכחיים* של המחירון — לא snapshot. משמש רק לזיהוי
  // שורת "דמי הזמנה" בפירוט (ראה BreakdownTotals), לא לחישוב.
  pricelistOrderFee: number | null;
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
  id: string;
  name: string;
  phone: string | null;
  phone2: string | null;
  email: string | null;
  cardLast4: string | null;
  defaultPointId: string | null;
  defaultPointName: string | null;
  agreedToEmails: boolean;
  /** §124: יתרת זכות שתקוזז מההזמנה הבאה */
  creditBalance?: number;
  // §64: תפקיד - נציג רואה מתג חזרה לאזור הנציג
  role?: string;
  // §64: השלמת הרשמה עצמאית ללקוח שנרשם בטלפון (סעיף 9)
  hasCard?: boolean;
  paymentPreference?: string;
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

// יחידת האריזה של הפריט. ברירת מחדל "קרטון" לפריטים ישנים שאין
// להם unit, אבל מוצר ארוז נמכר ביחידות ולא בקרטונים.
function packUnit(unit?: string | null): string {
  const u = (unit || "").trim();
  return u && u !== 'ק"ג' ? u : "קרטון";
}

// ריבוי בעברית. אות סופית חייבת להשתנות לפני הסיומת:
// "קרטון"+"ים" נותן "קרטוןים" שהוא שגוי.
function pluralizeUnit(u: string, n: number): string {
  if (n <= 1) return u;
  if (u.endsWith("ה")) return u.slice(0, -1) + "ות";
  const finals: Record<string, string> = { "ם": "מ", "ן": "נ", "ץ": "צ", "ף": "פ", "ך": "כ" };
  const last = u.slice(-1);
  return (finals[last] ? u.slice(0, -1) + finals[last] : u) + "ים";
}

// תצוגת כמות — אותה לוגיקה כמו במייל (qtyDisplay ב-email.ts).
function qtyDisplay(it: OrderItem): string {
  const qty = it.quantity;
  if (it.isSingle) {
    // בודדים - יחידות או ק"ג
    if (it.unit === "יחידה" || it.unit === "יחידות") {
      return qty === 1 ? "1 יחידה" : `${qty} יחידות`;
    }
    return `${qty} ק"ג`;
  }
  // 🐛 תוקן בעבר: הקוד קבע "תמיד קרטון" והתעלם מ-unit של המוצר.
  const u = packUnit(it.unit);
  return `${qty} ${pluralizeUnit(u, qty)}`;
}

// עיגול לאגורות. כל השוואות הכסף בפירוט נעשות באגורות שלמות כדי
// להימנע מבעיות float (0.1+0.2 !== 0.3).
function cents(n: number): number {
  return Math.round(n * 100);
}

// §59: על מה מחיר היחידה — לק"ג או ליחידה?
// קודם אימות מספרי מול מה שחויב בפועל (הכי אמין), ורק אם אין נתונים —
// כלל השקילה של §53: כל פריט נשקל ומחויב לפי ק"ג, למעט בודדים ביחידות.
function unitPriceBasis(it: OrderItem): string {
  const up = cents(it.unitPrice);
  if (up > 0 && it.finalPrice != null) {
    const ref = cents(it.finalPrice);
    if (it.actualWeight != null && Math.abs(ref - Math.round(it.actualWeight * up)) <= 2) {
      return 'לק"ג';
    }
    if (Math.abs(ref - Math.round(it.quantity * up)) <= 2) {
      return "ליחידה";
    }
  }
  if (it.isSingle && (it.unit === "יחידה" || it.unit === "יחידות")) return "ליחידה";
  return 'לק"ג';
}

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
  // §153: שינוי פרטי כניסה ישירות, בלי מייל
  const [showCredEdit, setShowCredEdit] = useState(false);
  const [credCurrent, setCredCurrent] = useState("");
  const [credNext, setCredNext] = useState("");
  const [credMsg, setCredMsg] = useState("");
  const [credErr, setCredErr] = useState("");
  const [savingCred, setSavingCred] = useState(false);
  // טלפון נוסף - ליצירת קשר בחלוקה
  const [phone2, setPhone2] = useState(customer.phone2 ?? "");
  const [showPhone2Edit, setShowPhone2Edit] = useState(false);
  const [phone2Msg, setPhone2Msg] = useState("");
  const [phone2Err, setPhone2Err] = useState("");
  const [savingPhone2, setSavingPhone2] = useState(false);
  // הזמנות ישנות - מוצגות רק אחרי לחיצה
  const [showHistory, setShowHistory] = useState(false);

  // הפרדה בין הזמנות פעילות להיסטוריות
  const activeOrders = orders.filter(
    (o) => o.status !== "CANCELLED" && o.status !== "COMPLETED"
  );
  const historyOrders = orders.filter(
    (o) => o.status === "CANCELLED" || o.status === "COMPLETED"
  );

  // §153: שינוי פרטי הכניסה.
  //
  // ⚠️ השרת שומר את הערך **בשני השדות** (loginCode + passwordHash),
  // וזה מה שמאפשר לו לשמש גם בכניסה לאתר וגם בהקראה בטלפון.
  async function saveCredential() {
    setCredErr("");
    setCredMsg("");
    setSavingCred(true);
    try {
      const res = await fetch("/api/customer/credential", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ current: credCurrent, next: credNext }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "שגיאה");
      setCredMsg(data.message || "הפרטים עודכנו");
      setShowCredEdit(false);
      setCredCurrent("");
      setCredNext("");
    } catch (e: any) {
      setCredErr(e.message);
    } finally {
      setSavingCred(false);
    }
  }

  async function savePhone2() {
    setPhone2Err("");
    setPhone2Msg("");
    setSavingPhone2(true);
    try {
      const cleaned = phone2.trim();
      const res = await fetch("/api/account", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "update-phone2", phone2: cleaned }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "שגיאה");
      setPhone2Msg("טלפון נוסף עודכן בהצלחה");
      setShowPhone2Edit(false);
    } catch (e: any) {
      setPhone2Err(e.message);
    } finally {
      setSavingPhone2(false);
    }
  }

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
        {/* §59: כרטיס ברכה מצומצם. ההזמנות עלו למעלה — זה מה שהלקוח
            בא לראות. הפרטים וההגדרות ירדו לתחתית העמוד. */}
        <div className="bg-white rounded-2xl shadow-lg border border-zinc-200 overflow-hidden">
          <div className="relative bg-gradient-to-br from-brand-yellow/40 via-brand-yellow/20 to-transparent px-5 py-4">
            <div className="flex items-center gap-4">
              <div className="shrink-0 w-12 h-12 rounded-full bg-gradient-to-br from-brand-rust to-[#a83a15] flex items-center justify-center text-white text-xl font-extrabold shadow-md">
                {customer.name.trim().charAt(0)}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-lg font-extrabold text-brand-slatedark truncate">
                  {customer.name}
                </div>
                <div className="text-xs text-zinc-500">ברוכ/ה הבא/ה</div>
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
            {/* §64: נציג שנמצא במצב לקוח - מתג חזרה (סעיף 5) */}
            {customer.role === "AGENT" && (
              <div className="mt-3">
                <RoleSwitcher mode="customer" />
              </div>
            )}
          </div>

          {/* §64: השלמת הרשמה עצמאית (סעיף 9).
              🐛 הפער: לקוח שנרשם בטלפון נשאר בלי כרטיס עד שנציג
              יטפל בו, ולא הייתה לו שום דרך להשלים בעצמו. עכשיו הוא
              נכנס עם הקוד שה-IVR הקריא לו, ומשלים כאן בלחיצה.
              לקוח מזומן לא רואה את זה - אצלו אין כרטיס בכוונה. */}
          {!customer.hasCard && customer.paymentPreference !== "CASH" && (
            <div className="mx-4 mb-4 bg-amber-50 border-2 border-amber-300 rounded-xl p-4">
              <div className="flex items-start gap-3">
                <div className="text-2xl shrink-0">💳</div>
                <div className="flex-1 min-w-0">
                  <div className="font-bold text-amber-900 text-sm">
                    נותר שלב אחד להשלמת החשבון
                  </div>
                  <p className="text-xs text-amber-800 mt-1 leading-relaxed">
                    כדי לבצע הזמנות יש להוסיף כרטיס אשראי. יבוצע חיוב אימות
                    של 1 ש&quot;ח בלבד, שיקוזז מההזמנה הראשונה שלך.
                  </p>
                  <div className="mt-3">
                    <UpdateCardButton
                      customerId={customer.id}
                      hasCurrentCard={false}
                      onSuccess={() => window.location.reload()}
                    />
                  </div>
                </div>
              </div>
            </div>
          )}
          {/* §124: יתרת זכות.

              ⚠️ מוצגת גבוה בעמוד ורק כשיש יתרה. זה כסף שמגיע
              ללקוח, והוא צריך לראות אותו בלי לחפש - אחרת הוא
              יפנה לנציג לשאול, או שלא יידע בכלל. */}
          {!!customer.creditBalance && customer.creditBalance > 0 && (
            <div className="px-4 pb-2">
              <div className="bg-emerald-50 border-2 border-emerald-300 rounded-xl p-3.5">
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <div>
                    <div className="font-extrabold text-emerald-800">
                      ↩️ יתרת זכות: {fmt(customer.creditBalance)}
                    </div>
                    <div className="text-xs text-emerald-700 mt-0.5 leading-relaxed">
                      הסכום יקוזז אוטומטית מההזמנה הבאה שלך. אין צורך לעשות
                      דבר.
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* באנר הסכמת מיילים — נשאר גבוה בעמוד כדי שלא ייקבר */}
          {!customer.agreedToEmails && customer.email && (
            <div className="px-4 pb-2">
              <ConsentBanner customerId={customer.id} />
            </div>
          )}
        </div>

        {/* §73: כפתור הזמנה חדשה - רק כשיש מכירה פעילה *וגם* הזמנות
            קיימות. כשאין הזמנות, כרטיס "אין הזמנות פעילות" שמתחת הוא
            הקריאה לפעולה - עם כפתור משלו - ושני כפתורים זהים אחד מעל
            השני נראו כמו כפל מסך. */}
        {hasActiveSale && activeOrders.length > 0 && (
          <Link href="/order" className="btn-primary w-full block text-center">
            הזמנה חדשה ←
          </Link>
        )}

        {/* הזמנות פעילות */}
        <div>
          <div className="flex items-center gap-3 mb-3">
            <div className="w-1 h-6 bg-brand-rust rounded-full"></div>
            <h2 className="font-extrabold text-brand-slatedark text-lg">
              {/* §73: כשאין הזמנות, הכרטיס שמתחת כבר אומר "אין הזמנות
                  פעילות" - הכותרת לא חוזרת עליו */}
              ההזמנות שלי
            </h2>
            <div className="flex-1 h-px bg-zinc-200"></div>
            {activeOrders.length > 0 && (
              <span className="text-xs text-zinc-400 font-medium">
                {activeOrders.length}
              </span>
            )}
          </div>
          {activeOrders.length === 0 ? (
            <div className="bg-white rounded-2xl border border-zinc-200 p-8 text-center">
              <div className="w-14 h-14 mx-auto mb-3 rounded-full bg-zinc-100 flex items-center justify-center">
                <svg
                  className="w-7 h-7 text-zinc-400"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={1.5}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"
                  />
                </svg>
              </div>
              <p className="text-brand-slatedark font-semibold">
                אין הזמנות פעילות
              </p>
              {hasActiveSale ? (
                <>
                  <p className="text-sm text-zinc-500 mt-1">
                    יש מכירה פעילה! לחץ להתחלת הזמנה חדשה
                  </p>
                  <a
                    href="/order"
                    className="mt-4 inline-flex items-center gap-2 bg-brand-rust text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-[#a83a15] transition-all shadow-sm"
                  >
                    <svg
                      className="w-4 h-4"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={2}
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z"
                      />
                    </svg>
                    להתחלת הזמנה
                  </a>
                </>
              ) : (
                <p className="text-sm text-zinc-500 mt-1">
                  ההרשמה למכירה הבאה תיפתח בקרוב
                </p>
              )}
            </div>
          ) : (
            <div className="space-y-3 md:grid md:grid-cols-2 md:gap-3 md:space-y-0">
              {activeOrders.map((o) => (
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
                    {/* §59: פירוט חיוב מלא — פריטים, משקל, מחיר ליחידה, סיכום */}
                    <OrderBreakdown o={o} />

                    {/* §7: פרטי איסוף — נקודה, תאריך, שעות */}
                    <div className="mt-3 pt-3 border-t border-zinc-100 text-sm text-zinc-600 space-y-1">
                      <div>📍 {o.pointName}{o.pointAddress ? ` — ${o.pointAddress}` : ""}</div>
                      {o.deliveryDate && <div>📦 חלוקה: {o.deliveryDate}</div>}
                      {o.pointDeliveryHours && <div>🕐 שעות: {o.pointDeliveryHours}</div>}
                    </div>

                    {/* §133: הערה לנציג ותשובתו.

                        ⚠️ ניתן לכתוב רק בהזמנה פעילה. הזמנה שנמסרה
                        או בוטלה - הנציג כבר לא יראה את ההערה, ואין
                        טעם לאפשר לכתוב לחלל. */}
                    <div className="mt-3">
                      <OrderNotePanel
                        orderId={o.id}
                        note={o.customerNote ?? null}
                        noteAt={o.customerNoteAt ?? null}
                        reply={o.agentReply ?? null}
                        replyAt={o.agentReplyAt ?? null}
                        mode="customer"
                        editable={
                          o.status !== "CANCELLED" && o.status !== "COMPLETED"
                        }
                      />
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

          {/* היסטוריה - accordion */}
          {historyOrders.length > 0 && (
            <div className="mt-6">
              <button
                onClick={() => setShowHistory(!showHistory)}
                className="w-full flex items-center justify-between gap-3 bg-white rounded-xl border border-zinc-200 p-3 hover:bg-zinc-50 transition-colors"
              >
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full bg-zinc-100 flex items-center justify-center">
                    <svg
                      className="w-4 h-4 text-zinc-500"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={2}
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
                      />
                    </svg>
                  </div>
                  <div className="text-right">
                    <div className="font-bold text-brand-slatedark text-sm">
                      היסטוריית הזמנות
                    </div>
                    <div className="text-xs text-zinc-500">
                      {historyOrders.length} הזמנות ישנות
                    </div>
                  </div>
                </div>
                <svg
                  className={`w-5 h-5 text-zinc-400 transition-transform ${
                    showHistory ? "rotate-180" : ""
                  }`}
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M19 9l-7 7-7-7"
                  />
                </svg>
              </button>

              {showHistory && (
                <div className="mt-3 space-y-2">
                  {historyOrders.map((o) => (
                    <HistoryOrderCard key={o.id} o={o} />
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* §59: פרטים והגדרות — כל מה שאינו הזמנות, בכרטיס אחד בתחתית */}
        <div className="bg-white rounded-2xl border border-zinc-200 shadow-sm overflow-hidden">
          <div className="px-5 py-3.5 flex items-center gap-2 border-b border-zinc-100 bg-zinc-50/50">
            <div className="w-8 h-8 rounded-lg bg-brand-rust/10 flex items-center justify-center">
              <svg className="w-4 h-4 text-brand-rust" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            </div>
            <span className="font-bold text-brand-slatedark text-sm">פרטים והגדרות</span>
          </div>

          <div className="divide-y divide-zinc-100">
            {customer.phone && (
              <InfoRow
                iconPath="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z"
                label="טלפון"
                value={customer.phone}
              />
            )}

            {/* §153: שינוי פרטי הכניסה - ישירות, בלי מייל.

                🐛 הפער: הדרך היחידה הייתה "שלח קישור למייל". לרוב
                הלקוחות אין מייל, ולכן לא הייתה להם שום דרך לשנות -
                הם היו תקועים עם מה שהמערכת נתנה, או נאלצים להתקשר
                לנציג.

                ⚠️ הערך נשמר בשני השדות (loginCode + passwordHash)
                ולכן הוא **אחד**: משמש בכניסה לאתר, ונשמע גם במערכת
                הטלפונית. */}
            <div className="px-5 py-3">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-start gap-3">
                  <svg className="w-5 h-5 text-brand-slate mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
                  </svg>
                  <div>
                    <div className="text-xs text-zinc-500">פרטי כניסה</div>
                    <div className="text-sm text-brand-slatedark">
                      משמשים בכניסה לאתר ונשמעים במערכת הטלפונית
                    </div>
                  </div>
                </div>
                {!showCredEdit && (
                  <button
                    onClick={() => {
                      setShowCredEdit(true);
                      setCredErr("");
                      setCredMsg("");
                    }}
                    className="text-xs text-brand-rust font-bold hover:underline shrink-0"
                  >
                    ✏️ שינוי
                  </button>
                )}
              </div>

              {showCredEdit && (
                <div className="mt-3 space-y-2">
                  <div>
                    <label className="text-[11px] text-zinc-500 block mb-0.5">
                      הפרטים הנוכחיים
                    </label>
                    <input
                      className="input"
                      type="text"
                      dir="ltr"
                      autoComplete="current-password"
                      value={credCurrent}
                      onChange={(e) => setCredCurrent(e.target.value)}
                    />
                  </div>
                  <div>
                    <label className="text-[11px] text-zinc-500 block mb-0.5">
                      פרטים חדשים
                    </label>
                    <input
                      className="input"
                      type="text"
                      dir="ltr"
                      autoComplete="new-password"
                      maxLength={12}
                      value={credNext}
                      onChange={(e) => setCredNext(e.target.value)}
                    />
                    {/* ⚠️ ההגבלה מוסברת מראש: לקוח שיקליד עברית
                        ויידחה לא יבין למה, ואם נסביר רק בשגיאה הוא
                        כבר יתוסכל. */}
                    <p className="text-[10px] text-zinc-500 mt-1 leading-relaxed">
                      4 עד 12 תווים, אותיות באנגלית וספרות בלבד — כדי
                      שנוכל להקריא אותם במערכת הטלפונית.
                    </p>
                  </div>
                  {credErr && <p className="text-sm text-red-600">{credErr}</p>}
                  <div className="flex gap-2">
                    <button
                      onClick={() => {
                        setShowCredEdit(false);
                        setCredCurrent("");
                        setCredNext("");
                        setCredErr("");
                      }}
                      disabled={savingCred}
                      className="btn-ghost btn-sm flex-1"
                    >
                      ביטול
                    </button>
                    <button
                      onClick={saveCredential}
                      disabled={savingCred || !credCurrent || !credNext}
                      className="btn-primary btn-sm flex-1"
                    >
                      {savingCred ? "שומר..." : "שמירה"}
                    </button>
                  </div>
                </div>
              )}
              {credMsg && !showCredEdit && (
                <p className="text-emerald-700 text-xs mt-2 bg-emerald-50 border border-emerald-200 rounded-lg p-2">
                  ✓ {credMsg}
                </p>
              )}

              {/* איפוס דרך מייל - נשאר כאפשרות נוספת למי שיש לו */}
              {currentEmail && !showCredEdit && (
                <div className="mt-2 pt-2 border-t border-zinc-100">
                  <button
                    onClick={sendPasswordReset}
                    disabled={sendingReset}
                    className="text-[11px] text-zinc-500 hover:text-brand-rust underline"
                  >
                    {sendingReset ? "שולח..." : "או: שליחת קישור איפוס למייל"}
                  </button>
                  {resetMsg && (
                    <p className="text-xs text-green-700 bg-green-50 border border-green-200 rounded-lg p-2 mt-2">
                      {resetMsg}
                    </p>
                  )}
                  {resetErr && <p className="text-xs text-red-600 mt-2">{resetErr}</p>}
                </div>
              )}
            </div>

            {/* טלפון נוסף - ליצירת קשר בעת חלוקה */}
            <div className="px-5 py-3">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <div className="flex items-start gap-3">
                  <svg
                    className="w-5 h-5 text-brand-slate mt-0.5"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={2}
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z"
                    />
                  </svg>
                  <div>
                    <div className="text-xs text-zinc-500">
                      טלפון נוסף לחלוקה
                    </div>
                    {!showPhone2Edit && (
                      <div className="text-sm text-brand-slatedark" dir="ltr">
                        {phone2 || (
                          <span className="text-zinc-400 italic">
                            לא הוגדר
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                </div>
                {!showPhone2Edit && (
                  <button
                    onClick={() => setShowPhone2Edit(true)}
                    className="text-xs text-brand-rust font-bold hover:underline"
                  >
                    {phone2 ? "✏️ עריכה" : "➕ הוסף"}
                  </button>
                )}
              </div>

              {showPhone2Edit && (
                <div className="mt-3 space-y-2">
                  <input
                    type="tel"
                    value={phone2}
                    onChange={(e) => setPhone2(e.target.value)}
                    placeholder="050-1234567"
                    dir="ltr"
                    className="w-full px-3 py-2 border-2 border-zinc-300 rounded-lg focus:outline-none focus:border-brand-rust"
                  />
                  <p className="text-[10px] text-zinc-500">
                    💡 טלפון נוסף לשימוש אם הראשי לא עונה בזמן חלוקת ההזמנה
                  </p>
                  <div className="flex gap-2">
                    <button
                      onClick={() => {
                        setPhone2(customer.phone2 ?? "");
                        setShowPhone2Edit(false);
                        setPhone2Err("");
                        setPhone2Msg("");
                      }}
                      disabled={savingPhone2}
                      className="btn-ghost btn-sm flex-1"
                    >
                      ביטול
                    </button>
                    <button
                      onClick={savePhone2}
                      disabled={savingPhone2}
                      className="btn-primary btn-sm flex-1"
                    >
                      {savingPhone2 ? "שומר..." : "שמור"}
                    </button>
                  </div>
                  {phone2Err && (
                    <p className="text-red-600 text-xs">{phone2Err}</p>
                  )}
                </div>
              )}
              {phone2Msg && !showPhone2Edit && (
                <p className="text-emerald-700 text-xs mt-1">✓ {phone2Msg}</p>
              )}
            </div>

            {/* מייל — תצוגה ועריכה במקום אחד (§59: אוחד מ"הגדרות חשבון") */}
            <div className="px-5 py-3">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-start gap-3">
                  <svg className="w-5 h-5 text-brand-slate mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                  </svg>
                  <div>
                    <div className="text-xs text-zinc-500">דוא״ל</div>
                    {!showEmailEdit && (
                      <div className="text-sm text-brand-slatedark" dir="ltr">
                        {currentEmail || (
                          <span className="text-amber-600 italic" dir="rtl">
                            לא הוגדר — הוסף כדי לקבל אישורי הזמנה ותשלום
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                </div>
                {!showEmailEdit && (
                  <button
                    onClick={() => {
                      setShowEmailEdit(true);
                      setEmailErr("");
                      setEmailMsg("");
                    }}
                    className="text-xs text-brand-rust font-bold hover:underline"
                  >
                    {currentEmail ? "✏️ שינוי" : "➕ הוסף"}
                  </button>
                )}
              </div>
              {showEmailEdit && (
                <div className="mt-3 space-y-2">
                  <input
                    className="input"
                    type="email"
                    dir="ltr"
                    placeholder="your@email.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                  {emailErr && <p className="text-sm text-red-600">{emailErr}</p>}
                  <div className="flex gap-2">
                    <button
                      onClick={() => {
                        setEmail(currentEmail);
                        setShowEmailEdit(false);
                        setEmailErr("");
                      }}
                      disabled={savingEmail}
                      className="btn-ghost btn-sm flex-1"
                    >
                      ביטול
                    </button>
                    <button
                      onClick={saveEmail}
                      disabled={savingEmail}
                      className="btn-primary btn-sm flex-1"
                    >
                      {savingEmail ? "שומר..." : "שמירת מייל"}
                    </button>
                  </div>
                </div>
              )}
              {emailMsg && !showEmailEdit && (
                <p className="text-emerald-700 text-xs mt-1">✓ {emailMsg}</p>
              )}
            </div>

            {/* כרטיס אשראי */}
            <div className="px-5 py-3 flex items-center justify-between gap-2 flex-wrap">
              <div className="flex items-start gap-3">
                <svg
                  className={`w-5 h-5 mt-0.5 ${customer.cardLast4 ? "text-brand-slate" : "text-zinc-400"}`}
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z"
                  />
                </svg>
                <div>
                  <div className="text-xs text-zinc-500">כרטיס אשראי</div>
                  {customer.cardLast4 ? (
                    <div className="font-medium text-brand-slatedark" dir="ltr">
                      •••• {customer.cardLast4}
                    </div>
                  ) : (
                    <div className="text-sm text-zinc-400">אין כרטיס שמור</div>
                  )}
                </div>
              </div>
              <UpdateCardButton
                customerId={customer.id}
                hasCurrentCard={!!customer.cardLast4}
                cardLast4={customer.cardLast4 ?? undefined}
                onSuccess={() => window.location.reload()}
              />
            </div>

            {/* תחנת חלוקה שמורה */}
            <div className="px-5 py-3">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-start gap-3">
                  <svg className="w-5 h-5 text-brand-slate mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                  </svg>
                  <div>
                    <div className="text-xs text-zinc-500">תחנת חלוקה שמורה</div>
                    {!showStationEdit && (
                      <div className="text-sm text-brand-slatedark font-medium">
                        {customer.defaultPointName || (
                          <span className="text-zinc-400 font-normal">לא נבחרה תחנה</span>
                        )}
                        {pointSaved && (
                          <span className="text-emerald-600 mr-2 text-xs">✓ נשמר</span>
                        )}
                      </div>
                    )}
                  </div>
                </div>
                <button
                  onClick={() => setShowStationEdit(!showStationEdit)}
                  className="text-xs text-brand-rust font-bold hover:underline"
                >
                  {showStationEdit ? "ביטול" : "✏️ שינוי"}
                </button>
              </div>
              {showStationEdit && (
                <div className="mt-3 space-y-2">
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

// ═══════════════════════════════════════════════════════════
// §59: פירוט חיוב מלא — כמו במייל החיוב
// ═══════════════════════════════════════════════════════════

// שורת פריט: מוצר + כמות + משקל מימין, מחיר ליחידה + סה"כ לשורה משמאל.
function ItemRow({ it }: { it: OrderItem }) {
  // פריט שבוטל — מוצג מחוק ובלי מחירים, כדי שיהיה ברור שלא חויב
  if (it.isCancelled) {
    return (
      <div className="flex items-center gap-3 text-sm py-2 opacity-60">
        <div className="flex-1 min-w-0">
          <span className="text-zinc-500 line-through">{it.productName}</span>
          <span className="text-[10px] bg-red-100 text-red-600 px-1.5 py-0.5 rounded font-bold mr-1.5">
            בוטל
          </span>
        </div>
        <div className="text-xs text-zinc-400 shrink-0">לא חויב</div>
      </div>
    );
  }

  return (
    <div className="flex items-start gap-3 text-sm py-2">
      {it.imageUrl && (
        <img
          src={it.imageUrl}
          alt={it.productName}
          className="w-10 h-10 rounded-lg object-cover flex-shrink-0"
        />
      )}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-brand-slatedark font-medium">
            {it.productName}
          </span>
          {it.isSingle ? (
            <span className="text-[10px] bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded font-bold shrink-0">
              בודדים
            </span>
          ) : (
            <span className="text-[10px] bg-orange-100 text-orange-700 px-1.5 py-0.5 rounded font-bold shrink-0">
              {packUnit(it.unit)}
            </span>
          )}
        </div>
        <div className="text-xs text-zinc-500 mt-0.5 font-medium">
          {qtyDisplay(it)}
        </div>
        {/* §49: משקל. אחרי שקילה מוצג המשקל המדויק, ולפניה ההערכה עם
            "כ-" - כדי שהלקוח לא יצפה בדיוק לכמות המשוערת. */}
        {it.actualWeight != null ? (
          <div className="text-[11px] text-emerald-700 font-medium">
            נשקל: {it.actualWeight.toFixed(2)} ק&quot;ג
          </div>
        ) : it.estimatedWeight != null ? (
          <div className="text-[11px] text-zinc-500">
            משקל משוער: כ-{it.estimatedWeight.toFixed(1)} ק&quot;ג
          </div>
        ) : null}
      </div>
      {/* §59: עמודת המחירים. סה"כ סופי מודגש אם הפריט נשקל וחושב,
          אחרת המשוער עם "כ-" — אותו כלל כמו במשקל. */}
      <div className="text-left shrink-0">
        {it.unitPrice > 0 && (
          <div className="text-[11px] text-zinc-400" dir="rtl">
            {fmt(it.unitPrice)} {unitPriceBasis(it)}
          </div>
        )}
        {it.finalPrice != null ? (
          <div className="font-bold text-brand-slatedark text-sm">
            {fmt(it.finalPrice)}
          </div>
        ) : (
          <div className="text-zinc-500 text-sm">כ-{fmt(it.estimatedPrice)}</div>
        )}
      </div>
    </div>
  );
}

// סיכום החיוב מתחת לפריטים.
//
// העיקרון: estimatedTotal/finalTotal על ההזמנה הם מקור האמת (חושבו
// בשרת ברגע ההזמנה/השקילה). סכום הפריטים נגזר מה-snapshots, וההפרש
// ביניהם מוצג כשורה — כך הטבלה תמיד מתכנסת בדיוק לסה"כ האמיתי.
//
// ההפרש נקרא "דמי הזמנה" רק אם הוא שווה בדיוק ל-orderFee הנוכחי של
// המחירון. orderFee אינו snapshot — אם הוא השתנה מאז ההזמנה, או אם
// קוזז ממנו שקל האימות (§46, מסומן ברמת הלקוח ולא ברמת ההזמנה), אי
// אפשר לפרק את ההפרש בוודאות — ואז הוא מוצג בשם כללי ולא מומצא.
function BreakdownTotals({ o }: { o: Order }) {
  const isFinal = o.finalTotal != null;

  // בסבב המשוער נסכמים כל הפריטים (כמו estimatedTotal שחושב ביצירה);
  // בסבב הסופי — רק פריטים שלא בוטלו, לפי finalPrice.
  const itemsSumC = o.items.reduce((sum, it) => {
    if (isFinal) {
      if (it.isCancelled) return sum;
      return sum + cents(it.finalPrice ?? it.estimatedPrice);
    }
    return sum + cents(it.estimatedPrice);
  }, 0);

  const totalC = cents(isFinal ? (o.finalTotal as number) : o.estimatedTotal);
  const diffC = totalC - itemsSumC;
  const feeC = o.pricelistOrderFee != null ? cents(o.pricelistOrderFee) : null;

  const diffLabel =
    diffC === 0
      ? null
      : feeC != null && diffC === feeC
        ? "דמי הזמנה"
        : diffC > 0
          ? "דמי הזמנה והתאמות"
          : "קיזוז";

  const paid = o.paymentStatus === "PAID";
  const amountPaidC = o.amountPaid != null ? cents(o.amountPaid) : null;

  return (
    <div className="mt-2 pt-2 border-t border-zinc-200 text-sm space-y-1">
      <div className="flex items-center justify-between text-zinc-600">
        <span>סה&quot;כ מוצרים</span>
        <span>{fmt(itemsSumC / 100)}</span>
      </div>
      {diffLabel && (
        <div className="flex items-center justify-between text-zinc-600">
          <span>{diffLabel}</span>
          <span>
            {diffC < 0 ? "-" : ""}
            {fmt(Math.abs(diffC) / 100)}
          </span>
        </div>
      )}
      <div className="flex items-center justify-between font-bold text-brand-slatedark pt-1 border-t border-zinc-100">
        <span>{isFinal ? "סה\"כ לחיוב" : "סה\"כ משוער"}</span>
        <span>
          {isFinal ? "" : "כ-"}
          {fmt(totalC / 100)}
        </span>
      </div>
      {/* מצב תשלום */}
      {paid ? (
        <div className="flex items-center justify-between text-green-700 font-medium text-xs pt-0.5">
          <span>
            ✓ שולם
            {o.paymentMethod && ` (${PAYMENT_METHOD_LABELS[o.paymentMethod] ?? ""})`}
          </span>
          {/* אם שולם סכום שונה מהסה"כ (תשלום חלקי / עיגול) — מציגים אותו */}
          {amountPaidC != null && amountPaidC !== totalC && (
            <span>{fmt(amountPaidC / 100)}</span>
          )}
        </div>
      ) : o.status === "CANCELLED" ? null : o.paymentStatus === "PAYMENT_PENDING" ? (
        <div className="text-amber-700 font-medium text-xs pt-0.5">ממתין לתשלום</div>
      ) : o.paymentStatus === "FAILED" ? (
        <div className="text-red-600 font-medium text-xs pt-0.5">החיוב נכשל — ננסה שוב</div>
      ) : !isFinal ? (
        <div className="text-zinc-400 text-xs pt-0.5">
          המחיר הסופי ייקבע לאחר שקילה
        </div>
      ) : null}
    </div>
  );
}

// הפירוט המלא: רשימת הפריטים + סיכום. משמש גם בהזמנות פעילות
// (פרוס) וגם בהיסטוריה (נפתח בלחיצה).
function OrderBreakdown({ o }: { o: Order }) {
  return (
    <div>
      {o.items.length > 0 && (
        <div className="divide-y divide-zinc-50">
          {o.items.map((it) => (
            <ItemRow key={it.id} it={it} />
          ))}
        </div>
      )}
      <BreakdownTotals o={o} />
    </div>
  );
}

// §59: כרטיס הזמנה בהיסטוריה — מכווץ כברירת מחדל.
// רוב הזמן הלקוח רוצה "כמה שילמתי"; לחיצה פותחת "על מה בדיוק".
function HistoryOrderCard({ o }: { o: Order }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="bg-white rounded-xl border border-zinc-200 overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="w-full p-3 text-right hover:bg-zinc-50 transition-colors"
      >
        <div className="flex items-center justify-between gap-2 mb-2">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-bold text-brand-slatedark text-sm">
              #{o.orderNumber}
            </span>
            <span
              className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${
                statusColors[o.status] ?? "bg-zinc-100 text-zinc-600"
              }`}
            >
              {STATUS_LABELS[o.status] ?? o.status}
            </span>
            {o.paymentStatus === "PAID" && (
              <span className="text-[10px] text-green-700 font-bold">✓ שולם</span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-zinc-500">
              {new Date(o.createdAt).toLocaleDateString("he-IL", {
                day: "2-digit",
                month: "2-digit",
                year: "2-digit",
              })}
            </span>
            <svg
              className={`w-4 h-4 text-zinc-400 transition-transform ${open ? "rotate-180" : ""}`}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
            </svg>
          </div>
        </div>
        <div className="text-xs text-zinc-600 flex items-center justify-between">
          <span>
            📍 {o.pointName}
            {o.deliveryDate && ` · 🗓 ${o.deliveryDate}`}
            {" · "}
            {o.itemCount} פריטים
          </span>
          <span className="font-bold text-brand-slatedark">
            {o.finalTotal == null && "כ-"}
            {fmt(o.finalTotal ?? o.estimatedTotal)}
          </span>
        </div>
      </button>

      {open && (
        <div className="px-3 pb-3 border-t border-zinc-100">
          <OrderBreakdown o={o} />
        </div>
      )}
    </div>
  );
}

// InfoRow - שורת פרטים עם אייקון SVG (בפרטים והגדרות)
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

// Timeline של סטטוס הזמנה - 4 שלבים חזותיים.
//
// 🐛 §59: השלבים הישנים בדקו סטטוסים שלא קיימים במערכת
// ("IN_PROGRESS", "READY") — ולכן "מוכן לאיסוף" לא נדלק אף פעם
// (הסטטוס האמיתי הוא READY_FOR_PICKUP). תוקן לפי מחזור החיים בפועל:
// PENDING_REVIEW → FINAL_PRICE_SET → PAYMENT_PENDING → PAID
// → READY_FOR_PICKUP → COMPLETED. סדר השלבים הותאם: חיוב לפני איסוף.
function OrderTimeline({ status, paymentStatus }: { status: string; paymentStatus?: string | null }) {
  if (status === "CANCELLED") return null;

  const afterReview = [
    "FINAL_PRICE_SET",
    "PAYMENT_PENDING",
    "PAID",
    "READY_FOR_PICKUP",
    "COMPLETED",
  ].includes(status);

  const steps = [
    { key: "received", label: "התקבלה", done: true },
    {
      key: "processing",
      label: "בטיפול",
      done: afterReview || paymentStatus === "PAID",
    },
    {
      key: "paid",
      label: "חויב",
      done: paymentStatus === "PAID",
    },
    {
      key: "ready",
      label: "מוכן לאיסוף",
      done: ["READY_FOR_PICKUP", "COMPLETED"].includes(status),
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

// באנר בקשת הסכמה למיילים - מוצג רק פעם אחת עד שהלקוח מסמן
function ConsentBanner({ customerId }: { customerId: string }) {
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);

  async function agree() {
    setSaving(true);
    try {
      const res = await fetch("/api/account", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "consent-emails" }),
      });
      if (res.ok) {
        setDone(true);
        setTimeout(() => window.location.reload(), 1200);
      }
    } catch {}
    finally {
      setSaving(false);
    }
  }

  if (done) {
    return (
      <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-3 my-2 text-sm text-emerald-800 font-medium text-center">
        ✅ תודה! תקבל עדכונים על המכירות במייל
      </div>
    );
  }

  return (
    <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 my-2 space-y-2">
      <div className="text-sm text-brand-slatedark">
        <div className="font-bold mb-0.5">📧 קבלת עדכונים במייל</div>
        <p className="text-xs text-zinc-600 leading-relaxed">
          תרצה לקבל עדכונים על פתיחת מכירות והודעות כלליות? מיילים תפעוליים
          (אישור הזמנה, חיוב) יישלחו בכל מקרה.
        </p>
      </div>
      <button
        onClick={agree}
        disabled={saving}
        className="w-full py-2 rounded-lg bg-brand-rust text-white text-sm font-bold hover:bg-[#a83a15] disabled:opacity-50"
      >
        {saving ? "שומר..." : "כן, אני מסכים לקבל עדכונים"}
      </button>
    </div>
  );
}
