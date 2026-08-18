"use client";

// §113: מסך מצב המכירה.
//
// ═══════════════════════════════════════════════════════════════
// מה זה פותר
// ═══════════════════════════════════════════════════════════════
// למנהל היו מסכים לכל *פעולה* (הזמנות, תשלומים, שקילות), אבל שום
// מסך לא ענה על שתי השאלות הבסיסיות:
//
//   1. "איפה המכירה עומדת עכשיו, ומה הצעד הבא?"
//   2. "קניתי X, חילקתי Y, גביתי Z - מה נשאר, ואיפה נעלם משקל?"
//
// השנייה היא הקריטית: כל שלב בנפרד נראה תקין, והפער מתגלה רק
// בהשוואה. מוצר שהגיעו ממנו 120 ק"ג וחולקו 104 נראה תקין בכל מסך
// אחר במערכת.

import { use, useEffect, useState } from "react";
import { api } from "@/lib/client";
import { fmt } from "@/lib/pricing";

type Row = {
  productId: string;
  productName: string;
  cartonsOrdered: number | null;
  cartonsReceived: number;
  weightReceived: number;
  weightDistributed: number;
  diff: number;
  diffPercent: number | null;
  costPerKg: number | null;
  totalCost: number | null;
  revenue: number;
};

type Data = {
  pricelist: {
    id: string;
    name: string;
    status: string;
    agentOnly: boolean;
    deliveryDateText: string | null;
  };
  stage: { key: string; label: string; action: string | null; index: number };
  counts: {
    orders: number;
    missingWeights: number;
    unpaidOrders: number;
    products: number;
    deliveredProducts: number;
  };
  rows: Row[];
  totals: {
    weightReceived: number;
    weightDistributed: number;
    diff: number;
    diffPercent: number | null;
    cost: number;
    revenue: number;
    margin: number;
    marginReliable: boolean;
  };
};

const STAGES = [
  "טיוטה",
  "מקבלת הזמנות",
  "לתכנון הזמנה",
  "ממתינה לסחורה",
  "בחלוקה",
  "לחיוב",
  "הושלמה",
];

function severity(p: number | null): "ok" | "warn" | "bad" {
  if (p === null) return "ok";
  const a = Math.abs(p);
  if (a <= 2) return "ok";
  if (a <= 5) return "warn";
  return "bad";
}

