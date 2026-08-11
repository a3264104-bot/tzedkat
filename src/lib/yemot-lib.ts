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
    // נקודה ומקף הם מפרידים בפרוטוקול של ימות - חייבים לצאת
    .replace(/[.\-–—]/g, " ")
    // & ו-= מפרידים בין פקודות
    .replace(/[&=]/g, " ")
    // גרשיים ומרכאות: לא שוברים את הפרוטוקול אבל מנוע ההקראה
    // עלול להגות אותם או להיתקע. שמות נקודות כמו 'בית יעקב"' נפוצים.
    .replace(/["'`׳״]/g, " ")
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

// ─────────────────────────────────────────────────────────────
// הודעות קבועות: הקלטה אנושית או TTS
// ─────────────────────────────────────────────────────────────

/**
 * מתג גלובלי: האם להשמיע הקלטות אנושיות במקום הקראה ממוחשבת.
 *
 * false = הכל TTS. עובד תמיד, גם בלי קבצים. זה המצב להתחלה ולפיתוח.
 * true  = הודעות קבועות מושמעות מקבצי שמע בשלוחה.
 *
 * ⚠️ הדלקה היא הכל-או-כלום: ימות *לא* נופלים אוטומטית מקובץ חסר ל-TTS,
 * הם משמיעים שגיאה. לכן להדליק רק אחרי שכל 16 הקבצים הועלו לשלוחה.
 * רשימת הקבצים המלאה: RECORDINGS.md
 */
export const USE_RECORDINGS = false;

/**
 * הודעה קבועה. מחזירה קובץ שמע אם המתג דלוק, אחרת הקראת טקסט.
 * מיועדת רק לטקסטים שלא משתנים - שמות מוצרים, סכומים ושמות לקוחות
 * חייבים להישאר say() כי אי אפשר להקליט אותם מראש.
 *
 * @param file שם הקובץ בשלוחה, בלי סיומת (למשל "menu_main")
 * @param text הטקסט שיוקרא כשהמתג כבוי
 */
export function prompt(file: string, text: string): string {
  if (!USE_RECORDINGS) return say(text);
  // הודעות שסומנו כנדירות נשארות בהקראה ממוחשבת גם כשהמתג דלוק -
  // אין טעם להקליט הודעות שגיאה שרוב הלקוחות לעולם לא ישמעו.
  if (TTS_ONLY.has(file)) return say(text);
  return `f-${file}`;
}

/**
 * הודעות שנשארות ב-TTS תמיד ואין צורך להקליט אותן.
 *
 * הקריטריון: מסלולי *שגיאה* בלבד - תקלת זיהוי, קלט לא חוקי, מוצר שאזל.
 * לקוח רגיל לא מגיע אליהם.
 *
 * מה שלא נכנס לכאן בכוונה: הודעות על מצב המכירה (אין מכירה פעילה /
 * ההרשמה הסתיימה / טרם נפתחה). הן נפוצות מאוד - בין מכירה למכירה אין
 * מכירה פעילה במשך ימים, וכל מי שמתקשר שומע אותן.
 *
 * אם מוסיפים כאן שם - להסיר אותו גם מ-RECORDINGS.md.
 */
const TTS_ONLY = new Set<string>([
  "id_error",
  "account_exists",
  "no_point_assigned",
  // נקודה בלי נציג משויך - לא אמור לקרות, אבל בלי ההודעה הלקוח
  // היה שומע "פנה לנציג" ואז שקט.
  "no_agent_call_office",
]);

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

/**
 * בקשת הקלטה שתתומלל לטקסט (זיהוי דיבור).
 *
 * 🐛 קודם זה נעשה ע"י read() רגיל ואז .replace() על המחרוזת שנוצרה -
 * פתרון שביר שנשבר בשקט אם סדר הערכים משתנה, ואז נשלח max=0 שאינו חוקי.
 * כאן הפורמט נבנה ישירות: <שם>,<שימוש-חוזר>,voice
 */
export function readVoice(prompt: string, name: string): string {
  return `read=${prompt}=${name},,voice`;
}

/** מעבר לשלוחה אחרת */
export function goToFolder(folder: string): string {
  return `go_to_folder=${folder}`;
}

/**
 * סיום השיחה אחרי השמעת הודעה.
 *
 * 🐛 היה כאן `go_to_folder=hangup` - ימות מצפים בפקודה הזו ל*שלוחה*
 * (מספר או נתיב כמו /1), לא למילה "hangup". התוצאה: ימות לא זיהו את
 * התשובה כחוקית והשמיעו M1607 "אין מענה משרת API".
 *
 * הדרך הנכונה: לא להוסיף פקודת ניתוק כלל. אחרי id_list_message ימות
 * מסיימים את השלוחה לבד ומתנהגים לפי api_end_goto (ברירת מחדל: חזרה
 * שלב אחד אחורה). לניתוק מלא מגדירים בשלוחה api_end_goto=hangup.
 */
export function hangup(): string {
  return "";
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
