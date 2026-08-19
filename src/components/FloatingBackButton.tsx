"use client";

// §68: כפתור חזרה צף, גלובלי (סעיף 6).
//
// ═══════════════════════════════════════════════════════════════
// למה כפתור אחד ולא עשרות
// ═══════════════════════════════════════════════════════════════
// הבעיה הייתה רוחבית - "בכל דף ודף אין אפשרות לחזור לדף הקודם" -
// ולכן גם הפתרון צריך להיות רוחבי. שתילה ידנית בכל אחד מ-50
// המסכים הייתה עבודה גדולה, ובעיקר שבירה: כל דף חדש שייבנה בעתיד
// היה נולד שוב בלי כפתור.
//
// הכפתור יושב ב-layout השורש ומופיע אוטומטית בכל מקום, למעט
// המסכים שבהם הוא מיותר או מזיק (ראה HIDE_ON למטה).
//
// ═══════════════════════════════════════════════════════════════
// למה זה לא רק router.back()
// ═══════════════════════════════════════════════════════════════
// history.back() נשען על היסטוריית הדפדפן, ולכן נשבר בדיוק במקרים
// הנפוצים אצלנו: משתמש שהגיע מקישור בוואטסאפ, מסריקת QR, או שפתח
// בטאב חדש. אצלו אין היסטוריה, והלחיצה זורקת אותו מחוץ לאתר.
//
// לכן יש נפילה ליעד לוגי שנגזר מהנתיב עצמו: מ-/admin/* חוזרים
// לניהול, מ-/agent/* לאזור הנציג, וכן הלאה.

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
// §142: הכפתור הצף ניתן להזזה בלחיצה ארוכה
import { DraggableFloating } from "./DraggableFloating";

// מסכים שבהם הכפתור לא יופיע.
// - "/" אין לאן לחזור ממנו.
// - מסכי התחברות: כפתור חזרה בהם מחזיר לדף שממנו נזרקת, וזה
//   בדרך כלל אותו דף מוגן שיזרוק אותך שוב - לולאה מבלבלת.
const HIDE_EXACT = new Set(["/", "/login", "/admin/login", "/register"]);

// יעד הנפילה לפי אזור. הסדר חשוב - הראשון שמתאים מנצח.
const FALLBACKS: [string, string][] = [
  ["/admin", "/admin"],
  ["/agent", "/agent"],
  ["/account", "/account"],
  ["/order/success", "/account"],
  ["/order", "/"],
];

function fallbackFor(path: string): string {
  for (const [prefix, target] of FALLBACKS) {
    // אם אנחנו *בדיוק* על היעד, אין טעם לחזור לעצמנו
    if (path.startsWith(prefix) && path !== target) return target;
  }
  return "/";
}

export function FloatingBackButton() {
  const pathname = usePathname();
  const router = useRouter();
  const [canGoBack, setCanGoBack] = useState(false);

  // window לא קיים בשרת, והרינדור הראשוני חייב להיות זהה בשני
  // הצדדים כדי לא לגרום ל-hydration mismatch.
  useEffect(() => {
    setCanGoBack(window.history.length > 1);
  }, [pathname]);

  if (!pathname) return null;
  if (HIDE_EXACT.has(pathname)) return null;

  const fallback = fallbackFor(pathname);
  // דף שהוא עצמו יעד הנפילה (למשל /admin) - אין לאן לחזור ממנו
  // בתוך האזור, ויש לו ניווט משלו.
  if (pathname === fallback) return null;

  function go() {
    if (canGoBack) {
      router.back();
      return;
    }
    router.push(fallback);
  }

  return (
    // §142: ניתן להזזה בלחיצה ארוכה.
    //
    // 🐛 הבעיה: הכפתור ישב קבוע בפינה ימנית-תחתונה, ובמסכים
    // ארוכים הוא כיסה בדיוק את מה שמתחתיו - כפתור "שמור", שדה
    // אחרון בטופס, או שורה בטבלה. במובייל זה קרה הרבה כי המסך צר.
    //
    // ⚠️ storageKey נפרד מכפתור הנגישות: שניהם צפים, ומפתח משותף
    // היה גורם להם לרדוף זה אחרי זה לאותו מקום.
    //
    // ⚠️ המחלקות fixed/bottom/right הוסרו מהכפתור עצמו והועברו
    // לעטיפה. שני מקורות למיקום היו נלחמים, והכפתור היה קופץ
    // חזרה בכל רינדור.
    //
    // ⚠️ print:hidden נשאר על הכפתור הפנימי ולא על העטיפה, כי
    // העטיפה היא זו שנושאת את המיקום ואין טעם להסתיר רק אותה.
    <DraggableFloating
      storageKey="back-button-pos"
      side="right"
      defaultBottom={16}
      defaultSide={16}
    >
      <button
        type="button"
        onClick={go}
        aria-label="חזרה לדף הקודם"
        title="לחיצה ארוכה מאפשרת להזיז את הכפתור"
        className="flex items-center gap-1.5 bg-white/95 backdrop-blur-sm text-brand-slatedark border-2 border-zinc-300 shadow-lg rounded-full px-4 py-2.5 text-sm font-bold hover:border-brand-rust hover:text-brand-rust transition-colors print:hidden"
      >
        {/* ב-RTL החץ ימינה הוא כיוון ה"אחורה" */}
        <svg
          className="w-4 h-4"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2.5}
          aria-hidden="true"
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
        </svg>
        חזרה
      </button>
    </DraggableFloating>
  );
}
