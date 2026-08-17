"use client";

// §68: כפתור חזרה אחיד (סעיף 6).
//
// ═══════════════════════════════════════════════════════════════
// למה לא פשוט router.back()
// ═══════════════════════════════════════════════════════════════
// history.back() נשען על היסטוריית הדפדפן, ולכן הוא נשבר בדיוק
// במקרים הנפוצים: משתמש שהגיע מקישור בוואטסאפ, מסריקת QR, או
// שפתח את הדף בטאב חדש. אצלו אין היסטוריה, והלחיצה או שלא עושה
// כלום או שזורקת אותו אל מחוץ לאתר.
//
// לכן: אם יש היסטוריה *באתר* - חוזרים אחורה כרגיל. אם אין -
// נופלים ל-fallback שכל דף מגדיר לעצמו. כך הכפתור תמיד עושה
// משהו הגיוני.
//
// הבדיקה היא על window.history.length: ערך 1 פירושו שזה העמוד
// הראשון בטאב. זו לא בדיקה מושלמת (הדפדפן לא חושף את מקור
// הניווט), אבל היא תופסת את המקרה השכיח.

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

export function BackButton({
  /** יעד כשאין היסטוריה. ברירת מחדל: דף הבית */
  fallbackHref = "/",
  /** טקסט הכפתור. ברירת מחדל: "חזרה" */
  label = "חזרה",
  className = "",
  variant = "default",
}: {
  fallbackHref?: string;
  label?: string;
  className?: string;
  /** default = כפתור עם מסגרת, subtle = טקסט בלבד (לכותרות כהות) */
  variant?: "default" | "subtle";
}) {
  const router = useRouter();
  const [canGoBack, setCanGoBack] = useState(false);

  // רק אחרי טעינה בצד הלקוח - window לא קיים בשרת, והרינדור הראשוני
  // חייב להיות זהה בשניהם כדי לא לגרום ל-hydration mismatch.
  useEffect(() => {
    setCanGoBack(window.history.length > 1);
  }, []);

  function go() {
    if (canGoBack) {
      router.back();
      return;
    }
    router.push(fallbackHref);
  }

  const base =
    variant === "subtle"
      ? "text-sm font-medium opacity-80 hover:opacity-100 transition-opacity"
      : "text-sm font-medium text-brand-slate hover:text-brand-rust flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-zinc-300 bg-white/60 backdrop-blur-sm transition-colors";

  return (
    <button
      type="button"
      onClick={go}
      className={`${base} ${className}`}
      aria-label={label}
    >
      {/* חץ ימינה - ב-RTL זה כיוון ה"אחורה" */}
      <svg
        className="w-4 h-4 inline-block"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={2}
        aria-hidden="true"
      >
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
      </svg>
      {label}
    </button>
  );
}
