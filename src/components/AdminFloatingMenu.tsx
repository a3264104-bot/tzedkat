"use client";

// תפריט הניהול גם מחוץ ל-/admin.
//
// המנהל עובד הרבה במסכי הנציג (הזמנה ללקוח, טבלת משקלים, מסך הזמנה)
// ובמסך ההזמנה של הלקוח (עריכה). שם אין AdminShell, ולכן לא הייתה
// לו דרך לנווט חוץ מ"חזרה" שוב ושוב.
//
// ⚠️ כפתור צף שאפשר להזיז (לחיצה ארוכה) — כדי שלא יסתיר כפתור
// "שמור" או סרגל תחתון. ברירת המחדל: שמאל, מעל הסרגל התחתון.
// ⚠️ מוצג רק למנהל: ה-layout מחליט, הרכיב לא בודק הרשאה בעצמו.

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { AdminNav } from "./AdminNav";
import { DraggableFloating } from "./DraggableFloating";

export function AdminFloatingMenu() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

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
    <>
      <DraggableFloating storageKey="admin-floating-menu" side="left" defaultBottom={96} zIndex={45}>
        <button
          onClick={() => setOpen(true)}
          aria-label="פתח תפריט ניהול"
          aria-expanded={open}
          aria-controls="admin-floating-drawer"
          className="flex items-center gap-1.5 rounded-full bg-brand-slatedark text-white shadow-lg px-3.5 h-11 text-sm font-bold active:scale-95"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
            <path strokeLinecap="round" d="M4 7h16M4 12h16M4 17h16" />
          </svg>
          ניהול
        </button>
      </DraggableFloating>

      <div
        onClick={() => setOpen(false)}
        aria-hidden="true"
        className={`fixed inset-0 z-[70] bg-black/40 transition-opacity duration-200 ${
          open ? "opacity-100" : "opacity-0 pointer-events-none"
        }`}
      />
      <div className="fixed inset-0 z-[80] overflow-hidden pointer-events-none">
        <aside
          id="admin-floating-drawer"
          dir="rtl"
          className={`pointer-events-auto absolute inset-y-0 right-0 w-72 max-w-[85vw] overflow-y-auto overscroll-contain bg-white p-3 shadow-xl
            transition-[transform,visibility] duration-200 ease-out motion-reduce:transition-none
            ${open ? "translate-x-0 visible" : "translate-x-full invisible"}`}
        >
          <button
            onClick={() => setOpen(false)}
            className="mb-2 w-full rounded-lg border border-zinc-200 py-2 text-sm font-bold text-brand-slatedark"
          >
            ✕ סגור תפריט
          </button>
          <AdminNav />
        </aside>
      </div>
    </>
  );
}
