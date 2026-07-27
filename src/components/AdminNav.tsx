"use client";

// תפריט אדמין מקובץ - מחליף את התפריט הישן ה"עמוס"
// קיבוץ ל-6 קטגוריות מתקפלות:
//   1. דשבורד (עצמאי - קיצור דרך)
//   2. מכירות ← הזמנות/משקלים/תעודות/בקרה/סיכום
//   3. מוצרים ← מוצרים/מחירונים/נקודות
//   4. לקוחות ← לקוחות/חובות/בקשות אישיות
//   5. נציגים ← נציגים/חובות נציגים
//   6. פיננסי ← תשלומים/דוחות

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, useEffect } from "react";

type NavItem = {
  href: string;
  label: string;
  icon: string;
};

type NavGroup = {
  id: string;
  label: string;
  icon: string;
  items: NavItem[];
};

const NAV_GROUPS: NavGroup[] = [
  {
    id: "sales",
    label: "מכירות",
    icon: "📦",
    items: [
      { href: "/admin/orders", label: "הזמנות", icon: "🧾" },
      { href: "/admin/pending-weights", label: "משקלים ממתינים", icon: "⚖️" },
      { href: "/admin/delivery-notes", label: "תעודות משלוח", icon: "📄" },
      { href: "/admin/sale-control", label: "בקרת מכירה", icon: "📊" },
      { href: "/admin/sale-summary", label: "סיכום מכירה", icon: "📑" },
    ],
  },
  {
    id: "catalog",
    label: "קטלוג",
    icon: "🛒",
    items: [
      { href: "/admin/products", label: "מוצרים", icon: "🥩" },
      { href: "/admin/kashrut", label: "כשרויות", icon: "🏷️" },
      { href: "/admin/pricelists", label: "מחירונים / מכירות", icon: "💵" },
      { href: "/admin/points", label: "נקודות חלוקה", icon: "📍" },
    ],
  },
  {
    id: "customers",
    label: "לקוחות",
    icon: "👥",
    items: [
      { href: "/admin/customers", label: "לקוחות", icon: "🧑" },
      { href: "/admin/debts", label: "חובות לקוחות", icon: "💰" },
      { href: "/admin/personal-requests", label: "בקשות אישיות", icon: "💬" },
    ],
  },
  {
    id: "agents",
    label: "נציגים",
    icon: "🎯",
    items: [
      { href: "/admin/agents", label: "נציגים", icon: "🧑‍💼" },
      { href: "/admin/agent-debts", label: "חובות נציגים", icon: "🧾" },
    ],
  },
  {
    id: "finance",
    label: "פיננסי",
    icon: "💳",
    items: [
      { href: "/admin/payments", label: "תשלומים", icon: "💳" },
      { href: "/admin/reports", label: "דוחות", icon: "📈" },
    ],
  },
];

// פריט עצמאי בראש - קיצור דרך לדשבורד
const DASHBOARD_ITEM = { href: "/admin", label: "דשבורד", icon: "🏠" };
const SETTINGS_ITEM = { href: "/admin/settings", label: "הגדרות", icon: "⚙️" };

export default function AdminNav() {
  const pathname = usePathname();
  // איזה group פתוח כרגע (רק אחד בפעם - כמו accordion)
  const [openGroup, setOpenGroup] = useState<string | null>(null);

  // פתיחה אוטומטית של הgroup שמכיל את העמוד הנוכחי
  useEffect(() => {
    for (const group of NAV_GROUPS) {
      if (group.items.some((item) => pathname.startsWith(item.href))) {
        setOpenGroup(group.id);
        return;
      }
    }
  }, [pathname]);

  const isActive = (href: string) => {
    if (href === "/admin") return pathname === "/admin";
    return pathname === href || pathname.startsWith(href + "/");
  };

  return (
    <nav className="space-y-1">
      {/* דשבורד - קיצור בראש */}
      <NavLink item={DASHBOARD_ITEM} active={isActive(DASHBOARD_ITEM.href)} />

      <div className="my-2 border-t border-brand-slate/15"></div>

      {/* קטגוריות מתקפלות */}
      {NAV_GROUPS.map((group) => {
        const isOpen = openGroup === group.id;
        // סימון אם יש פריט פעיל בקבוצה
        const hasActive = group.items.some((item) => isActive(item.href));
        return (
          <div key={group.id}>
            <button
              onClick={() => setOpenGroup(isOpen ? null : group.id)}
              className={`w-full flex items-center justify-between px-3 py-2.5 rounded-lg text-sm font-bold transition-colors ${
                hasActive
                  ? "bg-brand-rust/15 text-brand-rust"
                  : "text-brand-slatedark hover:bg-brand-slate/10"
              }`}
            >
              <span className="flex items-center gap-2">
                <span className="text-base">{group.icon}</span>
                <span>{group.label}</span>
                {hasActive && !isOpen && (
                  <span className="w-1.5 h-1.5 rounded-full bg-brand-rust"></span>
                )}
              </span>
              <svg
                className={`w-4 h-4 transition-transform ${isOpen ? "rotate-180" : ""}`}
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2.5}
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
              </svg>
            </button>

            {isOpen && (
              <div className="mt-1 mr-3 space-y-0.5 border-r-2 border-brand-slate/15 pr-3">
                {group.items.map((item) => (
                  <NavLink
                    key={item.href}
                    item={item}
                    active={isActive(item.href)}
                    small
                  />
                ))}
              </div>
            )}
          </div>
        );
      })}

      <div className="my-2 border-t border-brand-slate/15"></div>

      {/* הגדרות בתחתית */}
      <NavLink item={SETTINGS_ITEM} active={isActive(SETTINGS_ITEM.href)} />
    </nav>
  );
}

function NavLink({
  item,
  active,
  small,
}: {
  item: NavItem;
  active: boolean;
  small?: boolean;
}) {
  return (
    <Link
      href={item.href}
      className={`flex items-center gap-2 px-3 rounded-lg text-sm transition-colors ${
        small ? "py-1.5" : "py-2.5 font-bold"
      } ${
        active
          ? "bg-brand-rust text-white shadow-sm"
          : "text-brand-slatedark hover:bg-brand-slate/10"
      }`}
    >
      <span className={small ? "text-sm" : "text-base"}>{item.icon}</span>
      <span>{item.label}</span>
    </Link>
  );
}

// Named export כדי שגם import { AdminNav } וגם import AdminNav יעבדו
export { AdminNav };
