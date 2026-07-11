"use client";

import { useEffect, useState } from "react";

// באנר התקנת PWA למובייל.
// - Android/Chrome/Edge: מקבל event beforeinstallprompt, מציג כפתור התקנה ישיר
// - iOS Safari: אין event כזה, מציגים הוראות ידניות (שתף → הוסף למסך הבית)
// - Desktop: לא מציגים כלל
// - כבר מותקן (standalone): לא מציגים
// - נסגר → sessionStorage, יופיע שוב בסשן הבא (לא מציק)

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

const SESSION_DISMISS_KEY = "pwa-install-dismissed";

function isIOS(): boolean {
  if (typeof navigator === "undefined") return false;
  return /iPad|iPhone|iPod/.test(navigator.userAgent) && !("MSStream" in window);
}

function isMobile(): boolean {
  if (typeof navigator === "undefined") return false;
  return /Android|iPad|iPhone|iPod/.test(navigator.userAgent);
}

function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  // Chrome/Edge/Firefox
  if (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches) return true;
  // iOS Safari
  if ("standalone" in navigator && (navigator as { standalone?: boolean }).standalone) return true;
  return false;
}

export default function InstallPrompt() {
  const [visible, setVisible] = useState(false);
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [showIOSHint, setShowIOSHint] = useState(false);

  useEffect(() => {
    // אם כבר מותקן - לא להציג
    if (isStandalone()) return;
    // אם לא במובייל - לא להציג
    if (!isMobile()) return;
    // אם הלקוח סגר בסשן הזה - לא להציג
    try {
      if (sessionStorage.getItem(SESSION_DISMISS_KEY) === "1") return;
    } catch {
      // sessionStorage לא זמין (מצב פרטי חזק) - ממשיכים כרגיל
    }

    // Android/Chrome/Edge: מאזינים ל-event
    const handleBeforeInstall = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
      setVisible(true);
    };
    window.addEventListener("beforeinstallprompt", handleBeforeInstall as EventListener);

    // iOS Safari: אין event, מציגים הוראות אחרי דיליי קצר
    if (isIOS()) {
      const t = setTimeout(() => setVisible(true), 1500);
      return () => {
        clearTimeout(t);
        window.removeEventListener("beforeinstallprompt", handleBeforeInstall as EventListener);
      };
    }

    return () => {
      window.removeEventListener("beforeinstallprompt", handleBeforeInstall as EventListener);
    };
  }, []);

  // אם המשתמש התקין → סגירה
  useEffect(() => {
    const onInstalled = () => {
      setVisible(false);
      setDeferredPrompt(null);
    };
    window.addEventListener("appinstalled", onInstalled);
    return () => window.removeEventListener("appinstalled", onInstalled);
  }, []);

  function dismiss() {
    try {
      sessionStorage.setItem(SESSION_DISMISS_KEY, "1");
    } catch {
      // ignore
    }
    setVisible(false);
    setShowIOSHint(false);
  }

  async function handleInstall() {
    if (deferredPrompt) {
      // Android/Chrome: התקנה ישירה
      try {
        await deferredPrompt.prompt();
        const choice = await deferredPrompt.userChoice;
        if (choice.outcome === "accepted") {
          setVisible(false);
        }
        setDeferredPrompt(null);
      } catch {
        setVisible(false);
      }
    } else if (isIOS()) {
      // iOS: הצגת הוראות ידניות
      setShowIOSHint(true);
    }
  }

  if (!visible) return null;

  return (
    <>
      {/* באנר תחתון */}
      <div
        dir="rtl"
        className="fixed bottom-0 left-0 right-0 z-50 bg-white border-t-4 border-brand-rust shadow-2xl p-4 no-print"
        style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0) + 1rem)" }}
      >
        <div className="max-w-md mx-auto">
          <div className="flex items-start gap-3">
            <div className="text-3xl leading-none">📱</div>
            <div className="flex-1 min-w-0">
              <div className="font-bold text-brand-slatedark">התקינו כאפליקציה</div>
              <div className="text-sm text-zinc-600 mt-0.5">
                לחוויית שימוש מהירה ונוחה במסך מלא
              </div>
            </div>
            <button
              onClick={dismiss}
              className="text-zinc-400 hover:text-zinc-700 text-xl leading-none px-1"
              aria-label="סגור"
            >
              ✕
            </button>
          </div>
          <div className="mt-3 flex gap-2">
            <button
              onClick={handleInstall}
              className="flex-1 bg-brand-rust text-white font-medium py-2.5 rounded-lg hover:opacity-90"
            >
              {isIOS() ? "איך להתקין?" : "התקן עכשיו"}
            </button>
            <button
              onClick={dismiss}
              className="px-4 py-2.5 text-zinc-600 hover:bg-zinc-100 rounded-lg text-sm"
            >
              לא עכשיו
            </button>
          </div>
        </div>
      </div>

      {/* הוראות iOS (מודאל) */}
      {showIOSHint && (
        <div
          dir="rtl"
          className="fixed inset-0 z-[60] bg-black/50 flex items-end md:items-center justify-center p-4 no-print"
          onClick={() => setShowIOSHint(false)}
        >
          <div
            className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-bold text-lg text-brand-slatedark">התקנה במכשיר iOS</h2>
              <button
                onClick={() => setShowIOSHint(false)}
                className="text-zinc-400 hover:text-zinc-700 text-xl"
                aria-label="סגור"
              >
                ✕
              </button>
            </div>
            <ol className="space-y-3 text-sm text-zinc-700">
              <li className="flex gap-3">
                <span className="bg-brand-yellow text-brand-slatedark font-bold rounded-full w-7 h-7 flex-shrink-0 flex items-center justify-center">
                  1
                </span>
                <div>
                  לחצו על אייקון <strong>שיתוף</strong> בתחתית המסך
                  <div className="text-2xl mt-1">⬆️</div>
                </div>
              </li>
              <li className="flex gap-3">
                <span className="bg-brand-yellow text-brand-slatedark font-bold rounded-full w-7 h-7 flex-shrink-0 flex items-center justify-center">
                  2
                </span>
                <div>גללו למטה ובחרו <strong>&ldquo;הוסף למסך הבית&rdquo;</strong> (Add to Home Screen)</div>
              </li>
              <li className="flex gap-3">
                <span className="bg-brand-yellow text-brand-slatedark font-bold rounded-full w-7 h-7 flex-shrink-0 flex items-center justify-center">
                  3
                </span>
                <div>לחצו <strong>&ldquo;הוסף&rdquo;</strong> בפינה הימנית העליונה</div>
              </li>
            </ol>
            <button
              onClick={() => {
                setShowIOSHint(false);
                dismiss();
              }}
              className="mt-5 w-full bg-brand-rust text-white font-medium py-2.5 rounded-lg hover:opacity-90"
            >
              הבנתי
            </button>
          </div>
        </div>
      )}
    </>
  );
}
