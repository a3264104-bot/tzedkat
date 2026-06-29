"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/client";
import { Modal, Field } from "@/app/admin/products/page";

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

export default function PointsPage() {
  const [points, setPoints] = useState<Point[]>([]);
  const [editing, setEditing] = useState<Partial<Point> | null>(null);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    setPoints(await api("/api/admin/points"));
    setLoading(false);
  }
  useEffect(() => {
    load();
  }, []);

  async function save() {
    if (!editing) return;
    const payload = {
      name: editing.name,
      city: editing.city || null,
      address: editing.address || null,
      contactName: editing.contactName || null,
      phone: editing.phone || null,
      email: editing.email || null,
      deliveryHours: editing.deliveryHours || null,
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
          onClick={() => setEditing({ name: "", isActive: true })}
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
                  {p.contactName && <div className="text-sm text-zinc-500">{p.contactName}</div>}
                  {p.phone && <div className="text-sm text-zinc-500">{p.phone}</div>}
                  {p.email && <div className="text-sm text-zinc-400">{p.email}</div>}
                </div>
                <span className={`badge ${p.isActive ? "bg-green-100 text-green-700" : "bg-zinc-200 text-zinc-600"}`}>
                  {p.isActive ? "פעיל" : "מוסתר"}
                </span>
              </div>
              <div className="flex gap-2 mt-3">
                <button onClick={() => setEditing(p)} className="btn-ghost btn-sm">
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
            <Field label="שעות חלוקה">
              <input className="input" value={editing.deliveryHours ?? ""} onChange={(e) => setEditing({ ...editing, deliveryHours: e.target.value })} />
            </Field>
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
