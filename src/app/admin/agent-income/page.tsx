"use client";

// ═══════════════════════════════════════════════════════════════
// §401: 📥 כמה נכנס — לפי נציג ונקודה, בלי דמי ההזמנה
// ═══════════════════════════════════════════════════════════════
// המנהל רושם באקסל משבצת לכל נציג. "נגבה" באתר כולל את דמי ההזמנה
// (₪3 להזמנה) — שאינם של הנציג. כאן: ברוטו, דמי הזמנה, ו**נטו** —
// לכל נקודה, עם סיכום לכל נציג וכפתור העתקה שמדביקים ישר באקסל.

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { fmt } from "@/lib/pricing";
import {
  useSelectedPricelist,
  PricelistSelector,
  applySaleSelection,
} from "@/components/useSelectedPricelist";

type Row = {
  pointId: string;
  pointName: string;
  city: string | null;
  agentLabel: string;
  orders: number;
  paidOrders: number;
  gross: number;
  fees: number;
  net: number;
  card: number;
  agentCash: number;
  adminCash: number;
  walkins: number;
  walkinCount: number;
  debtCollected: number;
  /** 💸 חוב שהנציג רשם ונגבה — כלול בנטו */
  debtAgent: number;
  /** 💸 חוב של המנהל שנגבה — לא נספר אצל הנציג */
  debtAdmin: number;
  pending: number;
  pendingOrders: number;
};
type Totals = Omit<Row, "pointId" | "pointName" | "city" | "agentLabel" | "walkinCount">;

const NUM_KEYS = [
  "orders",
  "paidOrders",
  "gross",
  "fees",
  "net",
  "card",
  "agentCash",
  "adminCash",
  "walkins",
  "debtCollected",
  "debtAgent",
  "debtAdmin",
  "pending",
  "pendingOrders",
] as const;

function addUp(rows: Row[]): Totals {
  const t: any = {};
  for (const k of NUM_KEYS) {
    t[k] = Math.round(rows.reduce((s, r) => s + (r[k] || 0), 0) * 100) / 100;
  }
  return t as Totals;
}

/** מספר לאקסל: בלי ₪ ובלי פסיקים — שיודבק כמספר */
const xl = (n: number) => (Math.round(n * 100) / 100).toFixed(2);

