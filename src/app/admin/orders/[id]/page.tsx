"use client";

import { useEffect, useState } from "react";
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
  const [products, setProducts] = useState<any[]>([]);
  const [saving, setSaving] = useState(false);
  const [internalNotes, setInternalNotes] = useState("");
  const [showCashForm, setShowCashForm] = useState(false);
  const [charging, setCharging] = useState(false);

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
  async function chargeNow() {
    const amount = Number(order.finalTotal || 0);
    const confirmMsg =
      `לחייב את הזמנה #${order.orderNumber}?\n\n` +
      `לקוח: ${order.customerName}\n` +
      `סכום: ${fmt(amount)}\n` +
      `כרטיס: ${order.customer?.cardLast4 ? "****" + order.customer.cardLast4 : "לא ידוע"}`;
    if (!confirm(confirmMsg)) return;

    setCharging(true);
    try {
      const res = await fetch("/api/admin/charge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId: order.id }),
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
      ? `לבטל את הזמנה #${order.orderNumber}?\n\n⚠️ ההזמנה כבר שולמה (${fmt(Number(order.amountPaid || order.finalTotal))}).\nהביטול לא מבצע החזר כספי - יש לטפל בכך מול נדרים בנפרד.`
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

  async function removeItem(itemId: string) {
    await api(`/api/admin/orders/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ items: [{ id: itemId, _delete: true }], recomputeFinal: true }),
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
                {order.paidAt && ` · ${new Date(order.paidAt).toLocaleString("he-IL")}`}
              </div>
            )}
          </div>
          {!isPaid && (
            <div className="flex gap-2 flex-wrap">
              {/* חיוב אוטומטי - אם יש כרטיס שמור */}
              {hasFinalTotal && order.customer?.hasToken && !order.customer?.cardNeedsUpdate && (
                <button
                  onClick={chargeNow}
                  disabled={saving || charging}
                  className="btn-primary btn-sm bg-emerald-600 hover:bg-emerald-700"
                >
                  {charging ? "מחייב..." : "💳 חייב עכשיו"}
                </button>
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
                    (תוקף: {order.customer.cardExpiry})
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

      <div className="card p-5 grid md:grid-cols-2 gap-3 text-sm">
        <Info label="לקוח" value={order.customerName} />
        <Info label="טלפון" value={order.phone} />
        {order.phone2 && <Info label="טלפון נוסף" value={order.phone2} />}
        <Info label="נקודת חלוקה" value={order.point.name} />
        <Info label="תאריך חלוקה" value={order.pricelist?.deliveryDateText ?? "—"} />
        <Info label="תאריך הזמנה" value={new Date(order.createdAt).toLocaleString("he-IL")} />
        {/* §24: מקור ההזמנה - חשוב לתחקור, במיוחד בהזמנות טלפוניות
            שבהן אין למנהל שום דרך אחרת לדעת איך ההזמנה נוצרה. */}
        <Info
          label="מקור ההזמנה"
          value={
            order.source === "PHONE"
              ? "מערכת טלפונית"
              : order.source === "EXCEL"
                ? "קובץ אקסל במייל"
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
                  <td className="font-medium">
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
                    <button onClick={() => removeItem(it.id)} className="text-red-500 text-sm">
                      הסר
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

        <div className="flex justify-between items-center mt-4 pt-3 border-t">
          <div className="text-sm text-zinc-500">
            סה"כ משוער: <span className="font-bold text-brand-slatedark">{fmt(order.estimatedTotal)}</span>
          </div>
          <div className="text-lg">
            סופי: <span className="font-extrabold text-brand-rust">{order.finalTotal ? fmt(order.finalTotal) : "—"}</span>
          </div>
        </div>
      </div>

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
