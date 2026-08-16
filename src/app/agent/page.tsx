// המסך הראשי של הנציג - מציג את כל המכירות הפעילות שהוא משויך אליהן
// + קיצורי דרך למסכים חשובים
//
// §45: תמיכה בנציג רב-נקודתי. עד כה המסך השתמש ב-agentPoint היחיד
// (deprecated), ולכן נציג המשויך לכמה נקודות ראה "0 הזמנות בנקודה
// שלי" גם כשהיו לו הזמנות בנקודה השנייה.

import Link from "next/link";
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
          orders: {
            where: hasPoints
              ? { pointId: { in: myPointIds }, status: { notIn: ["CANCELLED"] } }
              : { status: { notIn: ["CANCELLED"] } },
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

  // סיכומי מכירות שלא נסגרו.
  // 🐛 תוקן כפילות: הסינון היה על *כל* הסיכומים הלא-מאושרים, כולל של
  // המכירה הפעילה - שממילא מופיעה ברשימה למטה. התוצאה הייתה שאותה
  // מכירה הופיעה פעמיים במסך. עכשיו מוצגות כאן רק מכירות שכבר אינן
  // פעילות ועדיין ממתינות לסגירת הנציג.
  const openSummaries = (
    await prisma.agentSaleSummary.findMany({
      where: { agentId, status: { not: "CONFIRMED" } },
      include: {
        pricelist: {
          select: { id: true, name: true, status: true, deliveryDate: true },
        },
      },
      orderBy: { createdAt: "desc" },
      take: 5,
    })
  ).filter((s) => !activeIds.has(s.pricelistId));

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
                המנהל צריך לשייך אותך לנקודת חלוקה במסך "נציגים".
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

        {/* קיצורי דרך */}
        <div className="grid grid-cols-2 gap-3">
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
                          new Date(s.pricelist.deliveryDate).toLocaleDateString("he-IL")}
                        · {s.totalCustomers} לקוחות · ₪{Number(s.totalCommission).toFixed(0)} עמלה
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
