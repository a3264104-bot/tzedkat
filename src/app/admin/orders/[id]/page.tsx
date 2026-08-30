"use client";

import { useEffect, useState } from "react";
// §296: מקור אמת יחיד לפריסה
import { INSTALLMENT_OPTIONS } from "@/lib/installments-lib";
// §200: תאריכים בשעון ישראל — השרת רץ ב-UTC
import { fmtDateTime } from "@/lib/date-lib";
// §183: עריכת פרטי הלקוח מתוך ההזמנה
import { QuickCustomerEdit } from "@/components/QuickCustomerEdit";
// §190: משלוח, חיוב נוסף וזיכוי - גם במסך המנהל
import { DeliveryPanel } from "@/components/DeliveryPanel";
import { CreditPanel } from "@/components/CreditPanel";
// §263: רישום חוב ללקוח
import { DebtPanel } from "@/components/DebtPanel";
// §191: הערת הלקוח - הייתה רק במסך הנציג
import { OrderNotePanel } from "@/components/OrderNotePanel";
import { useParams, useRouter } from "next/navigation";
import { api } from "@/lib/client";
import {
  PAYMENT_METHOD_LABELS,
  fmt,
} from "@/lib/pricing";
import { payStatusLabel } from "@/lib/pay-status-lib";
import { OrderStatusPanel } from "@/components/OrderStatusPanel";
import { AddOrderItem } from "@/components/AddOrderItem";

