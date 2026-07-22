"use client";

// §20: מסך ניהול תעודות משלוח
// זרימה: בחירת מחירון → העלאת צילום → Gemini OCR → תצוגת טבלה → עריכה + אישור

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";

type Pricelist = {
  id: string;
  name: string;
  status: string;
  deliveryDate: string | null;
};

type Product = {
  id: string;
  name: string;
};

type NoteItem = {
  id?: string;
  productNameOnNote: string;
  productId: string | null;
  product?: Product | null;
  quantity: number;
  weight: number;
  confidence: number | null;
  addedManually?: boolean;
  note?: string | null;
  sortOrder?: number;
};

type DeliveryNote = {
  id: string;
  supplierName: string | null;
  noteNumber: string | null;
  noteDate: string | null;
  imageUrl: string | null;
  status: string;
  confirmedAt: string | null;
  createdAt: string;
  items: NoteItem[];
};

type Props = {
  pricelists: Pricelist[];
  initialPricelistId?: string;
};

export default function AdminDeliveryNotesClient({
  pricelists,
  initialPricelistId,
}: Props) {
  const [pricelistId, setPricelistId] = useState<string>(
    initialPricelistId || pricelists[0]?.id || ""
  );
  const [notes, setNotes] = useState<DeliveryNote[]>([]);
  const [loading, setLoading] = useState(true);
  const [products, setProducts] = useState<Product[]>([]);
  const [uploadState, setUploadState] = useState<{
    stage: "idle" | "compressing" | "sending" | "processing" | "done" | "error";
    error?: string;
  }>({ stage: "idle" });
  const [editingNote, setEditingNote] = useState<DeliveryNote | null>(null);

  const loadNotes = useCallback(async () => {
    if (!pricelistId) return;
    setLoading(true);
    try {
      const res = await fetch(
        `/api/admin/delivery-notes?pricelistId=${pricelistId}`,
        { cache: "no-store" }
      );
      const data = await res.json();
      setNotes(Array.isArray(data) ? data : []);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [pricelistId]);

  const loadProducts = useCallback(async () => {
    try {
      const res = await fetch(`/api/admin/products`, { cache: "no-store" });
      const data = await res.json();
      setProducts(Array.isArray(data) ? data.map((p: any) => ({ id: p.id, name: p.name })) : []);
    } catch (e) {
      console.error(e);
    }
  }, []);

  useEffect(() => {
    loadNotes();
    loadProducts();
  }, [loadNotes, loadProducts]);

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !pricelistId) return;
    e.target.value = ""; // אפס את האינפוט כדי לאפשר העלאה חוזרת של אותו קובץ

    setUploadState({ stage: "compressing" });

    try {
      // דחיסת התמונה בצד לקוח כדי לחסוך זמן שליחה ל-Gemini
      const compressed = await compressImage(file, 1600);

      setUploadState({ stage: "sending" });

      // המרה ל-base64
      const base64 = await blobToBase64(compressed);

      setUploadState({ stage: "processing" });

      const res = await fetch("/api/admin/delivery-notes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pricelistId,
          imageBase64: base64,
          mimeType: "image/jpeg",
        }),
      });
      const data = await res.json();

      if (!res.ok) {
        setUploadState({
          stage: "error",
          error: data.error || "שגיאה בעיבוד התעודה",
        });
        return;
      }

      setUploadState({ stage: "done" });

      // רענון הרשימה ופתיחת המסמך החדש לעריכה
      await loadNotes();
      setEditingNote(data.deliveryNote);
      setTimeout(() => setUploadState({ stage: "idle" }), 2000);
    } catch (e: any) {
      setUploadState({
        stage: "error",
        error: e?.message || "שגיאה כללית",
      });
    }
  }

  return (
    <div dir="rtl" className="min-h-screen bg-brand-cream pb-20">
      {/* Header */}
      <header className="bg-brand-yellow border-b-4 border-brand-rust/20">
        <div className="mx-auto max-w-6xl px-4 py-3 flex items-center justify-between">
          <Link href="/admin" className="text-brand-slate font-medium text-sm">
            ← חזרה לניהול
          </Link>
          <h1 className="font-extrabold text-brand-slatedark">
            📄 תעודות משלוח
          </h1>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-6">
        {/* בחירת מחירון + העלאה */}
        <div className="bg-white rounded-2xl border border-zinc-200 shadow-sm p-5 mb-5">
          <div className="grid md:grid-cols-2 gap-4">
            <div>
              <label className="block">
                <span className="text-sm font-bold text-brand-slatedark">
                  בחר מחירון
                </span>
                <select
                  value={pricelistId}
                  onChange={(e) => setPricelistId(e.target.value)}
                  className="w-full mt-1 px-3 py-2 border border-zinc-300 rounded-lg text-sm bg-white"
                >
                  {pricelists.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} · {p.status}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div>
              <div className="text-sm font-bold text-brand-slatedark mb-1">
                העלה תעודת משלוח
              </div>
              <label
                className={`flex items-center justify-center gap-2 px-4 py-3 rounded-xl cursor-pointer font-bold transition-all ${
                  uploadState.stage !== "idle" && uploadState.stage !== "done" && uploadState.stage !== "error"
                    ? "bg-zinc-300 text-zinc-500 cursor-wait"
                    : "bg-brand-rust text-white hover:bg-[#a83a15] shadow-md"
                }`}
              >
                {uploadState.stage === "compressing" && "מכין את התמונה..."}
                {uploadState.stage === "sending" && "שולח לניתוח..."}
                {uploadState.stage === "processing" && "AI מזהה את התוכן..."}
                {uploadState.stage === "done" && "✓ נוצרה טיוטה"}
                {uploadState.stage === "error" && "שגיאה - נסה שוב"}
                {uploadState.stage === "idle" && (
                  <>
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-7.5-9V15m0 0l-3-3m3 3l3-3M3.75 6.75h16.5" />
                    </svg>
                    צלם / העלה תעודה
                  </>
                )}
                <input
                  type="file"
                  accept="image/*"
                  capture="environment"
                  onChange={handleFile}
                  className="hidden"
                  disabled={uploadState.stage !== "idle" && uploadState.stage !== "done" && uploadState.stage !== "error"}
                />
              </label>
              {uploadState.error && (
                <div className="mt-2 text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg p-2">
                  {uploadState.error}
                </div>
              )}
            </div>
          </div>

          <div className="mt-3 text-xs text-zinc-500 bg-blue-50/50 border border-blue-100 rounded-lg p-3">
            <strong>איך זה עובד:</strong> העלה צילום ברור של תעודת המשלוח. Gemini AI יזהה את הפריטים וימלא טבלה. אתה תראה את התוצאה, תוכל לתקן/להוסיף שורות, ורק אחרי אישור המערכת תשמור.
          </div>
        </div>

        {/* רשימת תעודות */}
        <div className="bg-white rounded-2xl border border-zinc-200 shadow-sm overflow-hidden">
          <div className="px-5 py-3 border-b border-zinc-200 bg-zinc-50">
            <div className="font-bold text-brand-slatedark">
              תעודות במכירה זו
            </div>
          </div>
          {loading ? (
            <div className="p-8 text-center text-zinc-500">טוען...</div>
          ) : notes.length === 0 ? (
            <div className="p-8 text-center text-zinc-500 text-sm">
              עדיין לא הועלו תעודות למכירה זו
            </div>
          ) : (
            <div className="divide-y divide-zinc-100">
              {notes.map((n) => (
                <NoteRow
                  key={n.id}
                  note={n}
                  onEdit={() => setEditingNote(n)}
                  onDeleted={loadNotes}
                />
              ))}
            </div>
          )}
        </div>
      </main>

      {/* מודל עריכה */}
      {editingNote && (
        <NoteEditorModal
          note={editingNote}
          products={products}
          onClose={() => setEditingNote(null)}
          onSaved={() => {
            setEditingNote(null);
            loadNotes();
          }}
        />
      )}
    </div>
  );
}

