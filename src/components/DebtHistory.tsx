"use client";

// ═══════════════════════════════════════════════════════════════
// §368: היסטוריית חוב — לכרטיס הלקוח
// ═══════════════════════════════════════════════════════════════
// המנהל רואה "חוב ₪370" ושואל: מאיפה? מי רשם? מתי נגבה? דרך מי?
// הפאנל עונה — שורה לכל תנועה.

import { useEffect, useState } from "react";

type Row = {
  id: string;
  kind: "ADD" | "COLLECT" | "RESTORE" | "ADJUST";
  amount: number;
  balanceAfter: number;
  note: string | null;
  orderNumber: number | null;
  pricelistName: string | null;
  agentName: string | null;
  createdBy: string;
  createdAt: string;
};

const KIND_LABEL: Record<Row["kind"], { text: string; color: string; icon: string }> = {
  ADD: { text: "חוב נרשם", color: "text-red-700", icon: "➕" },
  COLLECT: { text: "נגבה", color: "text-emerald-700", icon: "✓" },
  RESTORE: { text: "הוחזר (ביטול)", color: "text-amber-700", icon: "↩" },
  ADJUST: { text: "תיקון", color: "text-zinc-600", icon: "✏️" },
};

export default function DebtHistory({ customerId }: { customerId: string }) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    fetch(`/api/admin/debt-ledger?customerId=${customerId}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { rows: [] }))
      .then((d) => setRows(d.rows ?? []))
      .catch(() => setRows([]));
  }, [open, customerId]);

  const fmt = (n: number) => `₪${Math.abs(n).toFixed(2)}`;
  const date = (iso: string) =>
    new Date(iso).toLocaleDateString("he-IL", {
      day: "2-digit",
      month: "2-digit",
      year: "2-digit",
      timeZone: "Asia/Jerusalem",
    });

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="text-[11px] text-zinc-500 hover:text-brand-rust underline"
      >
        📒 היסטוריית חוב
      </button>
    );
  }

  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-3 mt-2">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-bold text-zinc-700">📒 היסטוריית חוב</span>
        <button onClick={() => setOpen(false)} className="text-zinc-400 text-lg leading-none px-1">
          ×
        </button>
      </div>

      {rows === null ? (
        <p className="text-xs text-zinc-400 py-2">טוען...</p>
      ) : rows.length === 0 ? (
        <p className="text-xs text-zinc-400 py-2">אין תנועות חוב</p>
      ) : (
        <div className="space-y-1.5 max-h-64 overflow-y-auto">
          {rows.map((r) => {
            const k = KIND_LABEL[r.kind];
            return (
              <div key={r.id} className="text-xs border-b border-zinc-100 pb-1.5">
                <div className="flex items-center justify-between gap-2">
                  <span className={`font-bold ${k.color}`}>
                    {k.icon} {k.text}
                    {r.orderNumber && (
                      <span className="font-normal text-zinc-500"> · #{r.orderNumber}</span>
                    )}
                  </span>
                  <span className={`font-bold tabular-nums ${k.color}`}>
                    {r.amount < 0 ? "−" : "+"}
                    {fmt(r.amount)}
                  </span>
                </div>
                <div className="flex items-center justify-between text-[10px] text-zinc-500 mt-0.5">
                  <span className="truncate">
                    {r.note}
                    {r.pricelistName && ` · ${r.pricelistName}`}
                    {r.agentName && ` · ${r.agentName}`}
                  </span>
                  <span className="shrink-0">
                    {date(r.createdAt)} · יתרה {fmt(r.balanceAfter)}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