export default function OrderDetail() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [order, setOrder] = useState<any>(null);
  // §305: 🚨 ה-useState חייב להיות **לפני** כל return מוקדם.
  //
  // 🐛 הצבתי אותו ליד הפונקציה שמשתמשת בו (שורה 99), אחרי
  // `if (!order) return ...` בשורה 67. מספר ה-hooks השתנה בין
  // רינדורים, React זרק "Rendered fewer hooks than expected",
  // והדף קרס לבן.
  //
  // ⚠️ זו הפעם השנייה היום (§283). החוק: hooks תמיד בשורות
  // הראשונות של הרכיב, בלי יוצא מן הכלל.
  const [sendingMail, setSendingMail] = useState(false);
  const [products, setProducts] = useState<any[]>([]);
  const [saving, setSaving] = useState(false);
  const [internalNotes, setInternalNotes] = useState("");
  const [showCashForm, setShowCashForm] = useState(false);
  const [charging, setCharging] = useState(false);
  // §191: מספר תשלומים לחיוב.
  //
  // 🐛 קודם הערך ההתחלתי היה `Number(order.requestedInstallments)` -
  // אבל order הוא null ברינדור הראשון (הוא נטען ב-useEffect),
  // וה-useState רץ **לפני** הבדיקה `if (!order)`. התוצאה: המסך
  // קרס עם "client-side exception" לפני שהספיק להציג משהו.
  //
  // ⚠️ מתחילים ב-1 ומסתנכרנים ב-useEffect כשההזמנה מגיעה. זהו
  // הדפוס הנכון: ערך התחלתי שאינו תלוי בנתונים שטרם נטענו.
  const [chargeInstallments, setChargeInstallments] = useState(1);

  async function load() {
    const [o, p] = await Promise.all([api(`/api/admin/orders/${id}`), api("/api/admin/products")]);
    setOrder(o);
    setInternalNotes(o.internalNotes ?? "");
    setProducts(p);
  }
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // §191: מסנכרן את בורר התשלומים כשההזמנה נטענת.
  //
  // ⚠️ תלוי ב-order?.id ולא ב-order: אובייקט חדש בכל רינדור היה
  // מאפס את הבחירה של המנהל בכל רענון.
  useEffect(() => {
    const n = Number((order as any)?.requestedInstallments);
    if (Number.isInteger(n) && n >= 1 && n <= 12) setChargeInstallments(n);
  }, [order?.id]);

  if (!order) return <p className="text-zinc-500">טוען...</p>;

  function updateItem(itemId: string, field: string, value: string) {
    setOrder((o: any) => ({
      ...o,
      items: o.items.map((it: any) => {
        if (it.id !== itemId) return it;
        const updated = { ...it, [field]: value };
        // ח2: חישוב אוטומטי של מחיר סופי לפי משקל × מחיר לק"ג
        // רק אם המוצר נשקל (יש unitPrice ומזינים משקל בפועל)
        if (field === "actualWeight" && value) {
          const weight = parseFloat(value);
          const unitPrice = parseFloat(it.unitPrice);
          if (!isNaN(weight) && !isNaN(unitPrice) && weight > 0) {
            updated.finalPrice = (Math.round(weight * unitPrice * 100) / 100).toString();
          }
        }
        return updated;
      }),
    }));
  }

  const isPaid = order.paymentStatus === "PAID";
  const hasFinalTotal = order.finalTotal !== null && order.finalTotal !== undefined;

  // §303: 📧 שליחת מייל **ידנית**.
  //
  // המייל האוטומטי בוטל (§303) כי הוא נשלח בכל תיקון משקל,
  // והלקוח קיבל שלושה סכומים שונים.
  //
  // ⚠️ עכשיו המנהל שולח כשהוא מוכן - אחרי שכל השקילות
  // הסתיימו והמחיר סופי באמת.


  async function sendPriceEmail() {
    if (!order?.finalTotal) {
      alert("אין מחיר סופי — אין מה לשלוח");
      return;
    }
    if (
      !confirm(
        `לשלוח מייל ל${order.customerName}?\n\nהמייל יכלול את הפירוט המלא והסכום הסופי: ${fmt(Number(order.finalTotal))}`
      )
    )
      return;
    setSendingMail(true);
    try {
      const res = await api(`/api/admin/orders/${id}/notify`, {
        method: "POST",
      });
      alert(res?.ok ? "המייל נשלח ✓" : res?.error || "השליחה נכשלה");
      await load();
    } catch (e: any) {
      alert(e?.message || "שגיאה");
    } finally {
      setSendingMail(false);
    }
  }

  async function setStatus(status: string) {
    // ההגנה על סדר השלבים נעשית בפאנל המצב (הוא לא מציג פעולה
    // חסומה) ובצד השרת. אין צורך בבדיקה כפולה כאן.
    setSaving(true);
    await api(`/api/admin/orders/${id}`, { method: "PATCH", body: JSON.stringify({ status }) });
    await load();
    setSaving(false);
  }

  // יצירת ושליחת לינק תשלום להזמנה שכבר יש לה מחיר סופי
  // (נדרש כשנציג ללא הרשאת לינק קבע את המחיר)
  // §191: 🐛 החיוב של המנהל היה confirm() בלי בורר תשלומים.
  //
  // §189 הוסיף פריסה לתשלומים - **אבל רק לנציג**. המנהל, שהוא
  // זה שמחייב ברוב המקרים, נשאר עם תשלום אחד בלבד.
  //
  // ⚠️ הפרמטר נשלח לאותו endpoint שכבר מאמת 1-12.
  async function chargeNow(installments = 1) {
    const amount = Number(order.finalTotal || 0);
    const confirmMsg =
      `לחייב את הזמנה #${order.orderNumber}?\n\n` +
      `לקוח: ${order.customerName}\n` +
      `סכום: ${fmt(amount)}\n` +
      (installments > 1
        ? `תשלומים: ${installments} × ${fmt(amount / installments)}\n`
        : "") +
      `כרטיס: ${order.customer?.cardLast4 ? "****" + order.customer.cardLast4 : "לא ידוע"}`;
    if (!confirm(confirmMsg)) return;

    setCharging(true);
    try {
      const res = await fetch("/api/admin/charge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId: order.id, installments }),
      });
      const data = await res.json();
      if (res.ok && data.ok) {
        alert(`חיוב הצליח! ${fmt(data.amountCharged || amount)}`);
      } else {
        alert(`חיוב נכשל: ${data.error || "שגיאה לא ידועה"}`);
      }
      await load();
    } catch (e: any) {
      alert(`שגיאת רשת: ${e.message || "לא ידוע"}`);
    } finally {
      setCharging(false);
    }
  }

  async function sendPaymentLink() {
    setSaving(true);
    try {
      await api(`/api/admin/orders/${order.id}`, {
        method: "PATCH",
        body: JSON.stringify({ sendPaymentLink: true }),
      });
      await load();
    } catch (e: any) {
      alert(e.message || "שגיאה בשליחת הלינק");
    } finally {
      setSaving(false);
    }
  }

  // §47: סימון מסירה מהמנהל.
  // עד כה רק הנציג יכול היה לסמן, והמנהל לא ראה זאת כלל.
  // חשוב מכך: הסימון מעדכן גם את status ל-COMPLETED, אחרת הדשבורד
  // המשיך לדרוש "סמן מוכן לחלוקה" על הזמנה שכבר נמסרה.
  async function markDelivered() {
    const note = prompt("הערה על המסירה (אופציונלי):");
    if (note === null) return;
    setSaving(true);
    try {
      await api(`/api/admin/orders/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ markDelivered: true, deliveredNote: note || null }),
      });
      await load();
    } catch (e: any) {
      alert(e.message || "שגיאה בסימון המסירה");
    } finally {
      setSaving(false);
    }
  }

  async function undoDelivered() {
    if (!confirm("לבטל את סימון המסירה?")) return;
    setSaving(true);
    try {
      await api(`/api/admin/orders/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ markDelivered: false }),
      });
      await load();
    } catch (e: any) {
      alert(e.message || "שגיאה");
    } finally {
      setSaving(false);
    }
  }

  // ביטול הזמנה. שונה ממחיקה: ההזמנה נשמרת לתיעוד ולדוחות,
  // רק מסומנת כבוטלה ויוצאת מכל הספירות.
  async function cancelOrder() {
    const paid = order.paymentStatus === "PAID";
    const msg = paid
      ? // §272: הזיכוי אוטומטי — האזהרה הישנה אמרה "טפל בנפרד",
        // וזה בדיוק מה שלא קורה בפועל.
        `לבטל את הזמנה #${order.orderNumber}?\n\n` +
        `⚠️ ההזמנה כבר שולמה (${fmt(Number(order.amountPaid || order.finalTotal))}).\n\n` +
        `✅ הסכום ייזקף כיתרת זכות ללקוח, ויקוזז אוטומטית מההזמנה הבאה שלו.\n\n` +
        `אם נדרש החזר כספי בפועל — יש לטפל מול נדרים בנפרד.`
      : `לבטל את הזמנה #${order.orderNumber}?\n\nההזמנה תישמר לתיעוד אך תצא מכל הספירות והדוחות.`;
    if (!confirm(msg)) return;
    const reason = prompt("סיבת הביטול (תישמר בהערות הפנימיות):");
    if (reason === null) return;
    setSaving(true);
    try {
      await api(`/api/admin/orders/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ status: "CANCELLED", cancelReason: reason || null }),
      });
      await load();
    } catch (e: any) {
      alert(e.message || "שגיאה בביטול");
    } finally {
      setSaving(false);
    }
  }

  async function saveAll() {
    setSaving(true);
    const items = order.items.map((it: any) => ({
      id: it.id,
      quantity: it.quantity ? parseFloat(it.quantity) : undefined,
      // actualWeight הוא השדה הראשי כיום; finalWeight נשמר זהה לתאימות לאחור
      actualWeight: it.actualWeight !== null && it.actualWeight !== "" ? parseFloat(it.actualWeight) : null,
      finalWeight: it.actualWeight !== null && it.actualWeight !== "" ? parseFloat(it.actualWeight) : null,
      finalPrice: it.finalPrice !== null && it.finalPrice !== "" ? parseFloat(it.finalPrice) : null,
    }));
    await api(`/api/admin/orders/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ items, internalNotes, recomputeFinal: true }),
    });
    await load();
    setSaving(false);
  }

  // §65: הוספת פריט מלאה - כמות, בודדים/קרטון, ומחיר יחידה מחושב.
  //
  // 🐛 קודם נשלח תמיד `quantity: 1, unitPrice: cartonPrice` - קרטון
  // אחד במחיר קרטון, בלי שום דרך להוסיף בודדים. צד השרת דווקא תמך
  // ב-isSingle; רק ה-UI לא נתן לשלוח אותו.
  async function addItem(item: {
    productId: string;
    quantity: number;
    isSingle: boolean;
    unitPrice: number;
    /** §334: מחיר שנקבע במוצר מועדף (§119) */
    agentSetPrice?: number | null;
  }) {
    await api(`/api/admin/orders/${id}`, {
      method: "PATCH",
      body: JSON.stringify({
        items: [item],
        recomputeFinal: true,
      }),
    });
    await load();
  }

  // §315: 🗑️ **ביטול ולא מחיקה.**
  //
  // 🐛 מה שהיה: `_delete: true` מחק את הפריט מהמסד. אחרי המחיקה
  // אין דרך לדעת שהלקוח הזמין אותו, למה הוא ירד, ומי הוריד -
  // וכשהוא מתקשר לשאול, אין תשובה.
  //
  // ⚠️ אותה גישה של ביטול הזמנה (§47): הפריט נשאר לתיעוד ויוצא
  // מהחישוב. היסטוריה שנמחקת אי אפשר לשחזר.
  //
  // ⚠️ ואותה פעולה בדיוק כמו אצל הנציג (§302/§315) - שני מסכים
  // שעושים דברים שונים לאותה לחיצה הם באג שמחכה לקרות.
  async function removeItem(itemId: string, isCancelled: boolean) {
    if (
      !isCancelled &&
      !window.confirm(
        "לבטל את הפריט מההזמנה?\n\nהפריט יוצא מהחישוב אך יישאר לתיעוד."
      )
    )
      return;
    await api(`/api/agent/order-item/${itemId}`, {
      method: "PATCH",
      body: JSON.stringify({ isCancelled: !isCancelled }),
    });
    load();
  }


  function whatsapp() {
    const lines = order.items
      .map((it: any) => `• ${it.productName} — ${it.quantity} ${it.unit}`)
      .join("\n");
    const total = order.finalTotal ?? order.estimatedTotal;
    const paidLine = isPaid
      ? `\nשולם (${PAYMENT_METHOD_LABELS[order.paymentMethod] ?? ""})`
      : "";
    const msg = `שלום ${order.customerName},\nסיכום הזמנה #${order.orderNumber} (${order.point.name}):\n${lines}\n\nסה"כ: ${fmt(Number(total))}\n${order.finalTotal ? "" : "(מחיר משוער — סופי לפי משקל בפועל)"}${paidLine}\nאין לקחת בהקפה, יש לשלם עם לקיחת הסחורה.`;
    const phone = order.phone.replace(/\D/g, "").replace(/^0/, "972");
    window.open(`https://wa.me/${phone}?text=${encodeURIComponent(msg)}`, "_blank");
  }

  return (
    <div className="space-y-5 max-w-3xl">
      <div className="flex flex-wrap items-center justify-between gap-2 no-print">
        <h1 className="text-2xl font-extrabold text-brand-slatedark">הזמנה #{order.orderNumber}</h1>
        <div className="flex flex-wrap gap-1.5">
          <button onClick={() => window.print()} className="btn-ghost btn-sm">
            הדפס
          </button>
          <button onClick={whatsapp} className="btn-ghost btn-sm">
            וואטסאפ
          </button>
          {/* מחיקה לצמיתות הוסרה מהכותרת: ביטול הזמנה (בפאנל המצב)
              הוא הפעולה הנכונה כמעט תמיד - הוא שומר תיעוד. מחיקה
              מוחלטת נשארה זמינה רק בפעולות הנוספות. */}
        </div>
      </div>

      {/* §47: פאנל מצב מסודר במקום שורת כפתורים של כל הסטטוסים.
          הפירוט המלא בקומפוננטה עצמה. */}
      {/* §309: 🔒 חיווי נעילה + שחרור.
          
          הנעילה נקבעת בשליחת המייל: הלקוח מחזיק בידו סכום,
          ושינוי אחריו יוצר פער.
          
          ⚠️ והשחרור כאן, אצל המנהל בלבד - נעילה בלי מפתח היא
          מלכודת. */}
      {(order as any).weightsLockedAt && (
        <div className="card p-4 no-print mb-3 border-2 border-amber-300 bg-amber-50">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="min-w-0">
              <div className="font-bold text-sm text-amber-900">
                🔒 ההזמנה נעולה לשינויים
              </div>
              <div className="text-[11px] text-amber-800 mt-0.5">
                נשלח ללקוח מייל עם הסכום הסופי ב-
                {new Date((order as any).weightsLockedAt).toLocaleString(
                  "he-IL"
                )}
                . הנציג אינו יכול לשנות משקלים.
              </div>
            </div>
            <button
              onClick={async () => {
                if (
                  !confirm(
                    "לפתוח את ההזמנה לשינויים?\n\n⚠️ הלקוח כבר קיבל מייל עם הסכום. אחרי התיקון יש לשלוח לו מייל מעודכן."
                  )
                )
                  return;
                await api(`/api/admin/orders/${id}`, {
                  method: "PATCH",
                  body: JSON.stringify({ unlockWeights: true }),
                });
                await load();
              }}
              className="px-3 py-1.5 rounded-lg bg-amber-700 text-white text-xs font-bold shrink-0"
            >
              🔓 פתח לשינויים
            </button>
          </div>
        </div>
      )}

      {/* §303: 📧 כפתור שליחת המייל.
          
          המקום כאן מכוון: אחרי פאנל הסטטוסים, לפני התשלומים.
          זו הפעולה שקורית **אחרי** שהמחיר סופי ולפני החיוב. */}
      {order.finalTotal != null && (
        <div className="card p-4 no-print mb-3">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="min-w-0">
              <div className="font-bold text-sm text-brand-slatedark">
                📧 מייל ללקוח
              </div>
              <div className="text-[11px] text-zinc-500 mt-0.5">
                {order.customerNotifiedAt
                  ? `נשלח ${new Date(order.customerNotifiedAt).toLocaleString("he-IL")}`
                  : order.customer?.email
                    ? "פירוט מלא + סכום סופי + קישור לתשלום"
                    : "⚠️ ללקוח אין מייל"}
              </div>
            </div>
            <button
              onClick={sendPriceEmail}
              disabled={sendingMail || !order.customer?.email}
              className="px-4 py-2 rounded-xl bg-brand-slatedark text-white font-bold text-sm disabled:opacity-40"
            >
              {sendingMail
                ? "שולח..."
                : order.customerNotifiedAt
                  ? "שלח שוב"
                  : "שלח מייל"}
            </button>
          </div>
        </div>
      )}

      <OrderStatusPanel
        order={order}
        saving={saving}
        onSetStatus={setStatus}
        onMarkDelivered={markDelivered}
        onUndoDelivered={undoDelivered}
        onCancel={cancelOrder}
      />


      {/* payment status panel */}
      <div className="card p-5 no-print">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-sm text-zinc-500">סטטוס תשלום</div>
            <div className="font-bold text-brand-slatedark">
              {payStatusLabel(order.paymentStatus)}
              {order.paymentMethod && (
                <span className="text-zinc-400 font-normal mr-2">
                  ({PAYMENT_METHOD_LABELS[order.paymentMethod]})
                </span>
              )}
            </div>
            {order.amountPaid != null && (
              <div className="text-sm text-zinc-500 mt-1">
                שולם בפועל: {fmt(order.amountPaid)}
                {order.paidAt && ` · ${fmtDateTime(order.paidAt)}`}
              </div>
            )}
          </div>
          {!isPaid && (
            <div className="flex gap-2 flex-wrap">
              {/* חיוב אוטומטי - אם יש כרטיס שמור */}
              {hasFinalTotal && order.customer?.hasToken && !order.customer?.cardNeedsUpdate && (
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={() => chargeNow(chargeInstallments)}
                    disabled={saving || charging}
                    className="btn-primary btn-sm bg-emerald-600 hover:bg-emerald-700"
                  >
                    {charging
                      ? "מחייב..."
                      : chargeInstallments > 1
                        ? `💳 חייב ב-${chargeInstallments} תשלומים`
                        : "💳 חייב עכשיו"}
                  </button>
                  {/* §191: בורר תשלומים ליד הכפתור.
                      
                      ⚠️ select ולא מודל: המנהל כבר רואה את הסכום
                      ואת הכרטיס בפאנל התשלום שמעל, ומודל נוסף
                      היה חוזר על מה שכבר מולו. */}
                  <select
                    value={chargeInstallments}
                    onChange={(e) => setChargeInstallments(Number(e.target.value))}
                    disabled={saving || charging}
                    className="rounded-lg border-2 border-emerald-300 bg-white px-2 py-1 text-xs font-bold text-emerald-800"
                    title="מספר תשלומים"
                  >
                    {INSTALLMENT_OPTIONS.map((n) => (
                      <option key={n} value={n}>
                        {n === 1 ? "תשלום 1" : `${n} תשלומים`}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              {/* שליחת לינק תשלום - למשל כשנציג קבע מחיר בלי הרשאת לינק */}
              {hasFinalTotal && !order.paymentLink && (
                <button
                  onClick={sendPaymentLink}
                  disabled={saving}
                  className="btn-primary btn-sm"
                >
                  {saving ? "שולח..." : "📩 שליחת לינק תשלום"}
                </button>
              )}
              <button
                onClick={() => setShowCashForm(true)}
                disabled={!hasFinalTotal}
                title={!hasFinalTotal ? "יש לקבוע מחיר סופי תחילה" : undefined}
                className="btn-yellow btn-sm disabled:opacity-40 disabled:cursor-not-allowed"
              >
                סמן כתשלום מזומן
              </button>
            </div>
          )}
        </div>

        {/* פרטי הכרטיס השמור - חשוב לראות לפני החיוב */}
        {order.customer?.hasToken && !isPaid && (
          <div className="mt-3 pt-3 border-t text-sm">
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-zinc-600">
                💳 כרטיס שמור:{" "}
                <strong dir="ltr">
                  {order.customer.cardLast4 ? `****${order.customer.cardLast4}` : "טוקן שמור"}
                </strong>
                {order.customer.cardExpiry && (
                  <span className="text-zinc-500 mr-2" dir="ltr">
                    {/* §112: התוקף נשמר כ-MMYY ("1031"), והוצג כך -
                        מספר בן ארבע ספרות שנקרא כמספר ולא כתאריך.
                        הפיצול הופך אותו לקריא: 10/31. */}
                    (תוקף: {order.customer.cardExpiry.length === 4
                      ? `${order.customer.cardExpiry.slice(0, 2)}/${order.customer.cardExpiry.slice(2)}`
                      : order.customer.cardExpiry})
                  </span>
                )}
              </span>
              {order.customer.cardNeedsUpdate && (
                <span className="text-orange-700 text-xs font-medium bg-orange-50 border border-orange-200 rounded px-2 py-0.5">
                  ⚠️ נדרש עדכון
                </span>
              )}
              {order.chargeAttempts > 0 && (
                <span className="text-xs text-zinc-500">
                  ניסיונות חיוב: {order.chargeAttempts}
                </span>
              )}
            </div>
            {order.lastChargeError && (
              <div className="mt-2 bg-red-50 border border-red-200 rounded p-2 text-xs text-red-800">
                <div className="font-medium">שגיאה אחרונה:</div>
                <div className="font-mono">{order.lastChargeError}</div>
              </div>
            )}
          </div>
        )}
        {/* תצוגת לינק תשלום קיים - להעתקה/שליחה ידנית */}
        {order.paymentLink && !isPaid && (
          <div className="mt-3 pt-3 border-t text-sm">
            <span className="text-zinc-500">לינק תשלום: </span>
            <a
              href={order.paymentLink}
              target="_blank"
              rel="noopener noreferrer"
              className="text-brand-rust underline break-all"
            >
              {order.paymentLink.slice(0, 60)}...
            </a>
            <button
              onClick={() => navigator.clipboard.writeText(order.paymentLink!)}
              className="btn-ghost btn-sm mr-2"
            >
              📋 העתק
            </button>
          </div>
        )}
        {!hasFinalTotal && (
          <p className="text-xs text-amber-700 mt-2">
            יש לעדכן משקלים ולשמור ("שמירת שינויים" למטה) כדי לקבוע מחיר סופי, לפני שאפשר לסמן תשלום.
          </p>
        )}
      </div>

      {/* §183: עריכת פרטי הלקוח **מתוך ההזמנה**.
          
          🐛 מה שהיה: המנהל ראה שם שגוי בהזמנה, ולא יכול היה
          לתקן אותו בלי לצאת, לחפש את הלקוח ברשימה, ולחזור.
          
          ⚠️ **מעדכן את הלקוח עצמו** ולא רק את ההזמנה. זה מה
          שהמנהל מצפה לו: הוא מתקן שם שגוי, וזה נשאר מתוקן
          בהזמנות הבאות ובכרטיס.
          
          ⚠️ Order.customerName הוא snapshot ונשאר כפי שהיה -
          הוא מתעד מה היה השם ברגע ההזמנה, וזה נכון. */}
      <div className="card p-5 space-y-3">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <div className="text-[11px] text-zinc-500">לקוח</div>
            <div className="font-bold text-brand-slatedark">
              {order.customer?.name ?? order.customerName}
            </div>
            {/* ⚠️ חיווי כשהשם בהזמנה שונה מהשם הנוכחי: זה קורה
                אחרי עריכה, וזו לא שגיאה - אבל המנהל צריך להבין
                למה יש שני שמות. */}
            {order.customer?.name &&
              order.customer.name !== order.customerName && (
                <div className="text-[10px] text-zinc-400 mt-0.5">
                  בהזמנה נרשם: {order.customerName}
                </div>
              )}
          </div>
          {order.customer && (
            <QuickCustomerEdit
              customerId={order.customer.id}
              name={order.customer.name}
              firstName={order.customer.firstName ?? null}
              lastName={order.customer.lastName ?? null}
              phone={order.phone}
              phone2={order.phone2 ?? null}
              paymentPreference={order.customer.paymentPreference ?? "CREDIT"}
              hasCard={!!order.customer.hasToken}
              canSetCash
            />
          )}
        </div>
      </div>

      <div className="card p-5 grid md:grid-cols-2 gap-3 text-sm">
        <Info label="טלפון" value={order.phone} />
        {order.phone2 && <Info label="טלפון נוסף" value={order.phone2} />}
        <Info label="נקודת חלוקה" value={order.point.name} />
        <Info label="תאריך חלוקה" value={order.pricelist?.deliveryDateText ?? "—"} />
        <Info label="תאריך הזמנה" value={fmtDateTime(order.createdAt)} />
        {/* §24: מקור ההזמנה - חשוב לתחקור, במיוחד בהזמנות טלפוניות
            שבהן אין למנהל שום דרך אחרת לדעת איך ההזמנה נוצרה. */}
        {/* §126: זיכוי ויתרת זכות.

    ⚠️ בלעדיהם המנהל רואה מחיר סופי שאינו מסתדר עם הפריטים,
    ואין לו שום דרך לדעת למה. הוא היה מניח שיש באג בחישוב. */}

        {order.creditAmount != null && (

          <Info

            label="↩️ זיכוי"

            value={`${fmt(Number(order.creditAmount))}${

              order.creditReason ? ` · ${order.creditReason}` : ""

            }`}

          />

        )}

        {order.appliedCreditBalance != null && (
          <Info
            label="יתרת זכות שקוזזה"
            value={fmt(Number(order.appliedCreditBalance))}
          />
        )}

        {/* §263: 💸 חוב שנגבה בהזמנה זו.
            
            ⚠️ עם ההסבר: הלקוח שרואה "חוב ₪120" בפירוט צריך לדעת
            על מה. בלי זה הוא מתקשר לברר, וזו שיחה שאפשר למנוע. */}
        {(order as any).appliedDebt != null && (
          <Info
            label="חוב קודם שנגבה"
            value={`+${fmt(Number((order as any).appliedDebt))}`}
          />
        )}

        <Info
          label="מקור ההזמנה"
          // ⚠️ מיפוי inline. §115 הוציא אותו לפונקציה משותפת
          // ב-pricing.ts, אבל אותו קובץ שוחזר מ-git (הוא נדרס
          // בטעות), והפונקציה כבר לא קיימת. חזרה לתנאי המקורי.
          value={
            order.source === "PHONE"
              ? "מערכת טלפונית"
              : order.source === "EXCEL"
                ? "קובץ אקסל"
                : order.source === "AGENT"
                  ? "נציג"
                  : order.source === "ADMIN"
                    ? "מנהל"
                    : "האתר"
          }
        />
        {order.phoneCallId && (
          <Info label="מזהה שיחה" value={order.phoneCallId} />
        )}
        {order.notes && <Info label="הערות לקוח" value={order.notes} />}
      </div>

      {/* §191: 🐛 הערת הלקוח הייתה **רק במסך הנציג**.
          
          הלקוח כתב "בלי עצם בבקשה", והמנהל שפתח את ההזמנה לא
          ראה את זה בכלל - גם לא כשהוא זה שטיפל בה.
          
          ⚠️ **מעל** המוצרים ולא מתחת: אם הלקוח ביקש משהו, צריך
          לראות את זה לפני שנוגעים בהזמנה. אותו נימוק כמו §133.
          
          ⚠️ mode="agent" כי הפעולה זהה - לענות ללקוח. מצב נפרד
          למנהל היה מפצל את הרכיב בלי סיבה. */}
      <div className="no-print mb-4">
        <OrderNotePanel
          orderId={order.id}
          note={order.customerNote}
          noteAt={order.customerNoteAt ?? null}
          reply={order.agentReply}
          replyAt={order.agentReplyAt ?? null}
          mode="agent"
        />
      </div>

      {/* items */}
      <div className="card p-5">
        <h2 className="font-bold text-brand-slatedark mb-3">מוצרים</h2>
        <div className="overflow-x-auto">
          <table className="admin">
            <thead>
              <tr>
                <th>מוצר</th>
                <th>כמות</th>
                <th>מחיר יח'</th>
                <th>משוער</th>
                <th>משקל בפועל</th>
                <th>מחיר סופי</th>
                <th className="no-print"></th>
              </tr>
            </thead>
            <tbody>
              {order.items.map((it: any) => (
                <tr key={it.id}>
                  <td
                    className={`font-medium ${
                      it.isCancelled ? "line-through text-zinc-400" : ""
                    }`}
                  >
                    {it.productName}
                    {it.isSingle && <span className="badge bg-amber-100 text-amber-700 mr-1">בודדים</span>}
                  </td>
                  <td>
                    <input
                      className="w-16 rounded-lg border border-zinc-200 px-2 py-1"
                      value={it.quantity}
                      onChange={(e) => updateItem(it.id, "quantity", e.target.value)}
                    />
                  </td>
                  <td>{fmt(it.unitPrice)}</td>
                  <td>{fmt(it.estimatedPrice)}</td>
                  <td>
                    <input
                      className="w-16 rounded-lg border border-zinc-200 px-2 py-1"
                      placeholder="—"
                      value={it.actualWeight ?? it.finalWeight ?? ""}
                      onChange={(e) => updateItem(it.id, "actualWeight", e.target.value)}
                    />
                  </td>
                  <td>
                    <input
                      className="w-20 rounded-lg border border-zinc-200 px-2 py-1 bg-zinc-50 text-zinc-700"
                      placeholder="—"
                      value={it.finalPrice ?? ""}
                      readOnly
                      title="מחושב אוטומטית: משקל × מחיר לק״ג"
                    />
                  </td>
                  <td className="no-print">
                    {/* §315: הכפתור משתנה לפי המצב — ביטול או החזרה. */}
                    <button
                      onClick={() => removeItem(it.id, !!it.isCancelled)}
                      className={`text-sm font-bold ${
                        it.isCancelled ? "text-emerald-600" : "text-red-500"
                      }`}
                    >
                      {it.isCancelled ? "↩ החזר" : "בטל"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* §65: הוספת מוצר עם כל האפשרויות שיש ללקוח באתר (סעיף 4),
            כולל מוצרים לא-פעילים בקבוצה נפרדת (סעיף 7). */}
        <div className="mt-3 no-print">
          <AddOrderItem
            products={products}
            singleSurcharge={Number(order.pricelist?.singleSurcharge ?? 0)}
            onAdd={addItem}
          />
        </div>

        {/* §190: קיצורים לשינויי סכום - **ליד הוספת המוצר**.
            
            🐛 המנהל הוסיף מוצר, ואז רצה משלוח או זיכוי - וזה
            היה בתחתית המסך. הוא היה צריך לגלול ולחפש.
            
            ⚠️ קיצורים ולא פאנלים כפולים: הפאנלים עצמם למטה.
            שני מקומות לאותה פעולה = בלגן. */}
        {order.finalTotal == null && (
          <div className="mt-3 grid grid-cols-3 gap-2 no-print">
            <a
              href="#money-actions"
              className="flex flex-col items-center gap-0.5 py-2.5 rounded-xl border-2 border-violet-300 bg-violet-50 hover:bg-violet-100 transition-colors"
            >
              <span className="text-lg leading-none">🚚</span>
              <span className="text-[11px] font-bold text-violet-900">
                {order.deliveryRequested ? "ערוך משלוח" : "משלוח"}
              </span>
            </a>
            <a
              href="#money-actions"
              className="flex flex-col items-center gap-0.5 py-2.5 rounded-xl border-2 border-orange-300 bg-orange-50 hover:bg-orange-100 transition-colors"
            >
              <span className="text-lg leading-none">➕</span>
              <span className="text-[11px] font-bold text-orange-900">
                חיוב נוסף
              </span>
            </a>
            <a
              href="#money-actions"
              className="flex flex-col items-center gap-0.5 py-2.5 rounded-xl border-2 border-emerald-300 bg-emerald-50 hover:bg-emerald-100 transition-colors"
            >
              <span className="text-lg leading-none">↩️</span>
              <span className="text-[11px] font-bold text-emerald-900">זיכוי</span>
            </a>
          </div>
        )}

        <div className="flex justify-between items-center mt-4 pt-3 border-t">
          <div className="text-sm text-zinc-500">
            סה"כ משוער: <span className="font-bold text-brand-slatedark">{fmt(order.estimatedTotal)}</span>
          </div>
          <div className="text-lg">
            סופי: <span className="font-extrabold text-brand-rust">{order.finalTotal ? fmt(order.finalTotal) : "—"}</span>
          </div>
        </div>
      </div>

      {/* §190: 🐛 שינויי סכום היו **רק במסך הנציג**.
          
          המנהל שפתח הזמנה ורצה להוסיף משלוח או לזכות לקוח לא
          יכול היה - הוא היה צריך לעבור לאזור הנציג, למצוא את
          ההזמנה שוב, ולעשות משם.
          
          ⚠️ אותם רכיבים בדיוק של מסך הנציג, ולא עותק: שני
          מימושים היו מתפצלים ביום שמישהו משנה אחד מהם, וזה
          נוגע בכסף.
          
          ⚠️ מוצג רק לפני קביעת המחיר הסופי - אותה חסימה שיש
          ב-API. שינוי אחרי החיוב לא ייגבה. */}
      {order.finalTotal == null && (
        <div id="money-actions" className="no-print scroll-mt-4">
          <div className="mt-4 mb-2 flex items-center gap-2">
            <div className="h-px flex-1 bg-zinc-200" />
            <span className="text-xs font-extrabold text-brand-slatedark whitespace-nowrap">
              💰 שינויים בסכום ההזמנה
            </span>
            <div className="h-px flex-1 bg-zinc-200" />
          </div>
          <p className="text-[11px] text-zinc-500 text-center mb-2 leading-relaxed">
            משלוח וחיוב נוסף <b>מוסיפים</b> · זיכוי <b>מוריד</b> · הכל נכנס
            לסכום שהלקוח ישלם
          </p>

          <div className="mb-3">
            <DeliveryPanel
              orderId={order.id}
              requested={order.deliveryRequested}
              fee={order.deliveryFee != null ? Number(order.deliveryFee) : null}
              address={order.deliveryAddress}
              note={order.deliveryNote}
              deliveredAt={order.deliveredToCustomerAt ?? null}
              // ⚠️ אחרי תשלום השינוי לא ייגבה - הפאנל נועל את עצמו
              alreadyPaid={order.paymentStatus === "PAID"}
            />
          </div>

          <div className="mb-3">
            <CreditPanel
              orderId={order.id}
              kind="credit"
              currentAmount={
                order.creditAmount != null ? Number(order.creditAmount) : null
              }
              currentReason={order.creditReason}
              orderTotal={Number(order.finalTotal ?? order.estimatedTotal)}
              alreadyPaid={order.paymentStatus === "PAID"}
            />
          </div>

          {/* §263: 💸 חוב מהעבר — נפרד מזיכוי על ההזמנה הזו.
              
              ⚠️ זיכוי שייך להזמנה ("פריט חסר"), וחוב שייך ללקוח
              ("לא שילם במכירת פסח"). ערבוב שלהם היה מבלבל את
              המנהל ואת הלקוח כאחד. */}
          {order.customer?.id && (
            <div className="mb-3">
              <DebtPanel
                customerId={order.customer.id}
                customerName={order.customer.name ?? ""}
                debtBalance={Number((order.customer as any).debtBalance ?? 0)}
                debtNote={(order.customer as any).debtNote}
                onDone={() => window.location.reload()}
              />
            </div>
          )}

          <div className="mb-3">
            <CreditPanel
              orderId={order.id}
              kind="charge"
              currentAmount={
                order.extraCharge != null ? Number(order.extraCharge) : null
              }
              currentReason={order.extraChargeReason}
              orderTotal={Number(order.finalTotal ?? order.estimatedTotal)}
              alreadyPaid={order.paymentStatus === "PAID"}
            />
          </div>
        </div>
      )}

      <div className="card p-5 no-print">
        <label className="label">הערות פנימיות</label>
        <textarea
          className="input"
          value={internalNotes}
          onChange={(e) => setInternalNotes(e.target.value)}
        />
        <button onClick={saveAll} disabled={saving} className="btn-primary mt-3">
          {saving ? "שומר..." : "שמירת שינויים"}
        </button>
      </div>

      {showCashForm && (
        <CashPaymentModal
          orderId={id}
          finalTotal={Number(order.finalTotal)}
          onClose={() => setShowCashForm(false)}
          onDone={() => {
            setShowCashForm(false);
            load();
          }}
        />
      )}
    </div>
  );
}

function CashPaymentModal({
  orderId,
  finalTotal,
  onClose,
  onDone,
}: {
  orderId: string;
  finalTotal: number;
  onClose: () => void;
  onDone: () => void;
}) {
  const [amountPaid, setAmountPaid] = useState(String(finalTotal));
  const [receivedBy, setReceivedBy] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const amount = parseFloat(amountPaid) || 0;
  const diff = Math.round((amount - finalTotal) * 100) / 100;
  const isUnder = diff < 0;
  const isOver = diff > 0;

  async function submit() {
    setError("");
    if (!receivedBy.trim()) {
      setError("חובה לציין מי קיבל את התשלום.");
      return;
    }
    if (amount <= 0) {
      setError("יש להזין סכום תקין שהתקבל.");
      return;
    }
    if (isUnder && !note.trim()) {
      setError("הסכום שהתקבל נמוך מהמחיר הסופי — חובה להוסיף הערה.");
      return;
    }
    if (isOver && !confirm(`הסכום שהוזן (${amount}) גבוה מהמחיר הסופי (${finalTotal}). להמשיך?`)) {
      return;
    }
    setSaving(true);
    try {
      await api(`/api/admin/orders/${orderId}/cash-payment`, {
        method: "POST",
        body: JSON.stringify({ amountPaid: amount, note: note.trim() || null }),
      });
      onDone();
    } catch (e: any) {
      setError(e.message || "שגיאה בשמירה");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-end md:items-center justify-center p-0 md:p-4">
      <div className="bg-white w-full md:max-w-md rounded-t-3xl md:rounded-2xl max-h-[92vh] overflow-y-auto">
        <div className="sticky top-0 bg-white flex items-center justify-between p-4 border-b">
          <h3 className="font-bold text-brand-slatedark">סימון תשלום מזומן</h3>
          <button onClick={onClose} className="text-2xl leading-none text-zinc-400">
            ×
          </button>
        </div>
        <div className="p-4 space-y-3">
          <p className="text-sm text-zinc-500">
            מחיר סופי להזמנה: <strong>{fmt(finalTotal)}</strong>
          </p>
          <div>
            <label className="label">סכום שהתקבל *</label>
            <input
              className="input"
              type="number"
              step="0.5"
              value={amountPaid}
              onChange={(e) => setAmountPaid(e.target.value)}
            />
            {isUnder && (
              <p className="text-xs text-amber-700 mt-1">
                ⚠ הסכום נמוך מהמחיר הסופי בכ-{Math.abs(diff)} ₪ — ההזמנה תסומן "שולם חלקית".
              </p>
            )}
            {isOver && (
              <p className="text-xs text-amber-700 mt-1">
                ⚠ הסכום גבוה מהמחיר הסופי בכ-{diff} ₪.
              </p>
            )}
          </div>
          <div>
            <label className="label">מי קיבל את התשלום *</label>
            <input
              className="input"
              placeholder="שם הנציג/המנהל"
              value={receivedBy}
              onChange={(e) => setReceivedBy(e.target.value)}
            />
          </div>
          <div>
            <label className="label">הערה פנימית {isUnder && "(חובה)"}</label>
            <textarea className="input" value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <button onClick={submit} disabled={saving} className="btn-primary w-full">
            {saving ? "שומר..." : "אישור תשלום מזומן"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span className="text-zinc-500">{label}: </span>
      <span className="font-semibold text-brand-slatedark">{value}</span>
    </div>
  );
}