function NoteRow({
  note,
  onEdit,
  onDeleted,
}: {
  note: DeliveryNote;
  onEdit: () => void;
  onDeleted: () => void;
}) {
  const [deleting, setDeleting] = useState(false);
  const totalWeight = note.items.reduce((s, i) => s + Number(i.weight), 0);
  const totalCartons = note.items.reduce((s, i) => s + Number(i.quantity), 0);
  const unmatched = note.items.filter((i) => !i.productId).length;

  async function del() {
    if (!confirm("למחוק את התעודה?")) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/admin/delivery-notes/${note.id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const j = await res.json();
        alert(j.error || "שגיאה");
        return;
      }
      onDeleted();
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="p-4 flex items-center gap-3">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-bold text-brand-slatedark">
            {note.supplierName || "ספק לא זוהה"}
          </span>
          {note.noteNumber && (
            <span className="text-xs bg-zinc-100 text-zinc-700 px-2 py-0.5 rounded font-mono">
              #{note.noteNumber}
            </span>
          )}
          {note.status === "CONFIRMED" ? (
            <span className="text-xs bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full font-bold">
              ✓ מאושר
            </span>
          ) : (
            <span className="text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full font-bold">
              טיוטה
            </span>
          )}
          {unmatched > 0 && (
            <span className="text-xs bg-red-100 text-red-700 px-2 py-0.5 rounded-full font-bold">
              {unmatched} לא הותאם
            </span>
          )}
        </div>
        <div className="text-xs text-zinc-500 mt-1">
          {note.items.length} שורות · {totalCartons} קרטונים · {totalWeight.toFixed(2)} ק"ג
          {note.noteDate && <> · {new Date(note.noteDate).toLocaleDateString("he-IL")}</>}
        </div>
      </div>
      <div className="flex gap-2 shrink-0">
        <button
          onClick={onEdit}
          className={`text-xs px-3 py-1.5 rounded-md font-medium ${
            note.status === "CONFIRMED"
              ? "bg-zinc-100 text-zinc-600 hover:bg-zinc-200"
              : "bg-brand-rust text-white hover:bg-[#a83a15]"
          }`}
        >
          {note.status === "CONFIRMED" ? "צפייה" : "עריכה ואישור"}
        </button>
        {note.status !== "CONFIRMED" && (
          <button
            onClick={del}
            disabled={deleting}
            className="text-xs px-3 py-1.5 rounded-md bg-red-50 text-red-700 hover:bg-red-100 font-medium"
          >
            מחק
          </button>
        )}
      </div>
    </div>
  );
}

