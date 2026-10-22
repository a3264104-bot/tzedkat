"use client";

// §410: 🔊 "השמע לפני פרסום" — מה הלקוחות ישמעו בטלפון.
// מציג גם את הטקסט כפי שייאמר (תאריכים ושעות במילים), כדי שהמנהל
// יתפוס טעות לפני שאלף מתקשרים שומעים אותה.

import { useState } from "react";

export default function VoicePreview({ text }: { text: string }) {
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<{ spoken: string; audio: string | null; voiceError: string | null; forText: string } | null>(null);
  const [error, setError] = useState("");

  async function play() {
    setBusy(true);
    setError("");
    try {
      const r = await fetch("/api/admin/phone-voice/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error || "שגיאה");
      setRes({ ...j, forText: text });
    } catch (e: any) {
      setError(e?.message || "שגיאה");
    } finally {
      setBusy(false);
    }
  }

  const stale = res && res.forText !== text;

  return (
    <div className="rounded-xl border border-sky-200 bg-sky-50 p-3 text-sm">
      <button
        type="button"
        onClick={play}
        disabled={busy || !text.trim()}
        className="rounded-lg bg-sky-600 px-4 py-2 font-bold text-white hover:bg-sky-700 disabled:opacity-50"
      >
        {busy ? "⏳ מקליט… (כ-15 שניות)" : res && !stale ? "🔊 הקלט שוב" : "🔊 השמע לפני פרסום"}
      </button>
      {error && <p className="mt-2 text-red-700">{error}</p>}
      {res && (
        <div className={`mt-3 space-y-2 ${stale ? "opacity-50" : ""}`}>
          {stale && <p className="font-bold text-amber-700">הטקסט השתנה — לחצו שוב כדי לשמוע את הגרסה החדשה</p>}
          {res.audio ? (
            <audio controls autoPlay src={res.audio} className="w-full" />
          ) : (
            <p className="text-amber-800">
              ⚠️ אין קול טבעי כרגע ({res.voiceError}). הלקוחות ישמעו הקראה ממוחשבת של הטקסט שלמטה.
            </p>
          )}
          <p className="text-zinc-600">
            <b>מה ייאמר:</b> {res.spoken}
          </p>
          <p className="text-xs text-zinc-500">
            בפרסום ההודעה מוקלטת שוב באותו קול (ההקלטה עשויה להישמע מעט אחרת).
          </p>
        </div>
      )}
    </div>
  );
}
