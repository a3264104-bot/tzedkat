"use client";

// 🏷️ המחירים שלי — מחיר קבוע לכל מוצר נסתר (מועדף / לא באתר).
// המחיר נשמר לנציג המחובר בלבד, וממולא לבד בכל פעם שהוא מוסיף את
// המוצר ללקוח. אפשר לשנות כאן בכל רגע; "מחק" מחזיר למחיר המחירון.

import Link from "next/link";
import { useEffect, useState } from "react";

type Row = {
  id: string;
  name: string;
  unit: string;
  listPrice: number;
  savedPrice: number | null;
};

export default function MyPricesPage() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ id: string; text: string; ok: boolean } | null>(null);
  const [q, setQ] = useState("");

  async function load() {
    try {
      const res = await fetch("/api/agent/my-prices", { cache: "no-store" });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "שגיאה בטעינה");
      setRows(d.products);
    } catch (e: any) {
      setError(e?.message || "שגיאה");
    }
  }
  useEffect(() => {
    load();
  }, []);

  async function save(r: Row, price: string | null) {
    setBusy(r.id);
    setMsg(null);
    try {
      const res = await fetch("/api/agent/my-prices", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productId: r.id, price }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || "השמירה נכשלה");
      setRows((rs) => rs?.map((x) => (x.id === r.id ? { ...x, savedPrice: d.savedPrice } : x)) ?? rs);
      setDraft((dr) => {
        const n = { ...dr };
        delete n[r.id];
        return n;
      });
      setMsg({ id: r.id, ok: true, text: d.savedPrice == null ? "נמחק — יחזור למחירון" : "✓ נשמר" });
    } catch (e: any) {
      setMsg({ id: r.id, ok: false, text: e?.message || "שגיאה" });
    } finally {
      setBusy(null);
    }
  }

  const words = q.trim().split(/\s+/).filter(Boolean);
  const shown = (rows ?? []).filter((r) => words.every((w) => r.name.includes(w)));

  return (
    <div dir="rtl" className="min-h-screen bg-brand-cream pb-20">
      <header className="bg-brand-yellow border-b-4 border-brand-rust/20">
        <div className="mx-auto max-w-3xl px-4 py-3 flex items-center justify-between">
          <Link href="/agent" className="text-brand-slate font-medium text-sm">
            ← חזרה
          </Link>
          <h1 className="font-extrabold text-brand-slatedark">🏷️ המחירים שלי</h1>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 py-6 space-y-4">
        <div className="rounded-2xl bg-white border border-zinc-200 p-4 text-sm text-zinc-700 leading-relaxed">
          כאן קובעים <b>מחיר קבוע שלך</b> למוצרים שאינם באתר (מועדפים / נסתרים). המחיר
          ממולא לבד בכל פעם שאתה מוסיף את המוצר ללקוח, ואפשר עדיין לשנות אותו בהזמנה עצמה.
          המחיר הוא לק״ג / ליחידה — כמו במחירון — ולא יכול להיות נמוך מהמחירון.
        </div>

        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="חיפוש מוצר…"
          className="w-full rounded-xl border-2 border-zinc-200 px-3 py-2 text-sm"
        />

        {error && <div className="text-red-600 font-bold">{error}</div>}
        {!rows && !error && <div className="text-zinc-500">טוען…</div>}
        {rows && shown.length === 0 && (
          <div className="text-zinc-500 text-sm">אין מוצרים נסתרים במכירות הפתוחות.</div>
        )}

        <div className="space-y-2">
          {shown.map((r) => {
            const val = draft[r.id] ?? (r.savedPrice != null ? String(r.savedPrice) : "");
            const dirty = draft[r.id] != null;
            return (
              <div key={r.id} className="rounded-xl bg-white border border-zinc-200 p-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="font-bold text-brand-slatedark truncate">{r.name}</div>
                    <div className="text-xs text-zinc-500">
                      מחירון: ₪{r.listPrice.toFixed(2)} / {r.unit}
                      {r.savedPrice != null && (
                        <span className="text-emerald-700 font-bold"> · המחיר שלך: ₪{r.savedPrice.toFixed(2)}</span>
                      )}
                    </div>
                  </div>
                </div>
                <div className="mt-2 flex items-center gap-2">
                  <input
                    type="number"
                    inputMode="decimal"
                    step="0.01"
                    dir="ltr"
                    value={val}
                    placeholder={r.listPrice.toFixed(2)}
                    onChange={(e) => setDraft((d) => ({ ...d, [r.id]: e.target.value }))}
                    className="w-32 rounded-lg border-2 border-zinc-200 px-2 py-1.5 text-center font-bold"
                  />
                  <button
                    disabled={!dirty || busy === r.id || val.trim() === ""}
                    onClick={() => save(r, val.trim())}
                    className="rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-bold text-white disabled:opacity-40"
                  >
                    {busy === r.id ? "שומר…" : "שמור"}
                  </button>
                  {r.savedPrice != null && (
                    <button
                      disabled={busy === r.id}
                      onClick={() => save(r, null)}
                      className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm text-zinc-600"
                    >
                      מחק
                    </button>
                  )}
                </div>
                {msg?.id === r.id && (
                  <div className={`mt-1 text-xs font-bold ${msg.ok ? "text-emerald-700" : "text-red-600"}`}>
                    {msg.text}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </main>
    </div>
  );
}
