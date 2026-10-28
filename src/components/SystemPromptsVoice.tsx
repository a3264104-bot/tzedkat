"use client";

// §411: 🎙️ הודעות המערכת בקול טבעי — כל הודעה במרכזייה שאין לה הקלטה
// אנושית מוקלטת אוטומטית. הקלטות אנושיות לא נוגעים בהן.

import { useEffect, useState } from "react";

type Row = { file: string; text: string; status: "human" | "voiced" | "missing" };

const LABEL: Record<Row["status"], string> = {
  human: "🎤 הקלטה שלך",
  voiced: "🎙️ קול טבעי",
  missing: "🤖 רובוט",
};

export default function SystemPromptsVoice() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [on, setOn] = useState(false);
  const [err, setErr] = useState("");
  const [progress, setProgress] = useState<string>("");
  const [failed, setFailed] = useState<{ file: string; error: string }[]>([]);
  const [open, setOpen] = useState(false);

  async function load() {
    setErr("");
    try {
      const r = await fetch("/api/admin/phone-voice/prompts");
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error || "שגיאה");
      setRows(j.rows);
      setOn(j.on);
    } catch (e: any) {
      setErr(e?.message || "שגיאה");
    }
  }
  useEffect(() => {
    load();
  }, []);

  async function recordMissing() {
    if (!rows) return;
    const todo = rows.filter((r) => r.status === "missing").map((r) => r.file);
    if (todo.length === 0) return;
    if (!confirm(`להקליט ${todo.length} הודעות בקול טבעי? זה לוקח כ-${Math.ceil(todo.length * 15 / 60)} דקות. אל תסגור את הדף.`)) return;
    setFailed([]);
    const bad: { file: string; error: string }[] = [];
    for (let i = 0; i < todo.length; i += 3) {
      setProgress(`מקליט ${Math.min(i + 3, todo.length)} מתוך ${todo.length}…`);
      try {
        const r = await fetch("/api/admin/phone-voice/prompts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ files: todo.slice(i, i + 3) }),
        });
        const j = await r.json();
        if (!r.ok) throw new Error(j?.error || "שגיאה");
        for (const x of j.results) if (!x.ok) bad.push({ file: x.file, error: x.error });
      } catch (e: any) {
        for (const f of todo.slice(i, i + 3)) bad.push({ file: f, error: e?.message || "שגיאה" });
      }
    }
    setFailed(bad);
    setProgress("");
    await load();
  }

  async function toggle() {
    const next = !on;
    if (next && !confirm("להפעיל את הקול הטבעי בשיחות? כדאי להתקשר מיד אחרי ולוודא שההודעות נשמעות.")) return;
    await fetch("/api/admin/phone-voice/prompts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ on: next }),
    });
    setOn(next);
  }

  const count = (s: Row["status"]) => rows?.filter((r) => r.status === s).length ?? 0;

  return (
    <div className="card p-4 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="font-bold text-brand-slatedark">🎙️ הודעות המערכת בקול טבעי</p>
          <p className="text-xs text-zinc-500 mt-0.5">
            כל הודעה קבועה במרכזייה שאין לה הקלטה שלך — מוקלטת בקול גבר טבעי במקום הרובוט.
            ההקלטות שלך לא משתנות.
          </p>
        </div>
        {rows && (
          <button
            onClick={toggle}
            className={`rounded-lg px-3 py-1.5 text-sm font-bold ${
              on ? "bg-emerald-600 text-white" : "bg-zinc-200 text-zinc-700"
            }`}
          >
            {on ? "✅ פעיל בשיחות — לחץ לכיבוי" : "כבוי בשיחות — לחץ להפעלה"}
          </button>
        )}
      </div>

      {err && <p className="text-sm text-red-700">שגיאה: {err}</p>}
      {!rows && !err && <p className="text-sm text-zinc-500">בודק מה יש בימות…</p>}

      {rows && (
        <>
          <div className="flex flex-wrap gap-2 text-sm">
            <span className="badge bg-sky-100 text-sky-800">🎤 הקלטה שלך: <bdi>{count("human")}</bdi></span>
            <span className="badge bg-emerald-100 text-emerald-800">🎙️ קול טבעי: <bdi>{count("voiced")}</bdi></span>
            <span className="badge bg-amber-100 text-amber-800">🤖 רובוט: <bdi>{count("missing")}</bdi></span>
          </div>

          {count("missing") > 0 && (
            <button
              onClick={recordMissing}
              disabled={!!progress}
              className="btn-primary btn-sm"
            >
              {progress || `🎙️ הקלט את ${count("missing")} ההודעות שמוקראות ברובוט`}
            </button>
          )}
          {count("voiced") > 0 && !on && (
            <p className="text-sm text-amber-800">
              ההקלטות מוכנות אבל עוד לא מושמעות. לחץ "להפעלה" ואז התקשר למרכזייה כדי לשמוע.
            </p>
          )}
          {failed.length > 0 && (
            <div className="text-sm text-red-700">
              <b>{failed.length} לא הוקלטו</b> (לחיצה נוספת תנסה שוב):
              <ul className="list-disc pr-5">
                {failed.slice(0, 5).map((f) => (
                  <li key={f.file}>
                    {f.file}: {f.error}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <button onClick={() => setOpen(!open)} className="text-xs text-zinc-500 underline">
            {open ? "הסתר את הרשימה" : "הצג את כל ההודעות"}
          </button>
          {open && (
            <ul className="max-h-80 overflow-y-auto divide-y divide-zinc-100 text-sm">
              {rows.map((r) => (
                <li key={r.file} className="py-1.5 flex gap-3">
                  <span className="shrink-0 w-28 text-xs">{LABEL[r.status]}</span>
                  <span className="text-zinc-700">{r.text}</span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
