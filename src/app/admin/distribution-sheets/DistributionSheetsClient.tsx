"use client";
import { useState } from "react";

export function DistributionSheetsClient({
  pricelistId,
  points,
}: {
  pricelistId: string;
  points: { id: string; name: string; count: number }[];
}) {
  // §282: בוחרים קודם למי מדפיסים, ואז לוחצים
  const [pointId, setPointId] = useState("");
  const qs = pointId ? `?pointId=${encodeURIComponent(pointId)}` : "";
  const total = points.reduce((s, p) => s + p.count, 0);

  return (
    <div className="card p-5 space-y-4">
      <label className="block">
        <span className="text-sm font-bold text-brand-slatedark">לאיזו נקודה להדפיס?</span>
        <select className="input mt-1 max-w-md" value={pointId} onChange={(e) => setPointId(e.target.value)}>
          <option value="">📍 כל הנקודות ({total} הזמנות) — גיליון לכל נקודה</option>
          {points.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name} ({p.count})
            </option>
          ))}
        </select>
      </label>

      <div className="grid gap-3 sm:grid-cols-2">
        <a
          href={`/api/agent/export-sale/${pricelistId}${qs}`}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-3 rounded-2xl bg-brand-slatedark p-4 text-white shadow-sm hover:opacity-90"
        >
          <span className="text-3xl">📥</span>
          <span>
            <span className="block text-lg font-extrabold">דף חלוקה</span>
            <span className="block text-xs opacity-80">לפי לקוח — משבצות משקל, מזומן ו&quot;הכל מוכן&quot;</span>
          </span>
        </a>
        <a
          href={`/api/agent/sorting-sheet/${pricelistId}${qs}`}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-3 rounded-2xl bg-blue-700 p-4 text-white shadow-sm hover:opacity-90"
        >
          <span className="text-3xl">📦</span>
          <span>
            <span className="block text-lg font-extrabold">דף מיון</span>
            <span className="block text-xs opacity-80">לפי מוצר — למי שייך כל מוצר, עם סה״כ</span>
          </span>
        </a>
      </div>
    </div>
  );
}
