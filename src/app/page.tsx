import Link from "next/link";
import { Logo } from "@/components/Logo";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export default async function Home() {
  const active = await prisma.pricelist.findFirst({
    where: { status: "ACTIVE" },
    orderBy: { createdAt: "desc" },
  });

  const now = new Date();
  const isOpen =
    !!active &&
    (!active.closeDate || now <= new Date(active.closeDate)) &&
    (!active.openDate || now >= new Date(active.openDate));

  return (
    <main className="min-h-screen bg-brand-yellow">
      <div className="mx-auto max-w-md px-5 pt-12 pb-10 flex flex-col items-center text-center">
        <Logo size={170} />

        <div className="mt-10 w-full card p-6">
          {isOpen ? (
            <>
              <h1 className="text-xl font-extrabold text-brand-slatedark">
                ההרשמה פתוחה — {active!.name}
              </h1>
              {active!.deliveryDateText && (
                <p className="mt-2 text-zinc-600">
                  חלוקה: {active!.deliveryDateText}
                </p>
              )}
              {active!.notes && (
                <p className="mt-3 text-sm text-zinc-500 leading-relaxed">{active!.notes}</p>
              )}
              <Link href="/order" className="btn-primary w-full mt-6 text-lg">
                להזמנה ←
              </Link>
            </>
          ) : (
            <>
              <h1 className="text-xl font-extrabold text-brand-slatedark">
                כרגע אין מכירה פתוחה להזמנות
              </h1>
              <p className="mt-2 text-zinc-600">ההרשמה תיפתח אי"ה בקרוב.</p>
            </>
          )}
        </div>

        <Link href="/admin" className="mt-8 text-sm text-brand-slate/70 underline">
          כניסת מנהל
        </Link>
      </div>
    </main>
  );
}
