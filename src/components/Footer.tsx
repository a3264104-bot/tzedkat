// Footer קבוע לאתר - נגיש, כולל קישורים משפטיים ויצירת קשר
// עומד בדרישות המקובלות באתרי מסחר בישראל:
//   - קישור למדיניות פרטיות
//   - קישור לתנאי שימוש
//   - קישור להצהרת נגישות
//   - אזור יצירת קשר ברור

import Link from "next/link";

export function Footer() {
  const year = new Date().getFullYear();

  return (
    <footer
      className="bg-brand-slatedark text-white mt-auto"
      role="contentinfo"
      aria-label="כותרת תחתונה"
    >
      <div className="mx-auto max-w-6xl px-4 py-8">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {/* אודות */}
          <div>
            <h2 className="font-extrabold text-lg mb-2">צדקת רבותינו</h2>
            <p className="text-sm text-white/70 leading-relaxed">
              מערכת הזמנות לחלוקת בשר, עוף ודגים כשרים לקהילה.
            </p>
          </div>

          {/* קישורים משפטיים */}
          <nav aria-label="קישורים משפטיים">
            <h2 className="font-bold text-sm mb-3 text-white/90">מידע ומדיניות</h2>
            <ul className="space-y-2 text-sm">
              <li>
                <Link
                  href="/privacy"
                  className="text-white/70 hover:text-white underline underline-offset-2 focus:outline-none focus:ring-2 focus:ring-white/50 rounded"
                >
                  מדיניות פרטיות
                </Link>
              </li>
              <li>
                <Link
                  href="/terms"
                  className="text-white/70 hover:text-white underline underline-offset-2 focus:outline-none focus:ring-2 focus:ring-white/50 rounded"
                >
                  תנאי שימוש
                </Link>
              </li>
              <li>
                <Link
                  href="/accessibility"
                  className="text-white/70 hover:text-white underline underline-offset-2 focus:outline-none focus:ring-2 focus:ring-white/50 rounded"
                >
                  הצהרת נגישות
                </Link>
              </li>
            </ul>
          </nav>

          {/* יצירת קשר */}
          <div>
            <h2 className="font-bold text-sm mb-3 text-white/90">יצירת קשר</h2>
            <p className="text-sm text-white/70 leading-relaxed mb-2">
              לכל שאלה, תקלה או פנייה ניתן ליצור קשר באמצעות כתובת המייל:
            </p>
            <a
              href="mailto:m5402088@gmail.com"
              className="inline-flex items-center gap-2 text-sm text-white hover:text-brand-yellow underline underline-offset-2 focus:outline-none focus:ring-2 focus:ring-white/50 rounded"
              aria-label="שליחת מייל לכתובת m5402088@gmail.com"
            >
              <svg
                className="w-4 h-4"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
                aria-hidden="true"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
                />
              </svg>
              m5402088@gmail.com
            </a>
          </div>
        </div>

        {/* שורת זכויות */}
        <div className="mt-6 pt-6 border-t border-white/15 text-center text-xs text-white/50">
          © {year} צדקת רבותינו. כל הזכויות שמורות.
        </div>
      </div>
    </footer>
  );
}
