"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/client";
import { fmt } from "@/lib/pricing";

type Cat = { id: string; name: string; sortOrder: number };
type Product = {
  id: string;
  name: string;
  categoryId: string;
  category: Cat;
  cartonPrice: string;
  allowSingles: boolean;
  singleSurcharge: string | null;
  unit: string;
  saleType: string;
  packageWeight: string | null;
  isFrozen: boolean;
  limitedQty: boolean;
  limitedQtyAmount: number | null;
  isActive: boolean;
  sortOrder: number;
};

const SALE_TYPES = [
  { v: "WEIGHT", l: 'לפי ק"ג' },
  { v: "UNIT", l: "לפי יחידה" },
  { v: "PACKAGE", l: "מארז" },
];

export default function ProductsPage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [cats, setCats] = useState<Cat[]>([]);
  const [editing, setEditing] = useState<Partial<Product> | null>(null);
  const [showCats, setShowCats] = useState(false);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    const [p, c] = await Promise.all([api("/api/admin/products"), api("/api/admin/categories")]);
    setProducts(p);
    setCats(c);
    setLoading(false);
  }
  useEffect(() => {
    load();
  }, []);

  async function save() {
    if (!editing) return;
    const payload = {
      name: editing.name,
      categoryId: editing.categoryId,
      cartonPrice: parseFloat(String(editing.cartonPrice ?? 0)),
      allowSingles: editing.allowSingles ?? false,
      singleSurcharge: editing.singleSurcharge ? parseFloat(String(editing.singleSurcharge)) : null,
      unit: editing.unit ?? 'ק"ג',
      saleType: editing.saleType ?? "WEIGHT",
      packageWeight: editing.packageWeight || null,
      isFrozen: editing.isFrozen ?? false,
      limitedQty: editing.limitedQty ?? false,
      limitedQtyAmount:
        editing.limitedQty && editing.limitedQtyAmount != null && String(editing.limitedQtyAmount) !== ""
          ? parseInt(String(editing.limitedQtyAmount), 10)
          : null,
      isActive: editing.isActive ?? true,
      sortOrder: editing.sortOrder ?? 0,
    };
    if (editing.id) {
      await api(`/api/admin/products/${editing.id}`, { method: "PATCH", body: JSON.stringify(payload) });
    } else {
      await api("/api/admin/products", { method: "POST", body: JSON.stringify(payload) });
    }
    setEditing(null);
    load();
  }

  async function toggleActive(p: Product) {
    await api(`/api/admin/products/${p.id}`, {
      method: "PATCH",
      body: JSON.stringify({ isActive: !p.isActive }),
    });
    load();
  }

  async function remove(p: Product) {
    if (!confirm(`למחוק את "${p.name}"?`)) return;
    await api(`/api/admin/products/${p.id}`, { method: "DELETE" });
    load();
  }

  async function duplicate(p: Product) {
    const { id, category, ...rest } = p as any;
    await api("/api/admin/products", {
      method: "POST",
      body: JSON.stringify({
        ...rest,
        name: p.name + " (העתק)",
        cartonPrice: parseFloat(p.cartonPrice),
        singleSurcharge: p.singleSurcharge ? parseFloat(p.singleSurcharge) : null,
      }),
    });
    load();
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-extrabold text-brand-slatedark">ניהול מוצרים</h1>
        <div className="flex gap-2">
          <button onClick={() => setShowCats(true)} className="btn-ghost btn-sm">
            קטגוריות
          </button>
          <button
            onClick={() =>
              setEditing({
                name: "",
                categoryId: cats[0]?.id,
                cartonPrice: "0",
                unit: 'ק"ג',
                saleType: "WEIGHT",
                isActive: true,
              })
            }
            className="btn-primary btn-sm"
          >
            + מוצר חדש
          </button>
        </div>
      </div>

      {loading ? (
        <p className="text-zinc-500">טוען...</p>
      ) : (
        <div className="table-wrap">
          <table className="admin">
            <thead>
              <tr>
                <th>מוצר</th>
                <th>קטגוריה</th>
                <th>מחיר</th>
                <th>יחידה</th>
                <th>בודדים</th>
                <th>פעיל</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {products.map((p) => (
                <tr key={p.id} className={p.isActive ? "" : "opacity-50"}>
                  <td className="font-medium">
                    {p.name}
                    {p.limitedQty && <span className="badge bg-amber-100 text-amber-700 mr-1">מוגבל</span>}
                    {p.isFrozen && <span className="badge bg-blue-100 text-blue-700 mr-1">קפוא</span>}
                  </td>
                  <td className="text-zinc-500">{p.category.name}</td>
                  <td>{fmt(p.cartonPrice)}</td>
                  <td className="text-zinc-500">{p.unit}</td>
                  <td>{p.allowSingles ? `+${fmt(p.singleSurcharge ?? 3)}` : "—"}</td>
                  <td>
                    <button
                      onClick={() => toggleActive(p)}
                      className={`badge ${p.isActive ? "bg-green-100 text-green-700" : "bg-zinc-200 text-zinc-600"}`}
                    >
                      {p.isActive ? "פעיל" : "מוסתר"}
                    </button>
                  </td>
                  <td>
                    <div className="flex gap-1 justify-end">
                      <button onClick={() => setEditing(p)} className="btn-ghost btn-sm">
                        ערוך
                      </button>
                      <button onClick={() => duplicate(p)} className="btn-ghost btn-sm">
                        שכפל
                      </button>
                      <button onClick={() => remove(p)} className="btn-ghost btn-sm text-red-600">
                        מחק
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* product editor modal */}
      {editing && (
        <Modal onClose={() => setEditing(null)} title={editing.id ? "עריכת מוצר" : "מוצר חדש"}>
          <div className="space-y-3">
            <Field label="שם מוצר">
              <input
                className="input"
                value={editing.name ?? ""}
                onChange={(e) => setEditing({ ...editing, name: e.target.value })}
              />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="קטגוריה">
                <select
                  className="input"
                  value={editing.categoryId}
                  onChange={(e) => setEditing({ ...editing, categoryId: e.target.value })}
                >
                  {cats.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="מחיר (קרטון)">
                <input
                  className="input"
                  type="number"
                  step="0.1"
                  value={String(editing.cartonPrice ?? "")}
                  onChange={(e) => setEditing({ ...editing, cartonPrice: e.target.value })}
                />
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="אופן מכירה">
                <select
                  className="input"
                  value={editing.saleType}
                  onChange={(e) => setEditing({ ...editing, saleType: e.target.value })}
                >
                  {SALE_TYPES.map((s) => (
                    <option key={s.v} value={s.v}>
                      {s.l}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="יחידת מידה">
                <input
                  className="input"
                  value={editing.unit ?? ""}
                  onChange={(e) => setEditing({ ...editing, unit: e.target.value })}
                />
              </Field>
            </div>
            <Field label="משקל מארז (אם רלוונטי)">
              <input
                className="input"
                placeholder="200 גרם / 400 גרם..."
                value={editing.packageWeight ?? ""}
                onChange={(e) => setEditing({ ...editing, packageWeight: e.target.value })}
              />
            </Field>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={editing.allowSingles ?? false}
                onChange={(e) => setEditing({ ...editing, allowSingles: e.target.checked })}
                className="h-4 w-4 accent-brand-rust"
              />
              אפשרות בודדים (תוספת לק"ג)
            </label>
            {editing.allowSingles && (
              <Field label='תוספת לבודדים לק"ג'>
                <input
                  className="input"
                  type="number"
                  step="0.5"
                  placeholder="ברירת מחדל 3"
                  value={String(editing.singleSurcharge ?? "")}
                  onChange={(e) => setEditing({ ...editing, singleSurcharge: e.target.value })}
                />
              </Field>
            )}
            <div className="flex flex-wrap gap-4">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={editing.isFrozen ?? false}
                  onChange={(e) => setEditing({ ...editing, isFrozen: e.target.checked })}
                  className="h-4 w-4 accent-brand-rust"
                />
                קפוא
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={editing.limitedQty ?? false}
                  onChange={(e) => setEditing({ ...editing, limitedQty: e.target.checked })}
                  className="h-4 w-4 accent-brand-rust"
                />
                כמות מוגבלת
              </label>
              {editing.limitedQty && (
                <div className="pr-6">
                  <label className="label">מגבלת כמות (לתצוגה ואזהרה למנהל)</label>
                  <input
                    type="number"
                    min={0}
                    className="input"
                    placeholder="לדוגמה: 50"
                    value={editing.limitedQtyAmount ?? ""}
                    onChange={(e) =>
                      setEditing({
                        ...editing,
                        limitedQtyAmount: e.target.value === "" ? null : parseInt(e.target.value, 10),
                      })
                    }
                  />
                  <p className="mt-1 text-xs text-zinc-400">
                    לא חוסם לקוחות — מוצג כאזהרה כשסך ההזמנות מתקרב למגבלה.
                  </p>
                </div>
              )}
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={editing.isActive ?? true}
                  onChange={(e) => setEditing({ ...editing, isActive: e.target.checked })}
                  className="h-4 w-4 accent-brand-rust"
                />
                פעיל באתר
              </label>
            </div>
            <button onClick={save} className="btn-primary w-full">
              שמירה
            </button>
          </div>
        </Modal>
      )}

      {showCats && (
        <CategoriesModal
          cats={cats}
          onClose={() => {
            setShowCats(false);
            load();
          }}
        />
      )}
    </div>
  );
}

function CategoriesModal({ cats, onClose }: { cats: Cat[]; onClose: () => void }) {
  const [list, setList] = useState(cats);
  const [name, setName] = useState("");

  async function add() {
    if (!name.trim()) return;
    const c = await api("/api/admin/categories", {
      method: "POST",
      body: JSON.stringify({ name: name.trim(), sortOrder: list.length + 1 }),
    });
    setList([...list, c]);
    setName("");
  }
  async function rename(c: Cat, newName: string) {
    await api(`/api/admin/categories/${c.id}`, { method: "PATCH", body: JSON.stringify({ name: newName }) });
  }
  async function del(c: Cat) {
    try {
      await api(`/api/admin/categories/${c.id}`, { method: "DELETE" });
      setList(list.filter((x) => x.id !== c.id));
    } catch (e: any) {
      alert(e.message);
    }
  }

  return (
    <Modal onClose={onClose} title="קטגוריות">
      <div className="space-y-2">
        {list.map((c) => (
          <div key={c.id} className="flex gap-2">
            <input
              className="input flex-1"
              defaultValue={c.name}
              onBlur={(e) => rename(c, e.target.value)}
            />
            <button onClick={() => del(c)} className="btn-ghost btn-sm text-red-600">
              מחק
            </button>
          </div>
        ))}
        <div className="flex gap-2 pt-2 border-t">
          <input
            className="input flex-1"
            placeholder="קטגוריה חדשה"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <button onClick={add} className="btn-primary btn-sm">
            הוסף
          </button>
        </div>
      </div>
    </Modal>
  );
}

export function Modal({
  children,
  title,
  onClose,
}: {
  children: React.ReactNode;
  title: string;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-end md:items-center justify-center p-0 md:p-4">
      <div className="bg-white w-full md:max-w-lg rounded-t-3xl md:rounded-2xl max-h-[92vh] overflow-y-auto">
        <div className="sticky top-0 bg-white flex items-center justify-between p-4 border-b">
          <h3 className="font-bold text-brand-slatedark">{title}</h3>
          <button onClick={onClose} className="text-2xl leading-none text-zinc-400">
            ×
          </button>
        </div>
        <div className="p-4">{children}</div>
      </div>
    </div>
  );
}

export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="label">{label}</label>
      {children}
    </div>
  );
}
