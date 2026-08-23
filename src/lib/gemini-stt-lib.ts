// ═══════════════════════════════════════════════════════════════
// §215: תמלול דיבור דרך Gemini — במקום יחידות ימות
// ═══════════════════════════════════════════════════════════════
// 🐛 הבעיה: מנוע זיהוי הדיבור של ימות גובה יחידות בכל תמלול.
// §173 הכפיל את הצריכה (שם פרטי + משפחה = שני תמלולים), והיחידות
// נגמרו באמצע יום עבודה. הלקוחות קיבלו "אין מספיק יחידות" ולא
// הצליחו להירשם.
//
// ההבחנה שפותרת את זה, מהתיעוד הרשמי של ימות:
//   STT (הקלטה → טקסט)  = **עולה יחידות**
//   TTS (טקסט → הקראה)  = חינם
//   הקלטה בלבד          = חינם
//
// לכן: מבקשים מימות **הקלטה** ולא תמלול, מורידים את הקובץ דרך
// ה-API שלהם, ושולחים ל-Gemini. אפס יחידות.
//
// ⚠️ זה מחליף עלות ביחידות בעלות ב-Gemini, לא מבטל אותה. בהיקף
// של עשרות הרשמות בחודש זה זניח, אבל זה לא "חינם".

// §215: 🐛 הנתיב הנכון הוא /ym/api ולא /ivr2/api.
//
// הראשון מחזיר 404 בשקט. "ivr2:" מופיע רק **בתוך** פרמטר
// ה-path, וזה מה שהטעה אותי.
import { GoogleGenerativeAI } from "@google/generative-ai";

const YEMOT_API = "https://www.call2all.co.il/ym/api";

/**
 * §215: טוקן הגישה ל-API של ימות.
 *
 * ⚠️ **מ-ENV בלבד.** הטוקן הוא מספר המערכת והסיסמה מופרדים
 * בנקודתיים, כלומר מי שמחזיק בו יכול לשנות את כל המערכת
 * הטלפונית. הוא לא נכתב בקוד ולא נשמר במסד.
 *
 * ב-Vercel: Settings → Environment Variables → YEMOT_TOKEN
 * הפורמט: 0331234567:הסיסמה
 */
function yemotToken(): string | null {
  const t = process.env.YEMOT_TOKEN;
  return t && t.includes(":") ? t : null;
}

/**
 * §215: מוריד קובץ הקלטה מימות ומחזיר אותו כ-base64.
 *
 * ⚠️ base64 ולא Buffer: זה מה ש-Gemini מצפה לו, והמרה כפולה
 * הייתה מבזבזת זיכרון על קובץ שממילא קטן (שניות ספורות).
 */
async function downloadRecording(path: string): Promise<string | null> {
  const token = yemotToken();
  if (!token) {
    console.error("[stt] YEMOT_TOKEN חסר ב-ENV");
    return null;
  }

  // ⚠️ הנתיב מגיע מימות בפורמט "ivr2:/1/000.wav" או "1/000.wav".
  // מנרמלים לשני המקרים כדי שלא ניפול על הבדל פורמט בין גרסאות.
  const clean = path.replace(/^ivr2:\/?/, "").replace(/^\/+/, "");

  try {
    const url = `${YEMOT_API}/DownloadFile?token=${encodeURIComponent(
      token
    )}&path=${encodeURIComponent("ivr2:/" + clean)}`;

    // ⚠️ timeout של 6 שניות: הלקוח על הקו, ושיחה שתקועה 20 שניות
    // גרועה מהודעת שגיאה. אם ימות איטיים - נופלים לזרימה החלופית.
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 6000);
    const res = await fetch(url, { signal: ctrl.signal });
    clearTimeout(timer);

    if (!res.ok) {
      console.error("[stt] DownloadFile נכשל:", res.status);
      return null;
    }
    const buf = Buffer.from(await res.arrayBuffer());
    // ⚠️ קובץ ריק = ההקלטה לא נוצרה. מחזירים null ולא מנסים
    // לשלוח ל-Gemini בייטים ריקים.
    if (buf.length < 500) {
      console.error("[stt] קובץ ריק או קצר מדי:", buf.length);
      return null;
    }
    return buf.toString("base64");
  } catch (e) {
    console.error("[stt] שגיאה בהורדה:", e);
    return null;
  }
}

/**
 * §215: מתמלל הקלטה של **שם** בעברית.
 *
 * ⚠️ ההנחיה ל-Gemini ממוקדת בשמות ולא בתמלול כללי: מודל שמקבל
 * "תמלל את זה" מחזיר משפט שלם עם סימני פיסוק, ואנחנו צריכים
 * שתי-שלוש מילים נקיות. ההבדל הזה הוא מה שהופך את התוצאה לשמישה.
 */
