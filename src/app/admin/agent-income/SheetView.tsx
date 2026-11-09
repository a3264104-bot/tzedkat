"use client";

// 📋 "כמו באקסל" — אותן עמודות ואותו סדר של הגיליון שהמנהל עובד איתו.
// העמודה הצהובה (אשראי לחישוב לנציג) היא הסכום שהמנהל מקזז לנציג.
// כל תא לחיץ: נפתח פירוט — ההזמנות שמרכיבות את המספר, וסכומן = התא.

import { useCallback, useEffect, useState } from "react";
import { fmt } from "@/lib/pricing";
import { applySaleSelection } from "@/components/useSelectedPricelist";

type Nums = {
  orders: number;
  paidOrders: number;
  kgCarton: number;
  kgSingles: number;
  gross: number;
  fees: number;
  commWeight: number;
  commSingles: number;
  commTotal: number;
  netGoods: number;
  cardReceived: number;
  cardAdminDebt: number;
  cardForAgent: number;
};
type SheetRow = Nums & { pointId: string; pointName: string; agentLabel: string };
type OrderRow = Nums & { orderNumber: number; customerName: string; pointName: string; paymentStatus: string | null };
type Kind = "n" | "kg" | "money";
type Col = { key: keyof Nums; label: string; kind: Kind; hint: string };

const COLS: Col[] = [
  { key: "orders", label: "הזמנות", kind: "n", hint: "כל ההזמנות בנקודה (בלי מבוטלות)" },
  { key: "paidOrders", label: "שולמו", kind: "n", hint: "הזמנות שנכנס בהן תשלום" },
  { key: "kgCarton", label: "משקל קרטונים", kind: "kg", hint: 'ק"ג שנשקלו בקרטונים' },
  { key: "kgSingles", label: "משקל בודדים", kind: "kg", hint: 'ק"ג שנשקלו בבודדים' },
  { key: "gross", label: "סך ברוטו", kind: "money", hint: "הסכום הצפוי מכל ההזמנות (בלי חוב קודם)" },
  { key: "netGoods", label: "סך נטו (סחורה)", kind: "money", hint: "ברוטו פחות דמי הזמנה ופחות עמלות הנציג" },
  { key: "fees", label: "דמי הזמנה", kind: "money", hint: "₪3 × כל ההזמנות — שייך למערכת" },
  { key: "commWeight", label: "עמלת נציג — משקל", kind: "money", hint: '₪1 לק"ג על כל המשקל' },
  { key: "commSingles", label: "עמלת נציג — בודדים", kind: "money", hint: '₪3 לק"ג על הבודדים (ובמועדפים — הפרש המחיר)' },
  { key: "commTotal", label: 'סה"כ עמלת נציג', kind: "money", hint: "משקל + בודדים" },
  { key: "cardReceived", label: "תשלום שהתקבל באשראי", kind: "money", hint: "כל מה שנכנס באשראי/העברה בנקודה" },
  { key: "cardForAgent", label: "אשראי — לחישוב לנציג", kind: "money", hint: "אשראי שהתקבל פחות דמי ההזמנה — הסכום שמקוזז לנציג" },
];

const show = (v: number, kind: Kind) =>
  kind === "money" ? fmt(v) : kind === "kg" ? v.toLocaleString("he-IL", { maximumFractionDigits: 3 }) : String(v);
const xl = (v: number) => String(Math.round(v * 100) / 100);
const r3 = (n: number) => Math.round(n * 1000) / 1000;

