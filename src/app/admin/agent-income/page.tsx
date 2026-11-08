"use client";

// ═══════════════════════════════════════════════════════════════
// §401: 📥 כמה נכנס — לפי נציג ונקודה, בלי דמי ההזמנה
// ═══════════════════════════════════════════════════════════════
// המנהל רושם באקסל משבצת לכל נציג. "נגבה" באתר כולל את דמי ההזמנה
// (₪3 להזמנה) — שאינם של הנציג. כאן: ברוטו, דמי הזמנה, ו**נטו** —
// לכל נקודה, עם סיכום לכל נציג וכפתור העתקה שמדביקים ישר באקסל.

import { MoneyTabs } from "@/components/MoneyTabs";
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { SheetView } from "./SheetView";
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
  // 📋 "כמו באקסל" — העמודות של הגיליון של המנהל. נזכר בין כניסות.
  const [mode, setModeState] = useState<"sheet" | "detail">("sheet");
  useEffect(() => {
    try {
      const m = localStorage.getItem("agentIncomeMode");
      if (m === "detail" || m === "sheet") setModeState(m);
    } catch {}
  }, []);
  const setMode = (m: "sheet" | "detail") => {
    setModeState(m);
    try {
      localStorage.setItem("agentIncomeMode", m);
    } catch {}
  };
  // 💳 פירוט האשראי של נקודה / נציג (לחיצה על הסכום בעמודה)
  const [cardFor, setCardFor] = useState<{ title: string; pointIds: string[]; expected: number } | null>(null);

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
        <MoneyTabs hub="income" />
        <Link href="/admin/agent-debts" className="text-sm text-brand-rust font-bold">
          → התחשבנות עם נציגים
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
        {mode === "detail" && (
        <>
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
        </>
        )}
      </div>

      <div className="inline-flex rounded-lg border border-zinc-300 overflow-hidden text-sm font-bold">
        {(
          [
            ["sheet", "📋 כמו באקסל"],
            ["detail", "📊 פירוט מלא"],
          ] as const
        ).map(([m, label]) => (
          <button
            key={m}
            onClick={() => setMode(m)}
            className={`px-3 py-1.5 ${mode === m ? "bg-brand-rust text-white" : "bg-white text-zinc-600"}`}
          >
            {label}
          </button>
        ))}
      </div>

      {mode === "sheet" && selected ? (
        <SheetView selected={selected} />
      ) : (
      <>
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
                  <GroupRows
                    key={g.agent}
                    agent={g.agent}
                    rows={g.rows}
                    total={g.total}
                    onCard={(title, pointIds, expected) => setCardFor({ title, pointIds, expected })}
                  />
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
          <p className="text-xs text-zinc-500">
            💳 לחיצה על סכום בעמודת האשראי מציגה ממה הוא מורכב — כל הזמנה וסכומיה.
          </p>
          {grand.walkins > 0 && (
            <p className="text-xs text-zinc-500">
              כולל {fmt(grand.walkins)} ממזדמנים ישנים (לפני שהומרו ללקוחות) — בלי דמי הזמנה.
            </p>
          )}
        </>
      )}
      </>
      )}
      {cardFor && selected && (
        <CardDetail
          title={cardFor.title}
          pointIds={cardFor.pointIds}
          expected={cardFor.expected}
          selected={selected}
          onClose={() => setCardFor(null)}
        />
      )}
    </div>
  );
}

type OnCard = (title: string, pointIds: string[], expected: number) => void;

