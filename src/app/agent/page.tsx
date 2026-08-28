// המסך הראשי של הנציג - מציג את כל המכירות הפעילות שהוא משויך אליהן
// + קיצורי דרך למסכים חשובים
//
// §45: תמיכה בנציג רב-נקודתי. עד כה המסך השתמש ב-agentPoint היחיד
// (deprecated), ולכן נציג המשויך לכמה נקודות ראה "0 הזמנות בנקודה
// שלי" גם כשהיו לו הזמנות בנקודה השנייה.

import Link from "next/link";
// §200: תאריכים בשעון ישראל — השרת רץ ב-UTC
import { fmtDate } from "@/lib/date-lib";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { SignOutBtn } from "./AgentHeader";
import { AgentAddCustomerButton } from "@/components/AgentAddCustomerButton";

export const dynamic = "force-dynamic";

export default async function AgentIndexPage() {
  const session = await auth();
  if (!session?.user) redirect("/login?callbackUrl=/agent");

  const role = (session.user as any).role;
  if (role !== "AGENT" && role !== "ADMIN") redirect("/account");

  const agentId = (session.user as any).id as string;

  const agent = await prisma.customer.findUnique({
    where: { id: agentId },
    select: {
      id: true,
      name: true,
      phone: true,
      agentPointId: true,
      agentPoint: { select: { id: true, name: true, city: true } },
      // §45: כל הנקודות (many-to-many)
      agentPoints: {
        select: { point: { select: { id: true, name: true, city: true } } },
      },
      commissionRateCarton: true,
      commissionRateSingles: true,
      // §277: הרשאת מוקד טלפוני — משנה את הספירה למטה
      canManagePhoneRequests: true,
    },
  });

  if (!agent) redirect("/login");

  // §45: כל נקודות הנציג. נפילה ל-agentPoint הישן לנציגים שטרם הועברו.
  const myPoints =
    agent.agentPoints.length > 0
      ? agent.agentPoints.map((ap) => ap.point)
      : agent.agentPoint
        ? [agent.agentPoint]
        : [];
  const myPointIds = myPoints.map((p) => p.id);
  const hasPoints = myPointIds.length > 0;

  // כל המכירות הפעילות
  const activePricelists = await prisma.pricelist.findMany({
    where: { status: "ACTIVE" },
    orderBy: { createdAt: "desc" },
    include: {
      _count: {
        select: {
          // התנאים חייבים להיות בתוך where - זו הדרישה של Prisma
          // בספירה מסוננת (_count.select.<relation>.where).
          // §186: 🚨 נציג בלי נקודות ראה את **כל** ההזמנות.
          //
          // `hasPoints ? ... : { כל ההזמנות }` - כלומר נציג שטרם
          // שויך לנקודה קיבל את מספר ההזמנות של כל המערכת, ולחץ
          // עליהן וראה לקוחות של נציגים אחרים.
          //
          // ⚠️ אותו דפוס שתוקן ב-§176 בארבעה מקומות. כאן הוא נשאר
          // כי הוא כתוב אחרת (ternary ולא `length > 0`).
          //
          // ⚠️ מנהל מזוהה ב-role ולא בהיעדר נקודות.
          orders: {
            where:
              role === "ADMIN"
                ? { status: { notIn: ["CANCELLED"] } }
                : {
                    pointId: { in: hasPoints ? myPointIds : ["__none__"] },
                    status: { notIn: ["CANCELLED"] },
                  },
          },
        },
      },
    },
  });
  const activeIds = new Set(activePricelists.map((p) => p.id));

  // §45: פילוח ההזמנות לפי נקודה - נציג רב-נקודתי צריך לדעת כמה בכל
  // אחת, לא רק סך הכל.
  const perPointCounts =
    myPointIds.length > 1 && activeIds.size > 0
      ? await prisma.order.groupBy({
          by: ["pricelistId", "pointId"],
          where: {
            pricelistId: { in: Array.from(activeIds) },
            pointId: { in: myPointIds },
            status: { notIn: ["CANCELLED"] },
          },
          _count: { _all: true },
        })
      : [];
  const countsByPricelist = new Map<string, { name: string; count: number }[]>();
  for (const row of perPointCounts) {
    // pricelistId ו-pointId ניתנים ל-null בסכמה, ולכן נדרשת בדיקה
    // מפורשת לפני השימוש כמפתח.
    const plId = row.pricelistId;
    if (!plId) continue;
    const pt = myPoints.find((p) => p.id === row.pointId);
    if (!pt) continue;
    const arr = countsByPricelist.get(plId) || [];
    arr.push({ name: pt.name, count: row._count._all });
    countsByPricelist.set(plId, arr);
  }

  // §149: בקשות הרשמה טלפוניות ממתינות בנקודות של הנציג.
  //
  // ⚠️ הספירה כאן ולא במסך הבקשות: הנציג צריך לראות שיש משהו
  // לטפל בו **בלי להיכנס**. מסך שצריך לבדוק כל יום הוא מסך
  // שלא נבדק.
  //
  // ⚠️ hasPoints נבדק לפני: נציג בלי נקודות אינו רואה בקשות כלל,
  // וספירה בלי הסינון הייתה מציגה לו את כל המערכת.
  // §317: הקישור לרשימת הלקוחות — ראה JSX למטה.

  // §277: 📞 מוקד טלפוני רואה את **כל** הבקשות.
  //
  // ⚠️ בלי זה הכרטיס היה מראה לו "3 ממתינות" (הנקודות שלו)
  // בזמן שיש 30 במערכת - והוא היה חושב שסיים.
  const isPhoneDesk = (agent as any)?.canManagePhoneRequests === true;

  const pendingSignups = isPhoneDesk
    ? await prisma.phoneSignupRequest.count({
        where: { status: { in: ["NEW", "ASSIGNED", "CONTACTED"] } },
      })
    : hasPoints
    ? await prisma.phoneSignupRequest.count({
        where: {
          pointId: { in: myPointIds },
          status: { in: ["NEW", "ASSIGNED", "CONTACTED"] },
        },
      })
    : 0;

  // סיכומי מכירות שלא נסגרו.
  // 🐛 תוקן כפילות: הסינון היה על *כל* הסיכומים הלא-מאושרים, כולל של
  // המכירה הפעילה - שממילא מופיעה ברשימה למטה. התוצאה הייתה שאותה
  // מכירה הופיעה פעמיים במסך. עכשיו מוצגות כאן רק מכירות שכבר אינן
  // פעילות ועדיין ממתינות לסגירת הנציג.
  // §224: 🐛 **נציג שלא פתח את המסך לא ראה כלום.**
  //
  // מה שקרה בשטח: הנציג בירושלים (26 הזמנות בנקודה שלו) ראה
  // "אין כרגע מכירות פעילות" - בזמן שנציג אחר עם 4 הזמנות ראה
  // את המכירה תחת "ממתינות לסגירה".
  //
  // הסיבה: הרשימה נשענה על agentSaleSummary, שנוצר **רק כשהנציג
  // פותח את מסך המכירה**. מי שלא פתח - אין לו רשומה, ולכן אין
  // לו מכירה. כלומר: כדי לראות שיש לך עבודה, היית צריך כבר
  // לדעת שיש לך עבודה.
  //
  // ⚠️ עכשיו הרשימה נבנית מ**הזמנות בנקודות שלו** - מקור האמת
  // האמיתי. הסיכום מצורף אם קיים, ואם לא - המכירה עדיין מוצגת.
  const summaries = await prisma.agentSaleSummary.findMany({
    where: { agentId, status: { not: "CONFIRMED" } },
    include: {
      pricelist: {
        select: { id: true, name: true, status: true, deliveryDate: true },
      },
    },
    orderBy: { createdAt: "desc" },
    take: 10,
  });
  const summaryByPricelist = new Map(summaries.map((s) => [s.pricelistId, s]));

  // ⚠️ מכירות שאינן פעילות אך יש בהן הזמנות בנקודות של הנציג.
  //
  // ⚠️ נציג בלי נקודות מקבל רשימה ריקה ולא את הכל - אותו כלל
  // אבטחה של §176/§186.
  const salesWithMyOrders = hasPoints
    ? await prisma.pricelist.findMany({
        where: {
          id: { notIn: Array.from(activeIds) },
          status: { in: ["CLOSED", "DONE"] },
          orders: {
            some: {
              pointId: { in: myPointIds },
              status: { notIn: ["CANCELLED"] },
            },
          },
        },
        select: { id: true, name: true, status: true, deliveryDate: true },
        orderBy: { createdAt: "desc" },
        take: 5,
      })
    : [];

  // ⚠️ איחוד: מכירות עם הזמנות + מכירות שכבר יש להן סיכום פתוח.
  // השנייה תופסת מקרה קצה - נציג שסגר נקודה אחרי שהזמינו בה.
  const openSummaries = [
    ...salesWithMyOrders.map((pl) => ({
      id: summaryByPricelist.get(pl.id)?.id ?? `pending-${pl.id}`,
      pricelistId: pl.id,
      pricelist: pl,
      status: summaryByPricelist.get(pl.id)?.status ?? "PENDING",
      // ⚠️ מכירה בלי סיכום עדיין מוצגת - עם אפסים. זה בדיוק
      // המסר: "יש כאן עבודה שלא התחלת".
      totalCustomers: summaryByPricelist.get(pl.id)?.totalCustomers ?? 0,
      totalCommission: Number(
        summaryByPricelist.get(pl.id)?.totalCommission ?? 0
      ),
    })),
    ...summaries
      .filter(
        (s) =>
          !activeIds.has(s.pricelistId) &&
          !salesWithMyOrders.some((pl) => pl.id === s.pricelistId)
      )
      .map((s) => ({
        id: s.id,
        pricelistId: s.pricelistId,
        pricelist: s.pricelist,
        status: s.status,
        totalCustomers: s.totalCustomers,
        totalCommission: Number(s.totalCommission),
      })),
  ].slice(0, 5);

  return (
    <div dir="rtl" className="min-h-screen bg-brand-cream pb-20">
      {/* Header */}
      <header className="bg-brand-yellow border-b-4 border-brand-rust/20">
        <div className="mx-auto max-w-4xl px-4 py-4 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="text-xs font-bold text-brand-slate">אזור הנציג</div>
            <h1 className="font-extrabold text-brand-slatedark text-lg truncate">
              שלום, {agent.name}
            </h1>
            {/* §45: כל הנקודות, לא רק הראשונה */}
            {myPoints.length > 0 && (
              <div className="text-xs text-brand-slate mt-0.5">
                📍{" "}
                {myPoints
                  .map((p) => (p.city ? `${p.name} — ${p.city}` : p.name))
                  .join(" · ")}
              </div>
            )}
          </div>
          <SignOutBtn />
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-4 py-5 space-y-5">
        {/* אזהרה אם אין נקודה */}
        {!hasPoints && (
          <div className="bg-amber-50 border-2 border-amber-300 rounded-2xl p-4 flex items-start gap-3">
            <div className="text-2xl">⚠️</div>
            <div className="flex-1">
              <div className="font-bold text-amber-900">
                אין נקודת חלוקה משויכת
              </div>
              <div className="text-xs text-amber-800 mt-1">
                המנהל צריך לשייך אותך לנקודת חלוקה במסך &quot;נציגים&quot;.
              </div>
            </div>
          </div>
        )}

        {/* כפתור בולט - בצע הזמנה ללקוח (חיפוש/יצירה + ניווט אוטומטי) */}
        {hasPoints && (
          <div className="bg-gradient-to-l from-emerald-500 to-emerald-600 rounded-2xl p-4 shadow-md">
            <div className="flex items-center gap-3 mb-3 text-white">
              <div className="text-3xl">🛒</div>
              <div className="flex-1">
                <div className="font-extrabold text-lg">בצע הזמנה ללקוח</div>
                <div className="text-xs text-white/90">
                  חיפוש לקוח קיים או הוספה מהירה
                </div>
              </div>
            </div>
            <AgentAddCustomerButton
              className="w-full justify-center bg-white text-emerald-700 hover:bg-emerald-50"
            />
          </div>
        )}

        {/* §149: בקשות הרשמה ממתינות.

            ⚠️ מוצג **רק כשיש** בקשות. כרטיס עם "0 בקשות" הוא רעש
            שהנציג לומד להתעלם ממנו, וביום שתגיע בקשה אמיתית הוא
            יפספס אותה.

            ⚠️ מעל קיצורי הדרך: זו פעולה שממתינה, ולא כלי שפותחים
            כשצריך. */}
        {/* §317: 🧑 רשימת הלקוחות של הנציג.
            
            הפער: הנציג הכיר את הלקוחות שלו רק דרך מכירה פעילה.
            לקוח שהתקשר לעדכן כרטיס בין מכירות - לא הייתה דרך
            להגיע אליו.
            
            ⚠️ רק הנקודות שלו: נציג שרואה את כל 296 הלקוחות
            רואה טלפונים של לקוחות נציגים אחרים. */}
        <a
          href="/agent/customers"
          className="flex items-center justify-between gap-2 bg-white rounded-xl border-2 border-zinc-200 px-4 py-3 hover:border-brand-rust transition-colors"
        >
          <div className="text-right">
            <div className="font-bold text-brand-slatedark">🧑 הלקוחות שלי</div>
            <div className="text-[11px] text-zinc-500">
              עדכון כרטיס, פרטים ואמצעי תשלום
            </div>
          </div>
          <span className="text-zinc-400">←</span>
        </a>

        {pendingSignups > 0 && (
          <Link
            href="/agent/signups"
            className="block bg-amber-50 border-2 border-amber-300 rounded-2xl p-4 hover:border-amber-400 transition-colors"
          >
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-xl bg-amber-100 flex items-center justify-center text-2xl shrink-0">
                📞
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-extrabold text-amber-900">
                  {pendingSignups}{" "}
                  {pendingSignups === 1 ? "בקשת הרשמה" : "בקשות הרשמה"} ממתינות
                </div>
                <div className="text-xs text-amber-800 mt-0.5">
                  לקוחות שנרשמו בטלפון וממתינים שתזין להם כרטיס אשראי
                </div>
              </div>
              <div className="text-amber-700 text-2xl shrink-0">←</div>
            </div>
          </Link>
        )}

        {/* קיצורי דרך */}
        <div className="grid grid-cols-2 gap-3">
          {/* §149: קישור קבוע - כדי שיהיה אפשר לראות גם בקשות
              שכבר טופלו, לא רק את הממתינות. */}
          <Link
            href="/agent/signups"
            className="bg-white border border-zinc-200 rounded-2xl p-4 hover:border-brand-rust/40 hover:shadow-sm transition-all"
          >
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-xl bg-amber-50 flex items-center justify-center text-2xl shrink-0">
                📞
              </div>
              <div className="min-w-0">
                <div className="font-bold text-brand-slatedark">
                  בקשות הרשמה
                </div>
                <div className="text-xs text-zinc-500">
                  {pendingSignups > 0
                    ? `${pendingSignups} ממתינות לכרטיס`
                    : "מהטלפון"}
                </div>
              </div>
            </div>
          </Link>

          <Link
            href="/agent/my-debts"
            className="bg-white border border-zinc-200 rounded-2xl p-4 hover:border-brand-rust/40 hover:shadow-sm transition-all"
          >
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-xl bg-purple-50 flex items-center justify-center text-2xl shrink-0">
                💰
              </div>
              <div className="min-w-0">
                <div className="font-bold text-brand-slatedark">
                  היתרות שלי
                </div>
                <div className="text-xs text-zinc-500">
                  עמלות ותשלומים
                </div>
              </div>
            </div>
          </Link>

          <div className="bg-white border border-zinc-200 rounded-2xl p-4">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-xl bg-orange-50 flex items-center justify-center text-2xl shrink-0">
                🎯
              </div>
              <div className="min-w-0">
                <div className="font-bold text-brand-slatedark text-sm">
                  ₪{Number(agent.commissionRateCarton).toFixed(0)}
                  <span className="text-zinc-400 mx-1">/</span>
                  ₪{Number(agent.commissionRateSingles).toFixed(0)}
                </div>
                <div className="text-[10px] text-zinc-500">
                  עמלה קרטון / בודדים
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* מכירות שנסגרו וטרם סוכמו */}
        {openSummaries.length > 0 && (
          <section className="bg-amber-50 border border-amber-200 rounded-2xl overflow-hidden">
            <div className="px-4 py-2.5 bg-amber-100 border-b border-amber-200">
              <div className="font-bold text-amber-900 text-sm">
                ⏳ ממתינות לסגירה שלך
              </div>
              <div className="text-[10px] text-amber-700 mt-0.5">
                מכירות שהסתיימו ועדיין לא סגרת בהן את הסיכום
              </div>
            </div>
            <div className="divide-y divide-amber-200/60">
              {openSummaries.map((s) => (
                <Link
                  key={s.id}
                  href={`/agent/sale/${s.pricelistId}`}
                  className="block p-3 hover:bg-amber-100/50 transition-colors"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="font-bold text-amber-900 truncate text-sm">
                        {s.pricelist.name}
                      </div>
                      <div className="text-[10px] text-amber-700 mt-0.5">
                        {s.pricelist.deliveryDate &&
                          fmtDate(s.pricelist.deliveryDate)}
                        {/* §224: מכירה שטרם נפתחה מציגה "טרם נסגרה"
                            במקום "0 לקוחות · ₪0" - שנראה כאילו אין
                            שם כלום, בזמן שיש 26 הזמנות שממתינות. */}
                        {s.totalCustomers > 0
                          ? ` · ${s.totalCustomers} לקוחות · ₪${s.totalCommission.toFixed(0)} עמלה`
                          : " · טרם נפתחה — יש הזמנות ממתינות"}
                      </div>
                    </div>
                    <span className="text-xs text-amber-800 font-bold">←</span>
                  </div>
                </Link>
              ))}
            </div>
          </section>
        )}

        {/* רשימת מכירות פעילות */}
        <section>
          <h2 className="font-bold text-brand-slatedark mb-3">
            מכירות פעילות
          </h2>
          {activePricelists.length === 0 ? (
            <div className="bg-white rounded-2xl border border-zinc-200 p-8 text-center">
              <div className="text-4xl mb-2">😴</div>
              <p className="text-brand-slatedark font-semibold">
                אין כרגע מכירות פעילות
              </p>
              <p className="text-xs text-zinc-500 mt-1">
                המסך יתעדכן אוטומטית כשתיפתח מכירה חדשה
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {activePricelists.map((pl) => {
                const perPoint = countsByPricelist.get(pl.id) || [];
                return (
                  <Link
                    key={pl.id}
                    href={`/agent/sale/${pl.id}`}
                    className="block bg-white border border-zinc-200 rounded-2xl p-4 hover:border-brand-rust/40 hover:shadow-md transition-all"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <div className="font-extrabold text-brand-slatedark">
                            {pl.name}
                          </div>
                          <span className="text-[10px] bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full font-bold">
                            פעילה
                          </span>
                        </div>
                        {pl.deliveryDate && (
                          <div className="text-xs text-zinc-500 mt-1">
                            📅 חלוקה: {new Date(pl.deliveryDate).toLocaleDateString("he-IL", {
                    // §200: השרת רץ ב-UTC — בלי זה 3 שעות אחורה
                    timeZone: "Asia/Jerusalem",
                              weekday: "long",
                              day: "2-digit",
                              month: "2-digit",
                            })}
                          </div>
                        )}
                        {/* §45: הניסוח "בנקודה שלי" היה שגוי לנציג
                            רב-נקודתי. עכשיו סך הכל, ומתחתיו פילוח. */}
                        <div className="text-xs text-brand-rust font-bold mt-1">
                          {pl._count.orders} הזמנות
                          {myPoints.length === 1 && ` בנקודה שלי`}
                          {myPoints.length > 1 && ` בכל הנקודות שלי`}
                        </div>
                        {perPoint.length > 0 && (
                          <div className="flex flex-wrap gap-1.5 mt-1.5">
                            {perPoint.map((p) => (
                              <span
                                key={p.name}
                                className="text-[10px] bg-zinc-100 text-zinc-600 px-2 py-0.5 rounded-full"
                              >
                                📍 {p.name} · {p.count}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                      <div className="text-brand-rust text-2xl shrink-0">←</div>
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
        </section>

        {role === "ADMIN" && (
          <div className="pt-4 border-t border-zinc-200">
            <Link
              href="/admin"
              className="block text-center text-sm text-brand-rust font-bold hover:underline"
            >
              🔧 לאזור הניהול ←
            </Link>
          </div>
        )}
      </main>
    </div>
  );
}