export default function AgentIncomePage() {
  const { lists, selected, setSelected } = useSelectedPricelist({ allowAll: true });
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState<string>("");

  const load = useCallback(async () => {
    if (!selected) return;
    setRows(null);
    setError("");
    try {
      const q = new URLSearchParams();
      applySaleSelection(q, selected);
      const res = await fetch(`/api/admin/agent-income?${q}`, { cache: "no-store" });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || `שגיאה (${res.status})`);
      setRows(d.rows);
    } catch (e: any) {
      setError(e.message || "שגיאה בטעינה");
      setRows([]);
    }
  }, [selected]);

  useEffect(() => {
    load();
  }, [load]);

  // קיבוץ לפי נציג (לפי הסדר שהשרת החזיר)
  const groups = useMemo(() => {
    const m = new Map<string, Row[]>();
    for (const r of rows ?? []) {
      const arr = m.get(r.agentLabel) ?? [];
      arr.push(r);
      m.set(r.agentLabel, arr);
    }
    return [...m.entries()].map(([agent, rs]) => ({ agent, rows: rs, total: addUp(rs) }));
  }, [rows]);
  const grand = useMemo(() => addUp(rows ?? []), [rows]);

  async function copy(text: string, tag: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(tag);
      setTimeout(() => setCopied(""), 2000);
    } catch {
      window.prompt("העתק ידנית (Ctrl+C):", text);
    }
  }

  function copyByPoint() {
    const head = ["נציג", "נקודה", "נטו", "ברוטו", "דמי הזמנה", "אשראי/העברה", "מזומן אצל הנציג", "מזומן אצל המנהל", "טרם נגבה"];
    const lines = (rows ?? []).map((r) =>
      [r.agentLabel, r.pointName, xl(r.net), xl(r.gross), xl(r.fees), xl(r.card), xl(r.agentCash), xl(r.adminCash), xl(r.pending)].join("\t")
    );
    copy([head.join("\t"), ...lines].join("\n"), "points");
  }

  function copyByAgent() {
    const head = ["נציג", "נטו", "ברוטו", "דמי הזמנה", "מזומן אצל הנציג", "טרם נגבה"];
    const lines = groups.map((g) =>
      [g.agent, xl(g.total.net), xl(g.total.gross), xl(g.total.fees), xl(g.total.agentCash), xl(g.total.pending)].join("\t")
    );
    copy([head.join("\t"), ...lines].join("\n"), "agents");
  }

  return (
    <div className="space-y-4">
      <div>
        <Link href="/admin/agent-debts" className="text-sm text-brand-rust font-bold">
          → חובות נציגים
        </Link>
        <h1 className="text-2xl font-extrabold text-brand-slatedark mt-1">
          📥 כמה נכנס — לפי נציג ונקודה
        </h1>
        <p className="text-sm text-zinc-600 mt-1 max-w-3xl leading-relaxed">
          <b>נטו</b> = מה שנגבה מהמכירה פחות דמי ההזמנה (₪3 לכל הזמנה ששולמה). זה הסכום
          למשבצת של הנציג באקסל. <b>חוב שהנציג רשם ונגבה — נכלל בנטו שלו</b>; חוב שהמנהל
          רשם — לא נכלל (מופיע בעמודה נפרדת), גם אם הלקוח בנקודה של הנציג. טרם נגבה מופיע לחוד.
        </p>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <PricelistSelector lists={lists} selected={selected} onChange={setSelected} allowAll />
        <button onClick={load} className="btn-ghost btn-sm">
          ↻ רענן
        </button>
        <span className="flex-1" />
        <button
          onClick={copyByAgent}
          disabled={!rows || rows.length === 0}
          className="btn-sm bg-emerald-600 text-white rounded-lg px-3 font-bold disabled:opacity-40"
        >
          {copied === "agents" ? "✓ הועתק" : "📋 העתק לאקסל — לפי נציג"}
        </button>
        <button
          onClick={copyByPoint}
          disabled={!rows || rows.length === 0}
          className="btn-sm bg-emerald-50 text-emerald-800 border border-emerald-300 rounded-lg px-3 font-bold disabled:opacity-40"
        >
          {copied === "points" ? "✓ הועתק" : "📋 העתק — לפי נקודה"}
        </button>
      </div>

      {error && (
        <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg p-2">{error}</p>
      )}

      {rows === null ? (
        <p className="text-zinc-500">טוען…</p>
      ) : rows.length === 0 ? (
        <p className="text-zinc-500">אין הזמנות במכירה הזו.</p>
      ) : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <Kpi label="נטו (בלי דמי הזמנה)" value={grand.net} strong />
            <Kpi label="ברוטו" value={grand.gross} />
            <Kpi label={`דמי הזמנה · ${grand.paidOrders} הזמנות`} value={grand.fees} />
            <Kpi label={`טרם נגבה · ${grand.pendingOrders}`} value={grand.pending} warn={grand.pending > 0} />
          </div>

          <div className="bg-white border border-zinc-200 rounded-xl overflow-x-auto">
            <table className="w-full text-sm min-w-[1080px]">
              <thead className="bg-zinc-50 text-zinc-600 text-xs">
                <tr>
                  <th className="text-right p-2">נקודה</th>
                  <th className="text-center p-2">שולמו / הזמנות</th>
                  <th className="text-left p-2 bg-emerald-50 text-emerald-800">נטו</th>
                  <th className="text-left p-2">ברוטו</th>
                  <th className="text-left p-2">דמי הזמנה</th>
                  <th className="text-left p-2">💳 אשראי/העברה</th>
                  <th className="text-left p-2">💵 אצל הנציג</th>
                  <th className="text-left p-2">💵 אצלך</th>
                  <th className="text-left p-2">⏳ טרם נגבה</th>
                  <th className="text-left p-2">💸 חוב של הנציג (בנטו)</th>
                  <th className="text-left p-2">חוב של המנהל</th>
                </tr>
              </thead>
              <tbody>
                {groups.map((g) => (
                  <GroupRows key={g.agent} agent={g.agent} rows={g.rows} total={g.total} />
                ))}
                <tr className="bg-brand-slatedark text-white font-bold">
                  <td className="p-2">סה&quot;כ</td>
                  <td className="p-2 text-center">
                    {grand.paidOrders} / {grand.orders}
                  </td>
                  <Money v={grand.net} />
                  <Money v={grand.gross} />
                  <Money v={grand.fees} />
                  <Money v={grand.card} />
                  <Money v={grand.agentCash} />
                  <Money v={grand.adminCash} />
                  <Money v={grand.pending} />
                  <Money v={grand.debtAgent} />
                  <Money v={grand.debtAdmin} />
                </tr>
              </tbody>
            </table>
          </div>
          {grand.walkins > 0 && (
            <p className="text-xs text-zinc-500">
              כולל {fmt(grand.walkins)} ממזדמנים ישנים (לפני שהומרו ללקוחות) — בלי דמי הזמנה.
            </p>
          )}
        </>
      )}
    </div>
  );
}

