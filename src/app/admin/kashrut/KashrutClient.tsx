"use client";

// ניהול כשרויות מרוכזות - CRUD עם העלאת תמונה
// המנהל יוצר פעם אחת שם + תמונה, אחר כך בוחר בכל מוצר מהרשימה

import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/client";

type Kashrut = {
  id: string;
  name: string;
  imageUrl: string;
  sortOrder: number;
  isActive: boolean;
  productCount: number;
};

export default function KashrutClient() {
  const [list, setList] = useState<Kashrut[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Kashrut | "new" | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const data = await api("/api/admin/kashrut");
      setList(Array.isArray(data) ? data : []);
    } catch {
      setList([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  async function toggleActive(k: Kashrut) {
    try {
      await api(`/api/admin/kashrut/${k.id}`, {
        method: "PATCH",
        body: JSON.stringify({ isActive: !k.isActive }),
      });
      load();
    } catch (e: any) {
      alert("שגיאה: " + e.message);
    }
  }

  async function del(k: Kashrut) {
    if (k.productCount > 0) {
      alert(
        `לא ניתן למחוק - ${k.productCount} מוצרים משתמשים בכשרות זו. הצג/הסתר במקום למחוק.`
      );
      return;
    }
    if (!confirm(`למחוק את הכשרות "${k.name}"?`)) return;
    try {
      await api(`/api/admin/kashrut/${k.id}`, { method: "DELETE" });
      load();
    } catch (e: any) {
      alert("שגיאה: " + e.message);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-extrabold text-brand-slatedark">
            כשרויות
          </h1>
          <p className="text-sm text-zinc-500">
            נהל את רשימת הכשרויות - שם + לוגו. תוכל לבחור מהרשימה בכל מוצר.
          </p>
        </div>
        <button
          onClick={() => setEditing("new")}
          className="btn-primary"
        >
          ➕ כשרות חדשה
        </button>
      </div>

      {loading ? (
        <div className="text-center py-12 text-zinc-500">טוען...</div>
      ) : list.length === 0 ? (
        <div className="card p-10 text-center">
          <div className="text-5xl mb-3">🏷️</div>
          <p className="font-bold text-brand-slatedark">
            עדיין לא הוגדרו כשרויות
          </p>
          <p className="text-xs text-zinc-500 mt-1">
            צור כשרות ראשונה כדי לבחור אותה במוצרים
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
          {list.map((k) => (
            <div
              key={k.id}
              className={`bg-white rounded-2xl border p-3 hover:shadow-md transition-all ${
                !k.isActive
                  ? "border-zinc-200 opacity-60"
                  : "border-zinc-200"
              }`}
            >
              {/* תמונה */}
              <div className="relative aspect-square rounded-xl bg-zinc-50 overflow-hidden mb-2 flex items-center justify-center">
                {k.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={k.imageUrl}
                    alt={k.name}
                    className="w-full h-full object-contain p-2"
                  />
                ) : (
                  <div className="text-zinc-300 text-3xl">🏷️</div>
                )}
                {!k.isActive && (
                  <div className="absolute inset-0 bg-white/60 flex items-center justify-center">
                    <span className="text-xs font-bold bg-zinc-800 text-white px-2 py-0.5 rounded">
                      לא פעילה
                    </span>
                  </div>
                )}
              </div>

              {/* שם */}
              <div className="font-bold text-brand-slatedark text-sm text-center mb-1 truncate">
                {k.name}
              </div>

              {/* בשימוש */}
              <div className="text-[10px] text-zinc-500 text-center mb-2">
                {k.productCount} מוצרים
              </div>

              {/* פעולות */}
              <div className="flex gap-1">
                <button
                  onClick={() => setEditing(k)}
                  className="flex-1 text-xs py-1.5 rounded-md bg-zinc-100 hover:bg-zinc-200 font-medium"
                >
                  עריכה
                </button>
                <button
                  onClick={() => toggleActive(k)}
                  className={`flex-1 text-xs py-1.5 rounded-md font-medium ${
                    k.isActive
                      ? "bg-amber-100 hover:bg-amber-200 text-amber-800"
                      : "bg-emerald-100 hover:bg-emerald-200 text-emerald-800"
                  }`}
                >
                  {k.isActive ? "הסתר" : "הצג"}
                </button>
                {k.productCount === 0 && (
                  <button
                    onClick={() => del(k)}
                    className="text-xs py-1.5 px-2 rounded-md bg-red-100 hover:bg-red-200 text-red-700 font-medium"
                    title="מחק"
                  >
                    🗑️
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {editing && (
        <KashrutEditor
          initial={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            load();
          }}
        />
      )}
    </div>
  );
}

function KashrutEditor({
  initial,
  onClose,
  onSaved,
}: {
  initial: Kashrut | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isNew = !initial;
  const [name, setName] = useState(initial?.name || "");
  const [imageUrl, setImageUrl] = useState(initial?.imageUrl || "");
  const [sortOrder, setSortOrder] = useState(initial?.sortOrder ?? 0);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  async function upload(file: File) {
    setUploading(true);
    setError("");
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("folder", "kashrut");
      const res = await fetch("/api/admin/upload", {
        method: "POST",
        body: formData,
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "העלאה נכשלה");
      setImageUrl(json.url);
    } catch (e: any) {
      setError("שגיאה בהעלאה: " + e.message);
    } finally {
      setUploading(false);
    }
  }

  async function save() {
    if (!name.trim()) {
      setError("יש להזין שם");
      return;
    }
    if (!imageUrl) {
      setError("יש להעלות תמונה");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const url = isNew
        ? "/api/admin/kashrut"
        : `/api/admin/kashrut/${initial.id}`;
      await api(url, {
        method: isNew ? "POST" : "PATCH",
        body: JSON.stringify({
          name: name.trim(),
          imageUrl,
          sortOrder,
        }),
      });
      onSaved();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="bg-white w-full max-w-md sm:rounded-2xl rounded-t-2xl max-h-[95vh] overflow-y-auto shadow-2xl">
        <div className="sticky top-0 bg-white border-b border-zinc-200 px-5 py-3 flex items-center justify-between z-10">
          <h3 className="font-extrabold text-brand-slatedark text-lg">
            {isNew ? "➕ כשרות חדשה" : "✏️ עריכת כשרות"}
          </h3>
          <button
            onClick={onClose}
            className="text-zinc-400 hover:text-zinc-600 text-2xl leading-none px-2"
          >
            ×
          </button>
        </div>

        <div className="p-5 space-y-4">
          {/* שם */}
          <div>
            <label className="text-xs font-bold text-zinc-500 block mb-1">
              שם הכשרות *
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder='לדוגמה: בד"ץ העדה החרדית'
              className="w-full px-3 py-2 border border-zinc-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-rust"
            />
          </div>

          {/* העלאת תמונה */}
          <div>
            <label className="text-xs font-bold text-zinc-500 block mb-1">
              לוגו כשרות *
            </label>

            {/* תצוגה של תמונה קיימת */}
            {imageUrl && (
              <div className="relative aspect-square w-32 mx-auto rounded-xl bg-zinc-50 border border-zinc-200 overflow-hidden mb-2">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={imageUrl}
                  alt="תצוגה מקדימה"
                  className="w-full h-full object-contain p-2"
                />
              </div>
            )}

            {/* כפתור העלאה */}
            <div>
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) upload(f);
                }}
                className="hidden"
              />
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                disabled={uploading}
                className="w-full py-2.5 border-2 border-dashed border-zinc-300 rounded-lg text-sm text-zinc-600 hover:border-brand-rust hover:text-brand-rust font-medium disabled:opacity-50"
              >
                {uploading
                  ? "מעלה..."
                  : imageUrl
                  ? "🔄 החלף תמונה"
                  : "📷 העלה לוגו"}
              </button>
              <p className="text-[10px] text-zinc-500 mt-1 text-center">
                מומלץ: תמונה מרובעת, רקע שקוף (PNG)
              </p>
            </div>
          </div>

          {/* סדר */}
          <div>
            <label className="text-xs font-bold text-zinc-500 block mb-1">
              סדר הצגה (0 = ראשון)
            </label>
            <input
              type="number"
              value={sortOrder}
              onChange={(e) => setSortOrder(Number(e.target.value) || 0)}
              className="w-full px-3 py-2 border border-zinc-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-rust"
            />
          </div>

          {/* שגיאה */}
          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-2.5 text-xs text-red-800">
              {error}
            </div>
          )}
        </div>

        <div className="sticky bottom-0 bg-white border-t border-zinc-200 p-4 flex gap-2">
          <button
            onClick={onClose}
            disabled={saving}
            className="flex-1 py-3 rounded-xl border border-zinc-300 text-brand-slatedark font-bold hover:bg-zinc-50"
          >
            ביטול
          </button>
          <button
            onClick={save}
            disabled={saving || uploading || !name.trim() || !imageUrl}
            className="flex-1 py-3 rounded-xl bg-brand-rust text-white font-bold hover:bg-[#a83a15] disabled:opacity-50 shadow-md"
          >
            {saving ? "שומר..." : "שמור"}
          </button>
        </div>
      </div>
    </div>
  );
}
