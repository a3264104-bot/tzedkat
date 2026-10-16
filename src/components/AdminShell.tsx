"use client";

// מעטפת הניהול: סרגל צד קבוע בדסקטופ, ובנייד סרגל עליון + מגירה.
// התוכן של התפריט (AdminNav) לא השתנה — רק האריזה שלו.

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { AdminNav } from "./AdminNav";

export function AdminShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  // סוגרים את המגירה אחרי ניווט
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  // נעילת גלילה ו-Escape כשהמגירה פתוחה
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="md:flex bg-[#faf6ec] min-h-screen">
      {/* סרגל עליון — נייד בלבד */}
      <header className="md:hidden sticky top-0 z-30 flex items-center justify-between gap-3 h-14 px-4 bg-white/95 backdrop-blur border-b border-zinc-200">
        <button
          onClick={() => setOpen(true)}
          aria-label="פתח תפריט"
          aria-expanded={open}
          aria-controls="admin-drawer"
          className="-mr-2 w-11 h-11 grid place-items-center rounded-lg text-brand-slatedark active:bg-zinc-100 transition-colors"
        >
          <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
            <path strokeLinecap="round" d="M4 7h16M4 12h16M4 17h16" />
          </svg>
        </button>
        <span className="font-extrabold text-brand-slatedark">ניהול</span>
        <span className="w-11" aria-hidden="true" />
      </header>

      {/* רקע כהה למגירה */}
      <div
        onClick={() => setOpen(false)}
        aria-hidden="true"
        className={`md:hidden fixed inset-0 z-40 bg-black/40 transition-opacity duration-200 ${
          open ? "opacity-100" : "opacity-0 pointer-events-none"
        }`}
      />

      {/* הסרגל: מגירה בנייד, קבוע ונגלל בדסקטופ.
          ⚠️ העטיפה חותכת את המגירה הסגורה — בלעדיה אלמנט fixed מחוץ למסך
          מרחיב את הדף לרוחב ויוצר גלילה אופקית בנייד. ב-md היא contents. */}
      <div className="fixed inset-0 z-50 overflow-hidden pointer-events-none md:contents">
        <aside
          id="admin-drawer"
          className={`pointer-events-auto absolute inset-y-0 right-0 w-72 max-w-[85vw] overflow-y-auto overscroll-contain bg-white p-3 shadow-xl
            transition-[transform,visibility] duration-200 ease-out motion-reduce:transition-none
            ${open ? "translate-x-0 visible" : "translate-x-full invisible"}
            md:visible md:w-64 md:max-w-none md:shrink-0 md:translate-x-0 md:shadow-none
            md:border-l md:border-zinc-200 md:sticky md:top-0 md:h-screen`}
        >
          <AdminNav />
        </aside>
      </div>

      <main className="flex-1 min-w-0 p-4 md:p-6">{children}</main>
    </div>
  );
}
