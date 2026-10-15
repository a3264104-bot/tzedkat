"use client";

// ═══════════════════════════════════════════════════════════════
// §401: 📣 הודעת פתיחת מכירה — מייל + טלפון, מהנוסח הקבוע
// ═══════════════════════════════════════════════════════════════
// נפתח מכפתור "📣 הודעת פתיחה" במסך המכירות. הנוסח הקבוע כבר
// ממולא; המשתנים ({מכירה}, {חלוקה}, {סגירה}, {אתר}) מתמלאים לבד,
// והתצוגה מתחת לכל שדה מראה בדיוק מה יישלח.
//
// ⚠️ לא נשלח אוטומטית בהפעלת המכירה: מייל למאות לקוחות אי אפשר
// להחזיר. כאן — לחיצה אחת, אחרי שרואים את הטקסט.

import { useEffect, useMemo, useState } from "react";
import {
  fillLaunchPhone,
  fillLaunchText,
  LAUNCH_VARS,
  type LaunchSale,
} from "@/lib/sale-launch-text";

type Loaded = {
  sale: {
    id: string;
    name: string;
    closeDate: string | null;
    deliveryDate: string | null;
    deliveryDateText: string | null;
    launchSentAt: string | null;
    launchSentCount: number;
  };
  templates: { subject: string; email: string; phone: string };
  recipientCount: number;
  phoneAnnouncement: { id: string; text: string; heardCount: number } | null;
};

