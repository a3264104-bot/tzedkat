"use client";

// ═══════════════════════════════════════════════════════════════
// §385: סגירת מכירה — השער
// ═══════════════════════════════════════════════════════════════
// /admin/sale-close/[pricelistId]
//
// אי אפשר לסגור עם חורים. כל הזמנה תלויה מקבלת דרך אחת: לחייב,
// או להעביר לחוב — ואז היא תיגבה במכירה הבאה אוטומטית (§263).

import { useEffect, useState, use } from "react";

type Hole = {
  id: string;
  orderNumber: number;
  customerName: string;
  pointName: string | null;
  finalTotal: number | null;
  amountPaid: number;
  remaining: number;
  reason: string;
  kind: "UNPAID" | "PARTIAL" | "CARD_FAILED" | "MISSING_WEIGHTS";
};

type Data = {
  pricelist: { id: string; name: string; status: string };
  total: number;
  paid: number;
  holes: Hole[];
  holesSum: number;
  canClose: boolean;
};

const KIND: Record<Hole["kind"], { label: string; cls: string; canDebt: boolean }> = {
  UNPAID: { label: "לא חויב", cls: "text-amber-700 bg-amber-50 border-amber-200", canDebt: true },
  PARTIAL: { label: "תשלום חלקי", cls: "text-orange-700 bg-orange-50 border-orange-200", canDebt: true },
  CARD_FAILED: { label: "כרטיס נכשל", cls: "text-red-700 bg-red-50 border-red-200", canDebt: true },
  MISSING_WEIGHTS: { label: "משקלים חסרים", cls: "text-zinc-600 bg-zinc-100 border-zinc-300", canDebt: false },
};

