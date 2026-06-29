"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { api } from "@/lib/client";
import { STATUS_LABELS, STATUS_ORDER, fmt } from "@/lib/pricing";

export default function OrderDetail() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [order, setOrder] = useState<any>(null);
  const [products, setProducts] = useState<any[]>([]);
  const [saving, setSaving] = useState(false);
  const [internalNotes, setInternalNotes] = useState("");
  const [addProductId, setAddProductId] = useState("");

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
      items: o.items.map((it: any) => (it.id === itemId ? { ...it, [field]: value } : it)),
    }));
  }

  async function setStatus(status: string) {
    setSaving(true);
    await api(`/api/admin/orders/${id}`, { method: "PATCH", body: JSON.stringify({ status }) });
    await load();
    setSaving(false);
  }

  async function saveAll() {
    setSaving(true);
    const items = order.items.map((it: any) => ({
      id: it.id,
      quantity: it.quantity ? parseFloat(it.quantity) : undefined,
      finalWeight: it.finalWeight !== null && it.finalWeight !== "" ? parseFloat(it.finalWeight) : null,
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
    const msg = `שלום ${order.customerName},\nסיכום הזמנה #${order.orderNumber} (${order.point.name}):\n${lines}\n\nסה"כ: ${fmt(Number(total))}\n${order.finalTotal ? "" : "(מחיר משוער — סופי לפי משקל בפועל)"}\nאין לקחת בהקפה, יש לשלם עם לקיחת הסחורה.`;
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

      {/* status pills */}
      <div className="flex flex-wrap gap-1.5 no-print">
        {STATUS_ORDER.map((s) => (
          <button
            key={s}
            onClick={() => setStatus(s)}
            disabled={saving}
            className={`badge px-3 py-1.5 ${
              order.status === s ? "bg-brand-rust text-white" : "bg-white border border-zinc-200 text-zinc-600"
            }`}
          >
            {STATUS_LABELS[s]}
          </button>
        ))}
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
                      value={it.finalWeight ?? ""}
                      onChange={(e) => updateItem(it.id, "finalWeight", e.target.value)}
                    />
                  </td>
                  <td>
                    <input
                      className="w-20 rounded-lg border border-zinc-200 px-2 py-1"
                      placeholder="—"
                      value={it.finalPrice ?? ""}
                      onChange={(e) => updateItem(it.id, "finalPrice", e.target.value)}
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
