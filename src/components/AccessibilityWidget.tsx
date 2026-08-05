"use client";

// ווידג'ט נגישות צף - כל כפתור באמת משנה את הדף.
// המצב נשמר ב-localStorage ומוחל מחדש בכל טעינת דף.
//
// כיצד זה עובד טכנית:
//   - כל "הגדרה" מוסיפה/מסירה class על <html> (document.documentElement)
//   - ה-CSS שמגיב ל-classים האלה נמצא ב-globals.css (מסופק בנפרד)
//   - גודל הטקסט נשלט ע"י CSS variable --a11y-font-scale על <html>

import { useEffect, useState, useCallback } from "react";

type A11ySettings = {
  fontScale: number; // 1 = רגיל, עד 1.5
  highContrast: boolean;
  highlightLinks: boolean;
  readableFont: boolean;
  stopAnimations: boolean;
};

const DEFAULT_SETTINGS: A11ySettings = {
  fontScale: 1,
  highContrast: false,
  highlightLinks: false,
  readableFont: false,
  stopAnimations: false,
};

const STORAGE_KEY = "a11y-settings";
const MIN_SCALE = 1;
const MAX_SCALE = 1.5;
const SCALE_STEP = 0.1;

// החלת ההגדרות על ה-DOM בפועל. זו הפונקציה שגורמת לשינוי האמיתי.
function applySettings(s: A11ySettings) {
  if (typeof document === "undefined") return;
  const html = document.documentElement;

  // גודל טקסט - CSS variable שה-globals.css משתמש בו
  html.style.setProperty("--a11y-font-scale", String(s.fontScale));

  // כל שאר ההגדרות - toggle של class על <html>
  html.classList.toggle("a11y-high-contrast", s.highContrast);
  html.classList.toggle("a11y-highlight-links", s.highlightLinks);
  html.classList.toggle("a11y-readable-font", s.readableFont);
  html.classList.toggle("a11y-stop-animations", s.stopAnimations);
}

