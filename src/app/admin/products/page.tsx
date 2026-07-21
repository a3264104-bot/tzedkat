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
  singlesMode: string; // "KG" (default) | "UNITS" - מצב בודדים (סלומון = UNITS)
  singleUnitPrice: string | null; // מחיר קבוע ליחידה בבודדים (רק ב-UNITS)
  unit: string;
  saleType: string;
  priceType: string;
  packageWeight: string | null;
  avgWeightPerUnit: string | null;
  isFrozen: boolean;
  limitedQty: boolean;
  limitedQtyAmount: number | null;
  allowPersonalOrder: boolean; // §9: זמין להזמנה אישית
  isActive: boolean;
  sortOrder: number;
  imageUrl: string | null;
  kashrut: string | null;
  isFeatured: boolean;
  highlightNote: string | null;
};

// ברירות מחדל מקובלות לכשרות - ניתן להקליד גם ערך אחר
const KASHRUT_OPTIONS = ["לנדא", "אגודת ישראל", 'בד"ץ העדה החרדית', "הרב רובין", 'בד"ץ בית יוסף'];

// שני סוגי מוצרים בעסק:
// CARTON_MODE = קרטונים נשקלים (עופות/בשר/דגים): מזמינים קרטונים, החיוב לפי שקילה.
//   בבשר/דגים אפשר לאפשר גם "בודדים" - הזמנה בק"ג עם תוספת לק"ג.
// UNIT_MODE = יחידות במחיר קבוע (מוצרי עוף ארוזים): 400 גרם, מחיר קבוע, בלי שקילה.
const SALE_MODES = [
  { v: "CARTONS", l: "קרטונים (נשקל בסוף)" },
  { v: "UNITS", l: "יחידות במחיר קבוע" },
];

// גזירת המצב הפשוט מהשדות השמורים (תאימות לאחור למוצרים ישנים)
function modeFromProduct(saleType: string | undefined, priceType: string | undefined): string {
  if (saleType === "UNIT" && priceType !== "PER_KG") return "UNITS";
  return "CARTONS";
}

// יחידת מידה נגזרת אוטומטית מאופן המכירה
function unitForSaleType(saleType: string, chosenUnit?: string | null): string {
  if (saleType === "UNIT") return "יחידה";
  // במארז - המנהל בוחר את הכינוי: מארז / מגש / קרטון
  if (saleType === "PACKAGE") {
    return chosenUnit && ["מארז", "מגש", "קרטון"].includes(chosenUnit) ? chosenUnit : "מארז";
  }
  return 'ק"ג';
}

