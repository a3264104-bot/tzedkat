"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/client";
import { Modal, Field } from "@/components/AdminModal";

type Customer = {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  pointName: string | null;
  orderCount: number;
  hasPaymentToken: boolean;
  createdAt: string;
};

export default function AdminCustomersPage() {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Customer | null>(null);
  const [newPassword, setNewPassword] = useState("");
  const [editEmail, setEditEmail] = useState("");
  const [editPhone, setEditPhone] = useState("");
  const [editName, setEditName] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [successMsg, setSuccessMsg] = useState("");

  // חיפוש עם debounce
  useEffect(() => {
    const t = setTimeout(async () => {
      setLoading(true);
      try {
        const data = await api(`/api/admin/customers?q=${encodeURIComponent(query)}`);
        setCustomers(Array.isArray(data) ? data : []);
      } catch {
        setCustomers([]);
      } finally {
        setLoading(false);
      }
    }, 300);
    return () => clearTimeout(t);
  }, [query]);

  function openEdit(c: Customer) {
    setEditing(c);
    setNewPassword("");
    setEditEmail(c.email ?? "");
    setEditPhone(c.phone ?? "");
    setEditName(c.name);
    setError("");
    setSuccessMsg("");
  }

  async function save() {
    if (!editing) return;
    setSaving(true);
    setError("");
    try {
      const payload: any = {};
      if (editName !== editing.name) payload.name = editName;
      if (editEmail !== (editing.email ?? "")) payload.email = editEmail || null;
      if (editPhone !== (editing.phone ?? "")) payload.phone = editPhone || null;
      if (newPassword) payload.newPassword = newPassword;

      if (Object.keys(payload).length === 0) {
        setError("לא בוצע שום שינוי");
        setSaving(false);
        return;
      }

      await api(`/api/admin/customers/${editing.id}`, {
        method: "PATCH",
        body: JSON.stringify(payload),
      });

      setSuccessMsg(
        newPassword
          ? `נשמר! מסור ללקוח את הסיסמה החדשה: ${newPassword}`
          : "הפרטים עודכנו בהצלחה"
      );
      setNewPassword("");
      // רענון הרשימה
      const data = await api(`/api/admin/customers?q=${encodeURIComponent(query)}`);
      setCustomers(Array.isArray(data) ? data : []);
    } catch (e: any) {
      setError(e.message || "שגיאה");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-extrabold text-brand-slatedark">ניהול לקוחות</h1>
        <p className="text-sm text-zinc-500">
          חיפוש לקוחות, איפוס סיסמה ועדכון פרטים — ללקוחות שנתקעו בכניסה
        </p>
      </div>

      <div className="card p-4">
        <input
          className="input"
          placeholder="חיפוש לפי שם, טלפון או מייל..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          autoFocus
        />
      </div>

      {loading ? (
        <p className="text-zinc-500">טוען...</p>
      ) : customers.length === 0 ? (
        <div className="card p-6 text-center text-zinc-500">
          {query ? "לא נמצאו לקוחות" : "אין עדיין לקוחות רשומים"}
        </div>
      ) : (
        <div className="grid md:grid-cols-2 gap-3">
          {customers.map((c) => (
            <div key={c.id} className="card p-4">
              <div className="flex justify-between items-start">
                <div>
                  <div className="font-bold text-brand-slatedark">{c.name}</div>
                  {c.phone && (
                    <div className="text-sm text-zinc-500" dir="ltr">
                      {c.phone}
                    </div>
                  )}
                  <div className="text-sm text-zinc-500">
                    {c.email || <span className="text-amber-600">אין מייל — לא יכול לאפס סיסמה לבד</span>}
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1">
                    {c.pointName && (
                      <span className="badge bg-blue-100 text-blue-700">{c.pointName}</span>
                    )}
                    <span className="badge bg-zinc-100 text-zinc-600">{c.orderCount} הזמנות</span>
                    {c.hasPaymentToken && (
                      <span className="badge bg-green-100 text-green-700">כרטיס שמור</span>
                    )}
                  </div>
                </div>
              </div>
              <div className="mt-3">
                <button onClick={() => openEdit(c)} className="btn-ghost btn-sm">
                  עריכה / איפוס סיסמה
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {editing && (
        <Modal onClose={() => setEditing(null)} title={`עריכת לקוח: ${editing.name}`}>
          <div className="space-y-3">
            <Field label="שם">
              <input className="input" value={editName} onChange={(e) => setEditName(e.target.value)} />
            </Field>
            <Field label="טלפון">
              <input className="input" dir="ltr" value={editPhone} onChange={(e) => setEditPhone(e.target.value)} />
            </Field>
            <Field label="מייל">
              <input
                className="input"
                dir="ltr"
                type="email"
                placeholder="הוסף מייל כדי שהלקוח יוכל לאפס סיסמה בעצמו"
                value={editEmail}
                onChange={(e) => setEditEmail(e.target.value)}
              />
            </Field>

            <div className="border-t pt-3">
              <Field label="איפוס סיסמה (השאר ריק אם לא צריך)">
                <input
                  className="input"
                  type="text"
                  placeholder="סיסמה זמנית חדשה - למסירה ללקוח"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                />
                <p className="text-xs text-zinc-400 mt-1">
                  הסיסמה מוצגת כטקסט כדי שתוכל למסור אותה ללקוח בטלפון. מומלץ שהלקוח יחליף אותה
                  אחר כך.
                </p>
              </Field>
            </div>

            {error && <p className="text-red-600 text-sm">{error}</p>}
            {successMsg && (
              <p className="text-green-700 text-sm font-medium bg-green-50 border border-green-200 rounded-lg p-2">
                {successMsg}
              </p>
            )}
            <button onClick={save} disabled={saving} className="btn-primary w-full">
              {saving ? "שומר..." : "שמירה"}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