function GroupRows({ agent, rows, total }: { agent: string; rows: Row[]; total: Totals }) {
  return (
    <>
      <tr className="bg-brand-cream/60 border-t-2 border-zinc-300">
        <td className="p-2 font-extrabold text-brand-slatedark">🧑‍💼 {agent}</td>
        <td className="p-2 text-center text-xs text-zinc-600">
          {total.paidOrders} / {total.orders}
        </td>
        <Money v={total.net} bold />
        <Money v={total.gross} bold />
        <Money v={total.fees} bold />
        <Money v={total.card} bold />
        <Money v={total.agentCash} bold />
        <Money v={total.adminCash} bold />
        <Money v={total.pending} bold />
        <Money v={total.debtAgent} bold />
        <Money v={total.debtAdmin} bold />
      </tr>
      {rows.length > 1 &&
        rows.map((r) => (
          <tr key={r.pointId} className="border-t border-zinc-100">
            <td className="p-2 pr-6 text-zinc-700">
              📍 {r.pointName}
              {r.city ? <span className="text-xs text-zinc-400"> · {r.city}</span> : null}
            </td>
            <td className="p-2 text-center text-xs text-zinc-500">
              {r.paidOrders} / {r.orders}
            </td>
            <Money v={r.net} />
            <Money v={r.gross} />
            <Money v={r.fees} />
            <Money v={r.card} />
            <Money v={r.agentCash} />
            <Money v={r.adminCash} />
            <Money v={r.pending} />
            <Money v={r.debtAgent} />
            <Money v={r.debtAdmin} />
          </tr>
        ))}
      {rows.length === 1 && (
        <tr className="border-t border-zinc-100">
          <td colSpan={11} className="p-1 pr-6 text-xs text-zinc-500">
            📍 {rows[0].pointName}
            {rows[0].city ? ` · ${rows[0].city}` : ""}
          </td>
        </tr>
      )}
    </>
  );
}

function Money({ v, bold }: { v: number; bold?: boolean }) {
  return (
    <td className={`p-2 text-left tabular-nums whitespace-nowrap ${bold ? "font-bold" : ""} ${v === 0 ? "text-zinc-300" : ""}`} dir="ltr">
      {v === 0 ? "—" : fmt(v)}
    </td>
  );
}

function Kpi({ label, value, strong, warn }: { label: string; value: number; strong?: boolean; warn?: boolean }) {
  return (
    <div
      className={`rounded-xl border p-3 ${
        strong ? "bg-emerald-50 border-emerald-300" : warn ? "bg-amber-50 border-amber-200" : "bg-white border-zinc-200"
      }`}
    >
      <div className="text-xs text-zinc-600">{label}</div>
      <div className={`text-xl font-extrabold tabular-nums ${strong ? "text-emerald-800" : "text-brand-slatedark"}`} dir="ltr">
        {fmt(value)}
      </div>
    </div>
  );
}
