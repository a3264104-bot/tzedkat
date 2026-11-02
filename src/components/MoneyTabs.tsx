"use client";

// 🧭 לשוניות בתוך מסכי הכספים — כמה מסכים קרובים תחת כותרת אחת.
// בתפריט יש ארבעה מסכי כספים בלבד; המסכים הישנים הם לשוניות כאן,
// והכתובות שלהם לא השתנו (קישורים ישנים ממשיכים לעבוד).

import Link from "next/link";
import { usePathname } from "next/navigation";

const HUBS = {
  income: [
    { href: "/admin/agent-income", label: "📥 כמה נכנס" },
    { href: "/admin/payment-audit", label: "🗒️ יומן מזומן" },
  ],
  debts: [
    { href: "/admin/debts", label: "💰 חובות לקוחות" },
    { href: "/admin/debt-ledger", label: "📒 ספר החובות" },
    { href: "/admin/credits", label: "↩️ זיכויים ויתרות" },
  ],
} as const;

export function MoneyTabs({ hub }: { hub: keyof typeof HUBS }) {
  const pathname = usePathname();
  return (
    <div className="flex gap-1 border-b border-zinc-200 mb-3 overflow-x-auto">
      {HUBS[hub].map((t) => {
        const active = pathname === t.href || pathname.startsWith(t.href + "/");
        return (
          <Link
            key={t.href}
            href={t.href}
            className={`px-3 py-2 text-sm font-bold whitespace-nowrap border-b-2 -mb-px ${
              active
                ? "border-brand-rust text-brand-rust"
                : "border-transparent text-zinc-500 hover:text-brand-slatedark"
            }`}
          >
            {t.label}
          </Link>
        );
      })}
    </div>
  );
}