export default function SaleStatusPage({
  params,
}: {
  // ⚠️ Next 15: params הוא Promise גם ב-client component.
  // use() פותח אותו - הדפוס הנתמך במקום await בקומפוננטה.
  params: Promise<{ pricelistId: string }>;
}) {
  const { pricelistId } = use(params);
  const [data, setData] = useState<Data | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [costDraft, setCostDraft] = useState<Record<string, string>>({});
  const [savingId, setSavingId] = useState<string | null>(null);

  async function load() {
    try {
      const d = await api(`/api/admin/sale-status/${pricelistId}`);
      setData(d);
      setError("");
    } catch (e: any) {
      setError(e.message || "שגיאה בטעינה");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pricelistId]);

  async function saveCost(productId: string) {
    setSavingId(productId);
    setError("");
    try {
      const res = await fetch(`/api/admin/sale-status/${pricelistId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          productId,
          costPerKg: costDraft[productId] === "" ? null : costDraft[productId],
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "שגיאה");
      await load();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSavingId(null);
    }
  }

  if (loading) return <main className="p-6 text-zinc-500">טוען…</main>;
  if (!data) return <main className="p-6 text-red-600">{error || "לא נמצא"}</main>;

  const t = data.totals;
  const sev = severity(t.diffPercent);

  return (
    <main dir="rtl" className="p-4 sm:p-6 max-w-6xl mx-auto space-y-5">
      <div>
        <h1 className="text-2xl font-extrabold text-brand-slatedark">
          {data.pricelist.name}
        </h1>
        <div className="flex items-center gap-2 flex-wrap mt-1">
          {data.pricelist.agentOnly && (
            <span className="text-[11px] font-bold bg-amber-100 text-amber-800 border border-amber-300 rounded px-2 py-0.5">
              🧑‍💼 נציגים בלבד
            </span>
          )}
          {data.pricelist.deliveryDateText && (
            <span className="text-sm text-zinc-500">
              חלוקה: {data.pricelist.deliveryDateText}
            </span>
          )}
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-300 text-red-800 rounded-lg p-3 text-sm">
          {error}
        </div>
      )}

      {/* ─── ציר השלבים ─── */}
      <div className="card p-5">
        <p className="text-xs font-bold text-zinc-500 mb-3">שלב המכירה</p>
        <div className="flex items-center gap-1 mb-4">
          {STAGES.map((label, i) => (
            <div key={label} className="flex items-center flex-1 min-w-0">
              <div className="flex flex-col items-center flex-1 min-w-0">
                <div
                  className={`w-7 h-7 rounded-full grid place-items-center text-xs font-bold shrink-0 ${
                    i < data.stage.index
                      ? "bg-emerald-500 text-white"
                      : i === data.stage.index
                        ? "bg-amber-100 text-amber-700 ring-2 ring-amber-400"
                        : "bg-zinc-200 text-zinc-400"
                  }`}
                >
                  {i < data.stage.index ? "✓" : i + 1}
                </div>
                <span
                  className={`text-[9px] sm:text-[10px] mt-1 text-center leading-tight ${
                    i === data.stage.index
                      ? "text-amber-800 font-bold"
                      : i < data.stage.index
                        ? "text-emerald-700"
                        : "text-zinc-400"
                  }`}
                >
                  {label}
                </span>
              </div>
              {i < STAGES.length - 1 && (
                <div
                  className={`h-0.5 flex-1 -mt-4 ${
                    i < data.stage.index ? "bg-emerald-400" : "bg-zinc-200"
                  }`}
                />
              )}
            </div>
          ))}
        </div>

        {data.stage.action && (
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
            <div className="text-xs font-bold text-amber-900 mb-0.5">הצעד הבא</div>
            <div className="text-sm text-amber-800">{data.stage.action}</div>
          </div>
        )}

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-3 text-center">
          <Stat label="הזמנות" value={String(data.counts.orders)} />
          <Stat
            label="משקלים חסרים"
            value={String(data.counts.missingWeights)}
            bad={data.counts.missingWeights > 0}
          />
          <Stat
            label="ממתינות לחיוב"
            value={String(data.counts.unpaidOrders)}
            bad={data.counts.unpaidOrders > 0}
          />
          <Stat
            label="מוצרים שנקלטו"
            value={`${data.counts.deliveredProducts}/${data.counts.products}`}
          />
        </div>
      </div>

      {/* ─── סיכום כספי ─── */}
      <div className="card p-5">
        <p className="text-xs font-bold text-zinc-500 mb-3">סיכום כספי ומשקלי</p>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <Box label="נקלט מהספק" value={`${t.weightReceived.toFixed(1)} ק"ג`} />
          <Box label="חולק ללקוחות" value={`${t.weightDistributed.toFixed(1)} ק"ג`} />
          <Box
            label="פער משקל"
            value={`${t.diff.toFixed(1)} ק"ג${
              t.diffPercent !== null ? ` (${t.diffPercent.toFixed(1)}%)` : ""
            }`}
            tone={sev}
          />
          <Box
            label="מרווח"
            value={fmt(t.margin)}
            sub={
              t.marginReliable
                ? `${fmt(t.revenue)} פחות ${fmt(t.cost)}`
                : "⚠️ חלקי — חסרה עלות לחלק מהמוצרים"
            }
            tone={t.marginReliable ? "ok" : "warn"}
          />
        </div>

        {/* ⚠️ ההסבר הזה חשוב: המנהל רואה מספר ועלול להסיק שגנבו
            ממנו, כשבפועל פחת של אחוז-שניים הוא נורמלי בבשר. */}
        {sev !== "ok" && (
          <p className="text-xs text-zinc-600 mt-3 bg-zinc-50 border border-zinc-200 rounded-lg p-2.5 leading-relaxed">
            פער בין מה שנקלט למה שחולק נובע בדרך כלל מפחת טבעי (נוזלים,
            ניקוי) ואינו חריג עד כ-2%. פער גדול מזה מצדיק בדיקה: ייתכן
            שסחורה לא הגיעה, שמשקל לא הוזן, או שנפלה טעות בשקילה.
          </p>
        )}
      </div>

      {/* ─── פירוט לפי מוצר ─── */}
      <div className="card p-0 overflow-hidden">
        <div className="p-4 pb-2">
          <p className="text-xs font-bold text-zinc-500">התאמה לפי מוצר</p>
          <p className="text-[11px] text-zinc-400 mt-0.5">
            הנתונים נקלטים מתעודות המשלוח המאושרות. כאן משלימים את העלות
            לק&quot;ג כדי לחשב רווח.
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-zinc-50 border-y border-zinc-200">
              <tr className="text-[11px] text-zinc-600">
                <th className="text-right p-2.5">מוצר</th>
                <th className="p-2.5">קרטונים</th>
                <th className="p-2.5">נקלט ק&quot;ג</th>
                <th className="p-2.5">חולק ק&quot;ג</th>
                <th className="p-2.5">פער</th>
                <th className="p-2.5">עלות לק&quot;ג</th>
                <th className="p-2.5">נגבה</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((r) => {
                const s = severity(r.diffPercent);
                const notReceived = r.weightReceived === 0;
                return (
                  <tr
                    key={r.productId}
                    className={`border-b border-zinc-100 ${
                      notReceived ? "bg-zinc-50/60" : ""
                    }`}
                  >
                    <td className="p-2.5 font-medium text-brand-slatedark">
                      {r.productName}
                    </td>
                    <td className="p-2.5 text-center text-xs text-zinc-600">
                      {r.cartonsReceived}
                      {r.cartonsOrdered != null && (
                        <span className="text-zinc-400">
                          {" "}
                          / {r.cartonsOrdered}
                        </span>
                      )}
                    </td>
                    <td className="p-2.5 text-center">
                      {notReceived ? (
                        <span className="text-[11px] text-zinc-400">טרם נקלט</span>
                      ) : (
                        r.weightReceived.toFixed(1)
                      )}
                    </td>
                    <td className="p-2.5 text-center">
                      {r.weightDistributed.toFixed(1)}
                    </td>
                    <td
                      className={`p-2.5 text-center font-bold text-xs ${
                        notReceived
                          ? "text-zinc-300"
                          : s === "bad"
                            ? "text-red-700"
                            : s === "warn"
                              ? "text-amber-700"
                              : "text-emerald-700"
                      }`}
                    >
                      {notReceived
                        ? "—"
                        : `${r.diff.toFixed(1)}${
                            r.diffPercent !== null
                              ? ` (${r.diffPercent.toFixed(1)}%)`
                              : ""
                          }`}
                    </td>
                    <td className="p-2.5 text-center">
                      <div className="flex items-center gap-1 justify-center">
                        <input
                          type="number"
                          step="0.01"
                          min={0}
                          dir="ltr"
                          disabled={notReceived}
                          placeholder={r.costPerKg != null ? String(r.costPerKg) : "—"}
                          value={costDraft[r.productId] ?? ""}
                          onChange={(e) =>
                            setCostDraft({
                              ...costDraft,
                              [r.productId]: e.target.value,
                            })
                          }
                          onBlur={() => {
                            if (costDraft[r.productId] !== undefined)
                              saveCost(r.productId);
                          }}
                          className={`w-20 text-center rounded border px-1 py-1 text-xs ${
                            r.costPerKg != null
                              ? "border-emerald-300 bg-emerald-50"
                              : "border-zinc-300"
                          } disabled:opacity-40`}
                        />
                        {savingId === r.productId && (
                          <span className="text-[10px] text-zinc-400">…</span>
                        )}
                      </div>
                    </td>
                    <td className="p-2.5 text-center text-xs font-bold text-brand-rust">
                      {fmt(r.revenue)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </main>
  );
}

function Stat({ label, value, bad }: { label: string; value: string; bad?: boolean }) {
  return (
    <div className="bg-zinc-50 rounded-lg p-2">
      <div className={`text-lg font-extrabold ${bad ? "text-red-700" : "text-brand-slatedark"}`}>
        {value}
      </div>
      <div className="text-[10px] text-zinc-500">{label}</div>
    </div>
  );
}

function Box({
  label,
  value,
  sub,
  tone = "ok",
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "ok" | "warn" | "bad";
}) {
  const cls =
    tone === "bad"
      ? "border-red-300 bg-red-50 text-red-800"
      : tone === "warn"
        ? "border-amber-300 bg-amber-50 text-amber-800"
        : "border-zinc-200 bg-white text-brand-slatedark";
  return (
    <div className={`border-2 rounded-xl p-3 ${cls}`}>
      <div className="text-[11px] opacity-70">{label}</div>
      <div className="text-lg font-extrabold mt-0.5">{value}</div>
      {sub && <div className="text-[10px] mt-0.5 opacity-80">{sub}</div>}
    </div>
  );
}
