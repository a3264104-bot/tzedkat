"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { api } from "@/lib/client";
import {
  STATUS_LABELS,
  MANUAL_STATUS_OPTIONS,
  STATUSES_REQUIRING_PAYMENT,
  PAYMENT_STATUS_LABELS,
  PAYMENT_METHOD_LABELS,
  fmt,
} from "@/lib/pricing";

export default function OrderDetail() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [order, setOrder] = useState<any>(null);
  const [products, setProducts] = useState<any[]>([]);
  const [saving, setSaving] = useState(false);
  const [internalNotes, setInternalNotes] = useState("");
  const [addProductId, setAddProductId] = useState("");
  const [showCashForm, setShowCashForm] = useState(false);

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
    // הגנה כפולה: גם בצד שרת, אבל גם כאן כדי לתת פידבק מיידי
    if (STATUSES_REQUIRING_PAYMENT.includes(status) && !isPaid) {
      alert("לא ניתן לעדכן סטטוס זה לפני שההזמנה שולמה (אונליין או מזומן).");
      return;
    }
    setSaving(true);
    await api(`/api/admin/orders/${id}`, { method: "PATCH", body: JSON.stringify({ status }) });
    await load();
    setSaving(false);
  }

  // יצירת ושליחת לינק תשלום להזמנה שכבר יש לה מחיר סופי
  // (נדרש כשנציג ללא הרשאת לינק קבע את המחיר)
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

  async function addProduct() {
    if (!addProductId) return;
    const p = products.find((x) => x.id === addProductId);
    await api(`/api/admin/orders/${id}`, {
      method: "PATCH",
      body: JSON.stringify({
        items: [{ productId: addProductId, quantity: 1, unitPrice: parseFloat(p.cartonPrice) }],
        recomputeFinal: true,
      }),
    });
    setAddProductId("");
    load();
  }

  async function removeItem(itemId: string) {
    await api(`/api/admin/orders/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ items: [{ id: itemId, _delete: true }], recomputeFinal: true }),
    });
    load();
  }

  async function deleteOrder() {
    if (!confirm("למחוק את ההזמנה לצמיתות?")) return;
    await api(`/api/admin/orders/${id}`, { method: "DELETE" });
    router.push("/admin/orders");
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
          <button onClick={deleteOrder} className="btn-ghost btn-sm text-red-600">
            מחק
          </button>
        </div>
      </div>

      {/* status pills - PAID לא מופיע כאן בכוונה, ראה הסבר בהמשך */}
      <div className="flex flex-wrap gap-1.5 no-print">
        {MANUAL_STATUS_OPTIONS.map((s) => (
          <button
            key={s}
            onClick={() => setStatus(s)}
            disabled={saving || (STATUSES_REQUIRING_PAYMENT.includes(s) && !isPaid)}
            title={
              STATUSES_REQUIRING_PAYMENT.includes(s) && !isPaid
                ? "ניתן לעדכן רק אחרי תשלום"
                : undefined
            }
            className={`badge px-3 py-1.5 ${
              order.status === s
                ? "bg-brand-rust text-white"
                : STATUSES_REQUIRING_PAYMENT.includes(s) && !isPaid
                  ? "bg-zinc-100 text-zinc-300 cursor-not-allowed"
                  : "bg-white border border-zinc-200 text-zinc-600"
            }`}
          >
            {STATUS_LABELS[s]}
          </button>
        ))}
      </div>

      {/* payment status panel */}
      <div className="card p-5 no-print">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-sm text-zinc-500">סטטוס תשלום</div>
            <div className="font-bold text-brand-slatedark">
              {PAYMENT_STATUS_LABELS[order.paymentStatus] ?? order.paymentStatus}
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

        <div className="flex gap-2 mt-3 no-print">
          <select className="input max-w-xs" value={addProductId} onChange={(e) => setAddProductId(e.target.value)}>
            <option value="">+ הוסף מוצר...</option>
            {products.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <button onClick={addProduct} className="btn-ghost btn-sm">
            הוסף
          </button>
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