export function SheetView({ selected }: { selected: string }) {
  const [rows, setRows] = useState<SheetRow[] | null>(null);
  const [err, setErr] = useState("");
  const [copied, setCopied] = useState(false);
  const [detail, setDetail] = useState<{ col: Col; title: string; pointIds: string[]; cell: number } | null>(null);

  const load = useCallback(async () => {
    setRows(null);
    setErr("");
    try {
      const q = new URLSearchParams();
      applySaleSelection(q, selected);
      const r = await fetch(`/api/admin/agent-income/sheet?${q}`, { cache: "no-store" });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || `שגיאה (${r.status})`);
      setRows(d.rows);
    } catch (e: any) {
      setErr(e.message || "שגיאה");
      setRows([]);
    }
  }, [selected]);
  useEffect(() => {
    load();
  }, [load]);

  const total = (k: keyof Nums) => r3((rows ?? []).reduce((s, r) => s + (Number(r[k]) || 0), 0));

  async function copy() {
    const head = ["נקודה", "נציג", ...COLS.map((c) => c.label)];
    const lines = (rows ?? []).map((r) => [r.pointName, r.agentLabel, ...COLS.map((c) => xl(Number(r[c.key])))].join("\t"));
    const text = [head.join("\t"), ...lines].join("\n");
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      window.prompt("העתק ידנית (Ctrl+C):", text);
    }
  }

  if (err) return <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg p-2">{err}</p>;
  if (!rows) return <p className="text-zinc-500">טוען…</p>;
  if (rows.length === 0) return <p className="text-zinc-500">אין הזמנות במכירה הזו.</p>;
  const adminDebt = total("cardAdminDebt");
  const allIds = rows.map((r) => r.pointId);

  const Cell = ({ v, col, title, pointIds, bold }: { v: number; col: Col; title: string; pointIds: string[]; bold?: boolean }) => (
    <td
      dir="ltr"
      className={`p-2 text-left tabular-nums whitespace-nowrap ${
        col.key === "cardForAgent" ? (bold ? "" : "bg-yellow-100 font-extrabold") : ""
      }`}
    >
      {v === 0 ? (
        <span className="opacity-40">{show(v, col.kind)}</span>
      ) : (
        <button
          onClick={() => setDetail({ col, title, pointIds, cell: v })}
          className="underline decoration-dotted underline-offset-2 hover:text-brand-rust"
          title="לחץ לפירוט"
        >
          {show(v, col.kind)}
        </button>
      )}
    </td>
  );

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 flex-wrap">
        <p className="text-xs text-zinc-600 flex-1 min-w-[240px]">
          אותן עמודות של הגיליון. <b className="bg-yellow-200 px-1">העמודה הצהובה</b> = אשראי שהתקבל פחות
          דמי ההזמנה — הסכום שמקוזז לנציג. <b>כל מספר לחיץ</b> — נפתחות ההזמנות שמרכיבות אותו.
        </p>
        <button onClick={copy} className="btn-sm bg-emerald-600 text-white rounded-lg px-3 font-bold">
          {copied ? "✓ הועתק" : "📋 העתק לאקסל"}
        </button>
      </div>
      <div className="bg-white border border-zinc-200 rounded-xl overflow-x-auto">
        <table className="w-full text-sm min-w-[1280px]">
          <thead className="bg-zinc-50 text-zinc-600 text-xs">
            <tr>
              <th className="text-right p-2">נקודה</th>
              {COLS.map((c) => (
                <th
                  key={c.key}
                  title={c.hint}
                  className={`p-2 text-left whitespace-nowrap cursor-help ${
                    c.key === "cardForAgent" ? "bg-yellow-200 text-zinc-900" : ""
                  }`}
                >
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.pointId} className="border-t border-zinc-100">
                <td className="p-2">
                  <div className="font-bold text-brand-slatedark">{r.pointName}</div>
                  <div className="text-[11px] text-zinc-500">{r.agentLabel}</div>
                </td>
                {COLS.map((c) => (
                  <Cell key={c.key} v={Number(r[c.key])} col={c} title={r.pointName} pointIds={[r.pointId]} />
                ))}
              </tr>
            ))}
            <tr className="bg-brand-slatedark text-white font-bold">
              <td className="p-2">סה&quot;כ</td>
              {COLS.map((c) => (
                <Cell key={c.key} v={total(c.key)} col={c} title="כל הנקודות" pointIds={allIds} bold />
              ))}
            </tr>
          </tbody>
        </table>
      </div>
      {adminDebt > 0 && (
        <p className="text-xs text-zinc-500">
          בעמודה הצהובה ירדו גם {fmt(adminDebt)} של חוב שהמנהל רשם ונגבה באשראי — הכסף הזה לא של הנציג.
        </p>
      )}
      {detail && (
        <CellDetail
          selected={selected}
          col={detail.col}
          title={detail.title}
          pointIds={detail.pointIds}
          cell={detail.cell}
          onClose={() => setDetail(null)}
        />
      )}
    </div>
  );
}

