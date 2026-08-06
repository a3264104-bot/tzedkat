"use client";

// דשבורד ניהול - ממוקד במכירה אחת בכל רגע.
//
// למה: כשיש עשרות מכירות, נתונים מצטברים על כולן חסרי משמעות ("5 הזמנות" - של מה?).
// לכן הדשבורד תמיד מוצג בהקשר של מכירה נבחרת (ברירת מחדל: המכירה הפעילה),
// וכל המספרים והפאנלים מסוננים אליה.
//
// 🐛 תוקן: הכרטיס "חדשות" ופאנל "הזמנות חדשות" הסתמכו על סטטוס "NEW" שלא
// קיים יותר (הוחלף ב-PENDING_REVIEW ב-/api/orders). לכן הם תמיד הציגו 0/ריק.

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { api } from "@/lib/client";
import { fmt, STATUS_LABELS } from "@/lib/pricing";

type Pricelist = {
  id: string;
  name: string;
  status: string;
  _count?: { orders: number };
};

// ברירת מחדל לבורר: "כל המכירות"
const ALL = "__all__";

export default function Dashboard() {
  const [lists, setLists] = useState<Pricelist[] | null>(null);
  const [selected, setSelected] = useState<string>("");
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  // טעינת רשימת המכירות + בחירת ברירת המחדל (המכירה הפעילה)
  useEffect(() => {
    api("/api/admin/pricelists")
      .then((res: Pricelist[]) => {
        setLists(res);
        // ברירת מחדל: המכירה הפעילה. אם אין - המכירה האחרונה שנוצרה.
        const active = res.find((l) => l.status === "ACTIVE");
        setSelected(active?.id ?? res[0]?.id ?? ALL);
      })
      .catch((e) => setErr(e.message));
  }, []);

  // טעינת הנתונים לפי המכירה הנבחרת
  const load = useCallback((pricelistId: string) => {
    if (!pricelistId) return;
    setLoading(true);
    setErr("");
    const qs = pricelistId === ALL ? "" : `?pricelistId=${encodeURIComponent(pricelistId)}`;
    api(`/api/admin/reports${qs}`)
      .then(setData)
      .catch((e) => setErr(e.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (selected) load(selected);
  }, [selected, load]);

  const currentList = lists?.find((l) => l.id === selected) ?? null;

  if (err) {
    return (
      <div className="card p-5 border-red-200 bg-red-50">
        <p className="font-bold text-red-800">לא ניתן לטעון את הנתונים</p>
        <p className="text-sm text-red-700 mt-1">{err}</p>
        <button onClick={() => load(selected)} className="btn-ghost btn-sm mt-3">
          נסה שוב
        </button>
      </div>
    );
  }

  // ספירות לפי סטטוס - מקור אמת לפאנל "מה הצעד הבא"
  const sc: Record<string, number> = data?.statusCounts ?? {};
  const waitingWeigh = sc.PENDING_REVIEW ?? 0;
  const priceSet = sc.FINAL_PRICE_SET ?? 0;
  const waitingPay = sc.PAYMENT_PENDING ?? 0;
  const paid = sc.PAID ?? 0;
  const readyPickup = sc.READY_FOR_PICKUP ?? 0;

  return (
    <div className="space-y-6">
      {/* ─── כותרת + בורר מכירה ─── */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold text-brand-slatedark">דשבורד</h1>
          <p className="text-sm text-brand-slate/60 mt-0.5">
            {selected === ALL
              ? "מציג נתונים מכל המכירות"
              : currentList
                ? `מציג את המכירה: ${currentList.name}`
                : "בחר מכירה"}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <label htmlFor="sale-picker" className="text-sm font-bold text-brand-slatedark">
            מכירה
          </label>
          <select
            id="sale-picker"
            value={selected}
            onChange={(e) => setSelected(e.target.value)}
            disabled={!lists}
            className="input py-2 px-3 text-sm w-56"
          >
            {!lists && <option>טוען...</option>}
            {lists?.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
                {l.status === "ACTIVE" ? " • פעילה" : ""}
              </option>
            ))}
            <option value={ALL}>— כל המכירות —</option>
          </select>
        </div>
      </div>

      {loading && <p className="text-zinc-500 text-sm">טוען נתונים...</p>}

      {data && (
        <>
          {/* ─── מספרי מפתח ─── */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Stat label="הזמנות" value={String(data.totalOrders)} />
            <Stat label="סכום משוער" value={fmt(data.estimatedSales)} />
            <Stat label="סכום סופי" value={fmt(data.finalSales)} />
            <Stat label="ממתינות לשקילה" value={String(waitingWeigh)} accent={waitingWeigh > 0} />
          </div>

          {/* ─── מה הצעד הבא ─── */}
          <div className="card p-5">
            <h2 className="font-bold text-brand-slatedark mb-1">מה הצעד הבא</h2>
            <p className="text-xs text-brand-slate/60 mb-3">
              לפי מצב ההזמנות במכירה הזו
            </p>
            <div className="space-y-1.5">
              <NextAction
                count={waitingWeigh}
                label="הזמנות ממתינות לשקילה והזנת מחיר סופי"
                href="/admin/pending-weights"
                cta="להזנת משקלים"
              />
              <NextAction
                count={priceSet}
                label="הזמנות עם מחיר סופי — מוכנות לחיוב"
                href="/admin/payments"
                cta="למסך תשלומים"
              />
              <NextAction
                count={waitingPay}
                label="הזמנות ממתינות לתשלום"
                href="/admin/payments"
                cta="למסך תשלומים"
              />
              <NextAction
                count={paid}
                label="הזמנות ששולמו — אפשר לסמן מוכנות לחלוקה"
                href="/admin/orders"
                cta="לרשימת ההזמנות"
              />
              <NextAction
                count={readyPickup}
                label="הזמנות מוכנות לחלוקה"
                href="/admin/orders"
                cta="לרשימת ההזמנות"
              />
              {waitingWeigh + priceSet + waitingPay + paid + readyPickup === 0 && (
                <p className="text-sm text-brand-slate/50 py-2">
                  אין פעולות פתוחות במכירה הזו.
                </p>
              )}
            </div>
          </div>

          {/* ─── אזהרות כמות מוגבלת ─── */}
          {data.limitedWarnings?.length > 0 && (
            <div className="card p-5 border-amber-300 bg-amber-50">
              <h2 className="font-bold text-amber-900 mb-1">מוצרים שמתקרבים למגבלת הכמות</h2>
              <p className="text-xs text-amber-800/70 mb-3">
                כדאי לעדכן מלאי או לסגור את המוצר להזמנה
              </p>
              <div className="space-y-2">
                {data.limitedWarnings.map((w: any) => (
                  <div key={w.name} className="flex justify-between items-center text-sm">
                    <span className="font-medium text-amber-900">{w.name}</span>
                    <span
                      className={`font-bold ${
                        w.level === "over" ? "text-red-700" : "text-amber-800"
                      }`}
                    >
                      {w.ordered} / {w.limit} {w.unit}
                      {w.level === "over" ? " — חריגה" : ""}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ─── פילוח ─── */}
          <div className="grid lg:grid-cols-2 gap-4">
            <div className="card p-5">
              <h2 className="font-bold text-brand-slatedark mb-3">הזמנות לפי נקודת חלוקה</h2>
              <div className="space-y-2">
                {data.byPoint.length === 0 && (
                  <p className="text-zinc-400 text-sm">אין הזמנות במכירה הזו</p>
                )}
                {data.byPoint.map((p: any) => (
                  <div key={p.name} className="flex justify-between gap-3 text-sm">
                    <span className="min-w-0 truncate">{p.name}</span>
                    <span className="text-zinc-500 shrink-0">
                      {p.orders} הזמנות · {fmt(p.total)}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            <div className="card p-5">
              <h2 className="font-bold text-brand-slatedark mb-3">מוצרים הכי נמכרים</h2>
              <div className="space-y-2">
                {data.topProducts.length === 0 && (
                  <p className="text-zinc-400 text-sm">אין הזמנות במכירה הזו</p>
                )}
                {data.topProducts.map((p: any) => (
                  <div key={p.name} className="flex justify-between gap-3 text-sm">
                    <span className="min-w-0 truncate">{p.name}</span>
                    <span className="text-zinc-500 shrink-0">
                      {Math.round(p.qty * 100) / 100} {p.unit}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* ─── פילוח מלא לפי סטטוס ─── */}
          <div className="card p-5">
            <h2 className="font-bold text-brand-slatedark mb-3">מצב ההזמנות</h2>
            <div className="flex flex-wrap gap-2">
              {Object.entries(sc).length === 0 && (
                <p className="text-zinc-400 text-sm">אין הזמנות במכירה הזו</p>
              )}
              {Object.entries(sc).map(([status, count]) => (
                <span
                  key={status}
                  className="badge bg-brand-slate/10 text-brand-slatedark py-1"
                >
                  {STATUS_LABELS[status] ?? status}: <strong className="mr-1">{count as number}</strong>
                </span>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function NextAction({
  count,
  label,
  href,
  cta,
}: {
  count: number;
  label: string;
  href: string;
  cta: string;
}) {
  if (!count) return null;
  return (
    <Link
      href={href}
      className="flex items-center justify-between gap-3 p-2.5 rounded-lg hover:bg-amber-50 transition-colors"
    >
      <span className="flex items-center gap-2.5 min-w-0">
        <span className="w-8 h-8 shrink-0 rounded-lg bg-brand-rust text-white grid place-items-center font-extrabold text-sm">
          {count}
        </span>
        <span className="text-sm text-brand-slatedark min-w-0">{label}</span>
      </span>
      <span className="text-xs font-bold text-brand-rust shrink-0">{cta} ←</span>
    </Link>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className={`card p-4 ${accent ? "bg-brand-rust text-white" : ""}`}>
      <div className={`text-sm ${accent ? "text-white/80" : "text-zinc-500"}`}>{label}</div>
      <div className="text-xl font-extrabold mt-1">{value}</div>
    </div>
  );
}
