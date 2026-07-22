// §20: מסך הנציג למכירה - server component
import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { AgentSaleClient } from "./AgentSaleClient";

export const dynamic = "force-dynamic";

export default async function AgentSalePage({
  params,
}: {
  params: Promise<{ pricelistId: string }>;
}) {
  const { pricelistId } = await params;
  const session = await auth();

  if (!session?.user) {
    redirect(`/login?callbackUrl=/agent/sale/${pricelistId}`);
  }
  const userId = (session.user as any).id as string;
  const role = (session.user as any).role as string;
  if (role !== "AGENT" && role !== "ADMIN") {
    redirect("/");
  }

  // בדיקה מהירה שהמחירון קיים
  const pricelist = await prisma.pricelist.findUnique({
    where: { id: pricelistId },
    select: { id: true, name: true },
  });
  if (!pricelist) {
    return (
      <div dir="rtl" className="min-h-screen bg-brand-cream flex items-center justify-center p-6">
        <div className="bg-white rounded-2xl p-8 shadow-lg text-center max-w-md">
          <div className="w-14 h-14 mx-auto mb-3 rounded-full bg-red-100 flex items-center justify-center">
            <svg className="w-7 h-7 text-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          </div>
          <h1 className="text-xl font-bold text-brand-slatedark">מחירון לא נמצא</h1>
          <p className="text-sm text-zinc-500 mt-2">
            ייתכן שהמכירה נמחקה. חזור לרשימה ונסה שוב.
          </p>
          <a
            href="/agent"
            className="mt-5 inline-block px-5 py-2 bg-brand-rust text-white rounded-lg font-bold"
          >
            חזרה לרשימת המכירות
          </a>
        </div>
      </div>
    );
  }

  // בדיקה שהנציג משויך לנקודה (אלא אם הוא מנהל)
  if (role === "AGENT") {
    const agent = await prisma.customer.findUnique({
      where: { id: userId },
      select: { agentPointId: true },
    });
    if (!agent?.agentPointId) {
      return (
        <div dir="rtl" className="min-h-screen bg-brand-cream flex items-center justify-center p-6">
          <div className="bg-white rounded-2xl p-8 shadow-lg text-center max-w-md">
            <div className="w-14 h-14 mx-auto mb-3 rounded-full bg-amber-100 flex items-center justify-center">
              <svg className="w-7 h-7 text-amber-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            </div>
            <h1 className="text-xl font-bold text-brand-slatedark">אין נקודת חלוקה משויכת</h1>
            <p className="text-sm text-zinc-500 mt-2">
              המנהל צריך לשייך אותך לנקודת חלוקה לפני שתוכל לעבוד עם המכירה.
              <br />
              פנה למנהל.
            </p>
            <a
              href="/agent"
              className="mt-5 inline-block px-5 py-2 bg-brand-rust text-white rounded-lg font-bold"
            >
              חזרה
            </a>
          </div>
        </div>
      );
    }
  }

  return <AgentSaleClient pricelistId={pricelistId} />;
}
