"use client";

// InstallPrompt - הצעה להתקין את האתר כאפליקציה
//
// ═══════════════════════════════════════════════════════════════
// §132: פעם אחת **בכל ביקור**, ולא פעם אחת לתמיד
// ═══════════════════════════════════════════════════════════════
// 🐛 מה שהיה: דחייה נשמרה ב-localStorage עם חסימה של 24 שעות.
// התוצאה: הלקוח סגר את ההצעה, יצא מהאתר, חזר - ולא ראה אותה
// שוב. הוא איבד את ההזדמנות להתקין עד למחרת.
//
// ההיגיון העסקי: דחייה היא "לא עכשיו", לא "לעולם". לקוח שדחה
// באמצע הזמנה עשוי לרצות להתקין בביקור הבא, כשהוא פנוי.
//
// עכשיו:
//   • מעבר בין דפים באתר  -> לא קופץ שוב  (sessionStorage)
//   • סגר את האתר וחזר    -> קופץ שוב     ✓
//   • דחה ואז חזר         -> קופץ שוב     ✓
//   • התקין בפועל         -> לא קופץ יותר (localStorage)
//
// ⚠️ ההבחנה: sessionStorage נמחק בסגירת הטאב, localStorage שורד.
// לכן דחייה נשמרת בראשון בלבד, והתקנה בשני.

import { useEffect, useState } from "react";

// §132: מפתח ההתקנה נשאר ב-localStorage - מי שהתקין לא צריך
// לראות הצעה להתקין, לעולם.
const LS_INSTALLED = "installPromptInstalled";

// §132: הדחייה עברה ל-sessionStorage. היא נמחקת ברגע שהלקוח
// סוגר את הטאב, ולכן ההצעה חוזרת בביקור הבא.
const SS_DISMISSED = "installPromptDismissedSession";

/**
 * §132: השהיה לפני ההצגה.
 *
 * לקוח שנכנס באמצע הזמנה ומקבל חלון קופץ מיד סוגר אותו אוטומטית
 * בלי לקרוא. מי שכבר גלל קצת באתר נמצא במצב פתוח יותר להצעה.
 */
const SHOW_DELAY_MS = 12_000;

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

