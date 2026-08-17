"use client";

// §64: מעבר נציג ↔ לקוח (סעיף 5 ברשימת התיקונים).
//
// ═══════════════════════════════════════════════════════════════
// למה זה לא דורש שינוי session
// ═══════════════════════════════════════════════════════════════
// נציג הוא רשומת Customer עם role="AGENT", ולכן הוא כבר *יכול*
// להזמין ב-/order ולצפות ב-/account - שני המסכים מזהים אותו כלקוח
// לכל דבר. מה שהיה חסר זו רק הדרך לעבור, ולכן הפתרון הוא ניווט
// ומתג ברור, ולא מנגנון הרשאות נוסף.
//
// זו גם הסיבה שלא בניתי כאן "התחזות עצמית": כל מנגנון שמשנה role
// ב-session היה מוסיף מצב שאפשר להיתקע בו (נציג שנשאר במצב לקוח
// ולא מבין למה אין לו תפריט), בתמורה לאפס יכולת שאין כבר.
//
// ⚠️ אין להשתמש בזה כדי להסתיר מידע: המתג הוא נוחות תצוגה בלבד,
// והרשאות נאכפות בשרת בכל מקרה.

import Link from "next/link";

export function RoleSwitcher({
  mode,
  className = "",
}: {
  /** "agent" = נמצא באזור הנציג, "customer" = נמצא באזור האישי */
  mode: "agent" | "customer";
  className?: string;
}) {
  if (mode === "agent") {
    return (
      <Link
        href="/account"
        className={`text-xs font-bold flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-zinc-300 bg-white/60 backdrop-blur-sm text-brand-slate hover:text-brand-rust hover:border-brand-rust transition-colors ${className}`}
        title="מעבר לתצוגת לקוח - הזמנה אישית ואזור אישי"
      >
        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
        </svg>
        מצב לקוח
      </Link>
    );
  }

  return (
    <Link
      href="/agent"
      className={`text-xs font-bold flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-purple-300 bg-purple-50 text-purple-700 hover:bg-purple-100 transition-colors ${className}`}
      title="חזרה לאזור הנציג"
    >
      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
      </svg>
      חזרה לנציג
    </Link>
  );
}
