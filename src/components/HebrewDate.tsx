"use client";

import { useEffect, useState } from "react";

// §6: תצוגת תאריך עברי+לועזי משולב.
// שני מנגנוני fallback: Intl.DateTimeFormat (מובנה בדפדפנים) + @hebcal/core (npm).
// מחזיר למשל: "ב׳ אב ה׳תשפ״ו - 16/07/2026"

// פורמט לועזי
function fmtGreg(d: Date): string {
  return d.toLocaleDateString("he-IL", {
    weekday: "long",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

// פונקציה שמייצרת תאריך עברי מ-Date
// מחזירה למשל: "ב׳ אב ה׳תשפ״ו"
function hebrewDateSync(d: Date): string | null {
  // ניסיון עם Intl (לא כל הדפדפנים תומכים)
  try {
    const formatter = new Intl.DateTimeFormat("he-u-ca-hebrew", {
      day: "numeric",
      month: "long",
      year: "numeric",
    });
    const parts = formatter.formatToParts(d);
    const day = parts.find((p) => p.type === "day")?.value || "";
    const month = parts.find((p) => p.type === "month")?.value || "";
    const year = parts.find((p) => p.type === "year")?.value || "";
    if (day && month) return `${day} ${month} ${year}`.trim();
  } catch {
    // fallback
  }
  return null;
}

type Props = {
  date: string | Date | null | undefined;
  className?: string;
  // אם true, מציג רק את התאריך העברי (בלי לועזי)
  hebrewOnly?: boolean;
};

/**
 * קומפוננט שמציג תאריך בפורמט משולב: עברי + לועזי.
 * למשל: "ב׳ אב תשפ״ו — 16/07/2026"
 */
export function HebrewDate({ date, className, hebrewOnly }: Props) {
  const [hebDate, setHebDate] = useState<string | null>(null);

  useEffect(() => {
    if (!date) return;
    const d = typeof date === "string" ? new Date(date) : date;
    if (isNaN(d.getTime())) return;

    // ניסיון ראשון: Intl
    const intlResult = hebrewDateSync(d);
    if (intlResult) {
      setHebDate(intlResult);
      return;
    }

    // Fallback: @hebcal/core (מותקן ב-npm)
    // renderGematriya() מחזיר את התאריך המלא בגמטריה, למשל: "ה׳ אָב תשפ״ו"
    (async () => {
      try {
        const { HDate } = await import("@hebcal/core");
        const hd = new HDate(d);
        setHebDate(hd.renderGematriya());
      } catch {
        // לא הצלחנו — מציגים רק לועזי
      }
    })();
  }, [date]);

  if (!date) return null;
  const d = typeof date === "string" ? new Date(date) : date;
  if (isNaN(d.getTime())) return null;

  const greg = fmtGreg(d);

  if (hebrewOnly) {
    return <span className={className}>{hebDate || greg}</span>;
  }

  return (
    <span className={className}>
      {hebDate ? `${hebDate} — ${greg}` : greg}
    </span>
  );
}