export async function transcribeName(
  recordingPath: string,
  kind: "first" | "last" | "full" = "full"
): Promise<string | null> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) {
    console.error("[stt] GEMINI_API_KEY חסר ב-ENV");
    return null;
  }

  const audio = await downloadRecording(recordingPath);
  if (!audio) return null;

  const what =
    kind === "first" ? "שם פרטי" : kind === "last" ? "שם משפחה" : "שם מלא";

  // ⚠️ ההנחיה מפורשת עד כדי אובססיביות, כי כל תוספת מהמודל
  // (מרכאות, "השם הוא", נקודה בסוף) נכנסת ישירות לשם הלקוח
  // ומופיעה בדף החלוקה ובמיילים.
  //
  // ⚠️ JSON ולא טקסט חופשי: אותו דפוס של §20 (תעודות משלוח),
  // שם responseMimeType="application/json" מונע מהמודל להוסיף
  // הסברים. זה הוכח בייצור ואין סיבה להמציא מחדש.
  const prompt = [
    // §215: רמז שפה מפורש בתחילת ההנחיה.
    //
    // ⚠️ התיעוד של גוגל מציין שרמז שפה משפר משמעותית את הדיוק
    // באודיו עם מבטא - וזה בדיוק המקרה כאן: הקלטה טלפונית
    // ב-8kHz, לרוב עם מבטא ירושלמי או אמריקאי.
    "שפת ההקלטה: עברית (he-IL).",
    `ההקלטה היא משיחת טלפון באיכות נמוכה (8kHz). בהקלטה אדם אומר ${what}.`,
    `החזר JSON: { "name": "${what} כפי שנשמע", "confidence": 0.0 }`,
    "name — בעברית בלבד, בלי מרכאות ובלי ניקוד.",
    "confidence — 0.0 עד 1.0. אם ההקלטה מטושטשת או לא ברורה, תן ערך נמוך.",
    "אם לא זיהית שם כלל — החזר name ריק.",
    'דוגמאות: {"name":"משה","confidence":0.95} · {"name":"ניימן","confidence":0.8}',
  ].join(" ");

  try {
    // ⚠️ אותו SDK ואותו דגם של §20 - מה שכבר עובד בייצור.
    // gemini-flash-latest ולא גרסה ממוספרת: גוגל מוציאים דגמים
    // חדשים ומשביתים ישנים, ו-latest חוסך פריסה בכל פעם.
    const genAI = new GoogleGenerativeAI(key);
    const model = genAI.getGenerativeModel({
      model: "gemini-flash-latest",
      generationConfig: {
        // ⚠️ 0.1 כמו בתעודות: אנחנו רוצים תמלול יציב, לא יצירתיות
        temperature: 0.1,
        maxOutputTokens: 128,
        responseMimeType: "application/json",
      },
    });

    const result = await model.generateContent([
      prompt,
      {
        inlineData: {
          data: audio,
          // ⚠️ audio/wav: זה מה שימות מקליטים (8kHz טלפוני).
          mimeType: "audio/wav",
        },
      },
    ]);

    const raw = result.response.text();
    let parsed: any;
    try {
      parsed = JSON.parse(raw);
    } catch {
      console.error("[stt] JSON לא תקין מ-Gemini:", raw.slice(0, 200));
      return null;
    }

    const name = String(parsed?.name ?? "").trim();
    const conf = Number(parsed?.confidence ?? 0);

    // ⚠️ ניקוי הגנתי: גם עם responseMimeType, מודלים מוסיפים
    // לפעמים מרכאות או נקודה בתוך הערך.
    const cleaned = name
      .replace(/["'`׳״.,!?]/g, " ")
      .replace(/\s+/g, " ")
      .trim();

    if (!cleaned) {
      console.log("[stt] Gemini לא זיהה שם");
      return null;
    }
    // ⚠️ סף ביטחון: תמלול שגוי גרוע מבקשה לומר שוב. 0.4 נבחר
    // כדי לתפוס הקלטות מטושטשות בלי לדחות שמות נדירים.
    if (conf > 0 && conf < 0.4) {
      console.log(`[stt] ביטחון נמוך (${conf}) - נדחה:`, cleaned);
      return null;
    }
    // ⚠️ תקרת אורך: תשובה ארוכה היא סימן שהמודל הסביר במקום
    // לתמלל, ושמירה שלה הייתה מכניסה משפט לשדה השם.
    if (cleaned.length > 40) {
      console.log("[stt] תשובה ארוכה מדי, נדחתה:", cleaned.slice(0, 60));
      return null;
    }
    return cleaned;
  } catch (e) {
    console.error("[stt] שגיאה ב-Gemini:", e);
    return null;
  }
}

/**
 * §215: האם התמלול העצמאי מופעל.
 *
 * ⚠️ מתג: אם משהו משתבש בייצור, כיבוי ב-ENV מחזיר מיד למנוע של
 * ימות בלי פריסת קוד. אותו עיקרון של YEMOT_USE_RECORDINGS (§92).
 */
export function useGeminiStt(): boolean {
  return (
    process.env.YEMOT_STT_VIA_GEMINI === "true" &&
    !!process.env.GEMINI_API_KEY &&
    !!yemotToken()
  );
}
