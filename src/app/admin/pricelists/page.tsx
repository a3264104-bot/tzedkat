"use client";

import { useEffect, useState } from "react";
import { api, download } from "@/lib/client";
import { PRICELIST_STATUS, fmt } from "@/lib/pricing";
import { Modal, Field } from "@/app/admin/products/page";

type Pricelist = {
  id: string;
  name: string;
  status: string;
  singleSurcharge: string;
  deliveryDateText: string | null;
  notes: string | null;
  _count: { orders: number; products: number; points: number };
};

export default function PricelistsPage() {
  const [lists, setLists] = useState<Pricelist[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  async function load() {
    setLoading(true);
    setLists(await api("/api/admin/pricelists"));
    setLoading(false);
  }
  useEffect(() => {
    load();
  }, []);

  async function setStatus(l: Pricelist, status: string) {
    await api(`/api/admin/pricelists/${l.id}`, { method: "PATCH", body: JSON.stringify({ status }) });
    load();
  }
  async function duplicate(l: Pricelist) {
    await api("/api/admin/pricelists", {
      method: "POST",
      body: JSON.stringify({ duplicateFrom: l.id, name: `${l.name} (העתק)` }),
    });
    load();
  }
  async function remove(l: Pricelist) {
    if (!confirm(`למחוק את "${l.name}"?`)) return;
    try {
      await api(`/api/admin/pricelists/${l.id}`, { method: "DELETE" });
      load();
    } catch (e: any) {
      alert(e.message);
    }
  }

  const statusColor: Record<string, string> = {
    DRAFT: "bg-zinc-200 text-zinc-600",
    ACTIVE: "bg-green-100 text-green-700",
    CLOSED: "bg-amber-100 text-amber-700",
    DONE: "bg-blue-100 text-blue-700",
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-extrabold text-brand-slatedark">מחירונים / מכירות</h1>
        <button onClick={() => setCreating(true)} className="btn-primary btn-sm">
          + מחירון חדש
        </button>
      </div>

      {loading ? (
        <p className="text-zinc-500">טוען...</p>
      ) : (
        <div className="space-y-3">
          {lists.map((l) => (
            <div key={l.id} className="card p-4">
              <div className="flex flex-wrap justify-between items-start gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-brand-slatedark text-lg">{l.name}</span>
                    <span className={`badge ${statusColor[l.status]}`}>
                      {PRICELIST_STATUS[l.status]}
                    </span>
                  </div>
                  <div className="text-sm text-zinc-500 mt-1">
                    {l._count.products} מוצרים · {l._count.points} נקודות · {l._count.orders} הזמנות ·
                    תוספת בודדים {fmt(l.singleSurcharge)}
                  </div>
                  {l.deliveryDateText && (
                    <div className="text-sm text-zinc-400 mt-0.5">חלוקה: {l.deliveryDateText}</div>
                  )}
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {l.status !== "ACTIVE" && (
                    <button onClick={() => setStatus(l, "ACTIVE")} className="btn-yellow btn-sm">
                      הפוך לפעיל
                    </button>
                  )}
                  {l.status === "ACTIVE" && (
                    <button onClick={() => setStatus(l, "CLOSED")} className="btn-ghost btn-sm">
                      סגור הזמנות
                    </button>
                  )}
                  <button onClick={() => setEditing(l.id)} className="btn-ghost btn-sm">
                    ערוך
                  </button>
                  <button onClick={() => duplicate(l)} className="btn-ghost btn-sm">
                    שכפל
                  </button>
                  <button
                    onClick={() => download(`/api/admin/export?type=orders&pricelistId=${l.id}`)}
                    className="btn-ghost btn-sm"
                  >
                    ייצוא לאקסל
                  </button>
                  {l._count.orders === 0 && (
                    <button onClick={() => remove(l)} className="btn-ghost btn-sm text-red-600">
                      מחק
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {creating && (
        <CreateModal
          onClose={() => setCreating(false)}
          onDone={() => {
            setCreating(false);
            load();
          }}
        />
      )}
      {editing && (
        <EditModal
          id={editing}
          onClose={() => setEditing(null)}
          onDone={() => {
            setEditing(null);
            load();
          }}
        />
      )}
    </div>
  );
}

function CreateModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [name, setName] = useState("");
  const [surcharge, setSurcharge] = useState("3");
  const [dateText, setDateText] = useState("");
  const [notes, setNotes] = useState("");

  async function create() {
    if (!name.trim()) return;
    await api("/api/admin/pricelists", {
      method: "POST",
      body: JSON.stringify({
        name: name.trim(),
        singleSurcharge: parseFloat(surcharge) || 3,
        deliveryDateText: dateText || null,
        notes: notes || null,
      }),
    });
    onDone();
  }

  return (
    <Modal onClose={onClose} title="מחירון חדש">
      <div className="space-y-3">
        <Field label="שם מחירון">
          <input className="input" placeholder='מחירון אב תשפ"ו' value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label='תוספת לבודדים לק"ג'>
          <input className="input" type="number" step="0.5" value={surcharge} onChange={(e) => setSurcharge(e.target.value)} />
        </Field>
        <Field label="תאריך חלוקה (טקסט)">
          <input className="input" value={dateText} onChange={(e) => setDateText(e.target.value)} />
        </Field>
        <Field label="הערות ללקוח">
          <textarea className="input" value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
        <button onClick={create} className="btn-primary w-full">
          צור מחירון
        </button>
        <p className="text-xs text-zinc-400">לאחר היצירה ניתן לבחור מוצרים, מחירים ונקודות חלוקה דרך "ערוך".</p>
      </div>
    </Modal>
  );
}

function EditModal({ id, onClose, onDone }: { id: string; onClose: () => void; onDone: () => void }) {
  const [data, setData] = useState<any>(null);
  const [allProducts, setAllProducts] = useState<any[]>([]);
  const [allPoints, setAllPoints] = useState<any[]>([]);
  const [selProducts, setSelProducts] = useState<Record<string, { on: boolean; price: string }>>({});
  const [selPoints, setSelPoints] = useState<Record<string, boolean>>({});
  const [form, setForm] = useState({ name: "", surcharge: "3", dateText: "", notes: "" });

  useEffect(() => {
    (async () => {
      const [pl, products, points] = await Promise.all([
        api(`/api/admin/pricelists/${id}`),
        api("/api/admin/products"),
        api("/api/admin/points"),
      ]);
      setData(pl);
      setAllProducts(products);
      setAllPoints(points);
      setForm({
        name: pl.name,
        surcharge: String(pl.singleSurcharge),
        dateText: pl.deliveryDateText ?? "",
        notes: pl.notes ?? "",
      });
      const sp: Record<string, { on: boolean; price: string }> = {};
      for (const p of products) {
        const inList = pl.products.find((x: any) => x.productId === p.id);
        sp[p.id] = { on: !!inList, price: inList?.price ? String(inList.price) : "" };
      }
      setSelProducts(sp);
      const spt: Record<string, boolean> = {};
      for (const pt of points) spt[pt.id] = !!pl.points.find((x: any) => x.pointId === pt.id);
      setSelPoints(spt);
    })();
  }, [id]);

  async function save() {
    const products = Object.entries(selProducts)
      .filter(([, v]) => v.on)
      .map(([productId, v]) => ({ productId, price: v.price ? parseFloat(v.price) : null }));
    const pointIds = Object.entries(selPoints)
      .filter(([, v]) => v)
      .map(([id]) => id);
    await api(`/api/admin/pricelists/${id}`, {
      method: "PATCH",
      body: JSON.stringify({
        name: form.name,
        singleSurcharge: parseFloat(form.surcharge) || 3,
        deliveryDateText: form.dateText || null,
        notes: form.notes || null,
        products,
        pointIds,
      }),
    });
    onDone();
  }

  if (!data) return <Modal onClose={onClose} title="טוען..."><p className="text-zinc-500">טוען...</p></Modal>;

  return (
    <Modal onClose={onClose} title="עריכת מחירון">
      <div className="space-y-4">
        <Field label="שם מחירון">
          <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label='תוספת בודדים לק"ג'>
            <input className="input" type="number" step="0.5" value={form.surcharge} onChange={(e) => setForm({ ...form, surcharge: e.target.value })} />
          </Field>
          <Field label="תאריך חלוקה">
            <input className="input" value={form.dateText} onChange={(e) => setForm({ ...form, dateText: e.target.value })} />
          </Field>
        </div>
        <Field label="הערות ללקוח">
          <textarea className="input" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
        </Field>

        <div>
          <div className="label">נקודות חלוקה משתתפות</div>
          <div className="grid grid-cols-2 gap-1.5 max-h-40 overflow-y-auto border rounded-xl p-2">
            {allPoints.map((pt) => (
              <label key={pt.id} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={selPoints[pt.id] ?? false}
                  onChange={(e) => setSelPoints({ ...selPoints, [pt.id]: e.target.checked })}
                  className="h-4 w-4 accent-brand-rust"
                />
                {pt.name}
              </label>
            ))}
          </div>
        </div>

        <div>
          <div className="label">מוצרים פעילים ומחיר למחירון (ריק = מחיר ברירת מחדל)</div>
          <div className="max-h-64 overflow-y-auto border rounded-xl divide-y">
            {allProducts.map((p) => (
              <div key={p.id} className="flex items-center gap-2 p-2 text-sm">
                <input
                  type="checkbox"
                  checked={selProducts[p.id]?.on ?? false}
                  onChange={(e) =>
                    setSelProducts({
                      ...selProducts,
                      [p.id]: { ...(selProducts[p.id] ?? { price: "" }), on: e.target.checked },
                    })
                  }
                  className="h-4 w-4 accent-brand-rust"
                />
                <span className="flex-1">{p.name}</span>
                <span className="text-zinc-400 text-xs">{fmt(p.cartonPrice)}</span>
                <input
                  className="w-20 rounded-lg border border-zinc-200 px-2 py-1 text-xs"
                  placeholder="מחיר"
                  type="number"
                  step="0.1"
                  value={selProducts[p.id]?.price ?? ""}
                  onChange={(e) =>
                    setSelProducts({
                      ...selProducts,
                      [p.id]: { on: selProducts[p.id]?.on ?? false, price: e.target.value },
                    })
                  }
                />
              </div>
            ))}
          </div>
        </div>

        <button onClick={save} className="btn-primary w-full">
          שמירה
        </button>
      </div>
    </Modal>
  );
}