/** איך כל הזמנה הגיעה למספר שלה — לעמודות שמחושבות מעמודות אחרות */
function formula(col: keyof Nums, o: OrderRow): string | null {
  switch (col) {
    case "netGoods":
      return `${fmt(o.gross)} − ${fmt(o.fees)} דמי הזמנה − ${fmt(o.commTotal)} עמלה`;
    case "commTotal":
      return `${fmt(o.commWeight)} משקל + ${fmt(o.commSingles)} בודדים`;
    case "commWeight":
      return `${r3(o.kgCarton + o.kgSingles)} ק"ג`;
    case "commSingles":
      return `${o.kgSingles} ק"ג בודדים`;
    case "cardForAgent":
      return `${fmt(o.cardReceived)} אשראי − ${fmt(o.fees)} דמי הזמנה${o.cardAdminDebt > 0 ? ` − ${fmt(o.cardAdminDebt)} חוב של המנהל` : ""}`;
    default:
      return null;
  }
}

function CellDetail({
  selected,
  col,
  title,
  pointIds,
  cell,
  onClose,
}: {
  selected: string;
  col: Col;
  title: string;
  pointIds: string[];
  cell: number;
  onClose: () => void;
}) {
  const [orders, setOrders] = useState<OrderRow[] | null>(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    const q = new URLSearchParams();
    applySaleSelection(q, selected);
    q.set("pointIds", pointIds.join(","));
    fetch(`/api/admin/agent-income/sheet?${q}`, { cache: "no-store" })
      .then(async (r) => {
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(j.error || `שגיאה (${r.status})`);
        setOrders(j.orders ?? []);
      })
      .catch((e) => setErr(e.message || "שגיאה"));
  }, [selected, pointIds]);

  // "הזמנות" — כולן; כל עמודה אחרת — רק הזמנות שתורמות לה
  const list = (orders ?? []).filter((o) => col.key === "orders" || Number(o[col.key]) !== 0);
  const sum = r3(list.reduce((s, o) => s + Number(o[col.key]), 0));
  const unpaid = col.key === "paidOrders" ? (orders ?? []).filter((o) => o.paidOrders === 0) : [];

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-start justify-center p-3 overflow-y-auto" onClick={onClose}>
      <div className="bg-white rounded-2xl w-full max-w-2xl p-4 my-6" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-2">
          <div>
            <h2 className="font-extrabold text-brand-slatedark">
              {col.label} — {title}
            </h2>
            <p className="text-xs text-zinc-500 mt-0.5">{col.hint}</p>
          </div>
          <button onClick={onClose} className="text-zinc-500 text-xl leading-none px-2">
            ×
          </button>
        </div>

        {err && <p className="text-sm text-red-700 mt-3">{err}</p>}
        {!orders && !err && <p className="text-zinc-500 mt-4">טוען…</p>}
        {orders && (
          <>
            <div className="mt-3 divide-y divide-zinc-100 border border-zinc-200 rounded-xl max-h-[60vh] overflow-y-auto">
              {list.length === 0 && <div className="p-3 text-sm text-zinc-500">אין הזמנות.</div>}
              {list.map((o) => {
                const f = formula(col.key, o);
                return (
                  <div key={o.orderNumber} className="flex items-center gap-2 p-2.5 text-sm">
                    <div className="flex-1 min-w-0">
                      <div className="truncate">
                        <b>{o.customerName}</b> <span className="text-zinc-400">#{o.orderNumber}</span>
                        {pointIds.length > 1 && <span className="text-xs text-zinc-400"> · {o.pointName}</span>}
                      </div>
                      {f && <div className="text-[11px] text-zinc-500" dir="rtl">{f}</div>}
                    </div>
                    {col.key !== "orders" && col.key !== "paidOrders" && (
                      <span className="font-bold tabular-nums" dir="ltr">
                        {show(Number(o[col.key]), col.kind)}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
            {unpaid.length > 0 && (
              <div className="mt-2 text-xs text-zinc-600">
                <b>לא שולמו ({unpaid.length}):</b> {unpaid.map((o) => `${o.customerName} #${o.orderNumber}`).join(" · ")}
              </div>
            )}
            <div className="mt-3 rounded-xl bg-zinc-50 border border-zinc-200 p-3 text-sm flex justify-between">
              <span>{list.length} הזמנות</span>
              <span className="font-extrabold tabular-nums" dir="ltr">
                {show(col.key === "orders" || col.key === "paidOrders" ? list.length : sum, col.kind)}
              </span>
            </div>
            {Math.abs((col.key === "orders" || col.key === "paidOrders" ? list.length : sum) - cell) > 0.01 && (
              <p className="text-xs text-red-700 font-bold mt-2">⚠️ הסכום לא תואם לתא ({show(cell, col.kind)}) — רענן את המסך.</p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
