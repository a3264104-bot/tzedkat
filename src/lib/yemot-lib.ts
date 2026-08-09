// §24: שכבת עזר לפרוטוקול של ימות המשיח (מודול API).
//
// ימות שולחים HTTP GET/POST עם פרמטרים, ומצפים לתשובה ב*טקסט פשוט*
// (לא JSON!) שמכילה הוראות מה לעשות עם השיחה. הקובץ הזה עוטף את
// בניית התשובות כדי שקוד הזרימה יישאר קריא.
//
// תיעוד: https://f2.freeivr.co.il/topic/56

/** פרמטרים שימות שולחים בכל קריאה */
export type YemotParams = Record<string, string>;

/** חילוץ הפרמטרים מהבקשה - תומך גם ב-GET וגם ב-POST */
export async function parseYemotRequest(req: Request): Promise<YemotParams> {
  const url = new URL(req.url);
  const params: YemotParams = {};
  url.searchParams.forEach((v, k) => {
    params[k] = v;
  });
  if (req.method === "POST") {
    try {
      const text = await req.text();
      const body = new URLSearchParams(text);
      body.forEach((v, k) => {
        params[k] = v;
      });
    } catch {
      // אם אין גוף - ממשיכים עם ה-query בלבד
    }
  }
  return params;
}

/**
 * תשובת טקסט לימות.
 *
 * חשוב: Content-Type חייב להיות text/plain. אם נחזיר JSON או HTML,
 * ימות ישמיעו למשתמש M1607 "אין מענה משרת API" והשיחה תיפול.
 */
export function yemotResponse(text: string): Response {
  return new Response(text, {
    status: 200,
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}

// ─────────────────────────────────────────────────────────────
// בניית הודעות להשמעה (id_list_message)
// ─────────────────────────────────────────────────────────────

/**
 * הקראת טקסט חופשי (TTS).
 *
 * ⚠️ מגבלת הפרוטוקול: אסור שהטקסט יכיל נקודה או מקף - הם משמשים
 * כמפרידים בפרוטוקול של ימות ויישברו את התשובה. הפונקציה מנקה אותם
 * אוטומטית, כי טקסט מגיע גם משמות מוצרים שהמנהל הזין ואי אפשר
 * לסמוך שהוא לא יכיל אותם.
 */
export function sanitizeTts(text: string): string {
  return String(text ?? "")
    .replace(/[.\-–—]/g, " ")
    .replace(/[&=]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** הודעת טקסט להשמעה */
export function say(text: string): string {
  return `t-${sanitizeTts(text)}`;
}

/** השמעת מספר ("מאה עשרים ושלוש") */
export function sayNumber(n: number | string): string {
  return `n-${n}`;
}

/** השמעת ספרות ("אחת שתיים שלוש") */
export function sayDigits(n: number | string): string {
  return `d-${n}`;
}

/** שרשור כמה הודעות ברצף - מופרדות בנקודה לפי הפרוטוקול */
export function messages(...parts: string[]): string {
  return parts.filter(Boolean).join(".");
}

/** השמעת הודעות ואז יציאה/מעבר */
export function playMessage(...parts: string[]): string {
  return `id_list_message=${messages(...parts)}`;
}

// ─────────────────────────────────────────────────────────────
// קבלת קלט מהמשתמש (read)
// ─────────────────────────────────────────────────────────────

export type ReadOptions = {
  /** שם הפרמטר שיחזור אלינו עם הערך */
  name: string;
  /** מקסימום ספרות */
  max?: number;
  /** מינימום ספרות */
  min?: number;
  /** שניות להמתנה */
  timeout?: number;
  /** איך להשמיע בחזרה את מה שהוקש */
  playback?: "No" | "Number" | "Digits";
  /**
   * האם לבקש אישור אחרי ההקשה.
   * ברירת המחדל של ימות היא כן ("לאישור הקישו 1") - וזה מעצבן
   * בתפריטים של ספרה אחת, ולכן ברירת המחדל שלנו היא לא.
   */
  confirm?: boolean;
  /** אילו מקשים מותרים. למשל "123" או "1.2.3" לרב-ספרתי */
  allowed?: string;
};

/**
 * בקשת קלט מהמשתמש.
 * בונה: read=<הודעות>=<שם>,<שימוש-חוזר>,<max>,<min>,<timeout>,<playback>,...
 */
export function read(prompt: string, opts: ReadOptions): string {
  const {
    name,
    max = 2,
    min = 1,
    timeout = 7,
    playback = "No",
    confirm = false,
    allowed = "",
  } = opts;

  // מיקומי הערכים לפי התיעוד:
  // 1=שם, 2=שימוש חוזר, 3=max, 4=min, 5=timeout, 6=playback,
  // 7=חסימת כוכבית, 8=חסימת אפס, 9=החלפת תו, 10=מקשים מותרים,
  // 11=חזרות, 12=התנהגות בריק, 13=טקסט לריק, 14=מקלדת, 15=אישור
  const parts = [
    name,
    "", // לא להשתמש בערך קודם - כל שאלה נשאלת מחדש
    String(max),
    String(min),
    String(timeout),
    playback,
    "", // כוכבית מותרת
    "", // אפס מותר
    "", // ללא החלפת תווים
    allowed,
    "", // חזרות - ברירת מחדל
    "", // התנהגות בריק - ברירת מחדל
    "", // טקסט לריק
    "", // מקלדת
    confirm ? "" : "no",
  ];
  return `read=${prompt}=${parts.join(",")}`;
}

/** מעבר לשלוחה אחרת */
export function goToFolder(folder: string): string {
  return `go_to_folder=${folder}`;
}

/** ניתוק השיחה (חזרה לשלוחה הראשית) */
export function hangup(): string {
  return "go_to_folder=hangup";
}

// ─────────────────────────────────────────────────────────────
// נרמול טלפון
// ─────────────────────────────────────────────────────────────

/**
 * ימות שולחים את המספר בפורמט שלהם; המערכת שומרת 0501234567.
 * חייב להיות זהה לנרמול ב-/api/customer/register אחרת לא נמצא לקוחות.
 */
export function normalizePhone(raw: string): string {
  const digits = String(raw ?? "").replace(/\D/g, "");
  if (digits.startsWith("972")) return "0" + digits.slice(3);
  return digits;
}
