import Link from "next/link";
import { LogoutButton } from "@/components/LogoutButton";
import { Logo } from "@/components/Logo";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";

export const dynamic = "force-dynamic";

// פורמט תאריך קצר בעברית
function fmtDate(d: Date | string | null | undefined): string {
  if (!d) return "";
  try {
    return new Date(d).toLocaleDateString("he-IL", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    });
  } catch {
    return "";
  }
}

export default async function Home() {
  const session = await auth();
  const isLoggedIn = !!session?.user;
  const isAdmin = (session?.user as any)?.role === "ADMIN";
  const userName = (session?.user as any)?.name || "";

  const active = await prisma.pricelist.findFirst({
    where: { status: "ACTIVE" },
    orderBy: { createdAt: "desc" },
  });

  const settings = await prisma.systemSettings.findUnique({ where: { id: "singleton" } });
  const personalEnabled = settings?.personalOrdersEnabled ?? false;

  const now = new Date();
  const isOpen =
    !!active &&
    (!active.closeDate || now <= new Date(active.closeDate)) &&
    (!active.openDate || now >= new Date(active.openDate));

  // הכרטיס הראשי - איזה משלושת הכרטיסים מקבל הדגשה
  // אם מכירה פתוחה → מכירה; אחרת אם הזמנות אישיות מופעלות → אישית; אחרת אף אחד.
  const primary: "sale" | "personal" | null = isOpen
    ? "sale"
    : personalEnabled
    ? "personal"
    : null;

  return (
    <main dir="rtl" className="min-h-screen bg-soft-gradient">
      {/* h1 סמנטי לנגישות ו-SEO - נסתר ויזואלית */}
      <h1 className="sr-only">צדקת רבותינו — הזמנת עופות, בשר ודגים</h1>

      <div className="mx-auto max-w-lg px-4 pt-8 md:pt-12 pb-10">
        {/* לוגו */}
        <div className="flex justify-center mb-6 md:mb-8">
          <Logo size={180} />
        </div>

        {/* ברכת שלום ללקוח מחובר */}
        {isLoggedIn && userName && (
          <p className="text-center text-brand-slate mb-6">
            שלום, <span className="font-bold text-brand-rust">{userName}</span>
          </p>
        )}

        {/* שלושת הכרטיסים - מכירה, הזמנה אישית, אזור אישי/כניסה */}
        <div className="space-y-4">
          {/* ═════ כרטיס 1: מכירה ═════ */}
          <section
            aria-labelledby="sale-heading"
            className={`card p-6 transition ${
              primary === "sale" ? "ring-2 ring-brand-rust shadow-md" : ""
            }`}
          >
            <div className="flex items-center gap-3 mb-3">
              <div className="text-3xl" aria-hidden="true">🛒</div>
              <h2 id="sale-heading" className="text-lg font-extrabold text-brand-slatedark">
                {isOpen ? "מכירה פעילה" : "הזמנה מהמכירה"}
              </h2>
            </div>

            {isOpen ? (
              <>
                <div className="text-brand-rust font-bold text-lg">{active!.name}</div>

                <div className="mt-3 space-y-1.5 text-sm text-zinc-600">
                  {active!.deliveryDateText && (
                    <div className="flex items-start gap-2">
                      <span aria-hidden="true">📅</span>
                      <span>חלוקה: {active!.deliveryDateText}</span>
                    </div>
                  )}
                  {active!.closeDate && (
                    <div className="flex items-start gap-2">
                      <span aria-hidden="true">⏰</span>
                      <span>ההרשמה נסגרת: {fmtDate(active!.closeDate)}</span>
                    </div>
                  )}
                </div>

                {active!.notes && (
                  <p className="mt-3 text-sm text-zinc-500 leading-relaxed border-t border-zinc-100 pt-3">
                    {active!.notes}
                  </p>
                )}

                <Link href="/order" className="btn-primary w-full mt-5 text-base">
                  להזמנה ←
                </Link>
              </>
            ) : (
              <p className="text-zinc-500 text-sm mt-1">
                כרגע אין מכירה פתוחה. ההרשמה תיפתח אי"ה בקרוב.
              </p>
            )}
          </section>

          {/* ═════ כרטיס 2: הזמנה אישית ═════ */}
          {personalEnabled && (
            <section
              aria-labelledby="personal-heading"
              className={`card p-6 transition ${
                primary === "personal" ? "ring-2 ring-brand-yellow shadow-md" : ""
              }`}
            >
              <div className="flex items-center gap-3 mb-3">
                <div className="text-3xl" aria-hidden="true">🎁</div>
                <h2 id="personal-heading" className="text-lg font-extrabold text-brand-slatedark">
                  הזמנה אישית
                </h2>
              </div>
              <p className="text-zinc-600 text-sm mb-4">
                להזמנת מוצרים מיוחדים — זמין גם כאשר אין מכירה פעילה.
              </p>
              <Link href="/personal-order" className="btn-yellow w-full text-base">
                להזמנה אישית ←
              </Link>
            </section>
          )}

          {/* ═════ כרטיס 3: אזור אישי / כניסה ═════ */}
          <section aria-labelledby="account-heading" className="card p-6">
            <div className="flex items-center gap-3 mb-3">
              <div className="text-3xl" aria-hidden="true">
                {isLoggedIn ? "👤" : "🔑"}
              </div>
              <h2 id="account-heading" className="text-lg font-extrabold text-brand-slatedark">
                {isLoggedIn ? (isAdmin ? "אזור הניהול" : "האזור האישי שלי") : "כניסה לחשבון"}
              </h2>
            </div>

            {isLoggedIn ? (
              <>
                <p className="text-zinc-600 text-sm mb-4">
                  {isAdmin
                    ? "ניהול הזמנות, מוצרים, לקוחות ודוחות."
                    : "צפייה בהזמנות שלך, ניהול פרטי חשבון ותשלומים."}
                </p>
                <Link
                  href={isAdmin ? "/admin" : "/account"}
                  className="btn-ghost w-full text-base"
                >
                  {isAdmin ? "לאזור הניהול ←" : "לאזור האישי ←"}
                </Link>
                <div className="mt-3 flex justify-center">
                  <LogoutButton />
                </div>
              </>
            ) : (
              <>
                <p className="text-zinc-600 text-sm mb-4">
                  להתחברות לחשבון קיים או להרשמה חדשה.
                </p>
                <Link href="/login" className="btn-ghost w-full text-base">
                  כניסה / התחברות ←
                </Link>
                <div className="mt-3 text-center">
                  <Link
                    href="/register"
                    className="text-sm text-brand-rust hover:underline font-medium"
                  >
                    אין לך חשבון? הרשמה חדשה
                  </Link>
                </div>
              </>
            )}
          </section>
        </div>

        {/* יצירת קשר */}
        <div className="mt-8 text-center">
          <a
            href="mailto:m5402088@gmail.com"
            className="inline-flex items-center gap-2 text-brand-rust font-medium hover:underline"
          >
            <span aria-hidden="true">✉️</span>
            <span>ליצירת קשר: m5402088@gmail.com</span>
          </a>
        </div>

        {/* footer */}
        <footer className="mt-8 pt-6 border-t border-brand-slate/10 text-center">
          <nav className="flex justify-center gap-4 text-xs text-brand-slate/60">
            <a href="/privacy" className="hover:text-brand-rust">
              מדיניות פרטיות
            </a>
            <span aria-hidden="true">·</span>
            <a href="/terms" className="hover:text-brand-rust">
              תנאי שימוש
            </a>
          </nav>
          <p className="text-xs text-brand-slate/40 mt-2">
            © {new Date().getFullYear()} צדקת רבותינו
          </p>
        </footer>
      </div>
    </main>
  );
}
