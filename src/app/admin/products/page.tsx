"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/client";
import { fmt } from "@/lib/pricing";
import { Modal, Field } from "@/components/AdminModal";

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
  priceType: string;
  packageWeight: string | null;
  avgWeightPerUnit: string | null;
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

// יחידת מידה נגזרת אוטומטית מאופן המכירה
function unitForSaleType(saleType: string): string {
  if (saleType === "UNIT") return "יחידה";
  if (saleType === "PACKAGE") return "מארז";
  return 'ק"ג';
}

// תווית שדה המחיר לפי אופן מכירה + סוג מחיר
function priceLabel(saleType: string, priceType: string): string {
  if (saleType === "UNIT") {
    // ביחידה - המחיר יכול להיות ליחידה או לק"ג
    return priceType === "PER_KG" ? 'מחיר לק"ג' : "מחיר ליחידה";
  }
  if (saleType === "PACKAGE") return "מחיר למארז";
  // WEIGHT
  return priceType === "CARTON" ? 'מחיר קרטון לק"ג' : 'מחיר לק"ג';
}

// האם צריך משקל ממוצע: רק במכירה לפי יחידה שהמחיר בה הוא לק"ג
function needsAvgWeight(saleType: string, priceType: string): boolean {
  return saleType === "UNIT" && priceType === "PER_KG";
}

// האם להציג אפשרות בודדים: רק במכירה לפי ק"ג עם סוג מחיר "קרטון"
function canHaveSingles(saleType: string, priceType: string): boolean {
  return saleType === "WEIGHT" && priceType === "CARTON";
}

