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
// §380: בורר מכירה מרכזי
import {
  useSelectedPricelist,
  PricelistSelector,
  // §396: צבירה לפי סוג (רגילות / שבועיות)
  applySaleSelection,
  isAggregateSelection,
  saleSelectionLabel,
} from "@/components/useSelectedPricelist";
// §397: ניווט בין מסכי הסיכום
import { ReportsNav } from "@/components/ReportsNav";
import Link from "next/link";
import { api } from "@/lib/client";
import { fmt } from "@/lib/pricing";
// מסלול המכירה + "לפני סגירה"
import { SaleTrack, CloseChecklist, SaleClosedNote, type CloseInfo } from "@/components/SaleProgress";


// ריבוי בעברית עם טיפול באות סופית: "קרטון"+"ים" נותן "קרטוןים"
// שהוא שגוי, ולכן ן->נ לפני הסיומת.
function pluralizeUnit(u: string, n: number): string {
  if (n <= 1) return u;
  if (u.endsWith("ה")) return u.slice(0, -1) + "ות";
  const finals: Record<string, string> = { "ם": "מ", "ן": "נ", "ץ": "צ", "ף": "פ", "ך": "כ" };
  const last = u.slice(-1);
  return (finals[last] ? u.slice(0, -1) + finals[last] : u) + "ים";
}

