"use client";

// 📋 "כמו באקסל" — אותן עמודות ואותו סדר של הגיליון שהמנהל עובד איתו.
// העמודה הצהובה (אשראי לחישוב לנציג) היא הסכום שהמנהל מקזז לנציג.

import { useCallback, useEffect, useState } from "react";
import { fmt } from "@/lib/pricing";
import { applySaleSelection } from "@/components/useSelectedPricelist";

type SheetRow = {
  pointId: string;
  pointName: string;
  agentLabel: string;
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

const COLS: { key: keyof SheetRow; label: string; kind: "n" | "kg" | "money"; hint: string }[] = [
  { key: "orders", label: "הזמנות", kind: "n", hint: "כל ההזמנות בנקודה (בלי מבוטלות)" },
  { key: "paidOrders", label: "שולמו", kind: "n", hint: "הזמנות שנכנס בהן תשלום" },
  { key: "kgCarton", label: "משקל קרטונים", kind: "kg", hint: 'ק"ג שנשקלו בקרטונים' },
  { key: "kgSingles", label: "משקל בודדים", kind: "kg", hint: 'ק"ג שנשקלו בבודדים' },
  { key: "gross", label: "סך ברוטו", kind: "money", hint: "הסכום הצפוי מכל ההזמנות (בלי חוב קודם)" },
  { key: "netGoods", label: "סך נטו (סחורה)", kind: "money", hint: "ברוטו פחות דמי הזמנה ופחות עמלות הנציג" },
  { key: "fees", label: "דמי הזמנה", kind: "money", hint: "₪3 × כל ההזמנות — שייך למערכת" },
  { key: "commWeight", label: "עמלת נציג — משקל", kind: "money", hint: "₪1 לק\"ג על כל המשקל" },
  { key: "commSingles", label: "עמלת נציג — בודדים", kind: "money", hint: "₪3 לק\"ג על הבודדים (ובמועדפים — הפרש המחיר)" },
  { key: "commTotal", label: 'סה"כ עמלת נציג', kind: "money", hint: "משקל + בודדים" },
  { key: "cardReceived", label: "תשלום שהתקבל באשראי", kind: "money", hint: "כל מה שנכנס באשראי/העברה בנקודה" },
  { key: "cardForAgent", label: "אשראי — לחישוב לנציג", kind: "money", hint: "אשראי שהתקבל פחות דמי ההזמנה — הסכום שמקוזז לנציג" },
];

const show = (v: number, kind: "n" | "kg" | "money") =>
  kind === "money" ? fmt(v) : kind === "kg" ? v.toLocaleString("he-IL", { maximumFractionDigits: 2 }) : String(v);
const xl = (v: number) => String(Math.round(v * 100) / 100);

export function SheetView({ selected }: { selected: string }) {
  const [rows, setRows] = useState<SheetRow[] | null>(null);
  const [err, setErr] = useState("");
  const [copied, setCopied] = useState(false);

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

  const total = (k: keyof SheetRow) =>
    Math.round((rows ?? []).reduce((s, r) => s + (Number(r[k]) || 0), 0) * 1000) / 1000;

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

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 flex-wrap">
        <p className="text-xs text-zinc-600 flex-1 min-w-[240px]">
          אותן עמודות של הגיליון. <b className="bg-yellow-200 px-1">העמודה הצהובה</b> = אשראי שהתקבל פחות
          דמי ההזמנה — הסכום שמקוזז לנציג. ריחוף על כותרת מסביר איך היא מחושבת.
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
                  <td
                    key={c.key}
                    dir="ltr"
                    className={`p-2 text-left tabular-nums whitespace-nowrap ${
                      c.key === "cardForAgent" ? "bg-yellow-100 font-extrabold" : ""
                    }`}
                    title={
                      c.key === "cardForAgent" && r.cardAdminDebt > 0
                        ? `כולל הורדה של ${fmt(r.cardAdminDebt)} — חוב של המנהל שנגבה באשראי`
                        : undefined
                    }
                  >
                    {show(Number(r[c.key]), c.kind)}
                  </td>
                ))}
              </tr>
            ))}
            <tr className="bg-brand-slatedark text-white font-bold">
              <td className="p-2">סה&quot;כ</td>
              {COLS.map((c) => (
                <td key={c.key} dir="ltr" className="p-2 text-left tabular-nums whitespace-nowrap">
                  {show(total(c.key), c.kind)}
                </td>
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
    </div>
  );
}
