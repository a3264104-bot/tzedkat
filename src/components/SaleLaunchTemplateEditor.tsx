"use client";

// ═══════════════════════════════════════════════════════════════
// §401: 📣 הנוסח הקבוע להודעת פתיחת מכירה
// ═══════════════════════════════════════════════════════════════
// המקום הקבוע לנוסח: כאן עורכים פעם אחת, וכפתור "📣 הודעת פתיחה"
// במסך המכירות ממלא ממנו אוטומטית — מייל וטלפון.

import { useEffect, useState } from "react";
import {
  DEFAULT_LAUNCH_EMAIL,
  DEFAULT_LAUNCH_PHONE,
  DEFAULT_LAUNCH_SUBJECT,
  LAUNCH_VARS,
} from "@/lib/sale-launch-text";

export function SaleLaunchTemplateEditor() {
  const [open, setOpen] = useState(false);
  const [subject, setSubject] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");

  useEffect(() => {
    if (!open || loaded) return;
    fetch("/api/admin/sale-launch", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        setSubject(d.templates?.subject ?? DEFAULT_LAUNCH_SUBJECT);
        setEmail(d.templates?.email ?? DEFAULT_LAUNCH_EMAIL);
        setPhone(d.templates?.phone ?? DEFAULT_LAUNCH_PHONE);
        setLoaded(true);
      })
      .catch(() => setErr("שגיאה בטעינה"));
  }, [open, loaded]);

  async function save() {
    setBusy(true);
    setErr("");
    setMsg("");
    try {
      const res = await fetch("/api/admin/sale-launch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subject, email, phone, saveAsDefault: true }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || "שגיאה");
      setMsg("✓ הנוסח נשמר");
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="bg-violet-50 border border-violet-200 rounded-xl">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full text-right px-4 py-3 font-bold text-violet-900 flex items-center justify-between"
      >
        <span>📣 נוסח קבוע — הודעת פתיחת מכירה (מייל + טלפון)</span>
        <span className="text-sm">{open ? "▲" : "▼"}</span>
      </button>
      {open && (
        <div className="px-4 pb-4 space-y-2">
          <p className="text-xs text-violet-800 leading-relaxed">
            נשלח מכפתור <b>📣 הודעת פתיחה</b> במסך המכירות. המשתנים מתמלאים מהמכירה:{" "}
            {LAUNCH_VARS.map((v) => (
              <code key={v} className="mx-0.5 bg-white px-1 rounded">
                {v}
              </code>
            ))}
            . בטלפון כל מתקשר שומע את ההודעה פעם אחת, ואחר כך את התפריט הרגיל.
          </p>
          {!loaded ? (
            <p className="text-sm text-zinc-500">טוען…</p>
          ) : (
            <>
              <label className="text-xs font-bold text-zinc-600 block">כותרת המייל</label>
              <input className="input w-full text-sm" value={subject} onChange={(e) => setSubject(e.target.value)} />
              <label className="text-xs font-bold text-zinc-600 block">תוכן המייל</label>
              <textarea
                className="input w-full text-sm min-h-[160px]"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
              <label className="text-xs font-bold text-zinc-600 block">נוסח לטלפון (מוקרא)</label>
              <textarea
                className="input w-full text-sm min-h-[70px]"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
              />
              {err && <p className="text-sm text-red-700">{err}</p>}
              {msg && <p className="text-sm text-emerald-700 font-bold">{msg}</p>}
              <div className="flex gap-2 flex-wrap">
                <button onClick={save} disabled={busy} className="btn-primary btn-sm disabled:opacity-50">
                  {busy ? "שומר…" : "💾 שמור נוסח קבוע"}
                </button>
                <button
                  onClick={() => {
                    setSubject(DEFAULT_LAUNCH_SUBJECT);
                    setEmail(DEFAULT_LAUNCH_EMAIL);
                    setPhone(DEFAULT_LAUNCH_PHONE);
                    setMsg("");
                  }}
                  className="btn-ghost btn-sm"
                >
                  ↺ נוסח ברירת המחדל
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
