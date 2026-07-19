"use client";

import { useEffect, useState } from "react";

// §6: תצוגת תאריך עברי+לועזי - זהה ללוח השנה שלך
// למשל: "ו׳ אב ה׳תשפ״ו — 20/07/2026"

// טבלת שמות חודשים - זהה ללוח השנה
const MONTH_HE: Record<string, string> = {
  "Nisan": "ניסן", "Iyyar": "אייר", "Sivan": "סיוון",
  "Tamuz": "תמוז", "Tammuz": "תמוז", "Av": "אב",
  "Elul": "אלול", "Tishrei": "תשרי", "Cheshvan": "חשוון",
  "Kislev": "כסלו", "Tevet": "טבת", "Shvat": "שבט",
  "Shevat": "שבט", "Adar": "אדר",
  "Adar I": "אדר א׳", "Adar II": "אדר ב׳",
  "Adar 1": "אדר א׳", "Adar 2": "אדר ב׳",
};

function fixM(n: string): string {
  return MONTH_HE[n] || n;
}

// המרת שנה לגמטריה - זהה ללוח השנה
function toHebYear(year: number): string {
  const map: Record<number, string> = {
    100: "ק", 200: "ר", 300: "ש", 400: "ת",
    500: "תק", 600: "תר", 700: "תש", 800: "תת", 900: "תתק",
  };
  const rem = year % 1000;
  const h = Math.floor(rem / 100) * 100;
  const t = Math.floor((rem % 100) / 10);
  const u = rem % 10;
  const tens = ["", "י", "כ", "ל", "מ", "נ", "ס", "ע", "פ", "צ"];
  const units = ["", "א", "ב", "ג", "ד", "ה", "ו", "ז", "ח", "ט"];
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

// תאריך עברי משולב - זהה לפורמט של לוח השנה שלך
function hebDay(hd: any): string {
  const dayGematriya = hd.renderGematriya();
  const dayOnly = dayGematriya.split(" ")[0]; // רק היום ("ו׳")
  const monthHe = fixM(hd.getMonthName());
  const yearHe = toHebYear(hd.getFullYear());
  return `${dayOnly} ${monthHe} ${yearHe}`;
}

type Props = {
  date: string | Date | null | undefined;
  className?: string;
  hebrewOnly?: boolean;
};

export function HebrewDate({ date, className, hebrewOnly }: Props) {
  const [hebDate, setHebDate] = useState<string | null>(null);

  useEffect(() => {
    if (!date) return;
    const d = typeof date === "string" ? new Date(date) : date;
    if (isNaN(d.getTime())) return;

    (async () => {
      try {
        const { HDate } = await import("@hebcal/core");
        const hd = new HDate(d);
        setHebDate(hebDay(hd));
      } catch (e) {
        console.error("Failed to render Hebrew date:", e);
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
