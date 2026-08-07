"use client";

// דשבורד ניהול - ממוקד במכירה אחת בכל רגע.
//
// כשיש עשרות מכירות, נתונים מצטברים על כולן חסרי משמעות ("5 הזמנות" - של מה?).
// לכן הדשבורד תמיד מוצג בהקשר של מכירה נבחרת (ברירת מחדל: המכירה הפעילה).
//
// 🐛 תוקן: "חדשות" הסתמך על סטטוס NEW שלא קיים יותר (הוחלף ב-PENDING_REVIEW),
//    ולכן תמיד הציג 0.
// 🐛 תוקן: הכרטיס הרביעי היה בלתי-נראה (טקסט לבן על רקע לבן כש-accent לא נתפס).
// 🐛 תוקן: "מצב ההזמנות" ספר גם הזמנות מבוטלות, וכך הסכום שם (9) לא הסתדר
//    מול "הזמנות פעילות" (5). מבוטלות מוצגות עכשיו בנפרד, מחוץ לפילוח.

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

const ALL = "__all__";

export default function Dashboard() {
  const [lists, setLists] = useState<Pricelist[] | null>(null);
  const [selected, setSelected] = useState<string>("");
  const [data, setData] = useState<any>(null);
  const [pendingW, setPendingW] = useState<{
    ordersCount: number;
    totalMissingItems: number;
  } | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    api("/api/admin/pricelists")
      .then((res: Pricelist[]) => {
        setLists(res);
        const active = res.find((l) => l.status === "ACTIVE");
        setSelected(active?.id ?? res[0]?.id ?? ALL);
      })
      .catch((e) => setErr(e.message));
  }, []);

  const load = useCallback((pricelistId: string) => {
    if (!pricelistId) return;
    setLoading(true);
    setErr("");
    const qs = pricelistId === ALL ? "" : `?pricelistId=${encodeURIComponent(pricelistId)}`;
    // טוענים גם את מקור האמת של המשקלים הממתינים - כדי שהדשבורד יציג
    // בדיוק את אותו מספר שמסך "משקלים ממתינים" מציג, ולא ניחוש מהסטטוס.
    api(`/api/admin/pending-weights${qs}`)
      .then((r: any) =>
        setPendingW({
          ordersCount: r?.ordersCount ?? 0,
          totalMissingItems: r?.totalMissingItems ?? 0,
        })
      )
      .catch(() => setPendingW(null));
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

  const sc: Record<string, number> = data?.statusCounts ?? {};
  const waitingWeigh = sc.PENDING_REVIEW ?? 0;

  // 🐛 תוקן סתירה: הדשבורד הציג "X ממתינות לשקילה" לפי הסטטוס PENDING_REVIEW,
  // אבל מסך המשקלים הציג "אין משקלים ממתינים". שניהם צדקו - הסטטוס
  // PENDING_REVIEW מכסה גם הזמנות *שכבר נשקלו* וממתינות רק לקביעת מחיר סופי.
  // עכשיו מפרידים: מספר השקילות מגיע ממקור האמת (/pending-weights),
  // והשאר מוצג כ"נשקלו - ממתינות לקביעת מחיר סופי", עם קישור למסך הנכון.
  const realWeighOrders = pendingW?.ordersCount ?? 0;
  const realWeighItems = pendingW?.totalMissingItems ?? 0;
  const awaitingFinalPrice = Math.max(0, waitingWeigh - realWeighOrders);
  // 🐛 תוקן: PAYMENT_PENDING ו-PAID הם ערכים של paymentStatus, לא של status.
  // קודם נקראו מ-statusCounts (שסופר רק status) ולכן היו תמיד 0, ושתי
  // השורות האלה ב"מה הצעד הבא" מעולם לא הופיעו.
  const psc: Record<string, number> = data?.payStatusCounts ?? {};
  const readyToCharge = psc.READY_TO_CHARGE ?? 0;
  const waitingPay = psc.PAYMENT_PENDING ?? 0;
  const chargeFailed = (psc.FAILED ?? 0) + (psc.CARD_UPDATE_NEEDED ?? 0);
  const paid = psc.PAID ?? 0;
  const completed = sc.COMPLETED ?? 0;
  const cancelled = sc.CANCELLED ?? 0;

  // "תומחרו" = כל מה שעבר את שלב השקילה (כלומר כבר לא ממתין לשקילה),
  // מתוך ההזמנות הפעילות בלבד.
  const activeTotal = data?.totalOrders ?? 0;
  const pricedCount = Math.max(0, activeTotal - waitingWeigh);
  const remaining = Math.max(0, activeTotal - pricedCount);

  // פילוח מצב ההזמנות - בלי מבוטלות (הן מוצגות בנפרד),
  // כדי שסכום הפילוח יתאים ל"הזמנות פעילות" למעלה.
  const activeStatusEntries = Object.entries(sc).filter(([s]) => s !== "CANCELLED");

  // readyPickup (READY_FOR_PICKUP) בכוונה *לא* נספר כאן: זו הזמנה שכבר
  // סומנה כמוכנה וממתינה שהלקוח יגיע - זה מצב המתנה, לא פעולה שהמנהל
  // צריך לעשות. הנציג יסמן מסירה כשהלקוח יגיע.
  const openActions =
    realWeighOrders + awaitingFinalPrice + readyToCharge + chargeFailed + waitingPay + paid;

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
            <Stat label="הזמנות פעילות" value={String(activeTotal)} />
            <Stat label="סכום משוער" value={fmt(data.estimatedSales)} />
            <Stat label="סכום סופי" value={fmt(data.finalSales)} />
            <Stat
              label="תומחרו"
              value={`${pricedCount} / ${activeTotal}`}
              sub={
                activeTotal === 0
                  ? undefined
                  : remaining === 0
                    ? "כל ההזמנות תומחרו"
                    : `נותרו ${remaining} לשקילה`
              }
              highlight={activeTotal > 0 && remaining > 0}
            />
          </div>

          {/* ─── מה הצעד הבא ─── */}
          <div className="card p-5">
            <h2 className="font-bold text-brand-slatedark mb-1">מה הצעד הבא</h2>
            <p className="text-xs text-brand-slate/60 mb-3">לפי מצב ההזמנות במכירה הזו</p>
            <div className="space-y-1.5">
              <NextAction
                count={realWeighOrders}
                label={
                  realWeighItems > 0
                    ? `הזמנות עם ${realWeighItems} פריטים שממתינים לשקילה`
                    : "הזמנות ממתינות לשקילה"
                }
                href="/admin/pending-weights"
                cta="להזנת משקלים"
              />
              <NextAction
                count={awaitingFinalPrice}
                label="הזמנות שנשקלו — ממתינות לקביעת מחיר סופי"
                href="/admin/orders"
                cta="לרשימת ההזמנות"
              />
              <NextAction
                count={readyToCharge}
                label="הזמנות מוכנות לחיוב"
                href="/admin/payments"
                cta="למסך תשלומים"
              />
              <NextAction
                count={chargeFailed}
                label="חיובים שנכשלו או שדורשים עדכון כרטיס"
                href="/admin/payments"
                cta="לטיפול בחיובים"
              />
              <NextAction
                count={waitingPay}
                label="הזמנות ממתינות לתשלום"
                href="/admin/payments"
                cta="למסך תשלומים"
              />
              <NextAction
                count={paid}
                label="הזמנות ששולמו — סמן שהן מוכנות לחלוקה"
                href="/admin/orders"
                cta="לרשימת ההזמנות"
              />
              {openActions === 0 && (
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
                  <div key={w.name} className="flex justify-between gap-3 items-center text-sm">
                    <span className="font-medium text-amber-900 min-w-0 truncate">{w.name}</span>
                    <span
                      className={`font-bold shrink-0 ${
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
                      <bdi>{p.orders}</bdi> הזמנות · {fmt(p.total)}
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
                      {[
                        p.cartons > 0 ? `${p.cartons} קרטון` : null,
                        p.singlesKg > 0 ? `${p.singlesKg} ק"ג בודדים` : null,
                      ]
                        .filter(Boolean)
                        .join(" + ") || "—"}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* ─── מצב ההזמנות (בלי מבוטלות) ─── */}
          <div className="card p-5">
            <div className="flex flex-wrap items-baseline justify-between gap-2 mb-3">
              <h2 className="font-bold text-brand-slatedark">מצב ההזמנות</h2>
              {cancelled > 0 && (
                <span className="text-xs text-brand-slate/50">
                  בנוסף: {cancelled} הזמנות בוטלו (לא נכללות בסכומים)
                </span>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              {activeStatusEntries.length === 0 && (
                <p className="text-zinc-400 text-sm">אין הזמנות פעילות במכירה הזו</p>
              )}
              {activeStatusEntries.map(([status, count]) => (
                <span key={status} className="badge bg-brand-slate/10 text-brand-slatedark py-1">
                  {STATUS_LABELS[status] ?? status}:{" "}
                  <strong className="mr-1">{count as number}</strong>
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
        <span className="w-8 h-8 shrink-0 rounded-lg bg-[#c0461e] text-white grid place-items-center font-extrabold text-sm">
          {count}
        </span>
        <span className="text-sm text-brand-slatedark min-w-0">{label}</span>
      </span>
      <span className="text-xs font-bold text-[#c0461e] shrink-0">{cta} ←</span>
    </Link>
  );
}

// Stat: צבעים מפורשים (hex) ולא utility של המותג, כדי שהכרטיס לעולם
// לא ייצא "טקסט לבן על רקע לבן" אם class כלשהו לא נטען.
function Stat({
  label,
  value,
  sub,
  highlight,
}: {
  label: string;
  value: string;
  sub?: string;
  highlight?: boolean;
}) {
  return (
    <div
      className="card p-4"
      style={
        highlight
          ? { backgroundColor: "#c0461e", borderColor: "#c0461e", color: "#ffffff" }
          : undefined
      }
    >
      <div className="text-sm" style={{ color: highlight ? "rgba(255,255,255,0.85)" : "#71717a" }}>
        {label}
      </div>
      <div className="text-xl font-extrabold mt-1" style={{ color: highlight ? "#ffffff" : "inherit" }}>
        {value}
      </div>
      {sub && (
        <div
          className="text-[11px] mt-1"
          style={{ color: highlight ? "rgba(255,255,255,0.8)" : "#a1a1aa" }}
        >
          {sub}
        </div>
      )}
    </div>
  );
}
