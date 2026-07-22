// §20: מסך הנציג הראשי - רשימת מכירות פעילות + קישורים
import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import Link from "next/link";
import { signOutBtn } from "./AgentHeader";

export const dynamic = "force-dynamic";

export default async function AgentPage() {
  const session = await auth();
  if (!session?.user) {
    redirect("/login?callbackUrl=/agent");
  }

  const userId = (session.user as any).id as string;
  const role = (session.user as any).role as string;
  if (role !== "AGENT" && role !== "ADMIN") {
    redirect("/");
  }

  const agent = await prisma.customer.findUnique({
    where: { id: userId },
    select: {
      id: true,
      name: true,
      role: true,
      agentPointId: true,
      agentPoint: { select: { id: true, name: true, city: true } },
      commissionRateCarton: true,
      commissionRateSingles: true,
    },
  });

  if (!agent) {
    redirect("/login");
  }

  // מכירות פעילות + מכירות שנסגרו לאחרונה (30 יום אחרונים)
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const pricelists = await prisma.pricelist.findMany({
    where: {
      OR: [
        { status: { in: ["ACTIVE", "CLOSED"] } },
        {
          status: "DONE",
          deliveryDate: { gte: thirtyDaysAgo },
        },
      ],
    },
    orderBy: [{ deliveryDate: "desc" }, { createdAt: "desc" }],
    include: {
      _count: {
        select: {
          orders: agent.agentPointId
            ? { where: { pointId: agent.agentPointId, status: { notIn: ["CANCELLED"] } } }
            : { where: { status: { notIn: ["CANCELLED"] } } },
        },
      },
      agentSaleSummaries: {
        where: { agentId: agent.id },
        select: {
          status: true,
          totalCommission: true,
          totalCustomers: true,
          totalWalkins: true,
        },
      },
    },
    take: 20,
  });

  return (
    <div dir="rtl" className="min-h-screen bg-brand-cream pb-20">
      {/* Header */}
      <header className="bg-brand-yellow border-b-4 border-brand-rust/20">
        <div className="mx-auto max-w-4xl px-4 py-4">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-full bg-gradient-to-br from-brand-rust to-[#a83a15] flex items-center justify-center text-white text-xl font-extrabold shadow-md">
                {agent.name.charAt(0)}
              </div>
              <div>
                <div className="font-extrabold text-brand-slatedark">
                  שלום, {agent.name}
                </div>
                <div className="text-xs text-brand-slate">
                  {agent.agentPoint
                    ? `📍 ${agent.agentPoint.name}${agent.agentPoint.city ? ` — ${agent.agentPoint.city}` : ""}`
                    : "כל הנקודות"}
                </div>
              </div>
            </div>
            {signOutBtn()}
          </div>

          {/* מידע על עמלה */}
          <div className="bg-white/50 backdrop-blur-sm rounded-lg px-3 py-2 text-xs text-brand-slatedark border border-white/60">
            <span className="font-bold">העמלה שלך:</span>{" "}
            ₪{Number(agent.commissionRateCarton).toFixed(0)} לק"ג קרטונים ·{" "}
            ₪{Number(agent.commissionRateSingles).toFixed(0)} לק"ג בודדים
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-4 py-6">
        {/* אזהרה אם נציג בלי נקודה */}
        {role === "AGENT" && !agent.agentPointId && (
          <div className="mb-4 bg-amber-50 border-2 border-amber-300 rounded-2xl p-4 flex items-start gap-3">
            <div className="w-10 h-10 rounded-full bg-amber-200 flex items-center justify-center shrink-0">
              <svg className="w-5 h-5 text-amber-700" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
            </div>
            <div className="flex-1">
              <div className="font-bold text-amber-900">אין נקודת חלוקה משויכת</div>
              <div className="text-xs text-amber-800 mt-1">
                עדיין לא שויכת לנקודת חלוקה. פנה למנהל כדי שיוסיף אותך לנקודה, אחרת לא תוכל לפתוח מסך חלוקה.
              </div>
            </div>
          </div>
        )}

        <div className="flex items-center gap-3 mb-4">
          <div className="w-1 h-6 bg-brand-rust rounded-full"></div>
          <h2 className="font-extrabold text-brand-slatedark text-lg">
            המכירות שלי
          </h2>
        </div>

        {pricelists.length === 0 ? (
          <div className="bg-white rounded-2xl border border-zinc-200 p-8 text-center">
            <div className="w-14 h-14 mx-auto mb-3 rounded-full bg-zinc-100 flex items-center justify-center">
              <svg className="w-7 h-7 text-zinc-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
              </svg>
            </div>
            <p className="text-brand-slatedark font-semibold">אין מכירות פעילות כרגע</p>
            <p className="text-sm text-zinc-500 mt-1">
              כשהמנהל יפתח מכירה חדשה, היא תופיע כאן
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {pricelists.map((p) => {
              const summary = p.agentSaleSummaries[0];
              const orderCount = p._count.orders;
              return (
                <div
                  key={p.id}
                  className="bg-white rounded-2xl border border-zinc-200 shadow-sm overflow-hidden"
                >
                  {/* Header */}
                  <div className="p-4 border-b border-zinc-100">
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <div className="flex-1 min-w-0">
                        <div className="font-bold text-brand-slatedark">
                          {p.name}
                        </div>
                        {p.deliveryDate && (
                          <div className="text-xs text-zinc-500 mt-0.5">
                            📅{" "}
                            {new Date(p.deliveryDate).toLocaleDateString("he-IL", {
                              weekday: "long",
                              day: "numeric",
                              month: "long",
                            })}
                          </div>
                        )}
                      </div>
                      <StatusBadge status={p.status} summaryStatus={summary?.status} />
                    </div>

                    <div className="flex items-center gap-3 text-xs text-brand-slate">
                      <span>📦 {orderCount} הזמנות</span>
                      {summary && summary.totalWalkins > 0 && (
                        <span>👥 {summary.totalWalkins} מזדמנים</span>
                      )}
                      {summary && Number(summary.totalCommission) > 0 && (
                        <span className="text-brand-rust font-bold">
                          💰 ₪{Number(summary.totalCommission).toFixed(2)}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="p-3 bg-zinc-50 flex gap-2">
                    <Link
                      href={`/agent/sale/${p.id}`}
                      className="flex-1 py-2.5 rounded-lg bg-brand-rust text-white text-center font-bold text-sm hover:bg-[#a83a15] shadow-sm"
                    >
                      פתח מסך חלוקה →
                    </Link>
                    <a
                      href={`/api/agent/export-sale/${p.id}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="py-2.5 px-4 rounded-lg bg-emerald-600 text-white text-center font-bold text-sm hover:bg-emerald-700 shadow-sm inline-flex items-center gap-1.5"
                      title="הורד דוח Excel להדפסה"
                    >
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                      </svg>
                      Excel
                    </a>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* קישור לחובות שלי (עתידי - יבוא בסבב הבא) */}
        <div className="mt-6 bg-white rounded-2xl border border-zinc-200 shadow-sm overflow-hidden">
          <Link href="/agent/my-debts" className="block p-4 hover:bg-zinc-50">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-emerald-100 flex items-center justify-center">
                <svg className="w-5 h-5 text-emerald-700" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1" />
                </svg>
              </div>
              <div className="flex-1">
                <div className="font-bold text-brand-slatedark">
                  היתרה שלי
                </div>
                <div className="text-xs text-zinc-500">
                  היסטוריית תשלומים ועמלות
                </div>
              </div>
              <svg className="w-5 h-5 text-zinc-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
              </svg>
            </div>
          </Link>
        </div>
      </main>
    </div>
  );
}

function StatusBadge({ status, summaryStatus }: { status: string; summaryStatus?: string }) {
  if (summaryStatus === "CONFIRMED") {
    return (
      <span className="text-xs bg-emerald-100 text-emerald-700 px-2.5 py-1 rounded-full font-bold whitespace-nowrap">
        ✓ סגרתי
      </span>
    );
  }
  if (status === "ACTIVE") {
    return (
      <span className="text-xs bg-blue-100 text-blue-700 px-2.5 py-1 rounded-full font-bold whitespace-nowrap">
        פעיל
      </span>
    );
  }
  if (status === "CLOSED") {
    return (
      <span className="text-xs bg-amber-100 text-amber-700 px-2.5 py-1 rounded-full font-bold whitespace-nowrap">
        נסגר להזמנות
      </span>
    );
  }
  if (status === "DONE") {
    return (
      <span className="text-xs bg-zinc-100 text-zinc-600 px-2.5 py-1 rounded-full font-bold whitespace-nowrap">
        הושלם
      </span>
    );
  }
  return null;
}
