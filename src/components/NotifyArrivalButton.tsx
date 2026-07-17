"use client";

import { useState, useEffect } from "react";

// ח5: כפתור "הסחורה הגיעה" — שולח מיילים ללקוחות שהסחורה מוכנה לאיסוף.
// אפשרות לשלוח לכל הנקודות או לנקודה ספציפית.

type Point = { id: string; name: string };

export function NotifyArrivalButton() {
  const [points, setPoints] = useState<Point[]>([]);
  const [selectedPoint, setSelectedPoint] = useState<string>("");
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [showConfirm, setShowConfirm] = useState(false);

  useEffect(() => {
    fetch("/api/admin/points")
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data)) {
          setPoints(data.filter((p: any) => p.isActive));
        }
      })
      .catch(() => {});
  }, []);

  async function send() {
    setSending(true);
    setResult(null);
    setShowConfirm(false);
    try {
      const res = await fetch("/api/admin/notify-arrival", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(selectedPoint ? { pointId: selectedPoint } : {}),
      });
      const data = await res.json();
      if (!res.ok) {
        setResult({ type: "error", text: data.error || "שגיאה" });
      } else {
        setResult({
          type: "success",
          text: `נשלחו ${data.sent} הודעות ל"${data.pointName}"${data.failed ? ` (${data.failed} נכשלו)` : ""}`,
        });
      }
    } catch (e: any) {
      setResult({ type: "error", text: e.message || "שגיאת רשת" });
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="card p-4">
      <div className="font-bold text-brand-slatedark mb-2">📦 הודעת הגעת סחורה</div>
      <p className="text-sm text-zinc-500 mb-3">
        שליחת מייל ללקוחות שהסחורה שלהם מוכנה לאיסוף.
      </p>

      <div className="flex gap-2 mb-3">
        <select
          className="input flex-1"
          value={selectedPoint}
          onChange={(e) => setSelectedPoint(e.target.value)}
        >
          <option value="">כל הנקודות</option>
          {points.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </div>

      {!showConfirm ? (
        <button
          onClick={() => setShowConfirm(true)}
          disabled={sending}
          className="btn-primary btn-sm w-full"
        >
          שלח הודעת "הסחורה הגיעה"
        </button>
      ) : (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 space-y-2">
          <p className="text-sm text-amber-900 font-medium">
            לשלוח הודעה ל{selectedPoint ? `נקודת "${points.find((p) => p.id === selectedPoint)?.name}"` : "כל הנקודות"}?
          </p>
          <div className="flex gap-2">
            <button
              onClick={() => setShowConfirm(false)}
              className="btn-ghost btn-sm flex-1"
            >
              ביטול
            </button>
            <button
              onClick={send}
              disabled={sending}
              className="btn-primary btn-sm flex-1"
            >
              {sending ? "שולח..." : "אישור ושליחה"}
            </button>
          </div>
        </div>
      )}

      {result && (
        <div
          className={`mt-3 rounded-lg p-2.5 text-sm text-center ${
            result.type === "success"
              ? "bg-emerald-50 text-emerald-800 border border-emerald-200"
              : "bg-red-50 text-red-800 border border-red-200"
          }`}
        >
          {result.text}
        </div>
      )}
    </div>
  );
}