export default function SaleClosePage({
  params,
}: {
  params: Promise<{ pricelistId: string }>;
}) {
  const { pricelistId } = use(params);
  const [data, setData] = useState<Data | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<"debt" | "close" | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const load = () =>
    fetch(`/api/admin/sale-close/${pricelistId}`, { cache: "no-store" })
      .then((r) => r.json())
      .then(setData)
      .catch(() => setData(null));

  useEffect(() => {
    load();
  }, [pricelistId]);

  const fmt = (n: number) => `₪${n.toFixed(2)}`;
  const debtable = data?.holes.filter((h) => KIND[h.kind].canDebt) ?? [];
  const selectedSum = debtable
    .filter((h) => selected.has(h.id))
    .reduce((s, h) => s + h.remaining, 0);

  async function toDebt() {
    if (selected.size === 0) return;
    if (
      !window.confirm(
        `להעביר ${selected.size} יתרות לחוב הלקוחות?\n\nסה"כ ${fmt(selectedSum)}\n\nהחוב ייגבה אוטומטית בהזמנה הבאה של כל לקוח.`
      )
    )
      return;
    setBusy("debt");
    setMsg(null);
    try {
      const res = await fetch(`/api/admin/sale-close/${pricelistId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "TO_DEBT", orderIds: Array.from(selected) }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || `שגיאה (${res.status})`);
      setMsg(`✓ ${d.moved} יתרות (${fmt(d.sum)}) הועברו לחוב`);
      setSelected(new Set());
      await load();
    } catch (e: any) {
      setMsg(e?.message || "שגיאה");
    } finally {
      setBusy(null);
    }
  }

  async function close() {
    if (!data?.canClose) return;
    if (
      !window.confirm(
        `לסגור את "${data.pricelist.name}" סופית?\n\nאחרי הסגירה לא ניתן לערוך הזמנות במכירה זו.`
      )
    )
      return;
    setBusy("close");
    setMsg(null);
    try {
      const res = await fetch(`/api/admin/sale-close/${pricelistId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "CLOSE" }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || `שגיאה (${res.status})`);
      setMsg("✓ המכירה נסגרה");
      await load();
    } catch (e: any) {
      setMsg(e?.message || "שגיאה");
    } finally {
      setBusy(null);
    }
  }

  if (!data) {
    return <main dir="rtl" className="p-6 text-zinc-500">טוען...</main>;
  }

  const isDone = data.pricelist.status === "DONE";

  return (
    <main dir="rtl" className="max-w-3xl mx-auto p-4 space-y-4">
      <div>
        <a href="/admin" className="text-xs text-zinc-500 hover:text-brand-rust">
          ← דשבורד
        </a>
        <h1 className="text-2xl font-extrabold text-brand-slatedark mt-1">
          🔒 סגירת מכירה — {data.pricelist.name}
        </h1>
        <p className="text-sm text-zinc-500 mt-1">
          {data.paid} מתוך {data.total} הזמנות שולמו
          {isDone && <span className="text-emerald-700 font-bold"> · ✓ סגורה</span>}
        </p>
      </div>

      {/* המצב */}
      {data.canClose ? (
        <div className="rounded-xl border-2 border-emerald-300 bg-emerald-50 p-4">
          <div className="font-extrabold text-emerald-900">✅ אין הזמנות פתוחות</div>
          <p className="text-sm text-emerald-800 mt-1">
            כל ההזמנות שולמו או הועברו לחוב. אפשר לסגור.
          </p>
        </div>
      ) : (
        <div className="rounded-xl border-2 border-amber-300 bg-amber-50 p-4">
          <div className="font-extrabold text-amber-900">
            ⚠️ {data.holes.length} הזמנות פתוחות · {fmt(data.holesSum)}
          </div>
          <p className="text-sm text-amber-800 mt-1">
            לכל אחת יש שתי דרכים: לחייב (במסך התשלומים), או להעביר
            את היתרה לחוב הלקוח — ואז היא תיגבה במכירה הבאה.
          </p>
        </div>
      )}

      {/* הרשימה */}
      {data.holes.length > 0 && (
        <div className="card p-4">
          <div className="flex items-center justify-between gap-2 mb-3 flex-wrap">
            <h2 className="font-bold text-brand-slatedark">הזמנות פתוחות</h2>
            <div className="flex gap-2">
              <button
                onClick={() => setSelected(new Set(debtable.map((h) => h.id)))}
                className="text-xs text-zinc-500 underline"
              >
                בחר הכל
              </button>
              <a
                href="/admin/payments"
                className="text-xs font-bold text-brand-rust hover:underline"
              >
                לחיוב ←
              </a>
            </div>
          </div>

          <div className="space-y-1.5">
            {data.holes.map((h) => {
              const k = KIND[h.kind];
              const on = selected.has(h.id);
              return (
                <label
                  key={h.id}
                  className={`flex items-center gap-3 p-2 rounded-lg border ${
                    on ? "border-brand-rust bg-brand-rust/5" : "border-zinc-100"
                  } ${k.canDebt ? "cursor-pointer" : "opacity-60"}`}
                >
                  <input
                    type="checkbox"
                    checked={on}
                    disabled={!k.canDebt || busy !== null}
                    onChange={() =>
                      setSelected((p) => {
                        const n = new Set(p);
                        if (n.has(h.id)) n.delete(h.id);
                        else n.add(h.id);
                        return n;
                      })
                    }
                  />
                  <div className="flex-1 min-w-0">
                    <div className="font-bold text-sm text-brand-slatedark truncate">
                      {h.customerName}
                      <span className="font-normal text-zinc-400"> #{h.orderNumber}</span>
                      {h.pointName && (
                        <span className="font-normal text-zinc-400 text-xs"> · {h.pointName}</span>
                      )}
                    </div>
                    <div className="text-[11px] text-zinc-500">{h.reason}</div>
                  </div>
                  <div className="text-left shrink-0">
                    <div className="font-bold tabular-nums text-brand-rust">{fmt(h.remaining)}</div>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded border ${k.cls}`}>
                      {k.label}
                    </span>
                  </div>
                </label>
              );
            })}
          </div>

          {/* ⚠️ משקלים חסרים — לא ניתן להעביר לחוב. חייב לשקול. */}
          {data.holes.some((h) => h.kind === "MISSING_WEIGHTS") && (
            <p className="text-[11px] text-zinc-500 mt-2">
              ⚠️ הזמנות עם משקלים חסרים — אין סכום להעביר. יש להשלים
              שקילה ב-<a href="/admin/pending-weights" className="underline">משקלים ממתינים</a>.
            </p>
          )}

          {selected.size > 0 && (
            <div className="mt-3 pt-3 border-t border-zinc-200 flex items-center justify-between gap-2">
              <span className="text-sm">
                <b>{selected.size}</b> נבחרו · {fmt(selectedSum)}
              </span>
              <button
                onClick={toDebt}
                disabled={busy !== null}
                className="px-4 py-2 rounded-xl bg-red-700 text-white text-sm font-bold disabled:opacity-40"
              >
                {busy === "debt" ? "..." : "💸 העבר לחוב"}
              </button>
            </div>
          )}
        </div>
      )}

      {msg && (
        <p className={`text-sm font-bold text-center ${msg.startsWith("✓") ? "text-emerald-700" : "text-red-600"}`}>
          {msg}
        </p>
      )}

      {/* הסגירה */}
      {!isDone && (
        <button
          onClick={close}
          disabled={!data.canClose || busy !== null}
          className="w-full py-3.5 rounded-xl bg-brand-slatedark text-white font-extrabold disabled:opacity-40"
        >
          {busy === "close" ? "סוגר..." : data.canClose ? "🔒 סגור מכירה" : `🔒 סגור מכירה (${data.holes.length} פתוחות)`}
        </button>
      )}
    </main>
  );
}