function GroupRows({
  agent,
  rows,
  total,
  onCard,
}: {
  agent: string;
  rows: Row[];
  total: Totals;
  onCard: OnCard;
}) {
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
        <Money
          v={total.card}
          bold
          onClick={() => onCard(agent, rows.map((r) => r.pointId), total.card)}
        />
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
            <Money v={r.card} onClick={() => onCard(r.pointName, [r.pointId], r.card)} />
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

function Money({ v, bold, onClick }: { v: number; bold?: boolean; onClick?: () => void }) {
  return (
    <td className={`p-2 text-left tabular-nums whitespace-nowrap ${bold ? "font-bold" : ""} ${v === 0 ? "text-zinc-300" : ""}`} dir="ltr">
      {v === 0 ? (
        "—"
      ) : onClick ? (
        <button onClick={onClick} className="underline decoration-dotted underline-offset-2 hover:text-brand-rust" title="ממה מורכב הסכום">
          {fmt(v)}
        </button>
      ) : (
        fmt(v)
      )}
    </td>
  );
}

type CardOrder = {
  orderNumber: number;
  customerName: string;
  point: string | null;
  sale: string | null;
  paidAt: string | null;
  transactionId: string | null;
  status: string;
  paymentStatus: string | null;
  parts: {
    items: number;
    orderFee: number;
    delivery: number;
    extra: number;
    extraReason: string | null;
    credit: number;
    creditReason: string | null;
    creditBalance: number;
    debt: number;
  };
  total: number;
  paid: number;
  cardPaid: number;
  cardDebt: number;
  cardRev: number;
};

// ⚠️ סימן LRM לפני המינוס: בלעדיו הדפדפן מציג "₪1.00−" בתוך עמוד RTL
const neg = (v: number) => `‎−${fmt(v)}`;

// 💳 ממה מורכב סכום האשראי — הזמנה אחר הזמנה
function CardDetail({
  title,
  pointIds,
  expected,
  selected,
  onClose,
}: {
  title: string;
  pointIds: string[];
  expected: number;
  selected: string;
  onClose: () => void;
}) {
  const [d, setD] = useState<{
    orders: CardOrder[];
    walkins: { walkinNumber: number; customerName: string; amount: number }[];
    totals: { cardPaid: number; cardDebt: number; cardRev: number; walkins: number; column: number };
  } | null>(null);
  const [err, setErr] = useState("");
  const [open, setOpen] = useState<number | null>(null);

  useEffect(() => {
    const q = new URLSearchParams();
    applySaleSelection(q, selected);
    q.set("pointIds", pointIds.join(","));
    fetch(`/api/admin/agent-income/card-detail?${q}`, { cache: "no-store" })
      .then(async (r) => {
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(j.error || `שגיאה (${r.status})`);
        setD(j);
      })
      .catch((e) => setErr(e.message || "שגיאה"));
  }, [pointIds, selected]);

  const line = (label: string, v: number, sign: "+" | "-" = "+", note?: string | null) =>
    v > 0 ? (
      <div className="flex justify-between gap-2">
        <span>
          {label}
          {note ? <span className="text-zinc-400"> · {note}</span> : null}
        </span>
        <span className="tabular-nums" dir="ltr">
          {sign === "-" ? neg(v) : fmt(v)}
        </span>
      </div>
    ) : null;

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-start justify-center p-3 overflow-y-auto" onClick={onClose}>
      <div className="bg-white rounded-2xl w-full max-w-2xl p-4 my-6" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-2">
          <div>
            <h2 className="font-extrabold text-brand-slatedark">💳 אשראי/העברה — {title}</h2>
            <p className="text-xs text-zinc-500 mt-0.5">כל הזמנה שנכנס בה כסף באשראי. לחיצה על שורה — ממה מורכב הסכום.</p>
          </div>
          <button onClick={onClose} className="text-zinc-500 text-xl leading-none px-2">
            ×
          </button>
        </div>

        {err && <p className="text-sm text-red-700 mt-3">{err}</p>}
        {!d && !err && <p className="text-zinc-500 mt-4">טוען…</p>}
        {d && (
          <>
            <div className="mt-3 divide-y divide-zinc-100 border border-zinc-200 rounded-xl">
              {d.orders.length === 0 && d.walkins.length === 0 && (
                <div className="p-3 text-sm text-zinc-500">אין תשלומי אשראי.</div>
              )}
              {d.orders.map((o) => (
                <div key={o.orderNumber}>
                  <button
                    onClick={() => setOpen(open === o.orderNumber ? null : o.orderNumber)}
                    className="w-full flex items-center gap-2 p-2.5 text-sm text-right hover:bg-zinc-50"
                  >
                    <span className="text-zinc-400 w-4">{open === o.orderNumber ? "▾" : "▸"}</span>
                    <span className="flex-1 min-w-0 truncate">
                      <b>{o.customerName}</b> <span className="text-zinc-400">#{o.orderNumber}</span>
                      {pointIds.length > 1 && o.point ? <span className="text-xs text-zinc-400"> · {o.point}</span> : null}
                      {o.status === "CANCELLED" ? <span className="text-xs text-red-600"> · מבוטלת</span> : null}
                    </span>
                    {o.cardDebt > 0 && (
                      <span className="text-[11px] text-zinc-500">כולל חוב {fmt(o.cardDebt)}</span>
                    )}
                    <span className="font-bold tabular-nums" dir="ltr">
                      {fmt(o.cardRev)}
                    </span>
                  </button>
                  {open === o.orderNumber && (
                    <div className="px-8 pb-3 text-xs text-zinc-700 space-y-0.5">
                      {line("מוצרים", o.parts.items)}
                      {line("דמי הזמנה", o.parts.orderFee)}
                      {line("משלוח", o.parts.delivery)}
                      {line("חיוב נוסף", o.parts.extra, "+", o.parts.extraReason)}
                      {line("זיכוי", o.parts.credit, "-", o.parts.creditReason)}
                      {line("יתרת זכות שקוזזה", o.parts.creditBalance, "-")}
                      {line("חוב קודם שנגבה", o.parts.debt)}
                      <div className="flex justify-between gap-2 border-t border-zinc-200 pt-1 font-bold">
                        <span>סכום ההזמנה</span>
                        <span className="tabular-nums" dir="ltr">{fmt(o.total)}</span>
                      </div>
                      <div className="flex justify-between gap-2">
                        <span>שולם באשראי</span>
                        <span className="tabular-nums" dir="ltr">{fmt(o.cardPaid)}</span>
                      </div>
                      {o.paid > o.cardPaid && (
                        <div className="flex justify-between gap-2 text-zinc-500">
                          <span>שולם במזומן</span>
                          <span className="tabular-nums" dir="ltr">{fmt(Math.round((o.paid - o.cardPaid) * 100) / 100)}</span>
                        </div>
                      )}
                      {o.cardDebt > 0 && (
                        <div className="flex justify-between gap-2 text-zinc-500">
                          <span>מתוכו חוב קודם (מופיע בעמודות החוב, לא כאן)</span>
                          <span className="tabular-nums" dir="ltr">{neg(o.cardDebt)}</span>
                        </div>
                      )}
                      <div className="flex justify-between gap-2 font-bold text-emerald-800">
                        <span>נספר בעמודת האשראי</span>
                        <span className="tabular-nums" dir="ltr">{fmt(o.cardRev)}</span>
                      </div>
                      {o.transactionId && <div className="text-zinc-400">מספר עסקה בנדרים: {o.transactionId}</div>}
                    </div>
                  )}
                </div>
              ))}
              {d.walkins.map((w) => (
                <div key={`w${w.walkinNumber}`} className="flex items-center gap-2 p-2.5 text-sm">
                  <span className="w-4" />
                  <span className="flex-1">
                    <b>{w.customerName}</b> <span className="text-zinc-400">מזדמן #{w.walkinNumber}</span>
                  </span>
                  <span className="font-bold tabular-nums" dir="ltr">{fmt(w.amount)}</span>
                </div>
              ))}
            </div>

            <div className="mt-3 rounded-xl bg-zinc-50 border border-zinc-200 p-3 text-sm space-y-1">
              <div className="flex justify-between">
                <span>
                  {d.orders.length} הזמנות{d.walkins.length > 0 ? ` + ${d.walkins.length} מזדמנים` : ""}
                </span>
                <span className="font-extrabold tabular-nums" dir="ltr">{fmt(d.totals.column)}</span>
              </div>
              {d.totals.cardDebt > 0 && (
                <div className="flex justify-between text-xs text-zinc-500">
                  <span>חוב קודם שנגבה באשראי בהזמנות האלה (לא בסכום)</span>
                  <span className="tabular-nums" dir="ltr">{fmt(d.totals.cardDebt)}</span>
                </div>
              )}
              {Math.abs(d.totals.column - expected) > 0.01 && (
                <div className="text-xs text-red-700 font-bold">
                  ⚠️ הסכום לא תואם לעמודה ({fmt(expected)}) — רענן את המסך.
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
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
