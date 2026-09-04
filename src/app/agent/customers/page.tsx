// ═══════════════════════════════════════════════════════════════
// §317: רשימת הלקוחות של הנציג
// ═══════════════════════════════════════════════════════════════
// הצורך: הנציג הכיר את הלקוחות שלו רק דרך מכירה פעילה. לקוח
// שהתקשר לעדכן כרטיס בין מכירות - לא הייתה דרך להגיע אליו.
//
// ⚠️ **רק הנקודות שלו**: זו הנקודה הרגישה כאן. נציג שרואה את
// כל 296 הלקוחות רואה טלפונים וכתובות של לקוחות נציגים אחרים,
// וזו דליפת מידע ולא נוחות.
//
// ⚠️ אותו כלל שייכות של §55: לקוח שהוא יצר, או ששייך לאחת
// מנקודותיו, או שהזמין בהן בעבר.

import { prisma } from "@/lib/prisma";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function AgentCustomersPage() {
  const session = await auth();
  const role = (session?.user as any)?.role;
  const userId = (session?.user as any)?.id as string;

  if (!session?.user || (role !== "AGENT" && role !== "ADMIN")) {
    redirect("/login");
  }

  // ─── הנקודות של הנציג ───
  const agent = await prisma.customer.findUnique({
    where: { id: userId },
    select: {
      agentPointId: true,
      agentPoints: { select: { pointId: true } },
    },
  });

  const myPointIds =
    agent && agent.agentPoints.length > 0
      ? agent.agentPoints.map((ap) => ap.pointId)
      : agent?.agentPointId
        ? [agent.agentPointId]
        : [];

  // ⚠️ מערך ריק אצל נציג פירושו "אין לו נקודות" ולא "בלי
  // הגבלה" - ההבחנה שנשכחה ב-§70 וחזרה כמה פעמים מאז.
  const isAdmin = role === "ADMIN";

  if (!isAdmin && myPointIds.length === 0) {
    return (
      <div dir="rtl" className="min-h-screen bg-brand-cream p-4">
        <div className="max-w-3xl mx-auto bg-white rounded-2xl border p-6 text-center">
          <p className="font-bold text-brand-slatedark">
            אין לך נקודת חלוקה משויכת
          </p>
          <p className="text-xs text-zinc-500 mt-1">פנה למנהל.</p>
        </div>
      </div>
    );
  }

  // ⚠️ שלושת מסלולי השייכות (§55): נקודת ברירת מחדל, הזמנה
  // בנקודה, או יצירה ע"י הנציג. לקוח יכול להגיע דרך כל אחד.
  const customers = await prisma.customer.findMany({
    where: {
      role: "CUSTOMER",
      isActive: true,
      ...(isAdmin
        ? {}
        : {
            OR: [
              { defaultPointId: { in: myPointIds } },
              { createdByAgentId: userId },
              { orders: { some: { pointId: { in: myPointIds } } } },
            ],
          }),
    },
    select: {
      id: true,
      name: true,
      lastName: true,
      phone: true,
      paymentPreference: true,
      cardLast4: true,
      cardExpiry: true,
      cardNeedsUpdate: true,
      paymentToken: true,
      defaultPoint: { select: { name: true } },
    },
    orderBy: { name: "asc" },
  });

  // ⚠️ מיון לפי שם משפחה (§233): הנציג מחפש "ניימן", לא "משה".
  // נפילה למילה האחרונה בשם המלא, כי 386 לקוחות טרם פוצלו.
  const sorted = [...customers].sort((a, b) => {
    const ln = (c: (typeof customers)[0]) =>
      c.lastName?.trim() ||
      (c.name || "").trim().split(/\s+/).slice(-1)[0] ||
      "";
    const r = ln(a).localeCompare(ln(b), "he");
    return r !== 0 ? r : (a.name || "").localeCompare(b.name || "", "he");
  });

  const needsCard = sorted.filter(
    (c) => c.paymentPreference !== "CASH" && !c.paymentToken
  ).length;

  return (
    <div dir="rtl" className="min-h-screen bg-brand-cream pb-20">
      <header className="bg-brand-yellow border-b-4 border-brand-rust/20">
        <div className="mx-auto max-w-3xl px-4 py-3 flex items-center justify-between">
          <Link href="/agent" className="text-brand-slate font-medium text-sm">
            ← אזור הנציג
          </Link>
          <h1 className="font-extrabold text-brand-slatedark">
            🧑 הלקוחות שלי ({sorted.length})
          </h1>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 py-4 space-y-2">
        {/* ⚠️ הבאנר רק כשיש בעיה: מספר "0 ללא כרטיס" הוא רעש
            שמאמן את העין לדלג על האזור הזה. */}
        {needsCard > 0 && (
          <div className="rounded-xl bg-amber-50 border border-amber-300 px-3 py-2 text-xs text-amber-900">
            💳 <b>{needsCard} לקוחות ללא אמצעי תשלום</b> — לא יוכלו להזמין
            עד שיוזן כרטיס או שיסומנו כמזומן.
          </div>
        )}

        {sorted.length === 0 && (
          <div className="bg-white rounded-2xl border p-6 text-center text-sm text-zinc-500">
            אין לקוחות בנקודות שלך
          </div>
        )}

        {sorted.map((c) => {
          const isCash = c.paymentPreference === "CASH";
          const hasCard = !!c.paymentToken;
          // §359: 📞 החיוג מחוץ ל-Link.
          //
          // ⚠️ a בתוך a הוא HTML לא חוקי, ו-onClick לא עובד
          // ב-Server Component. הפתרון: שני קישורים אחים —
          // הכרטיס והטלפון — ולא מקוננים.
          return (
            <div
              key={c.id}
              className="flex items-stretch gap-1"
            >
            <Link
              href={`/agent/customer/${c.id}`}
              className="flex-1 min-w-0 block bg-white rounded-xl border border-zinc-200 p-3 hover:border-brand-rust transition-colors"
            >
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="font-bold text-brand-slatedark truncate">
                    {c.name}
                  </div>
                  <div className="text-xs text-zinc-500" dir="ltr">
                    {c.phone}
                  </div>
                  {c.defaultPoint && (
                    <div className="text-[11px] text-zinc-400 truncate">
                      📍 {c.defaultPoint.name}
                    </div>
                  )}
                </div>

                {/* ⚠️ הסטטוס בצבע: הנציג סורק רשימה ארוכה ומחפש
                    את מי שצריך טיפול. אדום קופץ, ירוק לא. */}
                <div className="shrink-0 text-left">
                  {isCash ? (
                    <span className="text-[11px] font-bold bg-zinc-100 text-zinc-700 px-2 py-1 rounded">
                      💵 מזומן
                    </span>
                  ) : hasCard ? (
                    <span
                      className={`text-[11px] font-bold px-2 py-1 rounded ${
                        c.cardNeedsUpdate
                          ? "bg-red-100 text-red-700"
                          : "bg-emerald-100 text-emerald-700"
                      }`}
                    >
                      {c.cardNeedsUpdate ? "⚠️ נדרש עדכון" : `💳 ${c.cardLast4}`}
                    </span>
                  ) : (
                    <span className="text-[11px] font-bold bg-amber-100 text-amber-800 px-2 py-1 rounded">
                      ✗ אין כרטיס
                    </span>
                  )}
                </div>
              </div>
            </Link>
            {c.phone && (
              <a
                href={`tel:${c.phone.replace(/\D/g, "")}`}
                className="shrink-0 flex items-center justify-center w-11 rounded-xl border border-zinc-200 bg-white hover:border-emerald-400 hover:bg-emerald-50 text-lg"
                title={`התקשר ל-${c.phone}`}
              >
                📞
              </a>
            )}
            </div>
          );
        })}
      </main>
    </div>
  );
}
