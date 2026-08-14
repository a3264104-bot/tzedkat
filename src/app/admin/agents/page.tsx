// §20: רשימת נציגים למנהל - עם פרטים מלאים + לינקים לפרופיל
import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import Link from "next/link";
import { AddAgentButton } from "./AddAgentButton";

export const dynamic = "force-dynamic";

export default async function AdminAgentsPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const role = (session.user as any).role as string;
  if (role !== "ADMIN") redirect("/");

  // רשימת נציגים עם פרטים מלאים
  const agents = await prisma.customer.findMany({
    where: { role: { in: ["AGENT", "ADMIN"] } },
    select: {
      id: true,
      name: true,
      phone: true,
      email: true,
      role: true,
      agentPoint: { select: { id: true, name: true, city: true } },
      commissionRateCarton: true,
      commissionRateSingles: true,
      createdAt: true,
    },
    orderBy: [{ role: "asc" }, { name: "asc" }],
  });

  // סטטיסטיקות לכל נציג
  const agentIds = agents.map((a) => a.id);
  const summaryStats = await prisma.agentSaleSummary.groupBy({
    by: ["agentId"],
    where: { agentId: { in: agentIds } },
    _sum: { totalCommission: true },
    _count: true,
  });
  const statsMap = new Map(
    summaryStats.map((s) => [
      s.agentId,
      {
        totalCommission: Number(s._sum.totalCommission || 0),
        totalSales: s._count,
      },
    ])
  );

  const activeAgents = agents.filter((a) => a.role === "AGENT");
  const admins = agents.filter((a) => a.role === "ADMIN");

  return (
    <div dir="rtl" className="min-h-screen bg-brand-cream pb-20">
      <header className="bg-brand-yellow border-b-4 border-brand-rust/20">
        <div className="mx-auto max-w-6xl px-4 py-3 flex items-center justify-between">
          <Link href="/admin" className="text-brand-slate font-medium text-sm">
            ← חזרה לניהול
          </Link>
          <h1 className="font-extrabold text-brand-slatedark">
            👥 נציגים ומנהלים
          </h1>
          <AddAgentButton />
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-5 space-y-5">
        {/* בנר מידע */}
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 text-sm text-blue-900">
          <strong>לחץ על נציג</strong> לפתיחת פרופיל מלא, עריכת פרטים, איפוס סיסמא והצגת היסטוריית מכירות ותשלומים.
        </div>

        {/* סטטיסטיקה עליונה */}
        <div className="grid grid-cols-3 gap-3">
          <StatCard label="נציגים" value={String(activeAgents.length)} color="rust" />
          <StatCard label="מנהלים" value={String(admins.length)} color="red" />
          <StatCard
            label="עמלות סה״כ"
            value={`₪${activeAgents.reduce((s, a) => s + (statsMap.get(a.id)?.totalCommission || 0), 0).toFixed(0)}`}
            color="emerald"
          />
        </div>

        {/* נציגים */}
        {activeAgents.length > 0 && (
          <div className="bg-white rounded-2xl border border-zinc-200 shadow-sm overflow-hidden">
            <div className="px-5 py-3 border-b border-zinc-200 bg-zinc-50 flex items-center justify-between">
              <div className="font-bold text-brand-slatedark">
                נציגים ({activeAgents.length})
              </div>
            </div>
            <div className="divide-y divide-zinc-100">
              {activeAgents.map((agent) => {
                const stats = statsMap.get(agent.id);
                return (
                  <Link
                    key={agent.id}
                    href={`/admin/agents/${agent.id}/profile`}
                    className="block p-4 hover:bg-zinc-50 transition-colors"
                  >
                    <div className="flex items-start gap-3">
                      <div className="w-12 h-12 rounded-full bg-gradient-to-br from-brand-rust to-[#a83a15] flex items-center justify-center text-white text-lg font-extrabold shadow-sm shrink-0">
                        {agent.name.charAt(0)}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-bold text-brand-slatedark text-base">
                            {agent.name}
                          </span>
                          {agent.agentPoint ? (
                            <span className="text-[10px] bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full font-bold">
                              📍 {agent.agentPoint.name}
                            </span>
                          ) : (
                            <span className="text-[10px] bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full font-bold">
                              ⚠️ ללא נקודה
                            </span>
                          )}
                        </div>

                        <div className="mt-1.5 grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-0.5 text-xs">
                          {agent.phone && (
                            <div className="flex items-center gap-1.5">
                              <span className="text-zinc-500">📞</span>
                              <span
                                className="text-brand-slate font-mono"
                                dir="ltr"
                              >
                                {agent.phone}
                              </span>
                            </div>
                          )}
                          {agent.email && (
                            <div className="flex items-center gap-1.5">
                              <span className="text-zinc-500">📧</span>
                              <span className="text-brand-slate truncate" dir="ltr">
                                {agent.email}
                              </span>
                            </div>
                          )}
                          <div className="flex items-center gap-1.5">
                            <span className="text-zinc-500">💰</span>
                            <span className="text-brand-slate">
                              ₪{Number(agent.commissionRateCarton).toFixed(0)}/
                              ₪{Number(agent.commissionRateSingles).toFixed(0)} ל-ק"ג
                            </span>
                          </div>
                        </div>

                        {stats && stats.totalSales > 0 && (
                          <div className="mt-1.5 text-xs text-zinc-500">
                            {stats.totalSales} מכירות · עמלה מצטברת:{" "}
                            <strong className="text-brand-rust">
                              ₪{stats.totalCommission.toFixed(2)}
                            </strong>
                          </div>
                        )}
                      </div>

                      <div className="shrink-0 flex flex-col items-end gap-1">
                        <span className="text-xs text-brand-rust font-bold whitespace-nowrap">
                          פרופיל ←
                        </span>
                      </div>
                    </div>
                  </Link>
                );
              })}
            </div>
          </div>
        )}

        {/* מנהלים */}
        {admins.length > 0 && (
          <div className="bg-white rounded-2xl border border-zinc-200 shadow-sm overflow-hidden">
            <div className="px-5 py-3 border-b border-zinc-200 bg-zinc-50">
              <div className="font-bold text-brand-slatedark">
                מנהלים ({admins.length})
              </div>
            </div>
            <div className="divide-y divide-zinc-100">
              {admins.map((admin) => (
                <Link
                  key={admin.id}
                  href={`/admin/agents/${admin.id}/profile`}
                  className="block p-4 hover:bg-zinc-50 transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-gradient-to-br from-red-500 to-red-700 flex items-center justify-center text-white font-bold shadow-sm shrink-0">
                      {admin.name.charAt(0)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="font-bold text-brand-slatedark">
                        {admin.name}
                      </div>
                      <div className="text-xs text-zinc-500 mt-0.5" dir="ltr">
                        {admin.phone && `${admin.phone} · `}
                        {admin.email}
                      </div>
                    </div>
                    <span className="text-xs text-brand-rust font-bold">פרופיל ←</span>
                  </div>
                </Link>
              ))}
            </div>
          </div>
        )}

        {activeAgents.length === 0 && admins.length === 0 && (
          <div className="bg-white rounded-2xl border border-zinc-200 p-10 text-center">
            <p className="text-brand-slatedark font-semibold">
              אין נציגים או מנהלים במערכת
            </p>
            <p className="text-xs text-zinc-500 mt-1">
              נציג הוא לקוח קיים שהוגדר כנציג. השתמש בכפתור "הוסף נציג"
              למעלה כדי לבחור לקוח ולהפוך אותו לנציג.
            </p>
          </div>
        )}
      </main>
    </div>
  );
}

function StatCard({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color: "rust" | "red" | "emerald";
}) {
  const colorMap = {
    rust: "bg-orange-50 text-brand-rust border-orange-200",
    red: "bg-red-50 text-red-700 border-red-200",
    emerald: "bg-emerald-50 text-emerald-700 border-emerald-200",
  }[color];
  return (
    <div className={`rounded-xl border p-3 ${colorMap}`}>
      <div className="text-xs font-bold opacity-80">{label}</div>
      <div className="text-2xl font-extrabold mt-1">{value}</div>
    </div>
  );
}
