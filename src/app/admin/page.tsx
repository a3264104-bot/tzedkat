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
import { useSelectedPricelist, ALL_SALES, PricelistSelector } from "@/components/useSelectedPricelist";
import Link from "next/link";
import { api } from "@/lib/client";
import { fmt } from "@/lib/pricing";

// §380: ALL מיובא מה-hook
const ALL = ALL_SALES;

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
  } | null>(null);

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

    // §372: 💰 נתוני הכסף — רק כשנבחרה מכירה ספציפית.
    //
    // ⚠️ sale-control הוא per-pricelist. ב"כל המכירות" אין
    // משמעות לסכום אחד, ולכן הבלוק פשוט לא מוצג.
    if (pricelistId !== ALL) {
      api(`/api/admin/sale-control/${pricelistId}`)
        .then((r: any) => {
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
          });
        })
        .catch(() => setMoney(null));
    } else {
      setMoney(null);
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
  const pricedCount = Math.max(0, activeTotal - waitingWeigh);
  const remaining = Math.max(0, activeTotal - pricedCount);

  // פילוח מצב ההזמנות - בלי מבוטלות (הן מוצגות בנפרד),
  // כדי שסכום הפילוח יתאים ל"הזמנות פעילות" למעלה.
  const activeStatusEntries = Object.entries(sc).filter(([s]) => s !== "CANCELLED");

  // readyPickup (READY_FOR_PICKUP) בכוונה *לא* נספר כאן: זו הזמנה שכבר
  // סומנה כמוכנה וממתינה שהלקוח יגיע - זה מצב המתנה, לא פעולה שהמנהל
  // צריך לעשות. הנציג יסמן מסירה כשהלקוח יגיע.
  const openActions =
    realWeighOrders + awaitingFinalPrice + readyToCharge + chargeFailed + waitingPay + needsMarkReady;

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
          {/* §380: רכיב אחד לכל המסכים — הבחירה נשמרת. */}
          <PricelistSelector
            lists={lists}
            selected={selected}
            onChange={setSelected}
            allowAll
            className="input py-2 px-3 text-sm w-56"
          />
        </div>
      </div>

      {loading && <p className="text-zinc-500 text-sm">טוען נתונים...</p>}

      {data && (
        <>
          {/* §373: 🗑️ שורת ה-Stat **מוזגה ל-💰**.
              
              "סכום סופי" ו"נמכר" הם אותו מספר בשני שמות, ו"סכום
              משוער" מיותר אחרי שהכל נשקל.
              
              ⚠️ מה שנשאר רלוונטי — "תומחרו X/Y" — עבר לשורת
              הכסף כשורת התקדמות. */}

          {/* §372: 💰 **שורת הכסף — התמונה שחסרה.**
              
              הדשבורד ענה על "מה לעשות" ולא על "איפה הכסף".
              המנהל עבר בין ארבעה מסכים (בקרת מכירה, סיכום
              מכירה, תשלומים, חובות נציגים) כדי להרכיב מצב אחד.
              
              ⚠️ ארבעה מספרים, ולא דוח: נמכר, נגבה, ממתין, חוב.
              מי שרוצה פירוט לוחץ ועובר.
              
              ⚠️ והחוב **בנפרד** (§325/§366): הוא כסף שנכנס אבל
              לא מהמכירה הזו, וערבוב שלו שובר את ההצלבה מול
              תעודות הספק. */}
          {money && (
            <div className="card p-5">
              <div className="flex items-center justify-between mb-3">
                <h2 className="font-bold text-brand-slatedark">💰 הכסף</h2>
                <a
                  href={`/admin/sale-control/${selected !== ALL ? selected : ""}`}
                  className="text-xs font-bold text-brand-rust hover:underline"
                >
                  לפירוט מלא ←
                </a>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                <MoneyBox
                  label="נמכר"
                  value={money.sold}
                  sub={`${money.orders} הזמנות`}
                  tone="slate"
                />
                <MoneyBox
                  label="נגבה"
                  value={money.collected}
                  sub={`${money.paidCount} שולמו`}
                  tone="emerald"
                />
                <MoneyBox
                  label="💳 ממתין לחיוב"
                  value={money.pending}
                  sub={`${money.pendingCount} הזמנות · במכירה הזו`}
                  tone={money.pending > 0 ? "amber" : "slate"}
                  href="/admin/payments"
                />
                <MoneyBox
                  label="💸 חוב קודם שנגבה"
                  value={money.debt}
                  sub="ממכירות קודמות · לא נספר כאן"
                  tone="slate"
                  href="/admin/debt-ledger"
                />
              </div>

              {/* §373: התקדמות השקילה — מה שנשאר משורת ה-Stat.
                  
                  ⚠️ פס ולא מספר: "213/256" דורש חישוב בראש, ופס
                  נקרא במבט. */}
              {activeTotal > 0 && (
                <div className="mt-3 pt-3 border-t border-zinc-100">
                  <div className="flex items-center justify-between text-xs mb-1">
                    <span className="font-bold text-zinc-600">
                      תומחרו {pricedCount} מתוך {activeTotal}
                    </span>
                    <span
                      className={
                        remaining === 0
                          ? "text-emerald-700 font-bold"
                          : "text-amber-700 font-bold"
                      }
                    >
                      {remaining === 0
                        ? "✓ הכל תומחר"
                        : `נותרו ${remaining} לשקילה`}
                    </span>
                  </div>
                  <div className="h-2 bg-zinc-100 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-emerald-500 transition-all"
                      style={{
                        width: `${Math.round((pricedCount / activeTotal) * 100)}%`,
                      }}
                    />
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ─── מה הצעד הבא ─── */}
          <div className="card p-5">
            <h2 className="font-bold text-brand-slatedark mb-1">מה הצעד הבא</h2>
            <p className="text-xs text-brand-slate/60 mb-3">לפי מצב ההזמנות במכירה הזו</p>
            <div className="space-y-1.5">
              <NextAction
                count={realWeighOrders}
                label={
                  // §72: הניסוח הקודם - "הזמנות עם 2 פריטים שממתינים לשקילה"
                  // ליד עיגול עם המספר 2 - הציג את אותו מספר פעמיים בשתי
                  // משמעויות (הזמנות/פריטים), ואי אפשר היה לדעת מה סופר מה.
                  // עכשיו: העיגול = הזמנות, והפריטים מפורטים רק כשהם שונים.
                  realWeighItems > 0 && realWeighItems !== realWeighOrders
                    ? `הזמנות ממתינות לשקילה (${realWeighItems} פריטים בסך הכל)`
                    : "הזמנות ממתינות לשקילה"
                }
                href="/admin/pending-weights"
                cta="להזנת משקלים"
              />
              {/* §372: 🗑️ "נשקלו — ממתינות למחיר סופי" **הוסרה**.
                  
                  🐛 היא לא הייתה מצב אמיתי אלא הפרש בין שני
                  מספרים (waitingWeigh − realWeighOrders), ותיארה
                  שלב שכלל לא קיים: §266 קובע finalTotal ומסמן
                  READY_TO_CHARGE **באותה שקילה**.
                  
                  ⚠️ המנהל ראה שורה שאומרת "יש משהו לעשות" בלי
                  שיהיה מה לעשות — וזה בדיוק מה שהופך דשבורד
                  לרעש. */}
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
                count={needsMarkReady}
                label="הזמנות ששולמו — סמן שהן מוכנות לחלוקה"
                href="/admin/orders"
                cta="לרשימת ההזמנות"
              />
              {openActions === 0 && (
                <p className="text-sm text-brand-slate/50 py-2">
                  אין פעולות פתוחות במכירה הזו.
                </p>
              )}

              {/* §47: מצב החלוקה - מידע ולא משימה. הזמנה שסומנה מוכנה
                  ממתינה שהלקוח יגיע, וזו לא פעולה שהמנהל צריך לעשות. */}
              {(awaitingPickup > 0 || deliveredCount > 0) && (
                <div className="mt-3 pt-3 border-t border-zinc-100 flex flex-wrap gap-x-5 gap-y-1 text-xs text-brand-slate/70">
                  {awaitingPickup > 0 && (
                    <span>
                      <bdi>{awaitingPickup}</bdi> מוכנות וממתינות שהלקוח יגיע
                    </span>
                  )}
                  {deliveredCount > 0 && (
                    <span className="text-emerald-700">
                      <bdi>{deliveredCount}</bdi> כבר נמסרו ✓
                    </span>
                  )}
                </div>
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
              {/* §373: כותרת עם קישור — הנקודה היא גם יחידת
                  החיוב (§369), והמנהל שרואה "34 בברכפלד" רוצה
                  לחייב אותן. */}
              <div className="flex items-center justify-between mb-3">
                <h2 className="font-bold text-brand-slatedark">
                  הזמנות לפי נקודת חלוקה
                </h2>
                <a
                  href="/admin/payments"
                  className="text-xs font-bold text-brand-rust hover:underline"
                >
                  לחיוב לפי נקודה ←
                </a>
              </div>
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
                      {/* §38: התווית לפי unit האמיתי. מוצר ארוז נמכר
                          ביחידות והוצג כ"קרטון". */}
                      {[
                        p.cartons > 0
                          ? `${p.cartons} ${pluralizeUnit(p.unitLabel || "קרטון", p.cartons)}`
                          : null,
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

          {/* §373: 🗑️ "מצב ההזמנות" **הוסר**.

              🐛 הוא הציג את אותם סטטוסים ש"מה הצעד הבא" כבר
              מתרגם לפעולות. המנהל ראה "READY_TO_CHARGE: 256"
              למעלה, ו"256 מוכנות לחיוב → למסך תשלומים" למטה —
              אותו מספר, פעמיים, ורק אחד מהם אומר מה לעשות.

              ⚠️ תגיות סטטוס הן שפה של המערכת. הדשבורד מדבר
              בשפה של המנהל. */}
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

// §372: 💰 קוביית כסף — מספר אחד, בלי דוח.
//
// ⚠️ ארבע קוביות ולא טבלה: המנהל סורק אותן בשנייה, ולוחץ רק
// על מה שדורש פעולה.
function MoneyBox({
  label,
  value,
  sub,
  tone,
  href,
}: {
  label: string;
  value: number;
  sub?: string;
  tone: "slate" | "emerald" | "amber";
  href?: string;
}) {
  const tones = {
    slate: "border-zinc-200 bg-white text-brand-slatedark",
    emerald: "border-emerald-300 bg-emerald-50 text-emerald-900",
    amber: "border-amber-300 bg-amber-50 text-amber-900",
  };
  const body = (
    <div className={`rounded-xl border-2 p-3 ${tones[tone]}`}>
      <div className="text-[11px] font-bold opacity-70">{label}</div>
      <div className="text-lg font-extrabold tabular-nums mt-0.5">
        ₪
        {value.toLocaleString("he-IL", {
          minimumFractionDigits: 0,
          maximumFractionDigits: 0,
        })}
      </div>
      {sub && <div className="text-[10px] opacity-60 mt-0.5">{sub}</div>}
    </div>
  );
  return href ? (
    <a href={href} className="block hover:opacity-80 transition-opacity">
      {body}
    </a>
  ) : (
    body
  );
}
