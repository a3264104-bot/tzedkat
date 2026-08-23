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
    // §217: 3 שניות ולא 6. הקובץ הוא שניות בודדות של אודיו,
    // וימות מהירים. 6 שניות היו תקציב שאין לו הצדקה כשהלקוח
    // ממתין על הקו.
    const timer = setTimeout(() => ctrl.abort(), 3000);
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
/**
 * §218: מטמון תמלולים לפי נתיב ההקלטה.
 *
 * 🐛 הבאג שזה פותר (23/08 21:43): ימות שולחים את **כל** הערכים
 * שנצברו בשיחה, בכל בקשה (§106). כלומר NAME (נתיב ההקלטה) נשלח
 * שוב ושוב, ואנחנו תמללנו אותו מחדש בכל פעם.
 *
 * התוצאה בשטח: השם הפרטי תומלל בהצלחה בבקשה אחת, ונכשל בבקשה
 * הבאה - ונשמר "לקוח טלפוני ברנשטיין".
 *
 * ⚠️ שלוש בעיות בבת אחת: עלות כפולה ב-Gemini, זמן תגובה כפול,
 * ותוצאה לא עקבית באותה שיחה.
 *
 * ⚠️ מטמון בזיכרון ולא במסד: השיחה נמשכת דקה-שתיים, ו-Vercel
 * מחזיקים את אותו instance חם לאורך הזמן הזה ברוב המקרים.
 * instance קר יתמלל מחדש - נכון, אבל זה עדיין טוב פי כמה
 * מתמלול בכל בקשה. כתיבה למסד על כל הקלטה הייתה יקרה יותר
 * מהבעיה שהיא פותרת.
 */
const cache = new Map<string, { value: string | null; at: number }>();
const CACHE_TTL_MS = 10 * 60 * 1000;

function cacheGet(key: string): { hit: boolean; value: string | null } {
  const e = cache.get(key);
  if (!e) return { hit: false, value: null };
  if (Date.now() - e.at > CACHE_TTL_MS) {
    cache.delete(key);
    return { hit: false, value: null };
  }
  return { hit: true, value: e.value };
}

function cacheSet(key: string, value: string | null) {
  // ⚠️ ניקוי כשהמפה גדלה: instance חם ששרת מאות שיחות היה
  // צובר זיכרון בלי הגבלה.
  if (cache.size > 200) {
    const cutoff = Date.now() - CACHE_TTL_MS;
    for (const [k, v] of cache) if (v.at < cutoff) cache.delete(k);
  }
  cache.set(key, { value, at: Date.now() });
}

