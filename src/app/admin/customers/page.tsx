"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/client";
import { Modal, Field } from "@/components/AdminModal";

type Customer = {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  city: string | null;
  pointName: string | null;
  orderCount: number;
  hasPaymentToken: boolean;
  createdAt: string;
};

type SortKey = "name" | "phone" | "city" | "orderCount" | "createdAt";
type SortDir = "asc" | "desc";

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

  // סידור ושדה מיון
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  // סינון לפי עיר
  const [cityFilter, setCityFilter] = useState<string>("");
  // מצב תצוגה: table / grouped
  const [viewMode, setViewMode] = useState<"table" | "grouped">("grouped");

  // חיפוש עם debounce
  useEffect(() => {
    const t = setTimeout(async () => {
      setLoading(true);
      try {
        const data = await api(`/api/admin/customers?q=${encodeURIComponent(query)}`);
        // city מגיע מה-API אם יש, אחרת מנסים לחלץ מ-pointName
        const enriched = (Array.isArray(data) ? data : []).map((c: any) => ({
          ...c,
          city: c.city || c.pointCity || null,
        }));
        setCustomers(enriched);
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
      const data = await api(`/api/admin/customers?q=${encodeURIComponent(query)}`);
      setCustomers(Array.isArray(data) ? data : []);
    } catch (e: any) {
      setError(e.message || "שגיאה");
    } finally {
      setSaving(false);
    }
  }

  // מיון
  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir(sortDir === "asc" ? "desc" : "asc");
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  }
  const sortArrow = (key: SortKey) =>
    sortKey === key ? (sortDir === "asc" ? " ▲" : " ▼") : "";

  // סינון + מיון
  const filtered = customers
    .filter((c) => !cityFilter || (c.city || "(ללא עיר)") === cityFilter)
    .sort((a, b) => {
      const dir = sortDir === "asc" ? 1 : -1;
      const av = a[sortKey] ?? "";
      const bv = b[sortKey] ?? "";
      if (typeof av === "number" && typeof bv === "number") return (av - bv) * dir;
      return String(av).localeCompare(String(bv), "he") * dir;
    });

  // רשימת ערים ייחודיות לסינון
  const cities = Array.from(
    new Set(customers.map((c) => c.city || "(ללא עיר)"))
  ).sort((a, b) => a.localeCompare(b, "he"));

  // קיבוץ לפי עיר
  const grouped = filtered.reduce((acc, c) => {
    const city = c.city || "(ללא עיר)";
    if (!acc[city]) acc[city] = [];
    acc[city].push(c);
    return acc;
  }, {} as Record<string, Customer[]>);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold text-brand-slatedark">לקוחות</h1>
          <p className="text-sm text-zinc-500">
            {customers.length} לקוחות{cityFilter ? ` · ${cityFilter}` : ""}
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setViewMode(viewMode === "table" ? "grouped" : "table")}
            className="btn-ghost btn-sm"
          >
            {viewMode === "table" ? "👥 לפי ערים" : "📋 טבלה"}
          </button>
        </div>
      </div>

      {/* חיפוש + סינון עיר */}
      <div className="flex gap-2">
        <input
          className="input flex-1"
          placeholder="חיפוש לפי שם, טלפון או מייל..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          autoFocus
        />
        <select
          className="input w-auto min-w-[140px]"
          value={cityFilter}
          onChange={(e) => setCityFilter(e.target.value)}
        >
          <option value="">כל הערים</option>
          {cities.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
      </div>

      {loading ? (
        <p className="text-zinc-500 text-center py-8">טוען...</p>
      ) : filtered.length === 0 ? (
        <div className="card p-8 text-center text-zinc-500">
          {query || cityFilter ? "לא נמצאו לקוחות" : "אין עדיין לקוחות רשומים"}
        </div>
      ) : viewMode === "table" ? (
        /* ═══ תצוגת טבלה ═══ */
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-zinc-50 border-b text-right">
                <th className="p-3 cursor-pointer hover:bg-zinc-100" onClick={() => toggleSort("name")}>
                  שם{sortArrow("name")}
                </th>
                <th className="p-3 cursor-pointer hover:bg-zinc-100" onClick={() => toggleSort("phone")}>
                  טלפון{sortArrow("phone")}
                </th>
                <th className="p-3 hidden md:table-cell">מייל</th>
                <th className="p-3 cursor-pointer hover:bg-zinc-100" onClick={() => toggleSort("city")}>
                  עיר{sortArrow("city")}
                </th>
                <th className="p-3 cursor-pointer hover:bg-zinc-100 text-center" onClick={() => toggleSort("orderCount")}>
                  הזמנות{sortArrow("orderCount")}
                </th>
                <th className="p-3 text-center">כרטיס</th>
                <th className="p-3"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((c) => (
                <tr key={c.id} className="border-b hover:bg-zinc-50 transition">
                  <td className="p-3 font-medium text-brand-slatedark">{c.name}</td>
                  <td className="p-3 text-zinc-600" dir="ltr">{c.phone || "—"}</td>
                  <td className="p-3 text-zinc-500 hidden md:table-cell text-xs">{c.email || "—"}</td>
                  <td className="p-3 text-zinc-600">{c.city || "—"}</td>
                  <td className="p-3 text-center">{c.orderCount}</td>
                  <td className="p-3 text-center">
                    {c.hasPaymentToken ? (
                      <span className="text-green-600">✓</span>
                    ) : (
                      <span className="text-zinc-300">—</span>
                    )}
                  </td>
                  <td className="p-3">
                    <button onClick={() => openEdit(c)} className="text-brand-rust text-xs font-medium hover:underline">
                      עריכה
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        /* ═══ תצוגה מקובצת לפי ערים ═══ */
        <div className="space-y-4">
          {Object.entries(grouped)
            .sort(([a], [b]) => a.localeCompare(b, "he"))
            .map(([city, cityCustomers]) => (
            <div key={city}>
              <div className="flex items-center gap-2 mb-2">
                <h2 className="text-base font-bold text-brand-slatedark">{city}</h2>
                <span className="text-xs text-zinc-400">{cityCustomers.length} לקוחות</span>
                <div className="flex-1 border-b border-zinc-200" />
              </div>
              <div className="card overflow-x-auto">
                <table className="w-full text-sm">
                  <tbody>
                    {cityCustomers.map((c) => (
                      <tr key={c.id} className="border-b last:border-b-0 hover:bg-zinc-50 transition">
                        <td className="p-2.5 font-medium text-brand-slatedark">{c.name}</td>
                        <td className="p-2.5 text-zinc-600 text-xs" dir="ltr">{c.phone || "—"}</td>
                        <td className="p-2.5 text-zinc-500 text-xs hidden md:table-cell">{c.email || "—"}</td>
                        <td className="p-2.5 text-center text-xs">{c.orderCount} הזמנות</td>
                        <td className="p-2.5 text-center">
                          {c.hasPaymentToken && <span className="text-green-600 text-xs">💳</span>}
                        </td>
                        <td className="p-2.5">
                          <button onClick={() => openEdit(c)} className="text-brand-rust text-xs font-medium hover:underline">
                            עריכה
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
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
                  הסיסמה מוצגת כטקסט כדי שתוכל למסור אותה ללקוח בטלפון.
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
