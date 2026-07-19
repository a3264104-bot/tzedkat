import Link from "next/link";
import { LogoutButton } from "@/components/LogoutButton";
import { Logo } from "@/components/Logo";
import { CountdownTimer } from "@/components/CountdownTimer";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";

export const dynamic = "force-dynamic";

// פורמט תאריך לועזי+עברי (§6/§10)
function fmtDate(d: Date | string | null | undefined): string {
  if (!d) return "";
  try {
    return new Date(d).toLocaleDateString("he-IL", {
      weekday: "long",
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
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

  return (
    <main dir="rtl" className="min-h-screen bg-brand-cream">
      {/* h1 סמנטי לנגישות ו-SEO - נסתר ויזואלית */}
      <h1 className="sr-only">צדקת רבותינו — הזמנת עופות, בשר ודגים</h1>

      <div className="mx-auto max-w-lg md:max-w-2xl px-4 pt-6 md:pt-10 pb-10">
        {/* §8: כיתוב מעל הלוגו */}
        <p className="text-center text-brand-rust font-extrabold text-lg mb-3 tracking-tight">
          המכירה המוזלת עופות בשר ודגים
        </p>

        {/* לוגו */}
        <div className="flex justify-center mb-5 md:mb-6">
          <Logo size={160} />
        </div>

        {/* ברכת שלום ללקוח מחובר */}
        {isLoggedIn && userName && (
          <p className="text-center text-brand-slate mb-5 text-sm">
            שלום, <span className="font-bold text-brand-rust">{userName}</span>
          </p>
        )}

        <div className="space-y-4">
          {/* ═════ כרטיס מכירה ═════ */}
          {isOpen ? (
            <section
              aria-labelledby="sale-heading"
              className="relative bg-white rounded-2xl shadow-lg border border-brand-rust/20 overflow-hidden"
            >
              {/* Header עם רקע צבעוני עדין */}
              <div className="bg-gradient-to-l from-brand-rust to-[#a83a15] text-white px-6 py-5">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <h2 id="sale-heading" className="text-xl md:text-2xl font-extrabold">
                      מכירה פעילה
                    </h2>
                    <p className="text-white/90 text-sm mt-0.5">
                      המערכת פתוחה לקבלת הזמנות
                    </p>
                  </div>
                  <div className="bg-white/20 backdrop-blur-sm rounded-full w-14 h-14 flex items-center justify-center border border-white/30">
                    <div className="w-3 h-3 bg-white rounded-full animate-pulse" aria-hidden="true"></div>
                  </div>
                </div>
              </div>

              {/* Countdown timer - אם יש closeDate */}
              {active!.closeDate && (
                <CountdownTimer targetDate={active!.closeDate.toISOString()} />
              )}

              {/* פרטי תאריכים */}
              <div className="px-6 py-5 space-y-3">
                {active!.openDate && (
                  <DateRow
                    icon="open"
                    label="נפתחה"
                    value={fmtDate(active!.openDate)}
                  />
                )}
                {active!.closeDate && (
                  <DateRow
                    icon="close"
                    label="סגירת הזמנות"
                    value={fmtDate(active!.closeDate)}
                    highlight
                  />
                )}
                {active!.editDeadline && (
                  <DateRow
                    icon="lock"
                    label="נעילת שינויים"
                    value={fmtDate(active!.editDeadline)}
                  />
                )}
              </div>

              {/* CTA button - בולט */}
              <div className="px-6 pb-6">
                <Link
                  href="/order"
                  className="block w-full bg-brand-rust hover:bg-[#a83a15] text-white text-center py-3.5 rounded-xl font-bold text-base transition-all shadow-md hover:shadow-lg hover:-translate-y-0.5"
                >
                  להתחלת ההזמנה
                </Link>
              </div>
            </section>
          ) : (
            <section className="bg-white rounded-2xl shadow-lg border border-zinc-200 p-8 text-center">
              <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-zinc-100 flex items-center justify-center">
                <svg className="w-8 h-8 text-zinc-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <h2 className="text-xl font-extrabold text-brand-slatedark">
                אין מכירה פתוחה כעת
              </h2>
              <p className="text-zinc-500 text-sm mt-2">
                ההרשמה למכירה הבאה תיפתח בקרוב, בע&quot;ה
              </p>
            </section>
          )}

          {/* ═════ §9: הזמנה אישית — מוצגת רק כשאין מכירה פעילה ═════ */}
          {personalEnabled && !isOpen && (
            <section
              aria-labelledby="personal-heading"
              className="card p-6 ring-2 ring-brand-yellow shadow-md"
            >
              <div className="flex items-center gap-3 mb-3">
                <div className="text-3xl" aria-hidden="true">🎁</div>
                <h2 id="personal-heading" className="text-lg font-extrabold text-brand-slatedark">
                  הזמנה אישית
                </h2>
              </div>
              <p className="text-zinc-600 text-sm mb-4">
                להזמנת מוצרים מיוחדים — זמין כאשר אין מכירה פעילה.
              </p>
              <Link href="/personal-order" className="btn-yellow w-full text-base">
                להזמנה אישית ←
              </Link>
            </section>
          )}

          {/* ═════ אזור אישי / כניסה ═════ */}
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

// קומפוננט עזר - שורת תאריך עם אייקון SVG (לא אימוג'י)
function DateRow({
  icon,
  label,
  value,
  highlight,
}: {
  icon: "open" | "close" | "lock";
  label: string;
  value: string;
  highlight?: boolean;
}) {
  const iconPaths: Record<string, string> = {
    open: "M8 11V7a4 4 0 118 0m-4 8v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2z",
    close: "M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z",
    lock: "M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z",
  };
  return (
    <div className={`flex items-start gap-3 ${highlight ? "" : ""}`}>
      <div
        className={`shrink-0 w-9 h-9 rounded-lg flex items-center justify-center ${
          highlight ? "bg-brand-rust/10 text-brand-rust" : "bg-zinc-100 text-zinc-500"
        }`}
      >
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d={iconPaths[icon]} />
        </svg>
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-xs text-zinc-500 font-medium">{label}</div>
        <div className={`text-sm font-semibold ${highlight ? "text-brand-rust" : "text-brand-slatedark"}`}>
          {value}
        </div>
      </div>
    </div>
  );
}
