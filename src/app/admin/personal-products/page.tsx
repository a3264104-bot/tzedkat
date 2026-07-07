"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/client";
import { Modal, Field } from "@/components/AdminModal";

type Product = {
  id: string;
  name: string;
  imageUrl: string | null;
  description: string | null;
  isActive: boolean;
  sortOrder: number;
  maxQuantity: number | null;
  stock: number | null;
};

export default function PersonalProductsPage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Partial<Product> | null>(null);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);

  async function load() {
    setLoading(true);
    setProducts(await api("/api/admin/personal-products"));
    setLoading(false);
  }
  useEffect(() => {
    load();
  }, []);

  async function uploadImage(file: File | undefined) {
    if (!file || !editing) return;
    setUploading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/admin/upload", { method: "POST", body: form });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "ההעלאה נכשלה");
      setEditing({ ...editing, imageUrl: data.url });
    } catch (e: any) {
      alert(e.message);
    } finally {
      setUploading(false);
    }
  }

  async function save() {
    if (!editing?.name?.trim()) {
      alert("יש להזין שם מוצר");
      return;
    }
    setSaving(true);
    try {
      if (editing.id) {
        await api(`/api/admin/personal-products/${editing.id}`, {
          method: "PATCH",
          body: JSON.stringify(editing),
        });
      } else {
        await api("/api/admin/personal-products", {
          method: "POST",
          body: JSON.stringify({ ...editing, sortOrder: products.length }),
        });
      }
      setEditing(null);
      load();
    } catch (e: any) {
      alert(e.message);
    } finally {
      setSaving(false);
    }
  }

  async function remove(p: Product) {
    if (!confirm(`למחוק את "${p.name}"?`)) return;
    await api(`/api/admin/personal-products/${p.id}`, { method: "DELETE" });
    load();
  }

  async function move(idx: number, dir: -1 | 1) {
    const a = products[idx];
    const b = products[idx + dir];
    if (!a || !b) return;
    const aOrder = a.sortOrder === b.sortOrder ? idx : a.sortOrder;
    const bOrder = a.sortOrder === b.sortOrder ? idx + dir : b.sortOrder;
    await Promise.all([
      api(`/api/admin/personal-products/${a.id}`, {
        method: "PATCH",
        body: JSON.stringify({ sortOrder: bOrder }),
      }),
      api(`/api/admin/personal-products/${b.id}`, {
        method: "PATCH",
        body: JSON.stringify({ sortOrder: aOrder }),
      }),
    ]);
    load();
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-extrabold text-brand-slatedark">מוצרים — הזמנות אישיות</h1>
          <p className="text-sm text-zinc-500">
            מוצרים אלה מופיעים רק במודול ההזמנות האישיות (לא במכירות)
          </p>
        </div>
        <button
          onClick={() => setEditing({ isActive: true })}
          className="btn-primary btn-sm"
        >
          + מוצר חדש
        </button>
      </div>

      {loading ? (
        <p className="text-zinc-500">טוען...</p>
      ) : products.length === 0 ? (
        <div className="card p-6 text-center text-zinc-500">אין עדיין מוצרים</div>
      ) : (
        <div className="space-y-2">
          {products.map((p, idx) => (
            <div key={p.id} className={`card p-3 ${p.isActive ? "" : "opacity-50"}`}>
              <div className="flex items-center gap-3">
                <div className="flex flex-col gap-0.5">
                  <button
                    onClick={() => move(idx, -1)}
                    disabled={idx === 0}
                    className="btn-ghost btn-sm px-1.5 disabled:opacity-20"
                  >
                    ▲
                  </button>
                  <button
                    onClick={() => move(idx, 1)}
                    disabled={idx === products.length - 1}
                    className="btn-ghost btn-sm px-1.5 disabled:opacity-20"
                  >
                    ▼
                  </button>
                </div>
                {p.imageUrl && (
                  <img
                    src={p.imageUrl}
                    alt={p.name}
                    className="w-12 h-12 rounded-lg object-cover border border-zinc-200"
                  />
                )}
                <div className="flex-1">
                  <div className="font-medium text-brand-slatedark">{p.name}</div>
                  {p.description && (
                    <div className="text-xs text-zinc-500">{p.description}</div>
                  )}
                  <div className="flex gap-1 mt-1">
                    {!p.isActive && (
                      <span className="badge bg-zinc-200 text-zinc-600">מוסתר</span>
                    )}
                    {p.stock != null && (
                      <span className="badge bg-blue-100 text-blue-700">מלאי: {p.stock}</span>
                    )}
                    {p.maxQuantity != null && (
                      <span className="badge bg-zinc-100 text-zinc-600">מקס' {p.maxQuantity}</span>
                    )}
                  </div>
                </div>
                <div className="flex gap-1">
                  <button onClick={() => setEditing(p)} className="btn-ghost btn-sm">
                    ערוך
                  </button>
                  <button onClick={() => remove(p)} className="btn-ghost btn-sm text-red-600">
                    מחק
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {editing && (
        <Modal onClose={() => setEditing(null)} title={editing.id ? "עריכת מוצר" : "מוצר חדש"}>
          <div className="space-y-3">
            <Field label="שם מוצר *">
              <input
                className="input"
                value={editing.name ?? ""}
                onChange={(e) => setEditing({ ...editing, name: e.target.value })}
              />
            </Field>
            <Field label="תיאור קצר">
              <textarea
                className="input"
                rows={2}
                value={editing.description ?? ""}
                onChange={(e) => setEditing({ ...editing, description: e.target.value })}
              />
            </Field>
            <Field label="תמונה">
              <div className="flex items-center gap-3">
                {editing.imageUrl && (
                  <img
                    src={editing.imageUrl}
                    alt=""
                    className="w-14 h-14 rounded-lg object-cover border border-zinc-200"
                  />
                )}
                <label className="btn-ghost btn-sm cursor-pointer">
                  {uploading ? "מעלה..." : editing.imageUrl ? "החלף" : "העלאת תמונה"}
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    disabled={uploading}
                    onChange={(e) => uploadImage(e.target.files?.[0])}
                  />
                </label>
                {editing.imageUrl && (
                  <button
                    type="button"
                    onClick={() => setEditing({ ...editing, imageUrl: null })}
                    className="btn-ghost btn-sm text-red-600"
                  >
                    הסר
                  </button>
                )}
              </div>
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="כמות מקסימלית (אופציונלי)">
                <input
                  className="input"
                  type="number"
                  value={editing.maxQuantity ?? ""}
                  onChange={(e) =>
                    setEditing({
                      ...editing,
                      maxQuantity: e.target.value ? Number(e.target.value) : null,
                    })
                  }
                />
              </Field>
              <Field label="מלאי זמין (אופציונלי)">
                <input
                  className="input"
                  type="number"
                  value={editing.stock ?? ""}
                  onChange={(e) =>
                    setEditing({
                      ...editing,
                      stock: e.target.value ? Number(e.target.value) : null,
                    })
                  }
                />
              </Field>
            </div>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={editing.isActive ?? true}
                onChange={(e) => setEditing({ ...editing, isActive: e.target.checked })}
                className="h-4 w-4 accent-brand-rust"
              />
              פעיל (מוצג ללקוחות)
            </label>
            <button onClick={save} disabled={saving} className="btn-primary w-full">
              {saving ? "שומר..." : "שמירה"}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