export function AccessibilityWidget() {
  const [open, setOpen] = useState(false);
  const [settings, setSettings] = useState<A11ySettings>(DEFAULT_SETTINGS);
  const [mounted, setMounted] = useState(false);

  // טעינה ראשונית מ-localStorage + החלה
  useEffect(() => {
    setMounted(true);
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
        setSettings(parsed);
        applySettings(parsed);
      }
    } catch {
      // אם localStorage לא זמין - פשוט ממשיכים עם ברירת מחדל
    }
  }, []);

  // שמירה + החלה בכל שינוי
  const update = useCallback((partial: Partial<A11ySettings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...partial };
      applySettings(next);
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch {
        // ignore
      }
      return next;
    });
  }, []);

  const reset = useCallback(() => {
    setSettings(DEFAULT_SETTINGS);
    applySettings(DEFAULT_SETTINGS);
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // ignore
    }
  }, []);

  // סגירה עם Escape
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  // לא מרנדרים כלום עד שהקומפוננט mounted (מונע hydration mismatch)
  if (!mounted) return null;

  const canEnlarge = settings.fontScale < MAX_SCALE - 0.001;
  const canShrink = settings.fontScale > MIN_SCALE + 0.001;
  const anyActive =
    settings.fontScale !== 1 ||
    settings.highContrast ||
    settings.highlightLinks ||
    settings.readableFont ||
    settings.stopAnimations;

  return (
    <>
      {/* כפתור פתיחה צף */}
      <button
        onClick={() => setOpen((o) => !o)}
        className="fixed bottom-4 left-4 z-[90] w-14 h-14 rounded-full bg-brand-rust text-white shadow-lg flex items-center justify-center hover:bg-[#a83a15] focus:outline-none focus:ring-4 focus:ring-brand-rust/40 transition-colors"
        aria-label={open ? "סגור תפריט נגישות" : "פתח תפריט נגישות"}
        aria-expanded={open}
        aria-haspopup="dialog"
      >
        {/* אייקון נגישות אוניברסלי (person) */}
        <svg
          className="w-8 h-8"
          viewBox="0 0 24 24"
          fill="currentColor"
          aria-hidden="true"
        >
          <circle cx="12" cy="4" r="2" />
          <path d="M12 7c-2.5 0-4.5.5-6 1v2c1.2-.4 2.7-.7 4-.8v3l-1.5 6h2l1.5-5 1.5 5h2L18 12.2v-3c1.3.1 2.8.4 4 .8V8c-1.5-.5-3.5-1-6-1z" />
        </svg>
      </button>

      {/* פאנל ההגדרות */}
      {open && (
        <div
          role="dialog"
          aria-label="הגדרות נגישות"
          aria-modal="false"
          className="fixed bottom-20 left-4 z-[91] w-72 max-w-[calc(100vw-2rem)] bg-white rounded-2xl shadow-2xl border border-zinc-200 overflow-hidden"
          dir="rtl"
        >
          {/* כותרת */}
          <div className="bg-brand-rust text-white px-4 py-3 flex items-center justify-between">
            <h2 className="font-extrabold text-base">נגישות</h2>
            <button
              onClick={() => setOpen(false)}
              className="text-white/90 hover:text-white text-xl leading-none px-1 focus:outline-none focus:ring-2 focus:ring-white/50 rounded"
              aria-label="סגור"
            >
              ×
            </button>
          </div>

          <div className="p-3 space-y-2 max-h-[70vh] overflow-y-auto">
            {/* גודל טקסט */}
            <div className="bg-zinc-50 rounded-xl p-3">
              <div className="text-sm font-bold text-brand-slatedark mb-2">
                גודל טקסט
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => update({ fontScale: Math.max(MIN_SCALE, settings.fontScale - SCALE_STEP) })}
                  disabled={!canShrink}
                  className="flex-1 py-2 rounded-lg bg-white border border-zinc-300 font-bold text-brand-slatedark hover:bg-zinc-100 disabled:opacity-40 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-brand-rust/40"
                  aria-label="הקטן טקסט"
                >
                  A−
                </button>
                <span className="text-xs text-zinc-500 w-12 text-center" aria-live="polite">
                  {Math.round(settings.fontScale * 100)}%
                </span>
                <button
                  onClick={() => update({ fontScale: Math.min(MAX_SCALE, settings.fontScale + SCALE_STEP) })}
                  disabled={!canEnlarge}
                  className="flex-1 py-2 rounded-lg bg-white border border-zinc-300 font-bold text-brand-slatedark hover:bg-zinc-100 disabled:opacity-40 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-brand-rust/40"
                  aria-label="הגדל טקסט"
                >
                  A+
                </button>
              </div>
            </div>

            {/* מתגים */}
            <ToggleRow
              label="ניגודיות גבוהה"
              checked={settings.highContrast}
              onChange={(v) => update({ highContrast: v })}
            />
            <ToggleRow
              label="הדגשת קישורים"
              checked={settings.highlightLinks}
              onChange={(v) => update({ highlightLinks: v })}
            />
            <ToggleRow
              label="גופן קריא"
              checked={settings.readableFont}
              onChange={(v) => update({ readableFont: v })}
            />
            <ToggleRow
              label="עצירת אנימציות"
              checked={settings.stopAnimations}
              onChange={(v) => update({ stopAnimations: v })}
            />

            {/* איפוס */}
            <button
              onClick={reset}
              disabled={!anyActive}
              className="w-full py-2.5 rounded-lg bg-zinc-100 text-brand-slatedark font-bold hover:bg-zinc-200 disabled:opacity-40 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-brand-rust/40 mt-1"
            >
              איפוס הגדרות
            </button>

            <a
              href="/accessibility"
              className="block text-center text-xs text-brand-rust underline underline-offset-2 pt-1"
            >
              להצהרת הנגישות המלאה
            </a>
          </div>
        </div>
      )}
    </>
  );
}

// שורת מתג (toggle) נגישה - כפתור אמיתי עם role=switch
function ToggleRow({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      onClick={() => onChange(!checked)}
      role="switch"
      aria-checked={checked}
      className="w-full flex items-center justify-between gap-2 bg-zinc-50 hover:bg-zinc-100 rounded-xl p-3 text-right focus:outline-none focus:ring-2 focus:ring-brand-rust/40"
    >
      <span className="text-sm font-medium text-brand-slatedark">{label}</span>
      <span
        className={`relative w-11 h-6 rounded-full transition-colors shrink-0 ${
          checked ? "bg-brand-rust" : "bg-zinc-300"
        }`}
        aria-hidden="true"
      >
        <span
          className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all ${
            checked ? "right-0.5" : "right-[22px]"
          }`}
        />
      </span>
    </button>
  );
}