export default function Dashboard() {
  // §380: בורר מרכזי — הבחירה נשמרת ומשותפת לכל המסכים.
  const { lists, selected, setSelected } = useSelectedPricelist({ allowAll: true });
  const [data, setData] = useState<any>(null);
  // §372: 💰 נתוני הכסף — מ-sale-control, מקור האמת (§325).
  //
  // ⚠️ ולא חישוב מקומי: sale-control כבר מפריד חוב מהכנסות,
  // ושכפול הנוסחה כאן היה יוצר שני מספרים שמתפצלים.
  const [money, setMoney] = useState<{
    sold: number;
    collected: number;
    pending: number;
    debt: number;
    orders: number;
    paidCount: number;
    pendingCount: number;
    // ערוץ המזדמנים — טבלה נפרדת (WalkinOrder), לא נספר ב"נמכר"
    walkins: {
      count: number;
      revenue: number;
      cash: number;
      card: number;
      transferPending: number;
      transferReceived: number;
    };
  } | null>(null);

  // התגובה המלאה של sale-control — לפס ההתקדמות ולרשימת "לפני סגירה"
  const [ctl, setCtl] = useState<any>(null);
  // §385: שער הסגירה — אותו מקור שמסך הסגירה בודק, כדי שהמספרים יתאימו
  const [closeInfo, setCloseInfo] = useState<CloseInfo | null>(null);

  const [pendingW, setPendingW] = useState<{
    ordersCount: number;
    totalMissingItems: number;
  } | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    // §380: הרשימה והבחירה מגיעות מ-useSelectedPricelist.
  }, []);

  const load = useCallback((pricelistId: string) => {
    if (!pricelistId) return;
    setLoading(true);
    setErr("");
    // §396: "כל הרגילות" / "כל השבועיות" נשלחים כ-saleKind
    const sp = new URLSearchParams();
    applySaleSelection(sp, pricelistId);
    const qs = sp.toString() ? `?${sp.toString()}` : "";
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

    // §372: 💰 נתוני הכסף — רק כשנבחרה מכירה ספציפית.
    //
    // ⚠️ sale-control הוא per-pricelist. ב"כל המכירות" אין
    // משמעות לסכום אחד, ולכן הבלוק פשוט לא מוצג.
    if (!isAggregateSelection(pricelistId)) {
      // מנקים את המכירה הקודמת — שהפס לא יציג לרגע נתונים של מכירה אחרת
      setCtl(null);
      setCloseInfo(null);
      api(`/api/admin/sale-close/${pricelistId}`)
        .then((r: any) => setCloseInfo(r))
        .catch(() => setCloseInfo(null));
      api(`/api/admin/sale-control/${pricelistId}`)
        .then((r: any) => {
          setCtl(r);
          // ⚠️ financialSummary — השם ב-sale-control (§78).
          const f = r?.financialSummary ?? r?.financial ?? r ?? {};
          const sold = Number(f.orderRevenue ?? f.totalRevenue ?? 0);
          const collected = Number(f.totalCollected ?? 0);
          setMoney({
            sold,
            collected,
            pending: Math.max(0, Math.round((sold - collected) * 100) / 100),
            debt: Number(f.totalDebtCollected ?? 0),
            orders: Number(f.orderCount ?? r?.orders?.length ?? 0),
            paidCount: Number(f.paidOrdersCount ?? 0),
            pendingCount: Number(f.pendingOrdersCount ?? 0),
            walkins: {
              count: Number(r?.progress?.totalWalkins ?? 0),
              revenue: Number(f.walkinRevenue ?? 0),
              cash: Number(f.walkinCash ?? 0),
              card: Number(f.walkinCardTerminal ?? 0) + Number(f.walkinOnline ?? 0),
              transferPending: Number(f.walkinTransferPending ?? 0),
              transferReceived: Number(f.walkinTransferReceived ?? 0),
            },
          });
        })
        .catch(() => {
          setMoney(null);
          setCtl(null);
        });
    } else {
      setMoney(null);
      setCtl(null);
      setCloseInfo(null);
    }

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
  const completed = sc.COMPLETED ?? 0;
  const cancelled = sc.CANCELLED ?? 0;

  // §47: ספירות משולבות מהשרת.
  // 🐛 קודם השורה "הזמנות ששולמו - סמן שהן מוכנות לחלוקה" השתמשה
  // ב-psc.PAID, שסופר *כל* הזמנה ששולמה - כולל כאלה שכבר סומנו
  // מוכנות וכולל כאלה שכבר נמסרו. לכן המספר לא ירד אף פעם, וכל
  // סימון נראה כאילו לא עבד.
  const needsMarkReady = data?.needsMarkReady ?? 0;
  const awaitingPickup = data?.awaitingPickup ?? 0;
  const deliveredCount = data?.deliveredCount ?? 0;

  // "תומחרו" = כל מה שעבר את שלב השקילה (כלומר כבר לא ממתין לשקילה),
  // מתוך ההזמנות הפעילות בלבד.
  const activeTotal = data?.totalOrders ?? 0;
  // 🐛 תוקן: הספירה הייתה לפי status=PENDING_REVIEW — סטטוס שנשאר גם על
  // הזמנות שכבר נשקלו ושולמו (ראה הערה למעלה). במכירה עם 315/320 שולמו
  // הבר הציג "נותרו 301 לשקילה". עכשיו ממקור האמת (/pending-weights),
  // ורק אם הוא לא נטען — הנפילה לישן.
  const pricedCount = pendingW
    ? Math.max(0, activeTotal - realWeighOrders)
    : Math.max(0, activeTotal - waitingWeigh);
  const remaining = Math.max(0, activeTotal - pricedCount);

  // פילוח מצב ההזמנות - בלי מבוטלות (הן מוצגות בנפרד),
  // כדי שסכום הפילוח יתאים ל"הזמנות פעילות" למעלה.
  const activeStatusEntries = Object.entries(sc).filter(([s]) => s !== "CANCELLED");

  // readyPickup (READY_FOR_PICKUP) בכוונה *לא* נספר כאן: זו הזמנה שכבר
  // סומנה כמוכנה וממתינה שהלקוח יגיע - זה מצב המתנה, לא פעולה שהמנהל
  // צריך לעשות. הנציג יסמן מסירה כשהלקוח יגיע.
  const openActions =
    realWeighOrders + awaitingFinalPrice + readyToCharge + chargeFailed + waitingPay + needsMarkReady;

  // לתצוגה: רק השורות שמוצגות בפועל ברשימה (awaitingFinalPrice כבר לא שורה, §372)
  const shownActions = chargeFailed + realWeighOrders + readyToCharge + waitingPay + needsMarkReady;
  const aggregate = isAggregateSelection(selected);
  // המצב העדכני מהשרת (sale-control), ולא מרשימת הבורר שנשמרת לזמן הגלישה
  const saleStatus: string = ctl?.pricelist?.status ?? currentList?.status ?? "";
  const saleTitle = aggregate
    ? saleSelectionLabel(selected, lists)
    : currentList?.name ?? "בחר מכירה";
  const collectedPct =
    money && money.sold > 0 ? Math.min(100, Math.round((money.collected / money.sold) * 100)) : 0;
  const pricedPct = activeTotal > 0 ? Math.round((pricedCount / activeTotal) * 100) : 0;

  return (
    <div className="space-y-5 max-w-6xl">
      {/* ─── פס המכירה: מה מוצג, באיזה מצב, וכמה מחכה ─── */}
      <section className="card p-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <p className="text-xs font-bold text-zinc-500">דשבורד</p>
          <div className="flex items-center gap-2 min-w-0 mt-0.5">
            <h1 className="text-xl md:text-2xl font-extrabold text-brand-slatedark truncate">
              {saleTitle}
            </h1>
            {!aggregate && saleStatus && <SaleStatusBadge status={saleStatus} />}
          </div>
          {data && (
            <p className="text-sm mt-1 text-zinc-600">
              {shownActions > 0 ? (
                <>
                  <bdi className="font-extrabold text-brand-rust tabular-nums">{shownActions}</bdi>{" "}
                  פעולות ממתינות לטיפול
                </>
              ) : (
                <span className="text-emerald-700 font-bold">אין פעולות פתוחות</span>
              )}
              {activeTotal > 0 && (
                <span className="text-zinc-400"> · {activeTotal} הזמנות פעילות</span>
              )}
            </p>
          )}
        </div>

        <div className="flex flex-col gap-2 sm:items-end shrink-0">
          <label className="flex items-center gap-2">
            <span className="text-sm font-bold text-brand-slatedark shrink-0">מכירה</span>
            {/* §380: רכיב אחד לכל המסכים — הבחירה נשמרת. */}
            <PricelistSelector
              lists={lists}
              selected={selected}
              onChange={setSelected}
              allowAll
              className="input py-2 px-3 text-sm w-full sm:w-64"
            />
          </label>
          {!aggregate && selected && (
            <div className="flex gap-4 text-xs font-bold">
              <a href={`/admin/sale-control/${selected}`} className="text-brand-rust hover:underline">
                בקרת מכירה ←
              </a>
              {/* §385: סגירת מכירה — השער */}
              <a href={`/admin/sale-close/${selected}`} className="text-zinc-600 hover:text-brand-rust hover:underline">
                סגירת מכירה ←
              </a>
            </div>
          )}
        </div>
      </section>

      {loading && !data && <DashboardSkeleton />}

      {data && (
        <>
          {/* ─── מסלול המכירה — באיזה שלב, וכמה נשאר בכל שלב ─── */}
          {!aggregate && selected && ctl && (
            <SaleTrack
              pricelistId={selected}
              status={saleStatus}
              closeDate={ctl?.pricelist?.closeDate ?? null}
              activeTotal={activeTotal}
              pricedCount={pricedCount}
              deliveredCount={deliveredCount}
              awaitingPickup={awaitingPickup}
              close={closeInfo}
            />
          )}

          {/* §372: שורת הכסף — נמכר, נגבה, ממתין, חוב (בנפרד, §325/§366).
              ⚠️ רק במכירה אחת: sale-control הוא per-pricelist. */}
          {money ? (
            <section aria-label="הכסף" className="card p-4 md:p-5">
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                <Kpi label="נמכר" value={money.sold} sub={`${money.orders} הזמנות`} />
                <Kpi
                  label="נגבה"
                  value={money.collected}
                  sub={`${money.paidCount} שולמו · ${collectedPct}%`}
                  tone={money.collected > 0 ? "good" : "neutral"}
                  progress={collectedPct}
                />
                <Kpi
                  label="ממתין לחיוב"
                  value={money.pending}
                  sub={`${money.pendingCount} הזמנות במכירה הזו`}
                  tone={money.pending > 0 ? "warn" : "neutral"}
                  href="/admin/payments"
                />
                <Kpi
                  label="חוב קודם שנגבה"
                  value={money.debt}
                  sub="ממכירות קודמות · לא נספר כאן"
                  tone="muted"
                  href="/admin/debt-ledger"
                />
              </div>

              {/* §373: התקדמות השקילה — פס ולא מספר */}
              {activeTotal > 0 && (
                <div className="mt-4 pt-4 border-t border-zinc-100">
                  <div className="flex items-center justify-between text-xs mb-1.5">
                    <span className="font-bold text-zinc-600">
                      שקילה ותמחור · <bdi className="tabular-nums">{pricedCount}/{activeTotal}</bdi>
                    </span>
                    <span className={remaining === 0 ? "text-emerald-700 font-bold" : "text-amber-700 font-bold"}>
                      {remaining === 0 ? "✓ הכל תומחר" : `נותרו ${remaining} לשקילה`}
                    </span>
                  </div>
                  <Bar pct={pricedPct} tone={remaining === 0 ? "good" : "warn"} />
                </div>
              )}
            </section>
          ) : (
            aggregate && (
              <p className="text-sm text-zinc-500 px-1">
                נתוני כסף מוצגים כשבוחרים מכירה אחת.
              </p>
            )
          )}

          {/* ─── מה הצעד הבא ─── */}
          <section className="card overflow-hidden" aria-labelledby="next-steps">
            <div className="flex items-center justify-between gap-3 px-4 md:px-5 pt-4 pb-3">
              <h2 id="next-steps" className="font-extrabold text-brand-slatedark">
                מה הצעד הבא
              </h2>
              {shownActions > 0 && (
                <span className="text-xs font-bold text-zinc-500">לפי מצב ההזמנות במכירה</span>
              )}
            </div>

            {shownActions === 0 ? (
              <div className="px-4 md:px-5 pb-5 flex items-center gap-3">
                <span className="w-9 h-9 rounded-full bg-emerald-100 text-emerald-700 grid place-items-center font-extrabold" aria-hidden="true">
                  ✓
                </span>
                <p className="text-sm text-zinc-600">הכל מטופל — אין פעולות פתוחות במכירה הזו.</p>
              </div>
            ) : (
              <ul className="divide-y divide-zinc-100 border-t border-zinc-100">
                <NextAction
                  count={chargeFailed}
                  label="חיובים שנכשלו או שדורשים עדכון כרטיס"
                  href="/admin/payments"
                  cta="לטיפול"
                  tone="danger"
                />
                <NextAction
                  count={realWeighOrders}
                  label={
                    // §72: העיגול = הזמנות, והפריטים מפורטים רק כשהם שונים.
                    realWeighItems > 0 && realWeighItems !== realWeighOrders
                      ? `הזמנות ממתינות לשקילה (${realWeighItems} פריטים בסך הכל)`
                      : "הזמנות ממתינות לשקילה"
                  }
                  href="/admin/pending-weights"
                  cta="להזנת משקלים"
                />
                <NextAction count={readyToCharge} label="הזמנות מוכנות לחיוב" href="/admin/payments" cta="לחיוב" />
                <NextAction count={waitingPay} label="הזמנות ממתינות לתשלום" href="/admin/payments" cta="לתשלומים" />
                <NextAction
                  count={needsMarkReady}
                  label="הזמנות ששולמו — לסמן מוכנות לחלוקה"
                  href="/admin/orders"
                  cta="להזמנות"
                />
              </ul>
            )}

            {/* §47: מצב החלוקה - מידע ולא משימה */}
            {(awaitingPickup > 0 || deliveredCount > 0) && (
              <div className="px-4 md:px-5 py-3 bg-zinc-50 border-t border-zinc-100 flex flex-wrap gap-x-5 gap-y-1 text-xs text-zinc-600">
                {awaitingPickup > 0 && (
                  <span>
                    <bdi className="font-bold tabular-nums">{awaitingPickup}</bdi> מוכנות וממתינות ללקוח
                  </span>
                )}
                {deliveredCount > 0 && (
                  <span className="text-emerald-700">
                    <bdi className="font-bold tabular-nums">{deliveredCount}</bdi> כבר נמסרו ✓
                  </span>
                )}
              </div>
            )}
          </section>

          {/* ─── לפני סגירת המכירה — רק אחרי שההזמנות נסגרו.
              בזמן שעוד מזמינים, רשימת חוסמים מלאה היא רעש; הפס למעלה
              כבר מראה כמה חוסמים יש. ─── */}
          {!aggregate && selected && closeInfo && ctl && saleStatus === "CLOSED" && (
            <CloseChecklist pricelistId={selected} close={closeInfo} ctl={ctl} />
          )}
          {!aggregate && ctl && saleStatus === "DONE" && (
            <SaleClosedNote carriedToDebt={Number(ctl?.financialSummary?.carriedToDebt ?? 0)} />
          )}

          {/* ─── לפי ערוץ הזמנה ─── */}
          <ChannelBreakdown sourceCounts={data.sourceCounts ?? {}} walkins={money?.walkins ?? null} />

          {/* ─── אזהרות כמות מוגבלת ─── */}
          {data.limitedWarnings?.length > 0 && (
            <section className="card p-4 md:p-5 border-amber-300 bg-amber-50">
              <h2 className="font-extrabold text-amber-900">מוצרים שמתקרבים למגבלת הכמות</h2>
              <p className="text-xs text-amber-800/80 mb-3">כדאי לעדכן מלאי או לסגור את המוצר להזמנה</p>
              <ul className="space-y-2">
                {data.limitedWarnings.map((w: any) => (
                  <li key={w.name} className="flex justify-between gap-3 items-center text-sm">
                    <span className="font-medium text-amber-900 min-w-0 truncate">{w.name}</span>
                    <span className={`font-bold shrink-0 tabular-nums ${w.level === "over" ? "text-red-700" : "text-amber-800"}`}>
                      {w.ordered} / {w.limit} {w.unit}
                      {w.level === "over" ? " — חריגה" : ""}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* ─── פילוח ─── */}
          {/* grid-cols-1 = minmax(0,1fr): בלעדיו שם נקודה ארוך מרחיב את העמודה מעבר למסך בנייד */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <section className="card p-4 md:p-5">
              {/* §373: הנקודה היא גם יחידת החיוב (§369) */}
              <div className="flex items-center justify-between mb-3">
                <h2 className="font-extrabold text-brand-slatedark">לפי נקודת חלוקה</h2>
                <a href="/admin/payments" className="text-xs font-bold text-brand-rust hover:underline">
                  לחיוב לפי נקודה ←
                </a>
              </div>
              {data.byPoint.length === 0 ? (
                <p className="text-zinc-400 text-sm">אין הזמנות במכירה הזו</p>
              ) : (
                <ul className="divide-y divide-zinc-100">
                  {data.byPoint.map((p: any) => (
                    <li key={p.name} className="flex justify-between gap-3 text-sm py-2">
                      <span className="min-w-0 truncate">{p.name}</span>
                      <span className="text-zinc-500 shrink-0 tabular-nums">
                        <bdi>{p.orders}</bdi> הזמנות ·{" "}
                        <span className="font-bold text-brand-slatedark">{fmt(p.total)}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="card p-4 md:p-5">
              <h2 className="font-extrabold text-brand-slatedark mb-3">מוצרים הכי נמכרים</h2>
              {data.topProducts.length === 0 ? (
                <p className="text-zinc-400 text-sm">אין הזמנות במכירה הזו</p>
              ) : (
                <ul className="divide-y divide-zinc-100">
                  {data.topProducts.map((p: any) => (
                    <li key={p.name} className="flex justify-between gap-3 text-sm py-2">
                      <span className="min-w-0 truncate">{p.name}</span>
                      <span className="text-zinc-500 shrink-0 tabular-nums">
                        {/* §38: התווית לפי unit האמיתי */}
                        {[
                          p.cartons > 0
                            ? `${p.cartons} ${pluralizeUnit(p.unitLabel || "קרטון", p.cartons)}`
                            : null,
                          p.singlesKg > 0 ? `${p.singlesKg} ק"ג בודדים` : null,
                        ]
                          .filter(Boolean)
                          .join(" + ") || "—"}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>

          {/* §397: לאן הולכים מכאן — שלושת מסכי הסיכום */}
          <section aria-label="מסכי סיכום" className="pt-1">
            <h2 className="text-xs font-bold text-zinc-500 mb-2 px-1">מסכי סיכום</h2>
            <ReportsNav current={null} pricelistId={aggregate ? "" : selected} />
          </section>
        </>
      )}
    </div>
  );
}

// §24: מקור ההזמנה — אותן תוויות כמו ברשימת ההזמנות
const CHANNELS: Record<string, { label: string; color: string }> = {
  WEB: { label: "אתר", color: "bg-brand-rust" },
  PHONE: { label: "טלפון", color: "bg-indigo-500" },
  AGENT: { label: "נציג", color: "bg-teal-500" },
  EXCEL: { label: "אקסל", color: "bg-green-500" },
  ADMIN: { label: "מנהל", color: "bg-zinc-400" },
  WALKIN: { label: "מזדמן שהומר", color: "bg-violet-500" },
};
const CHANNEL_ORDER = ["WEB", "PHONE", "AGENT", "EXCEL", "WALKIN", "ADMIN"];

function shekels(n: number) {
  return "₪" + n.toLocaleString("he-IL", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

function ChannelBreakdown({
  sourceCounts,
  walkins,
}: {
  sourceCounts: Record<string, number>;
  walkins: {
    count: number;
    revenue: number;
    cash: number;
    card: number;
    transferPending: number;
    transferReceived: number;
  } | null;
}) {
  const rows = Object.entries(sourceCounts)
    .filter(([, n]) => n > 0)
    .sort(([a], [b]) => {
      const ia = CHANNEL_ORDER.indexOf(a);
      const ib = CHANNEL_ORDER.indexOf(b);
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
    });
  const total = rows.reduce((s, [, n]) => s + n, 0);
  const hasWalkins = !!walkins && walkins.count > 0;
  if (total === 0 && !hasWalkins) return null;

  const pct = (n: number) => (total > 0 ? Math.round((n / total) * 100) : 0);
  const walkinOther = walkins
    ? Math.max(0, walkins.revenue - walkins.cash - walkins.card - walkins.transferPending - walkins.transferReceived)
    : 0;

  return (
    <section className="card p-4 md:p-5" aria-labelledby="channels">
      <div className="flex items-center justify-between mb-3">
        <h2 id="channels" className="font-extrabold text-brand-slatedark">
          לפי ערוץ הזמנה
        </h2>
        <a href="/admin/reports" className="text-xs font-bold text-brand-rust hover:underline">
          לדוחות ←
        </a>
      </div>

      {total > 0 && (
        <>
          {/* פס אחד מחולק — היחס בין הערוצים במבט */}
          <div className="flex h-2.5 rounded-full overflow-hidden bg-zinc-100 gap-0.5" role="presentation">
            {rows.map(([src, n]) => (
              <div
                key={src}
                className={CHANNELS[src]?.color ?? "bg-zinc-300"}
                style={{ width: `${(n / total) * 100}%` }}
              />
            ))}
          </div>

          <ul className="mt-3 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
            {rows.map(([src, n]) => (
              <li key={src} className="rounded-lg bg-zinc-50 px-3 py-2">
                <div className="flex items-center gap-1.5 text-xs font-bold text-zinc-600">
                  <span className={`w-2 h-2 rounded-full shrink-0 ${CHANNELS[src]?.color ?? "bg-zinc-300"}`} aria-hidden="true" />
                  <span className="truncate">{CHANNELS[src]?.label ?? src}</span>
                </div>
                <div className="mt-0.5 flex items-baseline gap-1.5">
                  <span className="text-lg font-extrabold text-brand-slatedark tabular-nums">{n}</span>
                  <span className="text-xs text-zinc-500 tabular-nums">{pct(n)}%</span>
                </div>
              </li>
            ))}
          </ul>
          <p className="text-xs text-zinc-500 mt-2">
            <bdi className="tabular-nums">{total}</bdi> הזמנות פעילות (בלי מבוטלות)
          </p>
        </>
      )}

      {/* מכירות מזדמנות — טבלה נפרדת, ולכן גם בנפרד כאן */}
      {hasWalkins && walkins && (
        <div className={total > 0 ? "mt-4 pt-4 border-t border-zinc-100" : ""}>
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="text-sm font-extrabold text-brand-slatedark">
              מכירות מזדמנות בשטח
              <span className="font-normal text-zinc-500"> · <bdi className="tabular-nums">{walkins.count}</bdi> מכירות</span>
            </h3>
            <span className="text-lg font-extrabold text-brand-slatedark tabular-nums">{shekels(walkins.revenue)}</span>
          </div>
          <p className="text-xs text-zinc-500 mb-2">לא כלול ב"נמכר" למעלה</p>
          <div className="flex flex-wrap gap-1.5">
            {walkins.cash > 0 && <MethodChip label="מזומן" value={walkins.cash} />}
            {walkins.card > 0 && <MethodChip label="אשראי" value={walkins.card} />}
            {walkins.transferReceived > 0 && <MethodChip label="העברה שהתקבלה" value={walkins.transferReceived} />}
            {walkins.transferPending > 0 && <MethodChip label="העברה ממתינה לאישור" value={walkins.transferPending} warn />}
            {walkinOther > 0.5 && <MethodChip label="אחר" value={walkinOther} />}
          </div>
        </div>
      )}
    </section>
  );
}

function MethodChip({ label, value, warn }: { label: string; value: number; warn?: boolean }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs ${
        warn ? "bg-amber-100 text-amber-900 ring-1 ring-amber-200" : "bg-zinc-100 text-zinc-700"
      }`}
    >
      <span>{label}</span>
      <span className="font-bold tabular-nums">{shekels(value)}</span>
    </span>
  );
}

function SaleStatusBadge({ status }: { status: string }) {
  if (status === "ACTIVE")
    return (
      <span className="shrink-0 inline-flex items-center gap-1.5 rounded-full bg-emerald-100 text-emerald-800 px-2.5 py-0.5 text-xs font-bold">
        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" aria-hidden="true" />
        פעילה
      </span>
    );
  // DRAFT / ACTIVE / CLOSED / DONE (schema.prisma: Pricelist.status)
  if (status === "CLOSED")
    return (
      <span className="shrink-0 rounded-full bg-amber-100 text-amber-800 px-2.5 py-0.5 text-xs font-bold">
        ההזמנות נסגרו
      </span>
    );
  if (status === "DONE")
    return (
      <span className="shrink-0 rounded-full bg-zinc-200 text-zinc-700 px-2.5 py-0.5 text-xs font-bold">
        נסגרה סופית ✓
      </span>
    );
  if (status === "DRAFT")
    return (
      <span className="shrink-0 rounded-full bg-zinc-100 text-zinc-500 px-2.5 py-0.5 text-xs font-bold">
        טיוטה
      </span>
    );
  return null;
}

function NextAction({
  count,
  label,
  href,
  cta,
  tone = "task",
}: {
  count: number;
  label: string;
  href: string;
  cta: string;
  tone?: "task" | "danger";
}) {
  if (!count) return null;
  const chip = tone === "danger" ? "bg-red-600 text-white" : "bg-brand-rust text-white";
  return (
    <li>
      <Link
        href={href}
        className={`flex items-center justify-between gap-3 px-4 md:px-5 py-3 min-h-[56px] transition-colors ${
          tone === "danger" ? "bg-red-50/60 hover:bg-red-50" : "hover:bg-amber-50/70"
        }`}
      >
        <span className="flex items-center gap-3 min-w-0">
          <span className={`min-w-9 h-9 px-2 shrink-0 rounded-lg grid place-items-center font-extrabold text-sm tabular-nums ${chip}`}>
            {count}
          </span>
          <span className="text-sm font-medium text-brand-slatedark min-w-0">{label}</span>
        </span>
        <span className={`text-xs font-bold shrink-0 ${tone === "danger" ? "text-red-700" : "text-brand-rust"}`}>
          <span className="hidden sm:inline">{cta} </span>←
        </span>
      </Link>
    </li>
  );
}

function Bar({ pct, tone }: { pct: number; tone: "good" | "warn" }) {
  return (
    <div className="h-1.5 bg-zinc-100 rounded-full overflow-hidden" role="presentation">
      <div
        className={`h-full rounded-full transition-[width] duration-500 ease-out motion-reduce:transition-none ${
          tone === "good" ? "bg-emerald-500" : "bg-amber-500"
        }`}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

// §372: קוביית כסף — מספר אחד, בלי דוח. המנהל סורק ולוחץ רק על מה שדורש פעולה.
function Kpi({
  label,
  value,
  sub,
  tone = "neutral",
  href,
  progress,
}: {
  label: string;
  value: number;
  sub?: string;
  tone?: "neutral" | "good" | "warn" | "muted";
  href?: string;
  progress?: number;
}) {
  const valueColor = {
    neutral: "text-brand-slatedark",
    good: "text-emerald-700",
    warn: "text-amber-700",
    muted: "text-zinc-500",
  }[tone];
  const body = (
    <div
      className={`h-full rounded-xl p-3 md:p-4 ${
        tone === "warn" ? "bg-amber-50 ring-1 ring-amber-200" : "bg-zinc-50"
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-bold text-zinc-500">{label}</span>
        {href && <span className="text-xs text-zinc-400" aria-hidden="true">←</span>}
      </div>
      <div className={`text-xl md:text-2xl font-extrabold tabular-nums mt-1 ${valueColor}`}>
        ₪
        {value.toLocaleString("he-IL", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
      </div>
      {sub && <div className="text-xs text-zinc-500 mt-0.5 leading-snug">{sub}</div>}
      {progress != null && (
        <div className="mt-2">
          <Bar pct={progress} tone="good" />
        </div>
      )}
    </div>
  );
  return href ? (
    <a href={href} className="block rounded-xl transition-transform active:scale-[0.98] hover:brightness-[0.98]">
      {body}
    </a>
  ) : (
    body
  );
}

function DashboardSkeleton() {
  return (
    <div className="space-y-5" aria-busy="true" aria-label="טוען נתונים">
      <div className="card p-4 md:p-5 grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-24 rounded-xl bg-zinc-100 animate-pulse motion-reduce:animate-none" />
        ))}
      </div>
      <div className="card h-40 animate-pulse motion-reduce:animate-none bg-zinc-50" />
    </div>
  );
}
