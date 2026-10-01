"use client";

// ═══════════════════════════════════════════════════════════════
// §397: 🧭 שלושת מסכי הסיכום — מה כל אחד עונה, ומתי הולכים אליו
// ═══════════════════════════════════════════════════════════════
// הבעיה: "סיכום מכירה", "בקרת מכירה" ו"דוחות" נשמעים אותו דבר.
// המנהל לא ידע לאן ללכת, ומצא את אותו נתון בשני מקומות בצורה שונה.
//
// ✅ כל מסך עונה על שאלה אחת, והפס הזה מופיע בראש שלושתם:
//   📦 סיכום מכירה  — מה הוזמן?        (כמויות → הזמנה מהספק)
//   📊 בקרת מכירה   — מה קרה בפועל?    (משקלים, כסף, נציגים → סגירה)
//   📈 דוחות        — רשימות ויצוא      (לקוחות, סטטוסים, אקסל)
//
// ⚠️ המכירה עוברת איתך: הקישורים נושאים את המכירה הנבחרת, והבחירה
// נשמרת גם לבורר המרכזי (§380) — כך שמעבר לתשלומים/הזמנות נפתח על
// אותה מכירה.

import Link from "next/link";

const KEY = "tzidkat.selectedPricelistId";

/** שמירת המכירה לבורר המרכזי (דשבורד, הזמנות, תשלומים, זיכויים) */
export function rememberSale(pricelistId: string | null | undefined) {
  if (!pricelistId) return;
  try {
    localStorage.setItem(KEY, pricelistId);
  } catch {
    // דפדפן בלי אחסון — לא קריטי
  }
}

/** המכירה האחרונה שנבחרה בכל מסך (או ריק) */
export function recallSale(): string {
  try {
    const v = localStorage.getItem(KEY) || "";
    return v.startsWith("__") ? "" : v; // צבירות (__all__) אינן מכירה אחת
  } catch {
    return "";
  }
}

/**
 * קישור למסך מנהל שעובד עם הבורר המרכזי — שומר קודם את המכירה,
 * כדי שהמסך ייפתח עליה ולא על ברירת המחדל.
 */
export function SaleLink({
  href,
  pricelistId,
  className,
  children,
}: {
  href: string;
  pricelistId: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <Link href={href} className={className} onClick={() => rememberSale(pricelistId)}>
      {children}
    </Link>
  );
}

type Current = "summary" | "control" | "reports" | null;

const ITEMS: {
  id: Exclude<Current, null>;
  icon: string;
  title: string;
  question: string;
  when: string;
  href: (id: string) => string;
}[] = [
  {
    id: "summary",
    icon: "📦",
    title: "סיכום מכירה",
    question: "מה הוזמן?",
    when: "כמויות לכל מוצר ונקודה — להזמנה מהספק ולהכנה",
    href: (id) => `/admin/sale-summary${id ? `?pricelistId=${id}` : ""}`,
  },
  {
    id: "control",
    icon: "📊",
    title: "בקרת מכירה",
    question: "מה קרה בפועל?",
    when: "תעודות מול חלוקה, כסף שנכנס וחסר, נציגים — לסגירת המכירה",
    href: (id) => `/admin/sale-control${id ? `/${id}` : ""}`,
  },
  {
    id: "reports",
    icon: "📈",
    title: "דוחות ויצוא",
    question: "צריך רשימה או קובץ?",
    when: "לקוחות, סטטוסים, מקורות הזמנה, ייצוא לאקסל",
    href: (id) => `/admin/reports${id ? `?pricelistId=${id}` : ""}`,
  },
];

export function ReportsNav({
  current,
  pricelistId,
}: {
  current: Current;
  pricelistId?: string | null;
}) {
  const id = pricelistId ?? "";
  return (
    <nav
      aria-label="מסכי סיכום"
      className="no-print grid grid-cols-1 sm:grid-cols-3 gap-2"
    >
      {ITEMS.map((it) => {
        const active = it.id === current;
        return (
          <Link
            key={it.id}
            href={it.href(id)}
            onClick={() => rememberSale(id)}
            aria-current={active ? "page" : undefined}
            className={`rounded-xl border-2 px-3 py-2 transition-colors ${
              active
                ? "border-brand-rust bg-brand-rust/5"
                : "border-zinc-200 bg-white hover:border-brand-rust/50"
            }`}
          >
            <div className="flex items-center gap-1.5">
              <span className="text-lg" aria-hidden="true">
                {it.icon}
              </span>
              <span className="font-extrabold text-brand-slatedark text-sm">{it.title}</span>
              {active && (
                <span className="text-[10px] font-bold bg-brand-rust text-white rounded px-1.5 py-0.5 mr-auto">
                  אתה כאן
                </span>
              )}
            </div>
            <div className="text-xs font-bold text-brand-rust mt-0.5">{it.question}</div>
            <div className="text-[11px] text-zinc-600 leading-snug">{it.when}</div>
          </Link>
        );
      })}
    </nav>
  );
}