// תווית שדה המחיר לפי אופן מכירה + סוג מחיר
function priceLabel(mode: string): string {
  return mode === "UNITS" ? "מחיר ליחידה" : 'מחיר לק"ג';
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
  const [uploading, setUploading] = useState(false);
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

  // בחירת סוג המוצר: קרטונים (נשקל) או יחידות (קבוע).
  // מאחורי הקלעים נקבעים saleType/priceType/unit אוטומטית.
  function changeMode(mode: string) {
    if (!editing) return;
    if (mode === "UNITS") {
      setEditing({
        ...editing,
        saleType: "UNIT",
        priceType: "REGULAR",
        unit: "יחידה",
        allowSingles: false, // ביחידות אין בודדים
        avgWeightPerUnit: null,
      });
    } else {
      setEditing({
        ...editing,
        saleType: "PACKAGE",
        priceType: "PER_KG",
        unit: "קרטון",
        // allowSingles נשאר כפי שהוא - המנהל מחליט (עופות=לא, בשר/דגים=כן)
      });
    }
  }

  async function save() {
    if (!editing) return;
    const mode = modeFromProduct(editing.saleType, editing.priceType);
    const isCartons = mode === "CARTONS";
    const payload = {
      name: editing.name,
      categoryId: editing.categoryId,
      cartonPrice: parseFloat(String(editing.cartonPrice ?? 0)),
      // בודדים - רק בקרטונים (בשר/דגים). ביחידות אין בודדים.
      allowSingles: isCartons ? (editing.allowSingles ?? false) : false,
      singleSurcharge: editing.singleSurcharge ? parseFloat(String(editing.singleSurcharge)) : null,
      // מצב בודדים: KG (בשר, ברירת מחדל) / UNITS (סלומון וכד' - יחידות במחיר קבוע)
      singlesMode: isCartons ? (editing.singlesMode || "KG") : "KG",
      singleUnitPrice:
        isCartons && editing.singlesMode === "UNITS" && editing.singleUnitPrice
          ? parseFloat(String(editing.singleUnitPrice))
          : null,
      // קרטונים: PACKAGE+PER_KG+"קרטון". יחידות: UNIT+REGULAR+"יחידה".
      unit: isCartons ? "קרטון" : "יחידה",
      saleType: isCartons ? "PACKAGE" : "UNIT",
      priceType: isCartons ? "PER_KG" : "REGULAR",
      // משקל אריזה (400 גרם וכו') - רק ביחידות, לתצוגה ללקוח
      packageWeight: !isCartons ? editing.packageWeight || null : null,
      // משקל משוער לקרטון - רק בקרטונים, להערכת מחיר
      avgWeightPerUnit:
        isCartons && editing.avgWeightPerUnit
          ? parseFloat(String(editing.avgWeightPerUnit))
          : null,
      isFrozen: editing.isFrozen ?? false,
      limitedQty: editing.limitedQty ?? false,
      limitedQtyAmount:
        editing.limitedQty && editing.limitedQtyAmount != null && String(editing.limitedQtyAmount) !== ""
          ? parseInt(String(editing.limitedQtyAmount), 10)
          : null,
      isActive: editing.isActive ?? true,
      allowPersonalOrder: editing.allowPersonalOrder ?? true,
      sortOrder: editing.sortOrder ?? 0,
      imageUrl: editing.imageUrl || null,
      kashrut: editing.kashrut || null,
      isFeatured: editing.isFeatured ?? false,
      highlightNote: editing.highlightNote || null,
    };
    if (editing.id) {
      await api(`/api/admin/products/${editing.id}`, { method: "PATCH", body: JSON.stringify(payload) });
    } else {
      await api("/api/admin/products", { method: "POST", body: JSON.stringify(payload) });
    }
    setEditing(null);
    load();
  }

  // העלאת תמונת מוצר ל-Supabase Storage
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
      alert(e.message || "שגיאה בהעלאת התמונה");
    } finally {
      setUploading(false);
    }
  }

  // סידור: החלפת sortOrder עם המוצר השכן בקטגוריה ועדכון שניהם.
  // §8: Optimistic update - העדכון מיידי ב-state לפני שהשרת עונה.
  // אם השרת נכשל, ה-state חוזר למצב הקודם ומופיעה הודעה.
  async function moveProduct(catProducts: Product[], idx: number, dir: -1 | 1) {
    const a = catProducts[idx];
    const b = catProducts[idx + dir];
    if (!a || !b) return;
    // אם ה-sortOrder שווה (ברירת מחדל 0) - מקצים ערכים לפי המיקום הנוכחי
    const aOrder = a.sortOrder === b.sortOrder ? idx : a.sortOrder;
    const bOrder = a.sortOrder === b.sortOrder ? idx + dir : b.sortOrder;

    // === Optimistic update: עדכון מיידי של state ===
    const oldProducts = products;
    setProducts(
      products.map((p) => {
        if (p.id === a.id) return { ...p, sortOrder: bOrder };
        if (p.id === b.id) return { ...p, sortOrder: aOrder };
        return p;
      })
    );

    // === שליחה לשרת ברקע ===
    try {
      await Promise.all([
        api(`/api/admin/products/${a.id}`, {
          method: "PATCH",
          body: JSON.stringify({ sortOrder: bOrder }),
        }),
        api(`/api/admin/products/${b.id}`, {
          method: "PATCH",
          body: JSON.stringify({ sortOrder: aOrder }),
        }),
      ]);
      // הצליח - state כבר מעודכן, אין צורך ברענון
    } catch (e) {
      // נכשל - שחזור state ומודעה
      setProducts(oldProducts);
      alert("שגיאה בשינוי סדר המוצרים. נסה שוב.");
    }
  }

  // §8: Optimistic toggle - עדכון מיידי, שחזור על כישלון
  async function toggleActive(p: Product) {
    const oldProducts = products;
    setProducts(products.map((x) => (x.id === p.id ? { ...x, isActive: !x.isActive } : x)));
    try {
      await api(`/api/admin/products/${p.id}`, {
        method: "PATCH",
        body: JSON.stringify({ isActive: !p.isActive }),
      });
    } catch (e) {
      setProducts(oldProducts);
      alert("שגיאה בהחלפת סטטוס המוצר. נסה שוב.");
    }
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

  // המצב הפשוט: קרטונים (נשקל) או יחידות (קבוע)
  const editMode = modeFromProduct(editing?.saleType, editing?.priceType);
  const isCartonsMode = editMode === "CARTONS";
  const showSingles = isCartonsMode; // בודדים רק בקרטונים (בשר/דגים)
  const showAvgWeight = isCartonsMode; // משקל משוער לקרטון

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
                allowPersonalOrder: true,
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
        /* מוצרים מקובצים לפי קטגוריה - עם חוצץ לכל קטגוריה וחיצי סידור */
        <div className="space-y-6">
          {cats
            .slice()
            .sort((a, b) => a.sortOrder - b.sortOrder)
            .map((cat) => {
              const catProducts = products
                .filter((p) => p.categoryId === cat.id)
                .sort((a, b) => a.sortOrder - b.sortOrder);
              if (catProducts.length === 0) return null;
              return (
                <div key={cat.id}>
                  {/* חוצץ קטגוריה */}
                  <div className="flex items-center gap-3 mb-2">
                    <h2 className="text-lg font-extrabold text-brand-slatedark">{cat.name}</h2>
                    <span className="text-xs text-zinc-400">{catProducts.length} מוצרים</span>
                    <div className="flex-1 border-b border-zinc-200" />
                  </div>
                  <div className="table-wrap">
                    <table className="admin">
                      <thead>
                        <tr>
                          <th className="w-16">סדר</th>
                          <th>מוצר</th>
                          <th>מחיר</th>
                          <th>יחידה</th>
                          <th>בודדים</th>
                          <th>פעיל</th>
                          <th></th>
                        </tr>
                      </thead>
                      <tbody>
                        {catProducts.map((p, idx) => (
                          <tr key={p.id} className={p.isActive ? "" : "opacity-50"}>
                            <td>
                              {/* חיצי סידור בתוך הקטגוריה */}
                              <div className="flex gap-0.5">
                                <button
                                  onClick={() => moveProduct(catProducts, idx, -1)}
                                  disabled={idx === 0}
                                  className="btn-ghost btn-sm px-1.5 disabled:opacity-20"
                                  title="הזז למעלה"
                                >
                                  ▲
                                </button>
                                <button
                                  onClick={() => moveProduct(catProducts, idx, 1)}
                                  disabled={idx === catProducts.length - 1}
                                  className="btn-ghost btn-sm px-1.5 disabled:opacity-20"
                                  title="הזז למטה"
                                >
                                  ▼
                                </button>
                              </div>
                            </td>
                            <td className="font-medium">
                              <div className="flex items-center gap-2">
                                {p.imageUrl && (
                                  <img
                                    src={p.imageUrl}
                                    alt={p.name}
                                    className="w-9 h-9 rounded-lg object-cover border border-zinc-200"
                                  />
                                )}
                                <div>
                                  {p.name}
                                  <div className="flex flex-wrap gap-1 mt-0.5">
                                    {p.isFeatured && (
                                      <span className="badge bg-red-100 text-red-700">מבצע</span>
                                    )}
                                    {p.kashrut && (
                                      <span className="badge bg-sky-100 text-sky-700">{p.kashrut}</span>
                                    )}
                                    {p.limitedQty && (
                                      <span className="badge bg-amber-100 text-amber-700">מוגבל</span>
                                    )}
                                    {p.isFrozen && (
                                      <span className="badge bg-blue-100 text-blue-700">קפוא</span>
                                    )}
                                    {!p.allowPersonalOrder && (
                                      <span className="badge bg-zinc-200 text-zinc-600" title="לא זמין להזמנה אישית">
                                        לא בהזמנה אישית
                                      </span>
                                    )}
                                  </div>
                                </div>
                              </div>
                            </td>
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
                </div>
              );
            })}
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
              <p className="text-xs text-zinc-400 mt-1">
                טיפ: עטוף מילה בכוכביות להדגשה — סלמון *פילה* יוצג: סלמון <b>פילה</b>
              </p>
            </Field>

            <Field label="כשרות">
              <input
                className="input"
                list="kashrut-options"
                placeholder='לנדא / אגודת ישראל / בד"ץ העדה החרדית...'
                value={editing.kashrut ?? ""}
                onChange={(e) => setEditing({ ...editing, kashrut: e.target.value })}
              />
              <datalist id="kashrut-options">
                {KASHRUT_OPTIONS.map((k) => (
                  <option key={k} value={k} />
                ))}
              </datalist>
            </Field>

            <Field label="הערת הדגשה (אופציונלי)">
              <input
                className="input"
                placeholder='למשל: "בקרטונים בלבד — לא בבודדים" / "מחיר מיוחד!"'
                value={editing.highlightNote ?? ""}
                onChange={(e) => setEditing({ ...editing, highlightNote: e.target.value })}
              />
            </Field>

            <Field label="תמונת מוצר (אופציונלי)">
              <div className="flex items-center gap-3">
                {editing.imageUrl && (
                  <img
                    src={editing.imageUrl}
                    alt=""
                    className="w-14 h-14 rounded-lg object-cover border border-zinc-200"
                  />
                )}
                <label className="btn-ghost btn-sm cursor-pointer">
                  {uploading ? "מעלה..." : editing.imageUrl ? "החלף תמונה" : "העלאת תמונה"}
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
              <Field label="סוג מוצר">
                <select
                  className="input"
                  value={editMode}
                  onChange={(e) => changeMode(e.target.value)}
                >
                  {SALE_MODES.map((s) => (
                    <option key={s.v} value={s.v}>
                      {s.l}
                    </option>
                  ))}
                </select>
              </Field>
            </div>

            {/* הסבר קצר על הסוג שנבחר */}
            <p className="text-xs text-zinc-500 bg-zinc-50 rounded-lg p-2 -mt-1">
              {isCartonsMode
                ? "הלקוח מזמין קרטונים שלמים (1, 2, 3...). המחיר הסופי לפי שקילה בפועל - מדבקת המשקל מוזנת למערכת."
                : "מוצר ארוז במשקל קבוע (למשל 400 גרם). מחיר קבוע ליחידה, בלי שקילה - כמות × מחיר."}
            </p>

            <div className="grid grid-cols-2 gap-3">
              <Field label={priceLabel(editMode)}>
                <input
                  className="input"
                  type="number"
                  step="0.1"
                  value={String(editing.cartonPrice ?? "")}
                  onChange={(e) => setEditing({ ...editing, cartonPrice: e.target.value })}
                />
              </Field>
              <Field label="יחידת מכירה">
                <input
                  className="input bg-zinc-50"
                  value={isCartonsMode ? "קרטון" : "יחידה"}
                  readOnly
                />
              </Field>
            </div>

            {/* משקל אריזה - רק ביחידות (לתצוגה ללקוח: "400 גרם") */}
            {!isCartonsMode && (
              <Field label="משקל מארז (גרם)">
                <input
                  className="input"
                  placeholder="200 גרם / 400 גרם / 500 גרם..."
                  value={editing.packageWeight ?? ""}
                  onChange={(e) => setEditing({ ...editing, packageWeight: e.target.value })}
                />
              </Field>
            )}

            {/* משקל משוער לקרטון - להערכת המחיר ללקוח לפני השקילה */}
            {showAvgWeight && (
              <Field label='משקל משוער לקרטון (ק"ג)'>
                <input
                  className="input"
                  type="number"
                  step="0.1"
                  placeholder='לדוגמה: קרטון חזה עוף ≈ 12 ק"ג'
                  value={editing.avgWeightPerUnit ?? ""}
                  onChange={(e) => setEditing({ ...editing, avgWeightPerUnit: e.target.value })}
                />
                <p className="text-xs text-zinc-400 mt-1">
                  חובה למילוי — להערכת מחיר ללקוח (מחיר לק"ג × משקל משוער × כמות). המחיר הסופי לפי
                  שקילה בפועל.
                </p>
                {!editing.avgWeightPerUnit && (
                  <p className="text-xs text-amber-600 mt-1 font-medium">
                    ⚠️ חסר משקל משוער — ההערכה ללקוח לא תהיה מדויקת עד למילוי.
                  </p>
                )}
              </Field>
            )}

            {/* בודדים - רק בקרטונים (בשר/דגים): הזמנה בק"ג במקום קרטון שלם */}
            {showSingles && (
              <>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={editing.allowSingles ?? false}
                    onChange={(e) => setEditing({ ...editing, allowSingles: e.target.checked })}
                    className="h-4 w-4 accent-brand-rust"
                  />
                  לאפשר קנייה בבודדים — הזמנה בק"ג במקום קרטון שלם (בשר/דגים)
                </label>
                {editing.allowSingles && (
                  <>
                    <Field label="מצב בודדים">
                      <select
                        className="input"
                        value={editing.singlesMode || "KG"}
                        onChange={(e) => setEditing({ ...editing, singlesMode: e.target.value })}
                      >
                        <option value="KG">לפי ק"ג (בשר) — מחיר לק"ג + תוספת</option>
                        <option value="UNITS">לפי יחידה (סלומון) — מחיר קבוע ליחידה</option>
                      </select>
                    </Field>
                    {(!editing.singlesMode || editing.singlesMode === "KG") && (
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
                    {editing.singlesMode === "UNITS" && (
                      <Field label="מחיר קבוע ליחידה בבודדים">
                        <input
                          className="input"
                          type="number"
                          step="0.5"
                          placeholder="למשל: 25"
                          value={String(editing.singleUnitPrice ?? "")}
                          onChange={(e) => setEditing({ ...editing, singleUnitPrice: e.target.value })}
                        />
                      </Field>
                    )}
                  </>
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
                  checked={editing.isFeatured ?? false}
                  onChange={(e) => setEditing({ ...editing, isFeatured: e.target.checked })}
                  className="h-4 w-4 accent-brand-rust"
                />
                ⭐ מוצר מבצע (מודגש ללקוח)
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={editing.allowPersonalOrder ?? true}
                  onChange={(e) => setEditing({ ...editing, allowPersonalOrder: e.target.checked })}
                  className="h-4 w-4 accent-brand-rust"
                />
                <div>
                  <span>זמין להזמנה אישית</span>
                  <p className="text-xs text-zinc-400 font-normal">
                    כשמסומן — המוצר יופיע גם בעמוד ההזמנה האישית של הלקוח
                  </p>
                </div>
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