// תווית קצרה לתצוגה בטבלה
function priceTagForTable(p: Product): string {
  if (p.saleType === "UNIT") return "ליחידה";
  if (p.saleType === "PACKAGE") return "למארז";
  return p.priceType === "CARTON" ? "קרטון" : 'לק"ג';
}

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

  // כשמשנים אופן מכירה - מעדכנים אוטומטית יחידת מידה, ומכבים בודדים אם לא רלוונטי
  function changeSaleType(saleType: string) {
    if (!editing) return;
    const newPriceType = editing.priceType ?? "REGULAR";
    const stillSingles = canHaveSingles(saleType, newPriceType) ? editing.allowSingles : false;
    setEditing({
      ...editing,
      saleType,
      unit: unitForSaleType(saleType),
      allowSingles: stillSingles,
    });
  }

  // כשמשנים סוג מחיר - מכבים בודדים אם כבר לא רלוונטי
  function changePriceType(priceType: string) {
    if (!editing) return;
    const saleType = editing.saleType ?? "WEIGHT";
    const stillSingles = canHaveSingles(saleType, priceType) ? editing.allowSingles : false;
    setEditing({ ...editing, priceType, allowSingles: stillSingles });
  }

  async function save() {
    if (!editing) return;
    const saleType = editing.saleType ?? "WEIGHT";
    const priceType = editing.priceType ?? "REGULAR";
    const payload = {
      name: editing.name,
      categoryId: editing.categoryId,
      cartonPrice: parseFloat(String(editing.cartonPrice ?? 0)),
      // בודדים רק אם רלוונטי (WEIGHT+CARTON)
      allowSingles: canHaveSingles(saleType, priceType) ? (editing.allowSingles ?? false) : false,
      singleSurcharge: editing.singleSurcharge ? parseFloat(String(editing.singleSurcharge)) : null,
      // יחידת מידה תמיד נגזרת מאופן המכירה
      unit: unitForSaleType(saleType),
      saleType,
      priceType,
      // משקל מארז רק במכירת מארז
      packageWeight: saleType === "PACKAGE" ? editing.packageWeight || null : null,
      // משקל ממוצע ליחידה - רק כשמוכרים ביחידה ומתמחרים לק"ג
      avgWeightPerUnit:
        needsAvgWeight(saleType, priceType) && editing.avgWeightPerUnit
          ? parseFloat(String(editing.avgWeightPerUnit))
          : null,
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

  const editSaleType = editing?.saleType ?? "WEIGHT";
  const editPriceType = editing?.priceType ?? "REGULAR";
  const showSingles = canHaveSingles(editSaleType, editPriceType);
  // סוג מחיר רלוונטי ל-WEIGHT (רגיל/קרטון) ול-UNIT (ליחידה/לק"ג)
  const showPriceTypeSelect = editSaleType === "WEIGHT" || editSaleType === "UNIT";
  const showAvgWeight = editSaleType === "UNIT" && editPriceType === "PER_KG";

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
                priceType: "REGULAR",
                isActive: true,
              })
            }
            className="btn-primary btn-sm"
            disabled={cats.length === 0}
          >
            + מוצר חדש
          </button>
        </div>
      </div>

      {cats.length === 0 && !loading && (
        <div className="card p-4 bg-amber-50 border-amber-200 text-sm text-amber-800">
          אין עדיין קטגוריות. יש ליצור קטגוריה אחת לפחות (דרך כפתור "קטגוריות") לפני הוספת מוצרים.
        </div>
      )}

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
                  <td>
                    {fmt(p.cartonPrice)}
                    <span className="text-zinc-400 text-xs mr-1">{priceTagForTable(p)}</span>
                  </td>
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
              <Field label="אופן מכירה">
                <select
                  className="input"
                  value={editing.saleType}
                  onChange={(e) => changeSaleType(e.target.value)}
                >
                  {SALE_TYPES.map((s) => (
                    <option key={s.v} value={s.v}>
                      {s.l}
                    </option>
                  ))}
                </select>
              </Field>
            </div>

            {/* סוג מחיר - רק במכירה לפי ק"ג */}
            {showPriceTypeSelect && (
              <Field label={editSaleType === "UNIT" ? "בסיס התמחור" : "סוג מחיר"}>
                <select
                  className="input"
                  value={editing.priceType ?? "REGULAR"}
                  onChange={(e) => changePriceType(e.target.value)}
                >
                  {editSaleType === "WEIGHT" ? (
                    <>
                      <option value="REGULAR">מחיר רגיל</option>
                      <option value="CARTON">מחיר קרטון</option>
                    </>
                  ) : (
                    <>
                      <option value="REGULAR">המחיר הוא ליחידה</option>
                      <option value="PER_KG">המחיר הוא לק"ג (שקילה)</option>
                    </>
                  )}
                </select>
              </Field>
            )}

            <div className="grid grid-cols-2 gap-3">
              <Field label={priceLabel(editSaleType, editPriceType)}>
                <input
                  className="input"
                  type="number"
                  step="0.1"
                  value={String(editing.cartonPrice ?? "")}
                  onChange={(e) => setEditing({ ...editing, cartonPrice: e.target.value })}
                />
              </Field>
              {/* יחידת מידה - נגזרת אוטומטית, מוצגת לקריאה בלבד */}
              <Field label="יחידת מידה">
                <input
                  className="input bg-zinc-50 text-zinc-500"
                  value={unitForSaleType(editSaleType)}
                  readOnly
                />
              </Field>
            </div>

            {/* משקל מארז - רק במכירת מארז */}
            {editSaleType === "PACKAGE" && (
              <Field label="משקל מארז (גרם)">
                <input
                  className="input"
                  placeholder="200 גרם / 400 גרם / 500 גרם..."
                  value={editing.packageWeight ?? ""}
                  onChange={(e) => setEditing({ ...editing, packageWeight: e.target.value })}
                />
              </Field>
            )}

            {/* משקל ממוצע ליחידה - רק כשמוכרים ביחידה ומתמחרים לק"ג */}
            {showAvgWeight && (
              <Field label='משקל ממוצע ליחידה (ק"ג)'>
                <input
                  className="input"
                  type="number"
                  step="0.1"
                  placeholder='לדוגמה: עוף שלם ≈ 2 ק"ג'
                  value={editing.avgWeightPerUnit ?? ""}
                  onChange={(e) => setEditing({ ...editing, avgWeightPerUnit: e.target.value })}
                />
                <p className="text-xs text-zinc-400 mt-1">
                  חובה למילוי — משמש להערכת מחיר מדויקת ללקוח (מחיר לק"ג × משקל ממוצע × כמות).
                </p>
                {!editing.avgWeightPerUnit && (
                  <p className="text-xs text-amber-600 mt-1 font-medium">
                    ⚠️ חסר משקל משוער — ההערכה ללקוח לא תהיה מדויקת עד למילוי.
                  </p>
                )}
              </Field>
            )}

            {/* בודדים - רק ב-WEIGHT + CARTON */}
            {showSingles && (
              <>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={editing.allowSingles ?? false}
                    onChange={(e) => setEditing({ ...editing, allowSingles: e.target.checked })}
                    className="h-4 w-4 accent-brand-rust"
                  />
                  אפשרות קנייה בבודדים (תוספת לק"ג)
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
              </>
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
                <div className="pr-6 w-full">
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
        {list.length === 0 && (
          <p className="text-sm text-zinc-400 pb-2">
            אין עדיין קטגוריות. הוסף למטה (למשל: עופות, בשר, דגים קפואים / מארזים, מיוחדים / מוגבלים).
          </p>
        )}
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
            onKeyDown={(e) => e.key === "Enter" && add()}
          />
          <button onClick={add} className="btn-primary btn-sm">
            הוסף
          </button>
        </div>
      </div>
    </Modal>
  );
}
