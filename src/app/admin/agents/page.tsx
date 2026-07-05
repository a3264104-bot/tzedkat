"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/client";
import { Modal, Field } from "@/components/AdminModal";

type Point = { id: string; name: string; city: string | null };
type Agent = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  agentPointId: string | null;
  agentPointName: string | null;
  agentCanSetFinalPrice: boolean;
  agentCanSendPaymentLink: boolean;
};

type EditAgent = Partial<Agent> & { password?: string };

export default function AgentsPage() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [points, setPoints] = useState<Point[]>([]);
  const [editing, setEditing] = useState<EditAgent | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  async function load() {
    setLoading(true);
    const [a, p] = await Promise.all([api("/api/admin/agents"), api("/api/admin/points")]);
    setAgents(a);
    setPoints(p);
    setLoading(false);
  }
  useEffect(() => {
    load();
  }, []);

  async function save() {
    if (!editing) return;
    setError("");
    setSaving(true);
    try {
      if (editing.id) {
        // עריכה - שולחים רק את מה שהשתנה
        const payload: any = {
          name: editing.name,
          agentPointId: editing.agentPointId || null,
          agentCanSetFinalPrice: editing.agentCanSetFinalPrice ?? false,
          agentCanSendPaymentLink: editing.agentCanSendPaymentLink ?? false,
        };
        if (editing.password) payload.password = editing.password;
        await api(`/api/admin/agents/${editing.id}`, {
          method: "PATCH",
          body: JSON.stringify(payload),
        });
      } else {
        await api("/api/admin/agents", {
          method: "POST",
          body: JSON.stringify({
            name: editing.name,
            email: editing.email,
            password: editing.password,
            agentPointId: editing.agentPointId || null,
            agentCanSetFinalPrice: editing.agentCanSetFinalPrice ?? false,
            agentCanSendPaymentLink: editing.agentCanSendPaymentLink ?? false,
          }),
        });
      }
      setEditing(null);
      load();
    } catch (e: any) {
      setError(e.message || "שגיאה");
    } finally {
      setSaving(false);
    }
  }

  async function remove(a: Agent) {
    if (!confirm(`למחוק את הנציג "${a.name}"?`)) return;
    await api(`/api/admin/agents/${a.id}`, { method: "DELETE" });
    load();
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-extrabold text-brand-slatedark">ניהול נציגים</h1>
        <button
          onClick={() =>
            setEditing({
              name: "",
              email: "",
              password: "",
              agentCanSetFinalPrice: false,
              agentCanSendPaymentLink: false,
            })
          }
          className="btn-primary btn-sm"
        >
          + נציג חדש
        </button>
      </div>

      {loading ? (
        <p className="text-zinc-500">טוען...</p>
      ) : agents.length === 0 ? (
        <div className="card p-6 text-center text-zinc-500">
          עדיין אין נציגים. הוסף נציג כדי לאפשר לו להזמין בשם לקוחות ולהזין משקלים.
        </div>
      ) : (
        <div className="grid md:grid-cols-2 gap-3">
          {agents.map((a) => (
            <div key={a.id} className="card p-4">
              <div className="flex justify-between items-start">
                <div>
                  <div className="font-bold text-brand-slatedark">{a.name}</div>
                  <div className="text-sm text-zinc-500">{a.email}</div>
                  <div className="mt-2 flex flex-wrap gap-1">
                    <span className="badge bg-blue-100 text-blue-700">
                      {a.agentPointName ? `נקודה: ${a.agentPointName}` : "כל הלקוחות"}
                    </span>
                    {a.agentCanSetFinalPrice && (
                      <span className="badge bg-green-100 text-green-700">קובע מחיר סופי</span>
                    )}
                    {a.agentCanSendPaymentLink && (
                      <span className="badge bg-violet-100 text-violet-700">שולח לינק תשלום</span>
                    )}
                  </div>
                </div>
              </div>
              <div className="flex gap-2 mt-3">
                <button onClick={() => setEditing(a)} className="btn-ghost btn-sm">
                  ערוך
                </button>
                <button onClick={() => remove(a)} className="btn-ghost btn-sm text-red-600">
                  מחק
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {editing && (
        <Modal onClose={() => setEditing(null)} title={editing.id ? "עריכת נציג" : "נציג חדש"}>
          <div className="space-y-3">
            <Field label="שם הנציג">
              <input
                className="input"
                value={editing.name ?? ""}
                onChange={(e) => setEditing({ ...editing, name: e.target.value })}
              />
            </Field>

            {/* מייל - ניתן לעריכה רק ביצירה */}
            {!editing.id && (
              <Field label="מייל (לכניסה)">
                <input
                  className="input"
                  type="email"
                  value={editing.email ?? ""}
                  onChange={(e) => setEditing({ ...editing, email: e.target.value })}
                />
              </Field>
            )}

            <Field label={editing.id ? "סיסמה חדשה (השאר ריק לא לשנות)" : "סיסמה"}>
              <input
                className="input"
                type="text"
                placeholder="לפחות 10 תווים, אות + מספר"
                value={editing.password ?? ""}
                onChange={(e) => setEditing({ ...editing, password: e.target.value })}
              />
              <p className="text-xs text-zinc-400 mt-1">
                הסיסמה מוצגת כטקסט כדי שתוכל למסור אותה לנציג. חובה: 10+ תווים, אות ומספר.
              </p>
            </Field>

            <Field label="הרשאת צפייה בלקוחות">
              <select
                className="input"
                value={editing.agentPointId ?? ""}
                onChange={(e) => setEditing({ ...editing, agentPointId: e.target.value || null })}
              >
                <option value="">כל הלקוחות במערכת</option>
                {points.map((p) => (
                  <option key={p.id} value={p.id}>
                    רק לקוחות של: {p.city ? `${p.city} — ${p.name}` : p.name}
                  </option>
                ))}
              </select>
            </Field>

            <div className="space-y-2 border-t pt-3">
              <p className="text-sm font-semibold text-zinc-600">הרשאות נוספות:</p>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={editing.agentCanSetFinalPrice ?? false}
                  onChange={(e) =>
                    setEditing({ ...editing, agentCanSetFinalPrice: e.target.checked })
                  }
                  className="h-4 w-4 accent-brand-rust"
                />
                מורשה לקבוע מחיר סופי (אחרי שקילה)
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={editing.agentCanSendPaymentLink ?? false}
                  onChange={(e) =>
                    setEditing({ ...editing, agentCanSendPaymentLink: e.target.checked })
                  }
                  className="h-4 w-4 accent-brand-rust"
                />
                מורשה לשלוח לינק תשלום ללקוח
              </label>
            </div>

            {error && <p className="text-red-600 text-sm">{error}</p>}
            <button onClick={save} disabled={saving} className="btn-primary w-full">
              {saving ? "שומר..." : "שמירה"}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
