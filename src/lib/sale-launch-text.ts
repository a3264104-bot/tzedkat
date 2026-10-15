// §401: 📣 הודעת פתיחת מכירה — הטקסט בלבד (בלי מסד נתונים).
// ⚠️ קובץ נפרד כדי שגם המסך (client) ימלא תצוגה מקדימה באותו כלל
// בדיוק כמו השרת.

export const DEFAULT_LAUNCH_SUBJECT = "מכירה חדשה נפתחה: {מכירה}";

export const DEFAULT_LAUNCH_EMAIL = `שמחים לבשר שמכירת {מכירה} נפתחה להזמנות!

📅 החלוקה: {חלוקה}
⏰ ההזמנות פתוחות עד: {סגירה}

להזמנה באתר: {אתר}
או בטלפון — במערכת ההזמנות הטלפונית.

מהרו להזמין!`;

export const DEFAULT_LAUNCH_PHONE =
  "מכירת {מכירה} נפתחה להזמנות. החלוקה {חלוקה}. ההזמנות פתוחות עד {סגירה}.";

export const LAUNCH_VARS = ["{מכירה}", "{חלוקה}", "{סגירה}", "{אתר}"] as const;

export type LaunchSale = {
  name: string;
  deliveryDate: Date | null;
  deliveryDateText: string | null;
  closeDate: Date | null;
};

function fmtDate(d: Date, withTime: boolean): string {
  return d.toLocaleString("he-IL", {
    timeZone: "Asia/Jerusalem",
    weekday: "long",
    day: "numeric",
    month: "long",
    ...(withTime ? { hour: "2-digit", minute: "2-digit" } : {}),
  });
}

export function siteUrl(): string {
  return (process.env.NEXT_PUBLIC_APP_URL || "https://tzidkat.com").replace(/\/+$/, "");
}

export function launchValues(sale: LaunchSale): Record<string, string> {
  return {
    "{מכירה}": sale.name ?? "",
    "{חלוקה}":
      (sale.deliveryDateText && sale.deliveryDateText.trim()) ||
      (sale.deliveryDate ? fmtDate(new Date(sale.deliveryDate), false) : ""),
    "{סגירה}": sale.closeDate ? fmtDate(new Date(sale.closeDate), true) : "",
    "{אתר}": siteUrl(),
  };
}

function fillPart(part: string, values: Record<string, string>): string | null {
  let out = part;
  for (const [k, v] of Object.entries(values)) {
    if (!out.includes(k)) continue;
    if (!v) return null; // משתנה בלי ערך — החלק כולו יורד
    out = out.split(k).join(v);
  }
  return out;
}

/** מייל: לפי שורות */
export function fillLaunchText(template: string, sale: LaunchSale): string {
  const values = launchValues(sale);
  return template
    .split("\n")
    .map((line) => fillPart(line, values))
    .filter((l): l is string => l !== null)
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** טלפון: לפי משפטים (אין שורות בהקראה) */
export function fillLaunchPhone(template: string, sale: LaunchSale): string {
  const values = launchValues(sale);
  return template
    .replace(/\n+/g, " ")
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => fillPart(sentence, values))
    .filter((l): l is string => l !== null && l.trim() !== "")
    .join(" ")
    .trim();
}

export function textToHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;")
    .replace(/\n/g, "<br/>");
}
