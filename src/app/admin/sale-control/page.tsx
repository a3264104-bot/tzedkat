// §20: עמוד רשימת מכירות לבחירת בקרת מכירה
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function SaleControlIndexPage() {
  // כל המכירות הפעילות + הסגורות מהחודש האחרון
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const baseWhere = {
    OR: [
      { status: { in: ["ACTIVE", "CLOSED"] } },
      {
        status: "DONE",
        deliveryDate: { gte: thirtyDaysAgo },
      },
    ],
  };
  const include = {
    _count: {
      select: {
        orders: { where: { status: { notIn: ["CANCELLED"] } } },
      },
    },
  } satisfies Prisma.PricelistInclude;

  // §396: 🔁 רגילות ושבועיות בנפרד. שבוע נפתח כל שבוע, ובלי ההפרדה
  // הרשימה הייתה טובעת בשבועות והמכירה הגדולה נדחקת למטה.
  //
  // §398: 🐛 ההפרדה הייתה **אחרי** take: 30 — אחרי כמה חודשים 30
  // השורות היו כולן שבועות סגורים, והמכירה החודשית נעלמה מהרשימה.
  // עכשיו שתי שאילתות, וכל אחת עם מכסה משלה.
  const [regular, weekly] = await Promise.all([
    prisma.pricelist.findMany({
      where: { ...baseWhere, weeklySeriesId: null },
      orderBy: [{ deliveryDate: "desc" }, { createdAt: "desc" }],
      include,
      take: 30,
    }),
    prisma.pricelist.findMany({
      where: {
        weeklySeriesId: { not: null },
        // ⚠️ CLOSED בכל גיל (כמו ברגילות) — שבוע שלא הוסדר לא נעלם
        // מהרשימה אחרי חודש. DONE — רק מהחודש האחרון.
        OR: [
          { status: { in: ["ACTIVE", "CLOSED"] } },
          { status: "DONE", deliveryDate: { gte: thirtyDaysAgo } },
        ],
      },
      orderBy: [{ deliveryDate: "desc" }, { createdAt: "desc" }],
      include,
      take: 20,
    }),
  ]);

  return (
    <div dir="rtl" className="min-h-screen bg-brand-cream pb-20">
      <header className="bg-brand-yellow border-b-4 border-brand-rust/20">
        <div className="mx-auto max-w-4xl px-4 py-3 flex items-center justify-between">
          <Link href="/admin" className="text-brand-slate font-medium text-sm">
            ← חזרה לניהול
          </Link>
          <h1 className="font-extrabold text-brand-slatedark">
            📊 בקרת מכירה
          </h1>
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-4 py-6">
        <div className="mb-4 bg-blue-50 border border-blue-200 rounded-xl p-3 text-sm text-blue-900">
          <strong>בחר מכירה</strong> כדי לראות דו״ח מלא: פערי משקלים בין תעודות למה שחולק, נציגים, כספים, חובות והתראות.
        </div>

        {regular.length + weekly.length === 0 ? (
          <div className="bg-white rounded-2xl border border-zinc-200 p-8 text-center">
            <p className="text-brand-slatedark font-semibold">אין מכירות זמינות</p>
            <p className="text-xs text-zinc-500 mt-1">
              המערכת מציגה מכירות פעילות ומכירות שהסתיימו לאחרונה (30 יום)
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {[
              { title: "מכירות רגילות", rows: regular },
              { title: "🔁 מכירות שבועיות", rows: weekly },
            ].filter((g) => g.rows.length > 0).map((g) => (
              <section key={g.title} className="space-y-3">
                {regular.length > 0 && weekly.length > 0 && (
                  <h2 className="font-bold text-brand-slatedark pt-2">{g.title}</h2>
                )}
            {g.rows.map((p) => (
              <Link
                key={p.id}
                href={`/admin/sale-control/${p.id}`}
                className="block bg-white rounded-2xl border border-zinc-200 shadow-sm p-4 hover:shadow-md hover:border-brand-rust transition-all"
              >
                <div className="flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <span className="font-bold text-brand-slatedark">
                        {p.name}
                      </span>
                      <StatusBadge status={p.status} />
                      {p.weeklySeriesId && (
                        <span className="text-[10px] bg-violet-100 text-violet-800 px-2 py-0.5 rounded-full font-bold">
                          🔁 שבועית
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-zinc-500 flex items-center gap-3 flex-wrap">
                      {p.deliveryDate && (
                        <span>
                          📅{" "}
                          {new Date(p.deliveryDate).toLocaleDateString("he-IL", {
                            weekday: "long",
                            day: "numeric",
                            month: "long",
                            year: "numeric",
                          })}
                        </span>
                      )}
                      <span>📦 {p._count.orders} הזמנות</span>
                    </div>
                  </div>
                  <svg className="w-5 h-5 text-zinc-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
                  </svg>
                </div>
              </Link>
            ))}
              </section>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  if (status === "ACTIVE") {
    return (
      <span className="text-[10px] bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full font-bold">
        פעיל
      </span>
    );
  }
  if (status === "CLOSED") {
    return (
      <span className="text-[10px] bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full font-bold">
        נסגר להזמנות
      </span>
    );
  }
  if (status === "DONE") {
    return (
      <span className="text-[10px] bg-zinc-100 text-zinc-600 px-2 py-0.5 rounded-full font-bold">
        הושלם
      </span>
    );
  }
  return null;
}