export function SaleLaunchModal({
  pricelistId,
  onClose,
  onDone,
}: {
  pricelistId: string;
  onClose: () => void;
  onDone?: () => void;
}) {
  const [data, setData] = useState<Loaded | null>(null);
  const [subject, setSubject] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [sendEmail, setSendEmail] = useState(true);
  const [sendPhone, setSendPhone] = useState(true);
  const [saveDefault, setSaveDefault] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState("");

  useEffect(() => {
    fetch(`/api/admin/sale-launch?pricelistId=${encodeURIComponent(pricelistId)}`, {
      cache: "no-store",
    })
      .then(async (r) => {
        const d = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(d.error || "שגיאה בטעינה");
        setData(d);
        setSubject(d.templates.subject);
        setEmail(d.templates.email);
        setPhone(d.templates.phone);
        // כבר נשלח — לא מסמנים מייל מראש
        if (d.sale.launchSentAt) setSendEmail(false);
        if (d.phoneAnnouncement) setSendPhone(false);
      })
      .catch((e) => setError(e.message));
  }, [pricelistId]);

  const sale: LaunchSale | null = useMemo(
    () =>
      data
        ? {
            name: data.sale.name,
            closeDate: data.sale.closeDate ? new Date(data.sale.closeDate) : null,
            deliveryDate: data.sale.deliveryDate ? new Date(data.sale.deliveryDate) : null,
            deliveryDateText: data.sale.deliveryDateText,
          }
        : null,
    [data]
  );

  async function send(force = false) {
    if (!data) return;
    if (!sendEmail && !sendPhone && !saveDefault) {
      setError("בחר מה לשלוח");
      return;
    }
    if (!force) {
      const parts: string[] = [];
      if (sendEmail) parts.push(`📧 מייל ל-${data.recipientCount} לקוחות`);
      if (sendPhone) parts.push("📞 הודעה בטלפון — כל מתקשר ישמע פעם אחת");
      if (parts.length > 0 && !window.confirm(`לשלוח עכשיו?\n\n${parts.join("\n")}\n\nאי אפשר לבטל מייל שנשלח.`)) {
        return;
      }
    }
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/admin/sale-launch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pricelistId,
          subject,
          email,
          phone,
          sendEmail,
          sendPhone,
          saveAsDefault: saveDefault,
          force,
        }),
      });
      const d = await res.json().catch(() => ({}));
      if (res.status === 409 && d.code === "ALREADY_SENT") {
        if (window.confirm(`${d.error}\n\nלשלוח שוב לכולם?`)) {
          setBusy(false);
          return send(true);
        }
        return;
      }
      if (!res.ok) throw new Error(d.error || `שגיאה (${res.status})`);
      setDone(d.message || (d.saved ? "הנוסח נשמר" : "נשלח"));
      onDone?.();
    } catch (e: any) {
      setError(e.message || "שגיאה");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="bg-white w-full sm:max-w-2xl sm:rounded-2xl rounded-t-2xl max-h-[95vh] overflow-y-auto shadow-2xl">
        <div className="sticky top-0 bg-white border-b border-zinc-200 px-5 py-3 flex items-center justify-between z-10">
          <h3 className="font-extrabold text-brand-slatedark">
            📣 הודעת פתיחה{data ? ` — ${data.sale.name}` : ""}
          </h3>
          <button onClick={onClose} className="text-2xl leading-none text-zinc-400">
            ×
          </button>
        </div>

        {!data && !error && <p className="p-5 text-zinc-500">טוען…</p>}

        {done ? (
          <div className="p-6 text-center space-y-3">
            <div className="text-4xl">✅</div>
            <p className="font-bold text-emerald-800">{done}</p>
            <button onClick={onClose} className="btn-primary">
              סגור
            </button>
          </div>
        ) : (
          data &&
          sale && (
            <div className="p-5 space-y-4">
              <p className="text-xs text-zinc-500 leading-relaxed">
                המשתנים מתמלאים לבד: {LAUNCH_VARS.map((v) => <code key={v} className="mx-0.5 bg-zinc-100 px-1 rounded">{v}</code>)}.
                שורה עם משתנה שאין לו ערך (למשל אין תאריך סגירה) לא תופיע.
              </p>

              {/* ── מייל ── */}
              <section className="border border-zinc-200 rounded-xl p-3 space-y-2">
                <label className="flex items-center gap-2 font-bold text-sm text-brand-slatedark">
                  <input type="checkbox" checked={sendEmail} onChange={(e) => setSendEmail(e.target.checked)} />
                  📧 מייל ל-{data.recipientCount} לקוחות
                  {data.sale.launchSentAt && (
                    <span className="text-[11px] font-normal text-amber-700">
                      (כבר נשלח ל-{data.sale.launchSentCount} ב-
                      {new Date(data.sale.launchSentAt).toLocaleString("he-IL")})
                    </span>
                  )}
                </label>
                <input
                  className="input w-full text-sm"
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  placeholder="כותרת"
                />
                <textarea
                  className="input w-full text-sm min-h-[150px]"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
                <div className="bg-zinc-50 border border-zinc-200 rounded-lg p-2.5 text-sm">
                  <div className="text-[11px] text-zinc-500 mb-1">כך זה ייראה:</div>
                  <div className="font-bold">{fillLaunchText(subject, sale)}</div>
                  <div className="whitespace-pre-line text-zinc-700 mt-1">
                    שלום (שם הלקוח),{"\n"}
                    {fillLaunchText(email, sale)}
                  </div>
                </div>
              </section>

              {/* ── טלפון ── */}
              <section className="border border-zinc-200 rounded-xl p-3 space-y-2">
                <label className="flex items-center gap-2 font-bold text-sm text-brand-slatedark">
                  <input type="checkbox" checked={sendPhone} onChange={(e) => setSendPhone(e.target.checked)} />
                  📞 הודעה בטלפון — כל מתקשר שומע פעם אחת
                </label>
                {data.phoneAnnouncement && (
                  <p className="text-[11px] text-amber-700">
                    כבר יש הודעת פתיחה פעילה ({data.phoneAnnouncement.heardCount} שמעו). סימון כאן
                    יחליף אותה — וכולם ישמעו את החדשה פעם אחת.
                  </p>
                )}
                <textarea
                  className="input w-full text-sm min-h-[70px]"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                />
                <div className="bg-zinc-50 border border-zinc-200 rounded-lg p-2.5 text-sm text-zinc-700">
                  <div className="text-[11px] text-zinc-500 mb-1">יוקרא:</div>
                  {fillLaunchPhone(phone, sale)}
                  <div className="text-[11px] text-zinc-400 mt-1">
                    ← ואחריו &quot;לתפריט ההזמנות הקש 1&quot;. בשיחה הבאה — התפריט הרגיל.
                  </div>
                </div>
              </section>

              <label className="flex items-center gap-2 text-sm text-zinc-700">
                <input type="checkbox" checked={saveDefault} onChange={(e) => setSaveDefault(e.target.checked)} />
                💾 שמור את הנוסח הזה כנוסח הקבוע (למכירות הבאות)
              </label>

              {error && (
                <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg p-2">{error}</p>
              )}

              <div className="flex gap-2">
                <button onClick={onClose} disabled={busy} className="flex-1 btn-ghost">
                  ביטול
                </button>
                <button
                  onClick={() => send(false)}
                  disabled={busy || (!sendEmail && !sendPhone && !saveDefault)}
                  className="flex-[2] btn-primary disabled:opacity-50"
                >
                  {busy
                    ? "שולח…"
                    : !sendEmail && !sendPhone
                      ? "💾 שמור נוסח"
                      : "📣 שלח עכשיו"}
                </button>
              </div>
            </div>
          )
        )}
        {error && !data && <p className="p-5 text-sm text-red-700">{error}</p>}
      </div>
    </div>
  );
}
