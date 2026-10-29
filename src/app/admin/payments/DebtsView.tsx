"use client";

// 💸 חובות לקוחות — בתוך מסך התשלומים.
//
// • חובות פתוחים, עם פירוק "של מי": נציג (נספר בהכנסה שלו כשנגבה)
//   או המנהל (לא נספר אצל הנציג). לכל לקוח — "גבה עכשיו מהכרטיס".
// • גביות שבוצעו — בהזמנה או מיידית — לפי בעלים.
// סינון לפי בעלים: הכל / המנהל / נציג מסוים.

import { useCallback, useEffect, useMemo, useState } from "react";
import { isAggregateSelection } from "@/components/useSelectedPricelist";

type Owners = Record<string, number>;
type OpenRow = {
  id: string;
  name: string;
  phone: string | null;
  point: string | null;
  debt: number;
  owners: Owners;
  note: string | null;
  hasCard: boolean;
  cardLast4: string | null;
  isCash: boolean;
};
type CollectedRow = {
  id: string;
  customerName: string;
  amount: number;
  ownerKey: string;
  method: string | null;
  note: string | null;
  orderNumber?: number | null;
  createdAt: string;
};

const fmt = (n: number) => `₪${n.toLocaleString("he-IL", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function DebtsView({ pricelistId }: { pricelistId: string }) {
  const [data, setData] = useState<{
    agents: Record<string, string>;
    open: OpenRow[];
    collected: CollectedRow[];
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [owner, setOwner] = useState<string>("");
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const q = new URLSearchParams();
      if (pricelistId && !isAggregateSelection(pricelistId)) q.set("pricelistId", pricelistId);
      const res = await fetch(`/api/admin/debts-overview?${q}`, { cache: "no-store" });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "שגיאה");
      setData(d);
    } catch (e: any) {
      setError(e?.message || "שגיאה");
    }
  }, [pricelistId]);
  useEffect(() => {
    load();
  }, [load]);

  const label = useCallback(
    (key: string) => {
      if (key === "admin") return "המנהל";
      if (key.startsWith("agent:")) return `נציג: ${data?.agents[key.slice(6)] ?? "?"}`;
      return key;
    },
    [data]
  );

  const ownerKeys = useMemo(() => {
    const s = new Set<string>();
    for (const r of data?.open ?? []) Object.keys(r.owners).forEach((k) => s.add(k));
    for (const r of data?.collected ?? []) s.add(r.ownerKey);
    return [...s].sort((a, b) => (a === "admin" ? -1 : b === "admin" ? 1 : label(a).localeCompare(label(b), "he")));
  }, [data, label]);

  const open = (data?.open ?? []).filter((r) => !owner || (r.owners[owner] ?? 0) > 0);
  const collected = (data?.collected ?? []).filter((r) => !owner || r.ownerKey === owner);
  const openSum = open.reduce((s, r) => s + (owner ? r.owners[owner] ?? 0 : r.debt), 0);
  const collectedSum = collected.reduce((s, r) => s + r.amount, 0);

  async function chargeNow(r: OpenRow) {
    if (
      !window.confirm(
        `לגבות עכשיו ${fmt(r.debt)} מהכרטיס של ${r.name}${r.cardLast4 ? ` (****${r.cardLast4})` : ""}?\n\n` +
          `החיוב מתבצע מיד בנדרים.`
      )
    )
      return;
    setBusy(r.id);
    setMsg(null);
    try {
      const res = await fetch(`/api/admin/customers/${r.id}/debt/charge`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok || !d.ok) throw new Error(d.error || `שגיאה (${res.status})`);
      setMsg({ ok: true, text: `✓ נגבו ${fmt(d.charged)} מ-${r.name}` });
      load();
    } catch (e: any) {
      setMsg({ ok: false, text: `${r.name}: ${e?.message || "החיוב נכשל"}` });
      load();
    } finally {
      setBusy(null);
    }
  }

  if (error) return <div className="text-red-700 font-bold py-4">{error}</div>;
  if (!data) return <div className="text-center py-12 text-zinc-500">טוען...</div>;

  return (
    <div className="space-y-4">
      <div className="rounded-xl bg-white border border-zinc-200 p-3 text-sm text-zinc-700 leading-relaxed">
        <b>של מי החוב:</b> חוב שנציג רשם — שלו, ונספר בהכנסה שלו כשהוא נגבה. חוב שהמנהל רשם — של
        המנהל, ולא נספר אצל הנציג (גם אם הלקוח בנקודה שלו). חוב ישן שנרשם לפני ההפרדה — נחשב של המנהל.
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-bold text-brand-slatedark">סינון לפי בעלים:</span>
        <select
          value={owner}
          onChange={(e) => setOwner(e.target.value)}
          className="px-3 py-2 bg-white border border-zinc-300 rounded-lg text-sm"
        >
          <option value="">הכל</option>
          {ownerKeys.map((k) => (
            <option key={k} value={k}>
              {label(k)}
            </option>
          ))}
        </select>
        <button onClick={load} className="px-3 py-2 bg-white border border-zinc-300 rounded-lg text-sm">
          🔄 רענן
        </button>
      </div>

      {msg && (
        <div
          className={`rounded-lg p-3 text-sm font-bold ${
            msg.ok ? "bg-emerald-50 text-emerald-800 border border-emerald-200" : "bg-red-50 text-red-800 border border-red-200"
          }`}
        >
          {msg.text}
        </div>
      )}

      <section className="rounded-xl bg-white border border-zinc-200 p-3">
        <div className="flex items-center justify-between mb-2">
          <h2 className="font-extrabold text-brand-slatedark">חובות פתוחים ({open.length})</h2>
          <span className="font-bold text-red-700">{fmt(openSum)}</span>
        </div>
        {open.length === 0 && <div className="text-sm text-zinc-500">אין חובות פתוחים.</div>}
        <div className="divide-y divide-zinc-100">
          {open.map((r) => (
            <div key={r.id} className="py-2 flex flex-wrap items-center gap-2">
              <div className="flex-1 min-w-[180px]">
                <div className="font-bold text-brand-slatedark">
                  {r.name} <span className="text-xs text-zinc-500">{r.point ?? ""}</span>
                </div>
                {r.note && <div className="text-xs text-zinc-600">{r.note}</div>}
                <div className="text-[11px] text-zinc-500 mt-0.5">
                  {Object.entries(r.owners)
                    .map(([k, v]) => `${label(k)}: ${fmt(v)}`)
                    .join(" · ")}
                </div>
              </div>
              <div className="font-extrabold text-red-700 tabular-nums">{fmt(r.debt)}</div>
              {r.hasCard ? (
                <button
                  onClick={() => chargeNow(r)}
                  disabled={busy === r.id}
                  className="px-3 py-1.5 rounded-lg bg-brand-rust text-white text-sm font-bold disabled:opacity-40"
                >
                  {busy === r.id ? "גובה..." : "💳 גבה עכשיו"}
                </button>
              ) : (
                <span className="text-xs text-zinc-500">
                  {r.isCash ? "💵 מזומן — ייגבה בחלוקה" : "אין כרטיס תקין — ייגבה בהזמנה הבאה"}
                </span>
              )}
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-xl bg-white border border-zinc-200 p-3">
        <div className="flex items-center justify-between mb-2">
          <h2 className="font-extrabold text-brand-slatedark">
            חובות שנגבו ({collected.length})
          </h2>
          <span className="font-bold text-emerald-700">{fmt(collectedSum)}</span>
        </div>
        {collected.length === 0 && <div className="text-sm text-zinc-500">אין גביות חוב בסינון הזה.</div>}
        <div className="divide-y divide-zinc-100 text-sm">
          {collected.map((r) => (
            <div key={r.id} className="py-1.5 flex flex-wrap items-center gap-2">
              <span className="flex-1 min-w-[160px] font-medium">{r.customerName}</span>
              <span className="text-xs text-zinc-500">{label(r.ownerKey)}</span>
              <span className="text-xs text-zinc-500">
                {r.method === "CARD"
                  ? "💳 מיידי"
                  : r.method === "CARD_UNKNOWN"
                    ? "⚠️ לבדוק בנדרים"
                    : r.method === "ORDER"
                      ? `בהזמנה #${r.orderNumber ?? ""} (שולמה)`
                      : ""}
              </span>
              <span className="text-xs text-zinc-400">
                {new Date(r.createdAt).toLocaleDateString("he-IL", { timeZone: "Asia/Jerusalem" })}
              </span>
              <span className="font-bold tabular-nums text-emerald-700">{fmt(r.amount)}</span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
