"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";
import { useState } from "react";

const links = [
  { href: "/admin", label: "דשבורד", icon: "📊" },
  { href: "/admin/orders", label: "הזמנות", icon: "📦" },
  { href: "/admin/products", label: "מוצרים", icon: "🍗" },
  { href: "/admin/pricelists", label: "מחירונים / מכירות", icon: "📋" },
  { href: "/admin/points", label: "נקודות חלוקה", icon: "📍" },
  { href: "/admin/customers", label: "לקוחות", icon: "🧑‍🤝‍🧑" },
  { href: "/admin/sale-summary", label: "סיכום מכירה", icon: "📊" },
  { href: "/admin/debts", label: "חובות ותזכורות", icon: "💰" },
  { href: "/admin/reports", label: "דוחות", icon: "📈" },
  { href: "/admin/agents", label: "נציגים", icon: "👥" },
  { href: "/admin/settings", label: "הגדרות", icon: "⚙️" },
];

export function AdminNav() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  return (
    <>
      {/* mobile top bar */}
      <div className="md:hidden sticky top-0 z-40 bg-brand-slatedark text-white flex items-center justify-between px-4 py-3 no-print">
        <button onClick={() => setOpen(!open)} className="text-2xl leading-none">
          ☰
        </button>
        <span className="font-extrabold text-brand-yellow">צדקת רבותינו — ניהול</span>
        <button onClick={() => signOut({ callbackUrl: "/login" })} className="text-sm">
          יציאה
        </button>
      </div>

      <aside
        className={`${
          open ? "block" : "hidden"
        } md:block bg-brand-slatedark text-white md:w-60 md:min-h-screen md:sticky md:top-0 no-print`}
      >
        <div className="p-5 hidden md:block">
          <div className="font-extrabold text-brand-yellow text-lg">צדקת רבותינו</div>
          <div className="text-xs text-zinc-400">מערכת ניהול</div>
        </div>
        <nav className="p-2 space-y-1">
          {links.map((l) => {
            const active = pathname === l.href;
            return (
              <Link
                key={l.href}
                href={l.href}
                onClick={() => setOpen(false)}
                className={`flex items-center gap-3 px-4 py-2.5 rounded-xl text-sm font-medium transition ${
                  active ? "bg-brand-rust text-white" : "text-zinc-300 hover:bg-white/10"
                }`}
              >
                <span>{l.icon}</span>
                {l.label}
              </Link>
            );
          })}
        </nav>
        <div className="p-2 hidden md:block">
          <button
            onClick={() => signOut({ callbackUrl: "/login" })}
            className="w-full text-right px-4 py-2.5 rounded-xl text-sm text-zinc-400 hover:bg-white/10"
          >
            יציאה ←
          </button>
        </div>
      </aside>
    </>
  );
}
