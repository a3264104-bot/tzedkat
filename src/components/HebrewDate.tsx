"use client";

import { useEffect, useState } from "react";

// §6: תצוגת תאריך עברי+לועזי משולב.
// משתמש ב-@hebcal/core דרך CDN (esm.sh) כדי לא להוסיף תלות לbundle.
// מחזיר למשל: "יום חמישי פ' דברים - ב' אב תשפ"ו - 16/07/2026"

// שמות חודשים עבריים
const MONTH_HE: Record<string, string> = {
  Nisan: "ניסן", Iyyar: "אייר", Sivan: "סיוון", Tamuz: "תמוז", Tammuz: "תמוז",
  Av: "אב", Elul: "אלול", Tishrei: "תשרי", Cheshvan: "חשוון", Kislev: "כסלו",
  Tevet: "טבת", Shvat: "שבט", Shevat: "שבט", Adar: "אדר",
  "Adar I": "אדר א׳", "Adar II": "אדר ב׳", "Adar 1": "אדר א׳", "Adar 2": "אדר ב׳",
};

// המרת שנה עברית לגימטריה
function toHebYear(year: number): string {
  const map: Record<number, string> = {
    100: "ק", 200: "ר", 300: "ש", 400: "ת",
    500: "תק", 600: "תר", 700: "תש", 800: "תת", 900: "תתק",
  };
  const tens = ["", "י", "כ", "ל", "מ", "נ", "ס", "ע", "פ", "צ"];
  const units = ["", "א", "ב", "ג", "ד", "ה", "ו", "ז", "ח", "ט"];
  const rem = year % 1000;
  const h = Math.floor(rem / 100) * 100;
  const t = Math.floor((rem % 100) / 10);
  const u = rem % 10;
  let str = map[h] || "";
  const tu = t * 10 + u;
  if (tu === 15) str += "טו";
  else if (tu === 16) str += "טז";
  else {
    if (t) str += tens[t];
    if (u) str += units[u];
  }
  if (str.length === 1) str += "׳";
  else if (str.length > 1) str = str.slice(0, -1) + "״" + str.slice(-1);
  return "ה׳" + str;
}

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

    // Fallback: @hebcal/core דרך CDN
    (async () => {
      try {
        const { HDate } = await import("https://esm.sh/@hebcal/core@6.3.0" as any);
        const hd = new HDate(d);
        const dayGematriya = hd.renderGematriya();
        const monthName = MONTH_HE[hd.getMonthName("he")] || hd.getMonthName("he");
        const yearStr = toHebYear(hd.getFullYear());
        setHebDate(`${dayGematriya} ${monthName} ${yearStr}`);
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
