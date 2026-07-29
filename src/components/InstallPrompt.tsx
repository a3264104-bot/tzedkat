"use client";

// InstallPrompt חכם - מציג הצעה להתקין את האתר כאפליקציה
// התנהגות:
// 1. אם המשתמש כבר התקין - לא מציג לעולם
// 2. אם דחה עם X - לא מציג שוב תוך 24 שעות
// 3. אם עברו 24 שעות מדחייה - מציג שוב
// 4. תוך אותו session - לא מציג שוב אחרי dismiss
//
// שימוש ב-localStorage לזיכרון מתמשך בין sessions.
// שימוש ב-sessionStorage לזיכרון בתוך session אחד.

import { useEffect, useState } from "react";

// זמנים
const DISMISS_HOURS = 24;
const DISMISS_MS = DISMISS_HOURS * 60 * 60 * 1000;

// מפתחות localStorage
const LS_DISMISSED_AT = "installPromptDismissedAt";
const LS_INSTALLED = "installPromptInstalled";
const SS_DISMISSED_SESSION = "installPromptDismissedSession";

// Type של beforeinstallprompt event
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
    // בדיקות ראשונות
    if (typeof window === "undefined") return;

    // 🚨 הבנר לא מוצג במחשב - רק במובייל
    // זיהוי מובייל לפי userAgent + touch + width
    const isMobile =
      /iPhone|iPad|iPod|Android|webOS|BlackBerry|IEMobile|Opera Mini/i.test(
        navigator.userAgent
      ) ||
      (typeof window.matchMedia === "function" &&
        window.matchMedia("(max-width: 768px)").matches);

    if (!isMobile) {
      // מחשב - לא מציגים בכלל
      return;
    }

    // 1. האם המשתמש כבר התקין בעבר?
    if (localStorage.getItem(LS_INSTALLED) === "1") {
      return;
    }

    // 2. האם כבר רץ כאפליקציה מותקנת (standalone)?
    if (
      window.matchMedia?.("(display-mode: standalone)").matches ||
      (window.navigator as any).standalone
    ) {
      localStorage.setItem(LS_INSTALLED, "1");
      return;
    }

    // 3. האם דחה תוך 24 שעות האחרונות?
    const dismissedAt = localStorage.getItem(LS_DISMISSED_AT);
    if (dismissedAt) {
      const ago = Date.now() - Number(dismissedAt);
      if (ago < DISMISS_MS) {
        // עוד לא עברו 24 שעות - לא מציגים
        return;
      }
    }

    // 4. האם דחה בsession הנוכחי? (גם אם עברו יומיים בסשן ארוך)
    if (sessionStorage.getItem(SS_DISMISSED_SESSION) === "1") {
      return;
    }

    // בדיקת iOS - iOS לא תומך ב-beforeinstallprompt
    // צריך להראות הוראות ידניות במקום
    const iOS = /iPad|iPhone|iPod/.test(navigator.userAgent) &&
      !(window as any).MSStream;
    setIsIOS(iOS);

    if (iOS) {
      // ב-iOS מציגים את הbanner ידנית אחרי דיליי קצר
      const t = setTimeout(() => setVisible(true), 3000);
      return () => clearTimeout(t);
    }

    // מאזין לevent של Chrome/Edge/Android
    const handler = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
      setVisible(true);
    };
    window.addEventListener("beforeinstallprompt", handler);

    // מאזין לevent של התקנה מוצלחת
    const installedHandler = () => {
      localStorage.setItem(LS_INSTALLED, "1");
      setVisible(false);
      setDeferredPrompt(null);
    };
    window.addEventListener("appinstalled", installedHandler);

    return () => {
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
        // המשתמש דחה - סימון כ-dismissed
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
    // שומרים גם ב-localStorage (מתמשך) וגם ב-sessionStorage (סשן נוכחי)
    localStorage.setItem(LS_DISMISSED_AT, String(Date.now()));
    sessionStorage.setItem(SS_DISMISSED_SESSION, "1");
  }

  function handleDismiss() {
    recordDismiss();
    setVisible(false);
    setShowIOSInstructions(false);
  }

  if (!visible) return null;

  return (
    <>
      {/* Banner להצעת התקנה */}
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

      {/* Modal הוראות iOS */}
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
                  גלול למטה ובחר <strong>"הוסף למסך הבית"</strong>
                </span>
              </li>
              <li className="flex items-start gap-2">
                <span className="w-6 h-6 rounded-full bg-brand-rust text-white flex items-center justify-center text-xs font-bold shrink-0">
                  3
                </span>
                <span>
                  לחץ <strong>"הוסף"</strong> ואייקון של האתר יופיע במסך הראשי
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
