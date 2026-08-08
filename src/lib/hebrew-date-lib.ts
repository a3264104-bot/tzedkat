// §6: פורמט תאריך עברי+לועזי לשימוש בשרת (מיילים, דוחות).
//
// הלוגיקה זהה ל-components/HebrewDate.tsx, אבל שם היא בתוך קומפוננטת
// "use client" ולכן לא ניתנת לקריאה מ-route handlers. הועברה לכאן כדי
// שהמיילים יציגו בדיוק את אותו פורמט שהלקוח רואה באתר.
//
// פלט לדוגמה: "ו׳ אב ה׳תשפ״ו — יום שני, 20/07/2026"

import { HDate } from "@hebcal/core";

const MONTH_HE: Record<string, string> = {
  Nisan: "ניסן",
  Iyyar: "אייר",
  Sivan: "סיוון",
  Tamuz: "תמוז",
  Tammuz: "תמוז",
  Av: "אב",
  Elul: "אלול",
  Tishrei: "תשרי",
  Cheshvan: "חשוון",
  Kislev: "כסלו",
  Tevet: "טבת",
  Shvat: "שבט",
  Shevat: "שבט",
  Adar: "אדר",
  "Adar I": "אדר א׳",
  "Adar II": "אדר ב׳",
  "Adar 1": "אדר א׳",
  "Adar 2": "אדר ב׳",
};

function fixMonth(n: string): string {
  return MONTH_HE[n] || n;
}

// המרת שנה לגמטריה
function toHebYear(year: number): string {
  const map: Record<number, string> = {
    100: "ק",
    200: "ר",
    300: "ש",
    400: "ת",
    500: "תק",
    600: "תר",
    700: "תש",
    800: "תת",
    900: "תתק",
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

function fmtGreg(d: Date): string {
  return d.toLocaleDateString("he-IL", {
    weekday: "long",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

/** תאריך עברי בלבד. למשל: "ו׳ אב ה׳תשפ״ו" */
export function hebrewDateOnly(date: Date | string | null | undefined): string | null {
  if (!date) return null;
  const d = typeof date === "string" ? new Date(date) : date;
  if (isNaN(d.getTime())) return null;
  try {
    const hd = new HDate(d);
    const dayOnly = hd.renderGematriya().split(" ")[0];
    return `${dayOnly} ${fixMonth(hd.getMonthName())} ${toHebYear(hd.getFullYear())}`;
  } catch {
    return null;
  }
}

/**
 * תאריך מלא עברי + לועזי, בפורמט שהלקוח כבר רגיל לראות באתר.
 * למשל: "ו׳ אב ה׳תשפ״ו — יום שני, 20/07/2026"
 * אם חישוב התאריך העברי נכשל, נופלים ללועזי בלבד ולא לשום דבר.
 */
export function hebrewDateFull(date: Date | string | null | undefined): string | null {
  if (!date) return null;
  const d = typeof date === "string" ? new Date(date) : date;
  if (isNaN(d.getTime())) return null;
  const greg = fmtGreg(d);
  const heb = hebrewDateOnly(d);
  return heb ? `${heb} — ${greg}` : greg;
}
