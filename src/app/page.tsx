import Link from "next/link";
import { Logo } from "@/components/Logo";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function Home() {
  const session = await auth();
  const isLoggedIn = !!session?.user;
  const isAdmin = (session?.user as any)?.role === "ADMIN";

  const active = await prisma.pricelist.findFirst({
    where: { status: "ACTIVE" },
    orderBy: { createdAt: "desc" },
  });

  // האם מודול ההזמנות האישיות מופעל
  const settings = await prisma.systemSettings.findUnique({ where: { id: "singleton" } });
  const personalEnabled = settings?.personalOrdersEnabled ?? false;

  const now = new Date();
  const isOpen =
    !!active &&
    (!active.closeDate || now <= new Date(active.closeDate)) &&
    (!active.openDate || now >= new Date(active.openDate));

  return (
    <main
      dir="rtl"
      className="min-h-screen bg-soft-gradient"
    >
      <div className="mx-auto max-w-md px-5 pt-12 pb-10 flex flex-col items-center text-center">
        <Logo size={170} />

        <div className="mt-10 w-full card p-6">
          {isOpen ? (
            <>
              <h1 className="text-xl font-extrabold text-brand-slatedark">
                ההרשמה פתוחה — {active!.name}
              </h1>
              {active!.deliveryDateText && (
                <p className="mt-2 text-zinc-600">חלוקה: {active!.deliveryDateText}</p>
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

        {/* קישור התחברות / אזור אישי - תמיד זמין, גם כשאין מכירה פתוחה */}
        <div className="mt-8 flex flex-col items-center gap-3">
          {isLoggedIn ? (
            <>
              <p className="text-brand-slate">
                שלום, <span className="font-bold text-brand-rust">{(session!.user as any).name}</span>!
              </p>
              {isAdmin ? (
                <Link href="/admin" className="btn-ghost">
                  לאזור הניהול ←
                </Link>
              ) : (
                <Link href="/account" className="btn-ghost">
                  האזור האישי שלי ←
                </Link>
              )}
            </>
          ) : (
            <>
              <Link href="/login" className="btn-ghost">
                כניסה / התחברות
              </Link>
              <Link href="/register" className="text-sm text-brand-slate/70 underline">
                הרשמה לחשבון חדש
              </Link>
            </>
          )}
        </div>

        {/* הזמנה אישית - רק אם המודול מופעל */}
        {personalEnabled && (
          <div className="mt-6 text-center">
            <Link
              href="/personal-order"
              className="inline-flex items-center gap-2 btn-yellow"
            >
              🎁 הזמנה אישית — גם ללא מכירה פעילה
            </Link>
          </div>
        )}

        {/* יצירת קשר - בולט וברור */}
        <div className="mt-8 text-center">
          <a
            href="mailto:m5402088@gmail.com"
            className="inline-flex items-center gap-2 text-brand-rust font-medium hover:underline"
          >
            ✉️ ליצירת קשר: m5402088@gmail.com
          </a>
        </div>

        {/* footer - קישורי פרטיות ותנאים (חשוב לנגישות ולאמון) */}
        <footer className="mt-8 pt-6 border-t border-brand-slate/10 text-center">
          <div className="flex justify-center gap-4 text-xs text-brand-slate/60">
            <a href="/privacy" className="hover:text-brand-rust">מדיניות פרטיות</a>
            <span>·</span>
            <a href="/terms" className="hover:text-brand-rust">תנאי שימוש</a>
          </div>
          <p className="text-xs text-brand-slate/40 mt-2">
            © {new Date().getFullYear()} צדקת רבותינו
          </p>
        </footer>
      </div>
    </main>
  );
}