export function InstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] =
    useState<BeforeInstallPromptEvent | null>(null);
  const [visible, setVisible] = useState(false);
  const [isIOS, setIsIOS] = useState(false);
  const [showIOSInstructions, setShowIOSInstructions] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;

    // 🚨 הבנר לא מוצג במחשב - רק במובייל
    const isMobile =
      /iPhone|iPad|iPod|Android|webOS|BlackBerry|IEMobile|Opera Mini/i.test(
        navigator.userAgent
      ) ||
      (typeof window.matchMedia === "function" &&
        window.matchMedia("(max-width: 768px)").matches);

    if (!isMobile) return;

    // 1. כבר התקין בעבר
    if (localStorage.getItem(LS_INSTALLED) === "1") return;

    // 2. כבר רץ כאפליקציה מותקנת
    if (
      window.matchMedia?.("(display-mode: standalone)").matches ||
      (window.navigator as any).standalone
    ) {
      localStorage.setItem(LS_INSTALLED, "1");
      return;
    }

    // 3. §132: דחה בביקור הנוכחי בלבד.
    //
    // ⚠️ כאן היה גם `localStorage.getItem(LS_DISMISSED_AT)` עם
    // חסימה של 24 שעות - וזה מה שמנע מההצעה לחזור. הוסר.
    if (sessionStorage.getItem(SS_DISMISSED) === "1") return;

    // ─── iOS: אין beforeinstallprompt, מציגים הוראות ידניות ───
    const iOS =
      /iPad|iPhone|iPod/.test(navigator.userAgent) && !(window as any).MSStream;
    setIsIOS(iOS);

    if (iOS) {
      const t = setTimeout(() => setVisible(true), SHOW_DELAY_MS);
      return () => clearTimeout(t);
    }

    // ─── Chrome / Edge / Android ───
    //
    // ⚠️ ההשהיה כאן ולא ב-handler: הדפדפן יורה את האירוע מוקדם,
    // ואם נציג מיד הלקוח יראה חלון קופץ לפני שהספיק לקרוא משהו.
    let timer: ReturnType<typeof setTimeout> | null = null;

    const handler = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
      timer = setTimeout(() => {
        // בדיקה חוזרת: ייתכן שהלקוח דחה בינתיים בטאב אחר
        if (sessionStorage.getItem(SS_DISMISSED) !== "1") setVisible(true);
      }, SHOW_DELAY_MS);
    };
    window.addEventListener("beforeinstallprompt", handler);

    const installedHandler = () => {
      localStorage.setItem(LS_INSTALLED, "1");
      setVisible(false);
      setDeferredPrompt(null);
    };
    window.addEventListener("appinstalled", installedHandler);

    return () => {
      if (timer) clearTimeout(timer);
      window.removeEventListener("beforeinstallprompt", handler);
      window.removeEventListener("appinstalled", installedHandler);
    };
  }, []);

  async function handleInstall() {
    if (isIOS) {
      setShowIOSInstructions(true);
      return;
    }
    if (!deferredPrompt) return;
    try {
      await deferredPrompt.prompt();
      const choice = await deferredPrompt.userChoice;
      if (choice.outcome === "accepted") {
        localStorage.setItem(LS_INSTALLED, "1");
      } else {
        recordDismiss();
      }
    } catch {
      // ignore
    } finally {
      setVisible(false);
      setDeferredPrompt(null);
    }
  }

  function recordDismiss() {
    // §132: sessionStorage בלבד. שמירה ב-localStorage הייתה
    // מונעת מההצעה לחזור בביקור הבא - הבאג שתוקן.
    sessionStorage.setItem(SS_DISMISSED, "1");
  }

  function handleDismiss() {
    recordDismiss();
    setVisible(false);
    setShowIOSInstructions(false);
  }

  if (!visible) return null;

  return (
    <>
      {!showIOSInstructions && (
        <div className="fixed bottom-4 inset-x-4 z-50 max-w-md mx-auto animate-slide-up">
          <div className="bg-white rounded-2xl shadow-2xl border border-brand-rust/20 overflow-hidden">
            <div className="p-4 flex items-start gap-3">
              <div className="w-12 h-12 rounded-xl bg-brand-yellow flex items-center justify-center text-2xl shrink-0">
                📱
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-extrabold text-brand-slatedark text-sm">
                  התקן את האתר כאפליקציה
                </div>
                <div className="text-xs text-zinc-600 mt-0.5">
                  גישה מהירה מהמסך הראשי, בלי דפדפן
                </div>
              </div>
              <button
                onClick={handleDismiss}
                aria-label="סגור"
                className="text-zinc-400 hover:text-zinc-600 text-2xl leading-none px-1 -mt-1"
              >
                ×
              </button>
            </div>
            <div className="border-t border-zinc-100 p-3 flex gap-2">
              <button
                onClick={handleDismiss}
                className="flex-1 py-2 text-sm text-brand-slate font-medium hover:bg-zinc-50 rounded-lg"
              >
                לא עכשיו
              </button>
              <button
                onClick={handleInstall}
                className="flex-1 py-2 text-sm bg-brand-rust text-white font-bold rounded-lg hover:bg-[#a83a15] shadow-sm"
              >
                {isIOS ? "איך מתקינים?" : "התקנה"}
              </button>
            </div>
          </div>
        </div>
      )}

      {showIOSInstructions && (
        <div
          className="fixed inset-0 z-50 bg-black/60 flex items-end sm:items-center justify-center p-4"
          onClick={handleDismiss}
        >
          <div
            className="bg-white rounded-2xl shadow-2xl max-w-sm w-full p-5 space-y-3"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h3 className="font-extrabold text-brand-slatedark">
                📱 התקנה על iPhone
              </h3>
              <button
                onClick={handleDismiss}
                className="text-zinc-400 hover:text-zinc-600 text-2xl leading-none"
              >
                ×
              </button>
            </div>
            <ol className="space-y-3 text-sm">
              <li className="flex items-start gap-2">
                <span className="w-6 h-6 rounded-full bg-brand-rust text-white flex items-center justify-center text-xs font-bold shrink-0">
                  1
                </span>
                <span>
                  לחץ על כפתור <strong>שיתוף</strong>{" "}
                  <span className="inline-block w-5 h-5 align-middle">📤</span>{" "}
                  בתחתית המסך
                </span>
              </li>
              <li className="flex items-start gap-2">
                <span className="w-6 h-6 rounded-full bg-brand-rust text-white flex items-center justify-center text-xs font-bold shrink-0">
                  2
                </span>
                <span>
                  גלול למטה ובחר <strong>&quot;הוסף למסך הבית&quot;</strong>
                </span>
              </li>
              <li className="flex items-start gap-2">
                <span className="w-6 h-6 rounded-full bg-brand-rust text-white flex items-center justify-center text-xs font-bold shrink-0">
                  3
                </span>
                <span>
                  לחץ <strong>&quot;הוסף&quot;</strong> ואייקון של האתר יופיע
                  במסך הראשי
                </span>
              </li>
            </ol>
            <button
              onClick={handleDismiss}
              className="w-full py-2.5 bg-brand-rust text-white font-bold rounded-xl mt-3"
            >
              הבנתי, תודה
            </button>
          </div>
        </div>
      )}

      <style jsx>{`
        @keyframes slide-up {
          from {
            opacity: 0;
            transform: translateY(100%);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
        .animate-slide-up {
          animation: slide-up 0.4s cubic-bezier(0.16, 1, 0.3, 1);
        }
      `}</style>
    </>
  );
}

// Default export לתאימות עם imports
export default InstallPrompt;