export async function transcribeName(
  recordingPath: string,
  kind: "first" | "last" | "full" = "full"
): Promise<string | null> {
  // §217: 🚨 **תקציב זמן כולל** ולא לכל שלב בנפרד.
  //
  // 🐛 החישוב הקודם: 3 להורדה + 5 לניסיון + 3 לניסיון שני = 11
  // שניות במקרה הגרוע. Vercel Hobby חותך ב-10, וימות מנתקים
  // עוד לפני זה.
  //
  // ⚠️ deadline אחד לכל הפונקציה: אם ההורדה לקחה 3, לניסיונות
  // נשארות 4 - ולא 8. זו הדרך היחידה להבטיח תקרה אמיתית.
  // §218: אותה הקלטה מתומללת **פעם אחת** בשיחה.
  //
  // ⚠️ גם כישלון נשמר: אם Gemini לא הצליח, ניסיון חוזר באותה
  // שיחה כנראה ייכשל גם הוא - והוא רק מאריך את השיחה. עדיף
  // תוצאה עקבית מאשר "אולי הפעם יצליח".
  const cached = cacheGet(recordingPath);
  if (cached.hit) {
    console.log(`[stt] מהמטמון: ${cached.value ?? "(כישלון)"}`);
    return cached.value;
  }

  // §219: 14 שניות ולא 7.5.
  //
  // 🐛 מה שקרה: התקציב הצר נתן לניסיון השני 3.5 שניות בלבד,
  // והוא נחתך באמצע. שני ניסיונות קצרים גרועים מאחד ארוך.
  //
  // ⚠️ דורש maxDuration=25 ב-route (ברירת המחדל ב-Vercel היא
  // 10 שניות, וה-timeout היה נחתך מבחוץ בלי שנדע למה).
  const deadline = Date.now() + 14000;
  const left = () => Math.max(0, deadline - Date.now());
  const key = process.env.GEMINI_API_KEY;
  if (!key) {
    console.error("[stt] GEMINI_API_KEY חסר ב-ENV");
    return null;
  }

  // ⚠️ ההורדה מוגבלת גם היא ל-3 שניות **וגם** לתקציב הכולל
  const audio = await downloadRecording(recordingPath);
  if (!audio) return null;
  if (left() < 1500) {
    // ⚠️ פחות משנייה וחצי - אין טעם להתחיל קריאה שתיחתך באמצע.
    console.log("[stt] נגמר התקציב אחרי ההורדה");
    return null;
  }

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
    // §219: 🐛 gemini-flash-latest החזיר 503 "high demand" שוב ושוב.
    //
    // ה-alias מפנה למודל הפופולרי ביותר, ולכן הוא גם העמוס
    // ביותר. גרסה ממוספרת יושבת על מאגר קיבולת אחר.
    //
    // ⚠️ הניסיון השני עובר ל**מודל אחר** ולא חוזר על אותו אחד:
    // אם 2.5 עמוס, ניסיון נוסף עליו ייכשל בדיוק אותו דבר.
    // 2.0 הוא דור קודם, פחות מבוקש, ומספיק טוב לתמלול שם.
    const MODELS = ["gemini-2.5-flash", "gemini-2.0-flash"];
    const genAI = new GoogleGenerativeAI(key);
    const mkModel = (name: string) =>
      genAI.getGenerativeModel({
        model: name,
      generationConfig: {
        // ⚠️ 0.1 כמו בתעודות: אנחנו רוצים תמלול יציב, לא יצירתיות
        temperature: 0.1,
        // §217: 🐛 128 היה נמוך מדי - התשובה נחתכה על "{" בלבד.
        //
        // gemini-flash-latest הוא מודל חושב, ו"מחשבות" נספרות
        // בתקציב הפלט. עם 128 הן בלעו הכל ולא נשאר מקום ל-JSON.
        //
        // ⚠️ 1024 ולא 4096 (כמו בתעודות): התשובה כאן היא שתי
        // מילים, והתקרה רק צריכה לתת מקום למחשבות.
        maxOutputTokens: 1024,
          responseMimeType: "application/json",
        },
      });

    // §217: 🐛 503 "high demand" הפיל את התמלול.
    //
    // gemini-flash-latest עמוס בשעות מסוימות, וכישלון אחד הפיל
    // את כל הזרימה - הלקוח נתקע בלולאה של "אמור שוב".
    //
    // ⚠️ ניסיון אחד חוזר בלבד: הלקוח על הקו, וכל ניסיון עולה
    // שנייה-שתיים. שניים זה הגבול לפני שהשיחה נתקעת.
    // §217: 🚨 **מגבלת זמן על Gemini.**
    //
    // 🐛 מה שקרה בשטח: השיחה לקחה 11.19 שניות. ה-SDK אינו מקבל
    // AbortSignal, ולכן הקריאה יכלה להימשך ללא הגבלה - וימות
    // מנתקים או שולחים שוב.
    //
    // ⚠️ Promise.race ולא timeout של ה-SDK: אין כזה. הקריאה
    // ממשיכה ברקע אבל אנחנו מפסיקים לחכות לה, וזה מספיק - היא
    // תיפול לבד כשהפונקציה נגמרת.
    //
    // ⚠️ 5 שניות: יחד עם 3 של ההורדה זה 8, וזה הגבול שאחריו
    // הלקוח חושב שהשיחה נתקעה.
    const withTimeout = <T,>(pr: Promise<T>, ms: number): Promise<T> =>
      Promise.race([
        pr,
        new Promise<T>((_, rej) =>
          setTimeout(() => rej(new Error(`gemini timeout ${ms}ms`)), ms)
        ),
      ]);

    let result: any = null;
    let lastErr: any = null;
    for (let attempt = 0; attempt < MODELS.length; attempt++) {
      try {
        result = await withTimeout(
          mkModel(MODELS[attempt]).generateContent([
      prompt,
          {
            inlineData: {
              data: audio,
              // ⚠️ audio/wav: זה מה שימות מקליטים (8kHz טלפוני).
              mimeType: "audio/wav",
            },
            },
          ]),
          // ⚠️ ניסיון שני קצר יותר: אם הראשון נתקע, השני כנראה
          // גם ייתקע, ואין טעם לבזבז עוד 5 שניות מהשיחה.
          // ⚠️ מה שנשאר מהתקציב, עד 6 שניות.
          Math.min(6000, left())
        );
        break;
      } catch (e: any) {
        lastErr = e;
        // ⚠️ רק 503 שווה ניסיון חוזר. שגיאת מפתח או פורמט
        // תיכשל שוב בדיוק אותו דבר, והמתנה נוספת רק מאריכה
        // את השיחה.
        // ⚠️ 503 **או** timeout: שניהם זמניים ושווים ניסיון שני.
        // שגיאת מפתח או פורמט תיכשל שוב בדיוק אותו דבר.
        const retryable =
          e?.status === 503 || String(e?.message ?? "").includes("timeout");
        if (!retryable) throw e;
        // ⚠️ עצירה כשאין תקציב: ניסיון שני שייחתך אחרי חצי
        // שנייה הוא בזבוז שמאריך את השיחה בלי סיכוי להצליח.
        // ⚠️ 3 שניות מינימום: ניסיון עם פחות מזה ייחתך באמצע
        // ורק יאריך את השיחה בלי סיכוי אמיתי.
        if (left() < 3000 || attempt + 1 >= MODELS.length) {
          console.log("[stt] נגמר התקציב או המודלים");
          break;
        }
        console.log(
          `[stt] ${e?.status === 503 ? "503" : "timeout"} ב-${MODELS[attempt]} → מנסה ${MODELS[attempt + 1] ?? "אין"}`
        );
        await new Promise((r) => setTimeout(r, 300));
      }
    }
    if (!result) throw lastErr;

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
      cacheSet(recordingPath, null);
      return null;
    }
    // ⚠️ סף ביטחון: תמלול שגוי גרוע מבקשה לומר שוב. 0.4 נבחר
    // כדי לתפוס הקלטות מטושטשות בלי לדחות שמות נדירים.
    if (conf > 0 && conf < 0.4) {
      console.log(`[stt] ביטחון נמוך (${conf}) - נדחה:`, cleaned);
      cacheSet(recordingPath, null);
      return null;
    }
    // ⚠️ תקרת אורך: תשובה ארוכה היא סימן שהמודל הסביר במקום
    // לתמלל, ושמירה שלה הייתה מכניסה משפט לשדה השם.
    if (cleaned.length > 40) {
      console.log("[stt] תשובה ארוכה מדי, נדחתה:", cleaned.slice(0, 60));
      cacheSet(recordingPath, null);
      return null;
    }
    cacheSet(recordingPath, cleaned);
    return cleaned;
  } catch (e) {
    console.error("[stt] שגיאה ב-Gemini:", e);
    // ⚠️ כישלון **לא** נשמר במטמון כאן: 503 או timeout הם זמניים,
    // ובניגוד ל"לא זיהה" יש סיכוי אמיתי שניסיון בבקשה הבאה
    // יצליח. זו הפעם היחידה ששווה לנסות שוב.
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