function NoteEditorModal({
  note: initialNote,
  products,
  onClose,
  onSaved,
}: {
  note: DeliveryNote;
  products: Product[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [note, setNote] = useState<DeliveryNote>(initialNote);
  const [items, setItems] = useState<NoteItem[]>(initialNote.items);
  const [saving, setSaving] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const isConfirmed = note.status === "CONFIRMED";

  function updateItem(idx: number, updates: Partial<NoteItem>) {
    setItems((prev) => prev.map((it, i) => (i === idx ? { ...it, ...updates } : it)));
  }

  function removeItem(idx: number) {
    setItems((prev) => prev.filter((_, i) => i !== idx));
  }

  function addItem() {
    setItems((prev) => [
      ...prev,
      {
        productNameOnNote: "",
        productId: null,
        quantity: 1,
        weight: 0,
        confidence: null,
        addedManually: true,
      },
    ]);
  }

  async function saveDraft() {
    setSaving(true);
    try {
      const res = await fetch(`/api/admin/delivery-notes/${note.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          supplierName: note.supplierName,
          noteNumber: note.noteNumber,
          noteDate: note.noteDate,
          items: items.map((it) => ({
            productNameOnNote: it.productNameOnNote,
            productId: it.productId,
            quantity: it.quantity,
            weight: it.weight,
            addedManually: it.addedManually,
            note: it.note,
          })),
        }),
      });
      if (!res.ok) {
        const j = await res.json();
        alert(j.error || "שגיאה בשמירה");
        return;
      }
      onSaved();
    } finally {
      setSaving(false);
    }
  }

  async function confirmNote() {
    // בדיקה שהכל הותאם
    const unmatched = items.filter((it) => !it.productId);
    if (unmatched.length > 0) {
      alert(
        `${unmatched.length} שורות עדיין לא הותאמו למוצר במערכת. יש להתאים או להסיר לפני אישור.`
      );
      return;
    }
    if (!confirm("לאשר את התעודה? לאחר אישור לא ניתן יהיה לערוך.")) return;
    setConfirming(true);
    try {
      // קודם שמור טיוטה
      await fetch(`/api/admin/delivery-notes/${note.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          supplierName: note.supplierName,
          noteNumber: note.noteNumber,
          noteDate: note.noteDate,
          items: items.map((it) => ({
            productNameOnNote: it.productNameOnNote,
            productId: it.productId,
            quantity: it.quantity,
            weight: it.weight,
            addedManually: it.addedManually,
            note: it.note,
          })),
        }),
      });
      // ואז אשר
      const res = await fetch(`/api/admin/delivery-notes/${note.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "CONFIRMED" }),
      });
      if (!res.ok) {
        const j = await res.json();
        alert(j.error || "שגיאה באישור");
        return;
      }
      onSaved();
    } finally {
      setConfirming(false);
    }
  }

  const totalCartons = items.reduce((s, i) => s + Number(i.quantity), 0);
  const totalWeight = items.reduce((s, i) => s + Number(i.weight), 0);
  const unmatched = items.filter((it) => !it.productId).length;

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="bg-white w-full max-w-5xl sm:rounded-2xl rounded-t-2xl max-h-[95vh] overflow-y-auto shadow-2xl">
        {/* Header */}
        <div className="sticky top-0 bg-white border-b border-zinc-200 px-5 py-3 flex items-center justify-between z-10">
          <div>
            <h3 className="font-extrabold text-brand-slatedark text-lg">
              {isConfirmed ? "צפייה בתעודה" : "עריכת תעודה"}
            </h3>
            <p className="text-xs text-zinc-500">
              {isConfirmed
                ? "התעודה מאושרת"
                : "בדוק כל שורה, תקן במידת הצורך והוסף שורות חסרות"}
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-zinc-400 hover:text-zinc-600 text-2xl leading-none px-2"
          >
            ×
          </button>
        </div>

        {/* פרטי כותרת */}
        <div className="p-5 grid grid-cols-1 md:grid-cols-3 gap-3 border-b border-zinc-100">
          <label className="block">
            <span className="text-xs font-bold text-zinc-500">שם הספק</span>
            <input
              type="text"
              value={note.supplierName || ""}
              onChange={(e) => setNote({ ...note, supplierName: e.target.value })}
              disabled={isConfirmed}
              className="w-full mt-1 px-3 py-2 border border-zinc-300 rounded-lg text-sm disabled:bg-zinc-50"
            />
          </label>
          <label className="block">
            <span className="text-xs font-bold text-zinc-500">מספר תעודה</span>
            <input
              type="text"
              value={note.noteNumber || ""}
              onChange={(e) => setNote({ ...note, noteNumber: e.target.value })}
              disabled={isConfirmed}
              className="w-full mt-1 px-3 py-2 border border-zinc-300 rounded-lg text-sm disabled:bg-zinc-50"
            />
          </label>
          <label className="block">
            <span className="text-xs font-bold text-zinc-500">תאריך</span>
            <input
              type="date"
              value={note.noteDate ? note.noteDate.substring(0, 10) : ""}
              onChange={(e) => setNote({ ...note, noteDate: e.target.value })}
              disabled={isConfirmed}
              className="w-full mt-1 px-3 py-2 border border-zinc-300 rounded-lg text-sm disabled:bg-zinc-50"
            />
          </label>
        </div>

        {/* התראות */}
        {unmatched > 0 && !isConfirmed && (
          <div className="mx-5 mt-3 bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-800">
            <strong>{unmatched} שורות</strong> טרם הותאמו למוצר במערכת. יש להתאים או להסיר לפני אישור.
          </div>
        )}

        {/* טבלת שורות */}
        <div className="p-5">
          <div className="text-xs font-bold text-brand-slatedark mb-2">
            שורות בתעודה ({items.length})
          </div>
          <div className="space-y-2">
            {items.map((item, idx) => (
              <ItemEditor
                key={idx}
                item={item}
                products={products}
                readOnly={isConfirmed}
                onChange={(u) => updateItem(idx, u)}
                onRemove={() => removeItem(idx)}
              />
            ))}
          </div>
          {!isConfirmed && (
            <div className="mt-3 flex items-center gap-2">
              <button
                onClick={addItem}
                className="text-sm px-3 py-2 rounded-lg bg-blue-100 text-blue-700 hover:bg-blue-200 font-medium"
              >
                + הוסף שורה ידנית
              </button>
              <div className="text-xs text-zinc-500">
                (למקרה שה-AI התפספס שורה)
              </div>
            </div>
          )}
        </div>

        {/* סיכום */}
        <div className="px-5 py-3 border-t border-zinc-100 bg-zinc-50 flex items-center justify-between text-sm">
          <div className="text-zinc-600">סיכום:</div>
          <div className="font-bold text-brand-slatedark">
            {totalCartons} קרטונים · {totalWeight.toFixed(2)} ק"ג
          </div>
        </div>

        {/* Actions */}
        {!isConfirmed && (
          <div className="sticky bottom-0 bg-white border-t border-zinc-200 p-4 flex gap-2">
            <button
              onClick={onClose}
              className="flex-1 py-3 rounded-xl border border-zinc-300 text-brand-slatedark font-bold hover:bg-zinc-50"
            >
              סגור
            </button>
            <button
              onClick={saveDraft}
              disabled={saving}
              className="flex-1 py-3 rounded-xl bg-zinc-200 text-brand-slatedark font-bold hover:bg-zinc-300 disabled:opacity-50"
            >
              {saving ? "שומר..." : "שמור טיוטה"}
            </button>
            <button
              onClick={confirmNote}
              disabled={confirming || unmatched > 0}
              className="flex-1 py-3 rounded-xl bg-emerald-600 text-white font-bold hover:bg-emerald-700 disabled:opacity-50 shadow-md"
            >
              {confirming ? "מאשר..." : "אשר תעודה ✓"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function ItemEditor({
  item,
  products,
  readOnly,
  onChange,
  onRemove,
}: {
  item: NoteItem;
  products: Product[];
  readOnly?: boolean;
  onChange: (updates: Partial<NoteItem>) => void;
  onRemove: () => void;
}) {
  const [productSearch, setProductSearch] = useState("");
  const [showProductPicker, setShowProductPicker] = useState(false);

  const filteredProducts = products.filter((p) =>
    p.name.toLowerCase().includes(productSearch.toLowerCase())
  );
  const matchedProduct = products.find((p) => p.id === item.productId);
  const lowConfidence = item.confidence !== null && item.confidence < 0.6;

  return (
    <div
      className={`rounded-lg border p-3 ${
        item.productId
          ? "bg-white border-zinc-200"
          : "bg-red-50/40 border-red-300"
      } ${lowConfidence ? "ring-2 ring-amber-300" : ""}`}
    >
      {/* שורה עליונה: שם + confidence + מחיקה */}
      <div className="flex items-center justify-between gap-2 mb-2">
        <div className="flex items-center gap-2 flex-wrap">
          {item.addedManually && (
            <span className="text-[10px] bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded font-bold">
              הוסף ידנית
            </span>
          )}
          {lowConfidence && !item.addedManually && (
            <span className="text-[10px] bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded font-bold">
              ⚠️ AI לא בטוח - בדוק
            </span>
          )}
          {item.confidence !== null && (
            <span className="text-[9px] text-zinc-400">
              דיוק AI: {Math.round(item.confidence * 100)}%
            </span>
          )}
        </div>
        {!readOnly && (
          <button
            onClick={onRemove}
            className="text-xs text-red-600 hover:bg-red-50 px-2 py-1 rounded"
          >
            הסר
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-6 gap-2">
        {/* שם המוצר בתעודה */}
        <label className="block md:col-span-2">
          <span className="text-[10px] font-bold text-zinc-500">
            שם בתעודה
          </span>
          <input
            type="text"
            value={item.productNameOnNote}
            onChange={(e) => onChange({ productNameOnNote: e.target.value })}
            disabled={readOnly}
            className="w-full mt-0.5 px-2 py-1.5 border border-zinc-300 rounded text-sm disabled:bg-zinc-50"
          />
        </label>

        {/* מוצר במערכת */}
        <div className="block md:col-span-2">
          <span className="text-[10px] font-bold text-zinc-500">
            מוצר במערכת <span className="text-red-500">*</span>
          </span>
          {matchedProduct && !showProductPicker ? (
            <button
              onClick={() => !readOnly && setShowProductPicker(true)}
              disabled={readOnly}
              className={`w-full mt-0.5 px-2 py-1.5 border rounded text-sm text-right ${
                readOnly
                  ? "bg-zinc-50 border-zinc-200"
                  : "bg-emerald-50 border-emerald-300 hover:bg-emerald-100 cursor-pointer"
              }`}
            >
              ✓ {matchedProduct.name}
            </button>
          ) : (
            <>
              <input
                type="text"
                value={productSearch}
                onChange={(e) => {
                  setProductSearch(e.target.value);
                  setShowProductPicker(true);
                }}
                onFocus={() => setShowProductPicker(true)}
                placeholder={
                  matchedProduct ? matchedProduct.name : "חפש מוצר..."
                }
                disabled={readOnly}
                className="w-full mt-0.5 px-2 py-1.5 border border-red-300 rounded text-sm"
              />
              {showProductPicker && productSearch && (
                <div className="absolute z-10 mt-1 bg-white border border-zinc-200 rounded-lg shadow-lg max-h-40 overflow-y-auto min-w-[200px]">
                  {filteredProducts.slice(0, 10).map((p) => (
                    <button
                      key={p.id}
                      onClick={() => {
                        onChange({ productId: p.id });
                        setProductSearch("");
                        setShowProductPicker(false);
                      }}
                      className="w-full text-right px-3 py-2 text-sm hover:bg-blue-50"
                    >
                      {p.name}
                    </button>
                  ))}
                  {filteredProducts.length === 0 && (
                    <div className="px-3 py-2 text-xs text-zinc-500">
                      לא נמצאו תוצאות
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>

        {/* קרטונים */}
        <label className="block">
          <span className="text-[10px] font-bold text-zinc-500">קרטונים</span>
          <input
            type="number"
            min="0"
            step="1"
            value={item.quantity}
            onChange={(e) => onChange({ quantity: parseInt(e.target.value) || 0 })}
            disabled={readOnly}
            className="w-full mt-0.5 px-2 py-1.5 border border-zinc-300 rounded text-sm text-center disabled:bg-zinc-50"
          />
        </label>

        {/* משקל */}
        <label className="block">
          <span className="text-[10px] font-bold text-zinc-500">משקל ק"ג</span>
          <input
            type="number"
            min="0"
            step="0.01"
            value={item.weight}
            onChange={(e) => onChange({ weight: parseFloat(e.target.value) || 0 })}
            disabled={readOnly}
            className="w-full mt-0.5 px-2 py-1.5 border border-zinc-300 rounded text-sm text-center disabled:bg-zinc-50"
          />
        </label>
      </div>
    </div>
  );
}

// דחיסת תמונה בצד לקוח - כדי לא לשלוח קבצים ענקיים ל-Gemini
async function compressImage(file: File, maxDim: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      let w = img.width;
      let h = img.height;
      if (w > maxDim || h > maxDim) {
        if (w > h) {
          h = Math.round((h * maxDim) / w);
          w = maxDim;
        } else {
          w = Math.round((w * maxDim) / h);
          h = maxDim;
        }
      }
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (!ctx) return reject(new Error("no canvas context"));
      ctx.drawImage(img, 0, 0, w, h);
      canvas.toBlob(
        (blob) => {
          if (!blob) return reject(new Error("compression failed"));
          resolve(blob);
        },
        "image/jpeg",
        0.85
      );
    };
    img.onerror = () => reject(new Error("image load failed"));
    img.src = URL.createObjectURL(file);
  });
}

async function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = reader.result as string;
      resolve(result.split(",")[1] || result);
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}
