"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/client";

export default function SettingsPage() {
  const [settings, setSettings] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  async function load() {
    setLoading(true);
    const s = await api("/api/admin/settings");
    setSettings(s);
    setLoading(false);
  }
  useEffect(() => {
    load();
  }, []);

  async function save() {
    setSaving(true);
    setSaved(false);
    await api("/api/admin/settings", {
      method: "PATCH",
      body: JSON.stringify({
        adminEmail: settings.adminEmail,
        adminWhatsappPhone: settings.adminWhatsappPhone,
        sendEmailToCustomer: settings.sendEmailToCustomer,
        sendEmailToAdmin: settings.sendEmailToAdmin,
      }),
    });
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  }

  function set(field: string, value: any) {
    setSettings((s: any) => ({ ...s, [field]: value }));
  }

  if (loading) return <p className="text-zinc-500">טוען...</p>;

  return (
    <div className="space-y-5 max-w-lg">
      <h1 className="text-2xl font-extrabold text-brand-slatedark">הגדרות מערכת</h1>

      <div className="card p-5 space-y-4">
        <h2 className="font-bold text-brand-slatedark">התראות</h2>

        <div>
          <label className="label">מייל מנהל לקבלת הזמנות</label>
          <input
            className="input"
            type="email"
            value={settings.adminEmail ?? ""}
            onChange={(e) => set("adminEmail", e.target.value)}
          />
          <p className="text-xs text-zinc-400 mt-1">לכתובת זו יישלחו התראות על הזמנות חדשות.</p>
        </div>

        <div>
          <label className="label">טלפון וואטסאפ מנהל</label>
          <input
            className="input"
            type="tel"
            placeholder="050-1234567"
            value={settings.adminWhatsappPhone ?? ""}
            onChange={(e) => set("adminWhatsappPhone", e.target.value)}
          />
          <p className="text-xs text-zinc-400 mt-1">
            אם מוגדר, יתווסף כפתור וואטסאפ במייל ההתראה למנהל.
          </p>
        </div>

        <label className="flex items-center justify-between py-2 border-t">
          <span className="font-medium text-zinc-700">שליחת מייל התראה למנהל</span>
          <input
            type="checkbox"
            checked={settings.sendEmailToAdmin ?? true}
            onChange={(e) => set("sendEmailToAdmin", e.target.checked)}
            className="h-5 w-5 accent-brand-rust"
          />
        </label>

        <label className="flex items-center justify-between py-2 border-t">
          <span className="font-medium text-zinc-700">שליחת מייל אישור ללקוח</span>
          <input
            type="checkbox"
            checked={settings.sendEmailToCustomer ?? true}
            onChange={(e) => set("sendEmailToCustomer", e.target.checked)}
            className="h-5 w-5 accent-brand-rust"
          />
        </label>
      </div>

      <button onClick={save} disabled={saving} className="btn-primary">
        {saving ? "שומר..." : "שמירת הגדרות"}
      </button>
      {saved && <span className="text-green-600 font-medium mr-3">✓ נשמר</span>}
    </div>
  );
}
