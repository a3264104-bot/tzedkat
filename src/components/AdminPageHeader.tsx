// כותרת אחידה למסכי הניהול.
//
// ⚠️ עד עכשיו היו שני עיצובים: רוב המסכים עם כותרת נקייה, ו-11 מסכים
// ישנים עם פס צהוב וכפתור "← חזרה לניהול" — מיותר כשיש תפריט צד, והחץ
// אף הצביע לכיוון הלא נכון ב-RTL. כאן: אותה כותרת לכולם, ו"חזרה" רק
// במסכי משנה (פרופיל נציג, בקרת משקלים...) — אל המסך שממנו הגיעו.

import Link from "next/link";

export function AdminPageHeader({
  title,
  subtitle,
  back,
  actions,
}: {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  /** רק במסכי משנה — הקישור למסך האב */
  back?: { href: string; label: string };
  actions?: React.ReactNode;
}) {
  return (
    <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        {back && (
          <Link href={back.href} className="text-sm font-bold text-brand-rust hover:underline">
            → {back.label}
          </Link>
        )}
        <h1 className={`text-2xl font-extrabold text-brand-slatedark ${back ? "mt-1" : ""}`}>{title}</h1>
        {subtitle && <p className="mt-0.5 text-xs text-zinc-500">{subtitle}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
}
