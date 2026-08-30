"use client";

// ═══════════════════════════════════════════════════════════════
// §333: כפתור חזרה — צעד אחד אחורה
// ═══════════════════════════════════════════════════════════════
// 🐛 מה שהיה: קישורים קשיחים ל-/agent או /admin. הנציג שהגיע
// מטבלת המשקלים, הוסיף מוצר, ולחץ חזרה - נזרק לדף הבית וצריך
// למצוא את המכירה מחדש.
//
// ⚠️ router.back() מחזיר למקום שהיה, ולא למקום שמישהו החליט
// מראש שהוא הנכון.
//
// ⚠️ ונפילה ל-fallback: משתמש שהגיע ישירות מקישור (וואטסאפ,
// מייל) אין לו היסטוריה, ו-back() היה מוציא אותו מהאתר.

import { useRouter } from "next/navigation";

export default function BackButton({
  label = "חזרה",
  fallback = "/agent",
  className,
}: {
  label?: string;
  /** לאן ללכת כשאין היסטוריה — משתמש שהגיע מקישור חיצוני */
  fallback?: string;
  className?: string;
}) {
  const router = useRouter();

  return (
    <button
      onClick={() => {
        // ⚠️ history.length > 1 אינו מדויק ב-SPA, אבל הוא הסימן
        // הזמין היחיד. במקרה הגרוע נופלים ל-fallback, וזו בדיוק
        // ההתנהגות הישנה.
        if (typeof window !== "undefined" && window.history.length > 1) {
          router.back();
        } else {
          router.push(fallback);
        }
      }}
      className={
        className ??
        "shrink-0 text-xs font-bold text-white/80 hover:text-white bg-white/10 hover:bg-white/20 px-3 py-2 rounded-lg transition-colors"
      }
    >
      ← {label}
    </button>
  );
}
