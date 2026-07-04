"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/client";
import { Modal, Field } from "@/components/AdminModal";

type Point = {
  id: string;
  name: string;
  city: string | null;
  address: string | null;
  contactName: string | null;
  phone: string | null;
  email: string | null;
  deliveryHours: string | null;
  notes: string | null;
  isActive: boolean;
  sortOrder: number;
};

// אפשרויות שעה בקפיצות של חצי שעה, 06:00 עד 23:30
const TIME_OPTIONS: string[] = [];
for (let h = 6; h <= 23; h++) {
  for (const m of [0, 30]) {
    TIME_OPTIONS.push(`${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`);
  }
}

// מנסה לפרק מחרוזת שעות קיימת בפורמט "09:00 - 12:00" לשתי שעות
function parseHours(s: string | null | undefined): { from: string; to: string; free: boolean } {
  if (!s) return { from: "", to: "", free: false };
  const m = s.match(/^(\d{1,2}:\d{2})\s*[-–]\s*(\d{1,2}:\d{2})$/);
  if (m) return { from: m[1], to: m[2], free: false };
  // מחרוזת מורכבת - נשאיר כטקסט חופשי
  return { from: "", to: "", free: true };
}

export default function PointsPage() {
  const [points, setPoints] = useState<Point[]>([]);
  const [editing, setEditing] = useState<Partial<Point> | null>(null);
  const [loading, setLoading] = useState(true);

  // ניהול נפרד של שעות: from/to לבורר, freeText למצב מתקדם
  const [hoursFrom, setHoursFrom] = useState("");
  const [hoursTo, setHoursTo] = useState("");
  const [hoursFreeMode, setHoursFreeMode] = useState(false);
  const [hoursFreeText, setHoursFreeText] = useState("");

  async function load() {
    setLoading(true);
    setPoints(await api("/api/admin/points"));
    setLoading(false);
  }
  useEffect(() => {
    load();
  }, []);

  // כשפותחים עריכה - מאתחלים את שדות השעות מהמחרוזת הקיימת
  function openEditor(p: Partial<Point>) {
    const parsed = parseHours(p.deliveryHours);
    setHoursFrom(parsed.from);
    setHoursTo(parsed.to);
    setHoursFreeMode(parsed.free);
    setHoursFreeText(parsed.free ? p.deliveryHours ?? "" : "");
    setEditing(p);
  }

  // מחשב את מחרוזת השעות הסופית לשמירה
  function computeDeliveryHours(): string | null {
    if (hoursFreeMode) {
      return hoursFreeText.trim() || null;
    }
    if (hoursFrom && hoursTo) {
      return `${hoursFrom} - ${hoursTo}`;
    }
    return null;
  }

  async function save() {
    if (!editing) return;
    const payload = {
      name: editing.name,
      city: editing.city || null,
      address: editing.address || null,
      contactName: editing.contactName || null,
      phone: editing.phone || null,
      email: editing.email || null,
      deliveryHours: computeDeliveryHours(),
      notes: editing.notes || null,
      isActive: editing.isActive ?? true,
      sortOrder: editing.sortOrder ?? points.length,
    };
    if (editing.id) {
      await api(`/api/admin/points/${editing.id}`, { method: "PATCH", body: JSON.stringify(payload) });
    } else {
      await api("/api/admin/points", { method: "POST", body: JSON.stringify(payload) });
    }
    setEditing(null);
    load();
  }

  async function remove(p: Point) {
    if (!confirm(`למחוק את "${p.name}"?`)) return;
    await api(`/api/admin/points/${p.id}`, { method: "DELETE" });
    load();
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-extrabold text-brand-slatedark">נקודות חלוקה</h1>
        <button
          onClick={() => openEditor({ name: "", isActive: true })}
          className="btn-primary btn-sm"
        >
          + נקודה חדשה
        </button>
      </div>

      {loading ? (
        <p className="text-zinc-500">טוען...</p>
      ) : (
        <div className="grid md:grid-cols-2 gap-3">
          {points.map((p) => (
            <div key={p.id} className={`card p-4 ${p.isActive ? "" : "opacity-50"}`}>
              <div className="flex justify-between items-start">
                <div>
                  <div className="font-bold text-brand-slatedark">{p.name}</div>
                  {p.city && <div className="text-sm text-zinc-500">{p.city}</div>}
                  {p.contactName && <div className="text-sm text-zinc-500">{p.contactName}</div>}
                  {p.phone && <div className="text-sm text-zinc-500">{p.phone}</div>}
                  {p.deliveryHours && (
                    <div className="text-sm text-brand-rust mt-1">🕐 {p.deliveryHours}</div>
                  )}
                </div>
                <span className={`badge ${p.isActive ? "bg-green-100 text-green-700" : "bg-zinc-200 text-zinc-600"}`}>
                  {p.isActive ? "פעיל" : "מוסתר"}
                </span>
              </div>
              <div className="flex gap-2 mt-3">
                <button onClick={() => openEditor(p)} className="btn-ghost btn-sm">
                  ערוך
                </button>
                <button onClick={() => remove(p)} className="btn-ghost btn-sm text-red-600">
                  מחק
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {editing && (
        <Modal onClose={() => setEditing(null)} title={editing.id ? "עריכת נקודה" : "נקודה חדשה"}>
          <div className="space-y-3">
            <Field label="שם נקודה">
              <input className="input" value={editing.name ?? ""} onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="עיר / אזור">
                <input className="input" value={editing.city ?? ""} onChange={(e) => setEditing({ ...editing, city: e.target.value })} />
              </Field>
              <Field label="כתובת">
                <input className="input" value={editing.address ?? ""} onChange={(e) => setEditing({ ...editing, address: e.target.value })} />
              </Field>
            </div>
            <Field label="שם נציג">
              <input className="input" value={editing.contactName ?? ""} onChange={(e) => setEditing({ ...editing, contactName: e.target.value })} />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="טלפון">
                <input className="input" value={editing.phone ?? ""} onChange={(e) => setEditing({ ...editing, phone: e.target.value })} />
              </Field>
              <Field label="מייל">
                <input className="input" value={editing.email ?? ""} onChange={(e) => setEditing({ ...editing, email: e.target.value })} />
              </Field>
            </div>

            {/* שעות חלוקה - בורר שעות */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="label mb-0">שעות חלוקה</label>
                <button
                  type="button"
                  onClick={() => setHoursFreeMode(!hoursFreeMode)}
                  className="text-xs text-brand-rust font-medium"
                >
                  {hoursFreeMode ? "בחירה משעון" : "טקסט חופשי"}
                </button>
              </div>

              {!hoursFreeMode ? (
                <div className="flex items-center gap-2">
                  <select
                    className="input flex-1"
                    value={hoursFrom}
                    onChange={(e) => setHoursFrom(e.target.value)}
                  >
                    <option value="">משעה...</option>
                    {TIME_OPTIONS.map((t) => (
                      <option key={t} value={t}>{t}</option>
                    ))}
                  </select>
                  <span className="text-zinc-400">עד</span>
                  <select
                    className="input flex-1"
                    value={hoursTo}
                    onChange={(e) => setHoursTo(e.target.value)}
                  >
                    <option value="">עד שעה...</option>
                    {TIME_OPTIONS.map((t) => (
                      <option key={t} value={t}>{t}</option>
                    ))}
                  </select>
                </div>
              ) : (
                <input
                  className="input"
                  placeholder='לדוגמה: 09:00-12:00, 16:00-19:00'
                  value={hoursFreeText}
                  onChange={(e) => setHoursFreeText(e.target.value)}
                />
              )}
              <p className="text-xs text-zinc-400 mt-1">
                {hoursFreeMode
                  ? "מצב טקסט חופשי - מתאים לכמה חלונות זמן"
                  : "בחר שעת התחלה וסיום. למספר חלונות זמן - עבור לטקסט חופשי."}
              </p>
            </div>

            <Field label="הערות ללקוח">
              <textarea className="input" value={editing.notes ?? ""} onChange={(e) => setEditing({ ...editing, notes: e.target.value })} />
            </Field>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={editing.isActive ?? true}
                onChange={(e) => setEditing({ ...editing, isActive: e.target.checked })}
                className="h-4 w-4 accent-brand-rust"
              />
              פעיל
            </label>
            <button onClick={save} className="btn-primary w-full">
              שמירה
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
