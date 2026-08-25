// §24: המערכת הטלפונית - נקודת הכניסה מימות המשיח.
// GET/POST /api/phone/ivr
//
// ימות קוראים ל-endpoint הזה בכל שלב בשיחה, ושולחים את כל הנתונים
// שנאספו עד כה. אנחנו מחזירים טקסט שאומר להם מה להשמיע ומה לבקש.
//
// ⚠️ אין כאן auth() - ימות לא יכולים להתחבר. הזיהוי הוא לפי ApiPhone
// (מספר המתקשר, שימות מזהים ברמת הרשת ולא ניתן לזיוף מהמשתמש).
// ה-endpoint לא חושף מידע רגיש: רק שם הלקוח והזמנותיו שלו.
//
// עקרון מרכזי: לא משכפלים לוגיקה. המכירה, המוצרים, המחירים והוולידציות
// הם בדיוק אותם של האתר.

import bcrypt from "bcryptjs";
// §202: תוקף כרטיס האשראי
import { canChargeCard, expiryPhoneMessage } from "@/lib/card-expiry-lib";
// §215: תמלול דיבור דרך Gemini במקום יחידות ימות
import { transcribeName, useGeminiStt } from "@/lib/gemini-stt-lib";
import crypto from "crypto";
import { prisma } from "@/lib/prisma";
import {
  parseYemotRequest,
  yemotResponse,
  playMessage,
  say,
  prompt,
  sayNumber,
  sayDigits,
  read,
  readVoice,
  readRecord,
  clearVar,
  normalizePhone,
  messages,
  goToFolder,
} from "@/lib/yemot-lib";
import { effectiveUnitPrice, smartLineEstimate } from "@/lib/pricing";
// §64: קוד התחברות ללקוח שנרשם בטלפון
// §76: decryptCode בלבד - ה-IVR מקריא קודים, לא מייצר אותם
import { decryptCode } from "@/lib/login-code";
// §79: התראה לנציג על בקשת הרשמה חדשה
import { waitUntil } from "@vercel/functions";
import { sendPhoneSignupNotification } from "@/lib/email";
// §71: ניקוי שם מזיהוי הדיבור - מקור התווים הנסתרים
import { cleanName, cleanSpokenName, isPlausibleName } from "@/lib/identity";
// §124: יתרת זכות בטלפון
import { creditBalanceForPhone } from "@/lib/credit-balance-lib";
// §152: פרטי כניסה - איות אותיות בעברית להקראה בטלפון
import { spellForPhone, isDigitsOnly, resolveCredential } from "@/lib/credential-lib";
// §148: תצוגת יחידות - מקור אחד לכל המערכת
import { formatItemQty } from "@/lib/order-display";

/**
 * §215: מבקש מהלקוח לומר משהו — הקלטה או תמלול, לפי המתג.
 *
 * ⚠️ עטיפה אחת במקום ארבע קריאות מפוזרות: המעבר בין המנועים הוא
 * החלטה גלובלית, ופיזור התנאי בארבעה מקומות היה מבטיח שאחד
 * מהם יישאר מאחור ביום שמשנים משהו.
 *
 * ⚠️ **הערך שחוזר שונה בין המצבים**: ב-voice זה הטקסט שנאמר,
 * וב-record זה נתיב הקובץ. הקורא חייב להעביר את הערך דרך
 * resolveSpoken() ולא להשתמש בו ישירות.
 */
function askSpoken(promptText: string, name: string): string {
  return useGeminiStt() ? readRecord(promptText, name) : readVoice(promptText, name);
}

/**
 * §215: ממיר את מה שחזר מימות לטקסט.
 *
 * במצב voice — הערך כבר טקסט ומוחזר כמו שהוא.
 * במצב record — הערך הוא נתיב, ונשלח ל-Gemini לתמלול.
 *
 * ⚠️ נפילה ל-null ולא לזריקת שגיאה: אם Gemini נכשל או איטי,
 * הלקוח יתבקש לומר שוב — בדיוק כמו שקורה כשמנוע ימות לא מזהה.
 * שיחה שנופלת גרועה משאלה חוזרת.
 */
async function resolveSpoken(
  raw: string | null | undefined,
  kind: "first" | "last" | "full"
): Promise<string> {
  const v = String(raw ?? "").trim();
  if (!v) return "";
  if (!useGeminiStt()) return v;
  // ⚠️ זיהוי נתיב: ימות מחזירים "ivr2:/..." או נתיב יחסי עם
  // סיומת wav. טקסט רגיל לא ייראה כך.
  const looksLikePath = /\.wav$/i.test(v) || v.startsWith("ivr2:");
  if (!looksLikePath) return v;

  const t = await transcribeName(v, kind);
  if (t) return t;

  // §217: 🚨 **הלולאה.**
  //
  // 🐛 מה שקרה בשטח: Gemini נכשל (503 או JSON חתוך), הפונקציה
  // החזירה "", והזרימה חשבה שהלקוח לא ענה - ושאלה שוב. ושוב.
  // הלקוח הקליט שם משפחה חמש פעמים והמערכת המשיכה לבקש.
  //
  // ⚠️ סימון מיוחד ולא "": הזרימה **חייבת** להבדיל בין "לא
  // ענה" (לשאול שוב, נכון) לבין "ענה אבל התמלול נכשל" (להמשיך,
  // כי הלקוח כבר עשה את שלו).
  //
  // ⚠️ ההקלטה עצמה נשמרה בימות. המנהל יראה "לקוח טלפוני"
  // במסך הבקשות, יתקשר, וישלים - בדיוק כמו שקורה היום כשמנוע
  // הזיהוי של ימות לא מצליח.
  console.log(`[stt] תמלול נכשל (${kind}) - ממשיך בלי לחסום`);
  return STT_FAILED;
}

/**
 * §217: סימון "הלקוח ענה אך התמלול נכשל".
 *
 * ⚠️ מחרוזת ולא null: היא עוברת דרך cleanSpokenName ובדיקות
 * אחרות, וערך null היה נופל בהן. הסימון מסונן בסוף.
 */
const STT_FAILED = "\u0000STT_FAILED";

/** האם הערך הוא סימון כישלון תמלול */
function isSttFailed(v: string): boolean {
  return v === STT_FAILED;
}

import {
  sendCustomerOrderConfirmation,
  sendAdminOrderNotification,
} from "@/lib/email";

type DraftItem = {
  productId: string;
  productName: string;
  // §33: נשמר בטיוטה כדי שהסיכום יקריא אותה בלי שאילתה נוספת
  kashrut?: string | null;
  // §128: יחידת המכירה האמיתית של המוצר.
  //
  // 🐛 לא נשמרה, ולכן ביצירת ההזמנה נכתב `isSingle ? ק"ג : קרטון`
  // באופן קבוע. מוצר שנמכר ביחידות - כבד, בקר טחון - נשמר במסד
  // כ"קרטון", וכל מסך שקרא אותו הציג שגוי. זה לא באג תצוגה אלא
  // **נתון שגוי במסד**, ולכן הוא שרד כל תיקון בתצוגה.
  unit?: string | null;
  isSingle: boolean;
  quantity: number;
  unitPrice: number;
  estimatedPrice: number;
  estimatedWeight: number | null;
};

// §61: המחירון נטען **פעם אחת** בכניסה לבקשה, עם כל השדות שמישהו
// במסלול צריך, ומועבר הלאה. קודם הוא נטען מחדש בכל שלב (findFirst
// בתפריט + findFirst ב-handleOrder + שלוש findUnique נוספות לשדות
// בודדים כמו orderFee ו-editDeadline) - חמש נסיעות הלוך-חזור למסד
// על אותה שורה, בכל הקשה בשיחה.
type ActiveSale = {
  id: string;
  name: string;
  closeDate: Date | null;
  openDate: Date | null;
  singleSurcharge: any;
  orderFee: any;
  deliveryDateText: string | null;
  // §100: התאריך עצמו, להקראה נכונה בעברית ובלועזי
  deliveryDate: Date | null;
  editDeadline: Date | null;
};

// §61: ימות מחכים לתשובה שלנו לפני שהם משמיעים את ההודעה הבאה, ולכן
// כל מילישנייה כאן היא שקט באוזן של הלקוח.
//
// §69: שונה מ-dub1 ל-fra1 אחרי בדיקה בלוגים. הממצא היה:
//   Received in Frankfurt (fra1) → Routed to Washington (iad1)
//   Execution Duration: 2.44s
// כלומר הבקשה של ימות *מגיעה* לפרנקפורט, נשלחה לוירג'יניה, ומשם
// דיברה עם Supabase באירלנד - כל שאילתה חצתה את האוקיינוס פעמיים.
//
// fra1 ולא dub1: פרנקפורט היא נקודת הכניסה של ימות ממילא, ולכן היא
// מבטלת גם את הקפיצה הראשונה. פרנקפורט↔אירלנד הוא ~20ms לעומת
// ~90ms חוצה-אוקיינוס.
//
// ⚠️ ההגדרה כאן חלה על ה-route הזה בלבד. אם הלוגים עדיין מראים
// ניתוב ל-iad1, יש לקבוע את האזור גם ברמת הפרויקט:
// Vercel → Settings → Functions → Function Region → Frankfurt.
export const preferredRegion = "fra1";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * §219: תקרת זמן לפונקציה.
 *
 * 🐛 ברירת המחדל ב-Vercel היא 10 שניות. תמלול שלוקח 12 היה
 * נחתך **מבחוץ** - הפונקציה נהרגת, ימות מקבלים 504, והלקוח
 * שומע שקט. בלוגים זה נראה כמו timeout של Gemini, אבל המקור
 * אחר לגמרי.
 *
 * ⚠️ 25 ולא 60: התקציב הפנימי הוא 14 שניות, וזה נותן מרווח
 * להורדה ולעיבוד בלי לאפשר לפונקציה להיתקע לדקה שלמה.
 */
export const maxDuration = 25;

// סיסמה אקראית חזקה ללקוח שנרשם בטלפון.
// הוא לא הזין סיסמה ולא יכול להזין אחת בשיחה, אבל passwordHash הוא שדה
// חובה. הסיסמה לא מיועדת לשימוש: הלקוח ייכנס לאתר דרך "שכחתי סיסמה"
// (אם יוסיף מייל) או שהנציג יאפס לו. זהה למה ש-agent/customer-create עושה.
function generateStrongPassword(): string {
  return crypto.randomBytes(24).toString("base64");
}

async function handle(req: Request): Promise<Response> {
  const p = await parseYemotRequest(req);

  const callId = p.ApiCallId || "";
  const phone = normalizePhone(p.ApiPhone || "");

  // ניתוק: מנקים טיוטה שלא הושלמה
  if (p.hangup === "yes") {
    if (callId) {
      await prisma.phoneOrderDraft
        .deleteMany({ where: { callId, completedAt: null } })
        .catch(() => null);
    }
    return yemotResponse("");
  }

  if (!phone) {
    return yemotResponse(
      playMessage(prompt("id_error", "אירעה שגיאה בזיהוי המספר"))
    );
  }

  // ═══ §69: כוכבית = חזרה לתפריט הראשי, מכל מקום ═══
  //
  // כל הפרמטרים של השיחה נצברים אצל ימות ונשלחים בכל בקשה, ולכן
  // אי אפשר "לאפס תפריט" מתוך ה-API - הערכים הישנים (CAT0, MENU...)
  // ימשיכו להגיע והניתוב יקפוץ לאמצע הזרימה. הדרך היחידה להתחלה
  // נקייה היא go_to_folder: ימות עוברים לשלוחה מחדש, וכל הפרמטרים
  // שנאספו נמחקים.
  //
  // הסריקה על *כל* הפרמטרים: הכוכבית יכולה להגיע מכל שאלה בזרימה
  // (yemot-lib מוסיף אותה לרשימת המקשים המותרים בכל read).
  //
  // §89: השלוחה היא **השורש** (/) - ה-ext.ini עם type=api יושב שם
  // ולא בשלוחה ממוספרת. אומת מול ההגדרה בימות.
  //
  // ⚠️ ext.ini מגדיר גם api_end_goto=hangup, ולכן כל playMessage
  // (הודעה בלי read אחריה) מסיים את השיחה. זו התנהגות מכוונת -
  // הודעות סיום כמו "תודה ולהתראות" אמורות לנתק - אבל חשוב לזכור
  // אותה: הודעת שגיאה שנשלחת ב-playMessage תנתק את הלקוח במקום
  // להחזיר אותו לתפריט.
  //
  // YEMOT_IVR_FOLDER קיים כמוצא אם השלוחה תשתנה בעתיד.
  const starPressed = Object.entries(p).some(
    ([k, v]) => v === "*" && !k.startsWith("Api") && k !== "hangup"
  );
  if (starPressed) {
    return yemotResponse(goToFolder(process.env.YEMOT_IVR_FOLDER || "/"));
  }

  // ═══════════════════════════════════════════════════════════
  // §94: הלקוח והמחירון נשלפים **במקביל**
  // ═══════════════════════════════════════════════════════════
  // 🐛 מה שהיה: שתי שאילתות עצמאיות לחלוטין רצו בזו אחר זו, ולכן
  // שילמנו שתי נסיעות חוצות-אוקיינוס במקום אחת. עם ~200ms לנסיעה
  // זו חצי שנייה של שקט מיותר בכל הקשה.
  //
  // ⚠️ הן באמת עצמאיות: זיהוי הלקוח לפי טלפון אינו תלוי במחירון,
  // והמחירון הפעיל אינו תלוי בלקוח. לא כל שאילתה כאן ניתנת
  // למקבול - openOrder תלוי ב-activeSale ולכן נשאר אחריו.
  //
  // Promise.all ולא allSettled: אם אחת נכשלת אין טעם להמשיך, ואנחנו
  // רוצים שהשגיאה תעלה כרגיל.
  const [matches, activeSaleEarly] = await Promise.all([
    // §161: זיהוי לפי טלפון ראשי **או** טלפון נוסף.
    //
    // התרחיש: לקוח שמתקשר פעם מהבית ופעם מהנייד. עד היום השני
    // לא זוהה כלל - הוא שמע "לא מזוהה" ונאלץ להירשם מחדש.
    //
    // ⚠️ **findMany ולא findUnique.** phone2 אינו @unique, ולכן
    // יכולים להיות שני לקוחות עם אותו מספר - למשל טלפון בית
    // משותף למשפחה, או טעות הקלדה.
    //
    // ⚠️ הבדיקה למטה דוחה תוצאה מרובה: מתקשר שמזוהה כשני אנשים
    // **לא יזוהה בכלל**. עדיף שיירשם מחדש מאשר שיזמין בשם אחיו,
    // או ישמע את פרטי הכניסה של מישהו אחר.
    prisma.customer.findMany({
    where: { OR: [{ phone }, { phone2: phone }] },
    take: 2,
    select: {
      id: true,
      name: true,
      role: true,
      // §61: 🐛 phone לא נשלף, ולכן `customer.phone ?? ""` בטיוטה
      // ובהזמנה נתן תמיד מחרוזת ריקה. PhoneOrderDraft.phone היה ריק
      // בכל הרשומות, וה-@@index([phone]) עליו לא שירת דבר.
      phone: true,
      paymentToken: true,
      // §202: תוקף הכרטיס - לבדיקה לפני שמאפשרים הזמנה
      cardExpiry: true,
      // §60: לקוח מזומן מזמין בלי כרטיס
      paymentPreference: true,
      // §52: לקוח מושבת
      isActive: true,
      defaultPointId: true,
      defaultPoint: { select: { id: true, name: true } },
      // §76: לשמיעת קוד הכניסה לאתר (תפריט 4)
      loginCode: true,
      // §152: הסיסמה שהלקוח בחר - נפילה כשאין קוד. בלעדיה
      // resolveCredential תמיד יחזיר את הקוד בלבד.
      passwordPlain: true,
      // §124: יתרת זכות - מוקראת בתפריט הראשי
      creditBalance: true,
    },
    }),
    getActiveSale(),
  ]);

  // §161: זיהוי חד-משמעי בלבד.
  //
  // ⚠️ שתי התאמות = **לא מזוהה**. זה קורה כששני לקוחות חולקים
  // טלפון נוסף (משפחה, טעות הקלדה), ואז אין דרך לדעת מי מתקשר.
  //
  // הבחירה השרירותית הייתה גרועה בהרבה: המתקשר היה מזמין בשם
  // אחיו, שומע את פרטי הכניסה שלו, ורואה את ההזמנות שלו.
  if (matches.length > 1) {
    console.warn(
      `[ivr] ambiguous phone ${phone} matches ${matches.length} customers`
    );
  }
  const customer = matches.length === 1 ? matches[0] : null;

  // ═══ לקוח לא רשום ═══
  if (!customer) {
    return handleUnregistered(p, phone, callId);
  }

  // ═══ §52: לקוח לא פעיל ═══
  // 🐛 הערוץ הטלפוני היה החריג היחיד: ההשבתה נאכפה ב-8 מקומות באתר
  // ובמסכי הנציג, אבל לא כאן - ולקוח שביקש להפסיק לקבל שירות יכול
  // היה פשוט להתקשר ולהזמין. הבדיקה לפני כל השאר, כי היא גוברת גם
  // על הזמנה פתוחה קיימת.
  if (customer.isActive === false) {
    return yemotResponse(
      playMessage(
        say(`שלום ${customer.name}`),
        prompt(
          "customer_inactive",
          "החשבון שלך אינו פעיל כרגע. לחידוש ההזמנות יש לפנות למוקד. תודה ולהתראות"
        )
      )
    );
  }

  // ═══ לקוח שאינו כשיר להזמין ═══
  // חסום מהזמנה בדיוק כמו באתר. לא בונים כאן מסלול תשלום חלופי -
  // נציג יעדכן כרטיס והלקוח יוכל להזמין בשיחה הבאה.
  //
  // §60: לקוח מזומן **כן** רשאי להזמין בלי כרטיס - הנציג הגדיר אותו
  // ככזה, והגבייה מתבצעת פיזית בחלוקה. בלי החריג הזה כל לקוח המזומן
  // שנבנה ב-§60 היה נחסם מהטלפון בלי סיבה.
  // §202: 🐛 כרטיס שפג תוקפו אפשר הזמנה.
  //
  // הלקוח הזמין בטלפון, קיבל אישור, והחיוב נכשל אחרי החלוקה.
  // עכשיו הוא שומע את זה בשיחה ויכול לעדכן לפני שהוא מזמין.
  const cardUsable =
    !!customer.paymentToken && canChargeCard((customer as any).cardExpiry);
  const canOrder = cardUsable || customer.paymentPreference === "CASH";

  // §202: אזהרה על כרטיס שפג בקרוב. null כשהכל תקין.
  //
  // ⚠️ רק ללקוח אשראי: למזומן אין כרטיס, והודעה כזו הייתה
  // מבלבלת אותו לגמרי.
  const cardWarning =
    customer.paymentPreference === "CASH"
      ? null
      : expiryPhoneMessage((customer as any).cardExpiry);
  if (!canOrder) {
    const pending = await prisma.phoneSignupRequest.findFirst({
      where: { customerId: customer.id, status: { notIn: ["COMPLETED", "FAILED"] } },
      select: { id: true },
    });
    return yemotResponse(
      playMessage(
        say(`שלום ${customer.name}`),
        say(
          pending
            ? "בקשתך לפתיחת חשבון נקלטה ונציג יחזור אליך בהקדם לאימות פרטי האשראי"
            // §202: הודעה **מדויקת** ללקוח שהכרטיס שלו פג.
            //
            // 🐛 הוא שמע "יש צורך באימות פרטי אשראי" - כאילו
            // מעולם לא הזין כרטיס. בפועל יש לו כרטיס, הוא פשוט
            // פג, והוא לא הבין למה נחסם אחרי שנתיים של הזמנות.
            : !!customer.paymentToken
              ? "תוקף כרטיס האשראי שלך פג ולכן לא ניתן לבצע הזמנה. יש לעדכן כרטיס באתר או אצל הנציג"
              : "כדי לבצע הזמנות יש צורך באימות פרטי אשראי. נציג יחזור אליך בהקדם"
        )
      )
    );
  }

  // ═══ §26: הזמנה פתוחה במכירה הנוכחית ═══
  // "פתוחה" = נוצרה, לא בוטלה, ו*טרם נמסרה*. deliveredAt הוא הקובע
  // ולא הסטטוס: אחרי שהנציג סימן מסירה הלקוח חוזר לתפריט הרגיל ויכול
  // להזמין במכירה הבאה, גם אם הסטטוס עדיין לא התעדכן לגמרי.
  //
  // §94: כבר נשלף למעלה במקביל לזיהוי הלקוח, ומגיע מהמטמון אם הוא
  // טרי. אין כאן שאילתה נוספת.
  const activeSale = activeSaleEarly;

  // §94: ההזמנה הפתוחה וההודעות למתקשרים - במקביל.
  //
  // ההודעה סוננה קודם לפי openOrder.pointId, ולכן נאלצה לחכות לו -
  // עוד נסיעה חוצת-אוקיינוס. עכשיו נשלפות כל ההודעות של המכירה
  // (יש בודדות בפועל) והסינון לפי נקודה נעשה בזיכרון.
  //
  // ⚠️ הסינון עצמו לא השתנה: גלובלית או ספציפית לנקודת הלקוח,
  // וספציפית גוברת - רק המקום שבו הוא מתבצע.
  const nowForAnn = new Date();
  const [openOrder, announcements] = await Promise.all([
    activeSale
      ? prisma.order.findFirst({
          where: {
            customerId: customer.id,
            pricelistId: activeSale.id,
            status: { notIn: ["CANCELLED"] },
            deliveredAt: null,
          },
          select: {
            id: true,
            orderNumber: true,
            estimatedTotal: true,
            finalTotal: true,
            status: true,
            pointId: true,
            deliveryDateSnapshot: true,
          },
        })
      : Promise.resolve(null),
    activeSale && !p.ANNOUNCED
      ? prisma.phoneAnnouncement.findMany({
          where: {
            pricelistId: activeSale.id,
            isActive: true,
            OR: [{ expiresAt: null }, { expiresAt: { gt: nowForAnn } }],
          },
          orderBy: [{ pointId: "desc" }, { createdAt: "desc" }],
          select: { text: true, pointId: true },
        })
      : Promise.resolve([]),
  ]);

  // ─── §30: הודעה למתקשרים ───
  // מוקראת פעם אחת בכניסה, לפני התפריט. הסינון כפול ומכוון:
  //   1. רק ללקוח שיש לו הזמנה פעילה במכירה - למי שלא הזמין העדכון
  //      לא רלוונטי ורק מבלבל.
  //   2. רק אם ההודעה מיועדת לנקודה שלו (או גלובלית) - "החלוקה בקרלין
  //      נדחתה" לא צריך להישמע ללקוח מנדבורנא.
  // ANNOUNCED מסמן שכבר הושמעה, כדי שלא תחזור בכל שלב בשיחה.
  if (openOrder && !p.ANNOUNCED) {
    // §94: הסינון בזיכרון - ההודעות כבר נשלפו במקביל למעלה.
    // ספציפית לנקודה גוברת על גלובלית (ה-orderBy כבר סידר).
    const ann =
      announcements.find((a) => a.pointId === openOrder.pointId) ??
      announcements.find((a) => a.pointId === null) ??
      null;

    if (ann?.text) {
      return yemotResponse(
        read(
          messages(
            prompt("announcement_intro", "הודעה חשובה"),
            say(ann.text),
            // §107: אותה מלכודת - חלופה מוסברת נוספה
            prompt("announcement_continue", "להמשך הקש 1, או כוכבית לתפריט הראשי")
          ),
          { name: "ANNOUNCED", max: 1, min: 1, allowed: "1" }
        )
      );
    }
  }

  // ─── תפריט כשיש הזמנה פתוחה ───
  if (openOrder) {
    if (!p.OPEN) {
      const total =
        openOrder.finalTotal != null
          ? Number(openOrder.finalTotal)
          : Number(openOrder.estimatedTotal);
      const isFinal = openOrder.finalTotal != null;

      return yemotResponse(
        read(
          messages(
            say(`שלום ${customer.name}`),
            prompt("has_open_order", "יש לך הזמנה פתוחה במכירה הנוכחית"),
            prompt(
              isFinal ? "summary_final" : "summary_estimated",
              isFinal ? "סכום סופי" : "סכום משוער"
            ),
            sayNumber(Math.round(total)),
            prompt("shekels", "שקלים"),
            openOrder.deliveryDateSnapshot
              ? say(`מועד החלוקה ${openOrder.deliveryDateSnapshot}`)
              : "",
            prompt(
              "menu_open_order",
              "לשמיעת פרטי ההזמנה הקש 1. לשינוי ההזמנה הקש 2. לביטול ההזמנה הקש 3. לשמיעת נקודת החלוקה הקש 4"
            )
          ),
          { name: "OPEN", max: 1, min: 1, allowed: "1234" }
        )
      );
    }

    if (p.OPEN === "1") return handleMyOrders(p, customer.id);
    if (p.OPEN === "2") return handleEditOrder(p, openOrder, customer);
    if (p.OPEN === "3") return handleCancelOrder(p, openOrder, customer);
    if (p.OPEN === "4")
      return handleMyPoint(customer, p, {
        id: openOrder.id,
        pricelistId: activeSale?.id ?? null,
      });
  }

  // ═══ תפריט ראשי (אין הזמנה פתוחה) ═══
  if (!p.MENU) {
    // §76: אפשרות הקוד מוצעת רק ללקוח שהוקם במלואו (יש לו אופן
    // תשלום). אחרת התפריט מציע אפשרות שכל מה שהיא עושה זה לומר
    // "עדיין לא" - מאריך את השיחה של כולם ומתסכל את מי שבוחר בה.
    // §124: היתרה להקראה. null = אין יתרה, ואז שום דבר לא נאמר.
    const creditForPhone = creditBalanceForPhone(
      Number((customer as any).creditBalance ?? 0)
    );

    // §152: האפשרות מוצגת רק ללקוח **שיש לו** פרטי כניסה.
    //
    // 🐛 עד כה התנאי היה אמצעי תשלום בלבד. לקוח מזומן בלי קוד
    // ובלי סיסמה ראה את האפשרות בתפריט, בחר בה, ושמע "לא הופק
    // עבורך קוד" - תפריט שמבטיח משהו שאינו קיים.
    const hasCredential =
      !!customer.loginCode || !!(customer as any).passwordPlain;
    const canHearCode =
      hasCredential &&
      ((!!customer.paymentToken &&
        canChargeCard((customer as any).cardExpiry)) ||
        customer.paymentPreference === "CASH");

    return yemotResponse(
      read(
        messages(
          say(`שלום ${customer.name}`),
          // §97: 🐛 ההקלטה של "ברוכים הבאים" הפסיקה להישמע.
          //
          // §76 יצר שם הודעה **חדש** (menu_main_code) לתפריט עם
          // אפשרות 4. אין הקלטה בשם הזה, ולכן הוא נפל להקראה
          // ממוחשבת - וההקלטה הקיימת (menu_main) לא נקראה כלל.
          //
          // הפתרון: משאירים את ההקלטה הקיימת כפי שהיא, ומוסיפים
          // את אפשרות 4 כהודעה קצרה נפרדת. כך צריך להקליט **שורה
          // אחת** במקום את כל התפריט מחדש, ועד שתוקלט - רק היא
          // תישמע ממוחשבת.
          prompt(
            "menu_main",
            "ברוכים הבאים לצדקת רבותינו. לביצוע הזמנה הקש 1, לשמיעת ההזמנות שלך הקש 2, לשמיעת נקודת החלוקה שלך הקש 3"
          ),
          canHearCode
            ? prompt("menu_opt_code", "לשמיעת קוד הכניסה לאתר הקש 4")
            : "",
          // §124: יתרת זכות. מוקראת מיד אחרי הברכה, לפני התפריט -
          // זה כסף שמגיע ללקוח, והוא צריך לדעת עליו בלי לחפש.
          //
          // ⚠️ רק כשיש יתרה. "יתרת הזכות שלך: אפס" מבלבל, ומאריך
          // את השיחה של כל מי שאין לו.
          // §202: אזהרת תוקף כרטיס - **לפני** יתרת הזכות.
          //
          // ⚠️ הסדר: מה שחוסם אותו קודם, ומה שמשמח אותו אחר כך.
          // לקוח ששומע "יש לך 50 שקל זכות" ואז "הכרטיס פג" זוכר
          // רק את הראשון.
          //
          // ⚠️ מוצג רק כשהכרטיס **עדיין עובד** אבל פג בקרוב.
          // מי שכבר פג נחסם למעלה ולא מגיע לכאן.
          cardWarning ? say(cardWarning) : "",
          creditForPhone != null ? prompt("credit_balance_pre", "יש לך יתרת זכות של") : "",
          creditForPhone != null ? sayNumber(creditForPhone) : "",
          creditForPhone != null
            ? prompt("credit_balance_post", "שקלים, שתקוזז מההזמנה הבאה שלך")
            : "",
          // §107: ההסבר על הכוכבית **בסוף** התפריט ולא בתחילתו.
          //
          // הכוכבית עובדת בכל שלב במערכת (טיפול גלובלי בראש הקובץ),
          // אבל שום דבר לא סיפר ללקוח שהיא קיימת - ומי שנתקע במסך
          // עם אפשרות בודדת ("הקש 1") לא ידע שיש דרך חזרה.
          //
          // המיקום כאן מכוון: הלקוח שומע קודם ברכה ואת האפשרויות
          // שהוא בא בשבילן, ורק אז את הערת הניווט. הסבר טכני לפני
          // "ברוכים הבאים" נשמע הפוך.
          prompt("star_hint", "בכל שלב ניתן לחזור לתפריט זה בהקשת כוכבית")
        ),
        { name: "MENU", max: 1, min: 1, allowed: canHearCode ? "1234" : "123" }
      )
    );
  }

  if (p.MENU === "2") return handleMyOrders(p, customer.id);
  // §76: שמיעת קוד הכניסה לאתר
  if (p.MENU === "4") return handleLoginCode(customer);
  // אין הזמנה פתוחה כאן (התפריט הרגיל)
  if (p.MENU === "3") return handleMyPoint(customer, p, null);
  // §61: המחירון כבר נטען למעלה - מועבר ולא נשלף מחדש
  return handleOrder(p, customer, callId, activeSale);
}

// ─────────────────────────────────────────────────────────────
// לקוח לא רשום
// ─────────────────────────────────────────────────────────────
async function handleUnregistered(
  p: Record<string, string>,
  phone: string,
  callId: string
): Promise<Response> {
  // בחירת פעולה
  if (!p.NEW) {
    return yemotResponse(
      read(
        messages(
          prompt(
            "menu_unregistered",
            "ברוכים הבאים לצדקת רבותינו. המספר שלך אינו רשום במערכת. לפתיחת חשבון הקש 1, להשארת הודעה הקש 2"
          )
        ),
        { name: "NEW", max: 1, min: 1, allowed: "12" }
      )
    );
  }

  // השארת הודעה
  if (p.NEW === "2") {
    await prisma.phoneMessage.create({
      data: { phone, callId: callId || null, kind: "CALLBACK", status: "NEW" },
    });
    return yemotResponse(
      playMessage(prompt("message_saved", "הודעתך נקלטה, נחזור אליך בהקדם. תודה"))
    );
  }

  // ─── פתיחת חשבון ───
  // שלב 1: עיר
  // §69: cityPhoneName - כתיב פונטי לעיר. נלקח מהנקודה הראשונה
  // שהגדירה אותו (הערך זהה לכל נקודות אותה עיר בפועל).
  const cities = await prisma.deliveryPoint.findMany({
    // §163: עיר שיש בה **רק** נקודה סמויה לא תוצע ללקוח.
    // בלי זה הוא היה שומע את שם העיר, בוחר בה, ומגלה שאין בה
    // נקודות - מבוי סתום בשיחה.
    where: { isActive: true, isPrivate: false },
    select: { city: true, cityPhoneName: true },
    distinct: ["city"],
    orderBy: { city: "asc" },
  });
  const cityList = cities.map((c) => c.city).filter(Boolean) as string[];

  if (!p.CITY) {
    if (cityList.length === 0) {
      return yemotResponse(
        playMessage(prompt("no_points", "אין נקודות חלוקה פעילות כרגע"))
      );
    }
    // §69: מקריאים את הכתיב הפונטי אם הוגדר; הבחירה והשמירה נשארות
    // לפי שם העיר האמיתי.
    const cityTts = new Map<string, string>();
    for (const c of cities) {
      if (c.city && c.cityPhoneName && !cityTts.has(c.city)) {
        cityTts.set(c.city, c.cityPhoneName);
      }
    }
    const menu = cityList.map((c, i) => say(`ל${cityTts.get(c) || c} הקש ${i + 1}`));
    return yemotResponse(
      read(messages(prompt("choose_city", "בחר עיר"), ...menu), {
        name: "CITY",
          // §175: מספר הספרות לפי מספר האפשרויות בפועל.
          //
          // 🐛 max=2 קבוע גרם לכך שהלקוח הקיש ספרה אחת והמערכת
          // המתינה לשנייה שלא תגיע - שתיקה שנשמעת כמו תקלה.
          //
          // ⚠️ במקש בודד timeout ארוך הוא **נכון**: המשמעות שם
          // היא "כמה זמן להמתין להקשה", ולא "לספרה נוספת" (§100).
        max: cityList.length > 9 ? 2 : 1,
        min: 1,
          // §100: המתנה קצרה בין ספרות. שדה דו-ספרתי עם timeout
          // ארוך "נתקע" אחרי ההקשה הראשונה עד סולמית או פקיעה.
          timeout: 3,
        allowed: cityList.map((_, i) => String(i + 1)).join("."),
      })
    );
  }

  const cityIdx = parseInt(p.CITY, 10) - 1;
  const city = cityList[cityIdx];
  if (!city) {
    return errorAndReturn(prompt("invalid_choice", "בחירה לא חוקית, חוזרים לתפריט"));
  }

  // שלב 2: נקודה בעיר. אם יש רק אחת - נבחרת אוטומטית.
  const points = await prisma.deliveryPoint.findMany({
    where: { // §163: נקודה סמויה אינה מוצעת ללקוח בטלפון
      isPrivate: false,
      isActive: true, city },
    select: { id: true, name: true, phoneName: true },
    orderBy: { name: "asc" },
  });

  let pointId: string | null = null;
  if (points.length === 1) {
    pointId = points[0].id;
  } else if (!p.POINT) {
    // §69: כתיב פונטי לשם הנקודה, אם הוגדר
    const menu = points.map((pt, i) => say(`ל${pt.phoneName || pt.name} הקש ${i + 1}`));
    // §84: מקריאים מה נבחר לפני התפריט הבא.
    // 🐛 הלקוח הקיש "2" ולא שמע דבר - הוא לא ידע אם בחר ברמות או
    // בביתר, והמשיך הלאה בלי ודאות. הקראת הבחירה היא התיקון
    // הפשוט ביותר, ובלי להוסיף שלב אישור שמאריך את השיחה.
    const cityTtsName =
      cities.find((c) => c.city === city)?.cityPhoneName || city;
    return yemotResponse(
      read(
        messages(
          prompt("chosen_pre", "בחרת"),
          say(cityTtsName),
          prompt("choose_point", "בחר נקודת חלוקה"),
          ...menu
        ),
        {
        name: "POINT",
          // §175: מספר הספרות לפי מספר האפשרויות בפועל.
          //
          // 🐛 max=2 קבוע גרם לכך שהלקוח הקיש ספרה אחת והמערכת
          // המתינה לשנייה שלא תגיע - שתיקה שנשמעת כמו תקלה.
          //
          // ⚠️ במקש בודד timeout ארוך הוא **נכון**: המשמעות שם
          // היא "כמה זמן להמתין להקשה", ולא "לספרה נוספת" (§100).
        max: points.length > 9 ? 2 : 1,
        min: 1,
          // §100: המתנה קצרה בין ספרות. שדה דו-ספרתי עם timeout
          // ארוך "נתקע" אחרי ההקשה הראשונה עד סולמית או פקיעה.
          timeout: 3,
        allowed: points.map((_, i) => String(i + 1)).join("."),
      })
    );
  } else {
    pointId = points[parseInt(p.POINT, 10) - 1]?.id ?? null;
  }

  if (!pointId) {
    return errorAndReturn(prompt("invalid_choice", "בחירה לא חוקית, חוזרים לתפריט"));
  }

  // ═══ §84: שלב 3 - הקלטת השם, עם אישור ═══
  //
  // 🐛 באג קריטי שתוקן: §75 החזיר **שתי** פקודות read בתשובה אחת,
  // משורשרות ב-messages() שמחבר בנקודה. בפרוטוקול של ימות פקודות
  // מופרדות ב-& ולא בנקודה, והפקודה השנייה (מונה הניסיונות) ביקשה
  // הקשה לתוך NAMETRY. התוצאה: הלקוח הקליט את שמו וקיבל
  // "לא הוקשה בחירה" בלולאה - ההרשמה הטלפונית הייתה מושבתת לגמרי.
  //
  // ⚠️ הלקח: תשובה לימות מכילה **פקודה אחת**. שרשור פקודות אינו
  // נתמך, ו-messages() נועד לשרשר *הודעות* בתוך פקודה - לא פקודות.
  //
  // מגן הלולאה נשאר, בלי מונה נפרד: ימות שולחים את הפרמטר ברגע
  // שנקלט, ולכן אפשר להבחין בין שני מצבים בלי לשאול כלום -
  //   NAME לא קיים בכלל  = טרם שאלנו
  //   NAME קיים אך ריק    = שאלנו ולא נקלט דבר
  // המצב השני ממשיך עם שם זמני במקום לשאול שוב.
  const nameAsked = p.NAME !== undefined;
  // §108: cleanSpokenName ולא cleanName.
  //
  // 🐛 הבאג שנסגר: זיהוי הדיבור של ימות מחזיר את **ההודעות של
  // עצמו** יחד עם דיבור הלקוח. לקוח שאמר "יהודה", הזיהוי נכשל,
  // ימות השמיעו "לא זוהה הדיבור, נתחיל מחדש", והוא אמר שוב -
  // וה-NAME שחזר אלינו היה "נתחיל מחדש יהודה".
  //
  // שני לקוחות אמיתיים נשמרו כך במסד, והמייל לנציג יצא עם השם
  // המשובש. cleanName לבדה לא תפסה את זה - היא מנקה תווים
  // נסתרים, לא טקסט של המערכת.
  // §215: במצב Gemini הערך הוא נתיב הקלטה ולא טקסט - resolveSpoken
  // מטפל בשניהם.
  // §217: התמלול עשוי להיכשל - הסימון עובר הלאה ומסונן בהמשך.
  const rawNameRes = await resolveSpoken(p.NAME, "first");
  const nameFailed = isSttFailed(rawNameRes);
  const rawName = nameFailed ? "" : cleanSpokenName(rawNameRes);
  // ⚠️ "ענה" = יש ערך **או** שהתמלול נכשל. שניהם אומרים שהלקוח
  // כבר הקליט, ואין לשאול אותו שוב.
  const nameAnswered = !!rawName || nameFailed;

  if (!nameAsked) {
    // §84: מקריאים את הנקודה שנבחרה לפני שממשיכים. זה הרגע האחרון
    // שבו הלקוח יכול לזהות טעות בבחירה, לפני שהחשבון נוצר.
    const chosenPoint = await prisma.deliveryPoint.findUnique({
      where: { id: pointId },
      select: { name: true, phoneName: true, city: true, cityPhoneName: true },
    });
    const ptLabel = chosenPoint
      ? `${chosenPoint.phoneName || chosenPoint.name}${
          chosenPoint.city ? ` ב${chosenPoint.cityPhoneName || chosenPoint.city}` : ""
        }`
      : "";

    return yemotResponse(
      askSpoken(
        messages(
          ptLabel ? prompt("chosen_pre", "בחרת") : "",
          ptLabel ? say(ptLabel) : "",
          // §173: שם פרטי בלבד.
          //
          // 🐛 מה שגרם לבעיה: "אמור את שמך המלא" - וחלק אמרו
          // "ברכה" בלבד. בחלוקה אי אפשר היה לדעת אם זה שם פרטי
          // או משפחה.
          prompt(
            "ask_first_name",
            "אנא אמור את שמך הפרטי לאחר הצליל, ולסיום הקש סולמית"
          )
        ),
        "NAME"
      )
    );
  }

  // נקלט ריק - ממשיכים עם שם זמני. עדיף חשבון שהנציג יתקן את שמו
  // מאשר שיחה שנתקעת והלקוח לא נרשם בכלל.
  // §108: שם לא סביר (ריק, קצר מדי, ארוך בחריגות) נדחה לטובת שם
  // זמני. עדיף שהנציג יתקן "לקוח טלפוני" מאשר שיישמר שם שגוי
  // שנראה אמיתי ואיש לא יבדוק אותו.
  const finalName = isPlausibleName(rawName) ? rawName : "לקוח טלפוני";

  // אישור השם - בשליטתנו ולא של ימות. מוצג רק כשבאמת נקלט שם;
  // אין טעם לבקש אישור על "לקוח טלפוני".
  // §216: 🔄 **שאלה נפרדת, אישור אחד.**
  //
  // 🐛 מה שהיה: שני סבבי אישור מלאים.
  //    "השם הפרטי שנקלט: משה. לאישור 1"  →  הלקוח מקיש
  //    "שם המשפחה שנקלט: ניימן. לאישור 1" →  הלקוח מקיש שוב
  //
  // ארבעה שלבים לשם אחד. הלקוח שרק רצה להזמין עוף שמע ארבע
  // הודעות ולחץ פעמיים, וחלק ניתקו באמצע.
  //
  // עכשיו: שתי השאלות נשארות (זה מה שנותן את הפיצול), אבל
  // האישור מוקרא **פעם אחת על שניהם**:
  //    "השם שנקלט: משה ניימן. לאישור 1, לשינוי 2"
  //
  // ⚠️ השאלות נשארו נפרדות בכוונה: איחוד שלהן היה מחזיר את
  // הבעיה של §173 - לקוח שאומר "ברכה" ואין לדעת אם זה פרטי
  // או משפחה.
  //
  // ⚠️ "שינוי" מחזיר לשתי השאלות מההתחלה ולא רק לאחת. זה
  // פחות מדויק, אבל בורר "מה לתקן" היה מוסיף שלב שלישי -
  // בדיוק מה שבאנו לחסוך. בפועל מי שמתקן בדרך כלל אמר את
  // שניהם לא נכון.

  // ─── §173 שלב 3ב: שם משפחה ───
  //
  // ⚠️ שאלה **נפרדת** ולא "אמור שם מלא". זו כל מטרת §173:
  // כשמבקשים את שני החלקים בנפרד, מקבלים אותם בנפרד.
  //
  // §215: resolveSpoken מטפל גם בהקלטה וגם בטקסט
  const rawLastRes = await resolveSpoken(p.LNAME, "last");
  const lastFailed = isSttFailed(rawLastRes);
  const rawLast = lastFailed ? "" : String(rawLastRes).trim();
  const lastAnswered = !!rawLast || lastFailed;

  // ⚠️ שואלים שם משפחה **מיד** אחרי הפרטי, בלי אישור ביניים.
  // §217: 🐛 היה `!rawLast` - וכשהתמלול נכשל rawLast היה ריק,
  // אז השאלה חזרה שוב ושוב. עכשיו lastAnswered סוגר את הלולאה.
  if (nameAnswered && finalName !== "לקוח טלפוני" && !lastAnswered) {
    return yemotResponse(
      askSpoken(
        prompt(
          "ask_last_name",
          "אנא אמור את שם המשפחה שלך לאחר הצליל, ולסיום הקש סולמית"
        ),
        "LNAME"
      )
    );
  }

  // ─── §216: אישור אחד על שני החלקים ───
  const bothParts = [rawName, rawLast].filter(Boolean).join(" ").trim();

  // §217: 🐛 **אישור כפול.**
  //
  // מה שקרה בשטח: ימות במצב `record` **כבר משמיעים** ללקוח את
  // ההקלטה שלו ושואלים "לאישור הקש 1". הלקוח שמע את עצמו, אישר,
  // ואז המערכת שאלה אותו שוב - הפעם על התמלול.
  //
  // ⚠️ במצב Gemini מדלגים על האישור שלנו: ימות כבר עשו אותו,
  // והלקוח אישר את מה **שהוא אמר** - וזה מה שחשוב. תמלול שגוי
  // ייתפס אצל המנהל במסך הבקשות, בדיוק כמו היום.
  //
  // ⚠️ במצב ימות (voice) האישור שלנו **נשאר**: שם אין השמעה
  // חוזרת, והלקוח לא שמע כלום.
  const needsOwnConfirm = !useGeminiStt();

  if (needsOwnConfirm && bothParts && p.NAMEOK !== "1") {
    if (p.NAMEOK === "2") {
      // ⚠️ מנקים **את שניהם**: אם נשאיר את LNAME, השאלה השנייה
      // תדולג והלקוח יתקן רק חצי.
      //
      // ⚠️ המחיקה נעשית ע"י בקשה חוזרת של NAME בלבד - ימות
      // דורסים את הערך, ו-LNAME נמחק בשורה הבאה בזרימה.
      return yemotResponse(
        messages(
          clearVar("LNAME"),
          askSpoken(
            prompt(
              "ask_first_name_again",
              "אנא אמור את שמך הפרטי שוב לאחר הצליל, ולסיום הקש סולמית"
            ),
            "NAME"
          )
        )
      );
    }
    return yemotResponse(
      read(
        messages(
          // ⚠️ "השם שנקלט" ולא "השם הפרטי" - כאן מקריאים את שניהם
          prompt("name_confirm_pre", "השם שנקלט"),
          say(bothParts),
          prompt("name_confirm_ask", "לאישור הקש 1, לשינוי הקש 2")
        ),
        { name: "NAMEOK", max: 1, min: 1, allowed: "12" }
      )
    );
  }

  // §173: הרכבת השם המלא.
  //
  // ⚠️ שם משפחה לא סביר נזרק, והשם הפרטי לבדו נשמר. עדיף שם
  // חלקי נכון מאשר צירוף עם רעש שנקלט.
  const finalLast = isPlausibleName(rawLast) ? rawLast : null;

  // §218: 🐛 "לקוח טלפוני ברנשטיין".
  //
  // מה שקרה בשטח (23/08 21:43): התמלול של השם הפרטי נכשל,
  // finalName קיבל "לקוח טלפוני", ואז שם המשפחה **הצליח** -
  // והצירוף יצר שם משפט.
  //
  // ⚠️ "לקוח טלפוני" הוא **סימון**, לא שם. צירוף שלו לחלק
  // אמיתי הופך אותו לשם שנראה תקין, ואז הוא לא מופיע ברשימת
  // "חסרי פיצול" - כלומר המנהל לא יידע שצריך להשלים אותו.
  //
  // ⚠️ שם המשפחה לבדו עדיף: "ברנשטיין" הוא מידע אמיתי שהמנהל
  // יכול לעבוד איתו, ו-firstName נשאר null - מה שמסמן במפורש
  // שחסר חלק.
  const namePlaceholder = finalName === "לקוח טלפוני";
  const fullName = namePlaceholder
    ? finalLast || finalName
    : finalLast
      ? `${finalName} ${finalLast}`
      : finalName;

  // ─── §25 שלב 4: הסכמה לתנאי השימוש ───
  // באתר הלקוח מסמן צ'קבוקס ואנחנו שומרים agreedToTerms עם חותמת זמן.
  // בטלפון אי אפשר להקריא את כל התנאים - אדם ינתק. לכן: אישור קצר,
  // ומי שרוצה לשמוע תמצית מקיש 2. ההסכמה נשמרת עם termsVersion נפרד
  // שמסמן שהיא ניתנה בטלפון ולא באתר.
  if (!p.TERMS) {
    return yemotResponse(
      read(
        messages(
          prompt(
            "terms_ask",
            "בפתיחת החשבון אתה מאשר את תנאי השימוש ומדיניות הפרטיות. לאישור והמשך הקש 1. לשמיעת התנאים הקש 2"
          )
        ),
        { name: "TERMS", max: 1, min: 1, allowed: "12" }
      )
    );
  }

  if (p.TERMS === "2") {
    // הקראת התמצית ואז חזרה לאישור. מאפסים את TERMS כדי שהשאלה
    // תישאל שוב - ימות שולחים את כל הפרמטרים שנאספו, אז בלי איפוס
    // הוא היה נתקע בלולאה.
    return yemotResponse(
      read(
        messages(
          prompt(
            "terms_full",
            "תנאי השימוש: ההזמנה מחייבת אימות כרטיס אשראי. המחיר המוצג הוא משוער בלבד, והמחיר הסופי נקבע לאחר שקילה בפועל. הכרטיס השמור יחויב אוטומטית בסכום הסופי. ניתן לבטל או לשנות הזמנה עד למועד סגירת המכירה. התנאים המלאים מפורטים באתר"
          ),
          prompt("terms_confirm", "לאישור התנאים ופתיחת החשבון הקש 1")
        ),
        { name: "TERMS", max: 1, min: 1, allowed: "1" }
      )
    );
  }

  if (p.TERMS !== "1") {
    return yemotResponse(
      playMessage(prompt("terms_declined", "החשבון לא נפתח. תודה ולהתראות"))
    );
  }

  // יצירת הלקוח + בקשת הטיפול
  // §71: 🐛 כאן נולדו התווים הנסתרים. זיהוי הדיבור של ימות מחזיר
  // לעיתים סימני כיווניות (RLM/LRM) ורווחים לא-שבירים בתוך השם,
  // ו-.trim() לא נוגע בהם. התוצאה: `LIKE '%בושקפן%'` החזיר אפס
  // שורות על לקוח שקיים - הנציג לא מצא אותו, יצר מחדש, וכפילות.
  // §84: finalName כבר נוקה ואושר בשלב 3 למעלה
  // §173: name הוא כעת השם המלא - פרטי + משפחה.
  const name = fullName;

  // הגנה מפני יצירה כפולה אם ימות שולחים את אותה בקשה פעמיים
  const already = await prisma.customer.findUnique({ where: { phone } });
  if (already) {
    return yemotResponse(
      playMessage(prompt("account_exists", "החשבון כבר קיים במערכת, נציג יחזור אליך"))
    );
  }

  // §225: הסיסמה נשמרת במשתנה כדי שנוכל לשמור גם את הגרסה
  // הגלויה. קודם היא נוצרה inline ונעלמה מיד.
  const tempPassword = generateStrongPassword();
  const passwordHash = await bcrypt.hash(tempPassword, 10);

  const created = await prisma.customer.create({
    data: {
      name,
      // §173: הפיצול נשמר בנפרד. finalLast עשוי להיות null אם
      // שם המשפחה לא נקלט - ואז יש רק שם פרטי, וזה עדיין טוב
      // בהרבה מ"ברכה" בלי שנדע מה זה.
      firstName: finalName !== "לקוח טלפוני" ? finalName : null,
      lastName: finalLast,
      phone,
      passwordHash,
      // §225: 🐛 הסיסמה **חייבת** להישמר גלויה.
      //
      // ⚠️ קריטי דווקא כאן: לקוח שנרשם בטלפון לא בחר סיסמה ולא
      // יודע אחת. בלי השמירה אין לו שום דרך להיכנס לאתר, והמנהל
      // לא יכול לעזור - בדיוק מה שקרה עם נציג ירושלים.
      passwordPlain: tempPassword,
      role: "CUSTOMER",
      isActivated: false,
      defaultPointId: pointId,
      hasSeenOrderIntro: true,
      // אין הסכמה מפורשת למיילים בטלפון - נאספת כשהנציג משלים את הרישום
      agreedToEmails: false,
      // §25: הסכמה לתנאי השימוש ניתנה בשיחה (הקשה 1 אחרי ההקראה).
      // termsVersion נפרד מזה של האתר, כדי שיהיה ברור בתיעוד שההסכמה
      // ניתנה קולית ולא בטופס.
      agreedToTerms: true,
      agreedToTermsAt: new Date(),
      termsVersion: "phone-2026-08",
    },
    select: { id: true },
  });

  // §76: **אין יצירת קוד כאן.**
  //
  // 🐛 מה שתוקן: §64 ייצר קוד בסיום ההרשמה והקריא אותו. זה יצר שני
  // מסלולי הפקה - אחד ב-IVR ואחד בכרטיס הלקוח - ולכן היה אפשרי
  // מצב שהלקוח מחזיק קוד שהמנהל לא יודע עליו, או שקוד חדש שהמנהל
  // הפיק דרס בשקט את זה שהלקוח רשם לעצמו בשיחה.
  //
  // מקור אמת אחד: הקוד מופק בכרטיס הלקוח אצל המנהל, בלבד. וזה גם
  // העיתוי הנכון - לקוח שטרם אושר אינו יכול להזמין, וקוד בשלב הזה
  // רק היה מכניס אותו לאתר כדי לגלות שהכל חסום.
  //
  // הפער שבגללו §64 נבנה (לקוח בלי מייל שנתקע) נפתר טוב יותר:
  //   • הוא יכול להשלים הרשמה באתר בעצמו - החשבון ריק ולכן פתוח
  //   • ואחרי שהנציג יקים אותו, אפשרות 4 בתפריט תקריא לו את הקוד

  const signupRequest = await prisma.phoneSignupRequest.create({
    data: {
      customerId: created.id,
      phone,
      customerName: name,
      pointId,
      callId: callId || null,
      status: "NEW",
    },
    select: { id: true },
  });

  // §79: התראה לנציגי הנקודה ולמנהל.
  //
  // 🐛 הפער שנסגר: הבקשה נוצרה ואז שום דבר לא קרה - היא ישבה במסך
  // "בקשות מהטלפון" וחיכתה שמישהו יפתח אותו במקרה. לקוח שהתקשר
  // בערב יכול היה להמתין יום שלם, חסום מלהזמין ומלהיכנס לאתר.
  //
  // waitUntil ולא await: ימות ממתינים לתשובה שלנו לפני שהם משמיעים
  // את ההודעה הבאה, ושליחת מייל דרך Resend מוסיפה מאות מילישניות
  // של שקט באוזן הלקוח. waitUntil מבטיח ש-Vercel *כן* יסיים את
  // המשימה אחרי שהתשובה נשלחה - בשונה מ-fire-and-forget שנקטע
  // ברגע שהפונקציה מחזירה (הבאג של §17 בברודקסט).
  waitUntil(
    sendPhoneSignupNotification({
      customerName: name,
      phone,
      pointId,
      requestId: signupRequest.id,
    })
      .then((r) => {
        if (!r.ok) console.error("[phone-ivr] signup notification failed:", r.error);
      })
      .catch((e) => console.error("[phone-ivr] signup notification error:", e))
  );

  // §76: מפנים לאתר להשלמת הפרטים. הלקוח יכול להירשם שם עם אותו
  // מספר טלפון והטופס ישלים את החשבון הקיים - ראה register/route.
  return yemotResponse(
    playMessage(
      prompt(
        "signup_done",
        "החשבון נפתח בהצלחה. ניתן להשלים את הפרטים באתר בכתובת צדקת רבותינו נקודה קום, או להמתין לנציג שיחזור אליך בהקדם. תודה ולהתראות"
      )
    )
  );
}

// ─────────────────────────────────────────────────────────────
// §27: עריכת הזמנה קיימת בטלפון
// ─────────────────────────────────────────────────────────────
// הלקוח עובר על הפריטים אחד-אחד ובוחר מה לעשות עם כל אחד.
//
// למה זה בטוח: כל פעולה משנה פריט *אחד* ומיד מחשבת מחדש את הסכום,
// כך שאין מצב ביניים לא עקבי. אין כאן "עגלה זמנית" - כל שינוי נשמר
// מיד, בדיוק כמו עריכה באתר.
//
// הניווט: ITEM = אינדקס הפריט הנוכחי, ACT = הפעולה עליו. שניהם
// נושאים סיומת מספרית כדי שפרמטרים של פריט קודם לא ייקראו שוב.
async function handleEditOrder(
  p: Record<string, string>,
  order: { id: string; orderNumber: number; status: string; pointId: string },
  customer: any
): Promise<Response> {
  // הזמנה ששולמה - שינוי דורש התחשבנות מחדש, ולכן מפנים לנציג עם
  // המספר שלו. אותו נוסח כמו בביטול הזמנה ששולמה - זה אותו מצב.
  if (order.status === "PAID" || order.status === "COMPLETED") {
    const phoneParts = await agentPhoneParts(order.pointId);
    return yemotResponse(
      playMessage(
        prompt("paid_contact_agent", "הזמנה ששולמה ניתן לשנות רק דרך הנציג"),
        ...(phoneParts.length > 0
          ? phoneParts
          : [prompt("no_agent_call_office", "לא נמצא נציג משויך, אנא פנה למוקד")])
      )
    );
  }

  // §28: מועד אחרון לעריכה - אותה מגבלה שקיימת באתר. בלי הבדיקה הזו
  // לקוח היה יכול לשנות הזמנה אחרי שהמנהל כבר הזמין מהספק לפי הכמויות.
  const plDead = await prisma.order.findUnique({
    where: { id: order.id },
    select: { pricelist: { select: { editDeadline: true, closeDate: true } } },
  });
  const deadline =
    plDead?.pricelist?.editDeadline ?? plDead?.pricelist?.closeDate ?? null;
  if (deadline && new Date() > deadline) {
    return yemotResponse(
      playMessage(
        prompt("edit_deadline_passed", "המועד לשינוי ההזמנה חלף. לשינוי יש לפנות לנציג"),
        ...(await agentPhoneParts(order.pointId))
      )
    );
  }

  const items = await prisma.orderItem.findMany({
    where: { orderId: order.id, isCancelled: false },
    orderBy: { id: "asc" },
    select: {
      id: true,
      productName: true,
      quantity: true,
      unitPrice: true,
      isSingle: true,
      unit: true,
    },
  });

  if (items.length === 0) {
    // כל הפריטים נמחקו - ההזמנה מתבטלת, בדיוק כמו באתר
    await prisma.order.update({
      where: { id: order.id },
      data: {
        status: "CANCELLED",
        internalNotes: `בוטלה אוטומטית - כל הפריטים נמחקו בשיחה ${new Date().toLocaleString("he-IL")}`,
      },
    });
    return yemotResponse(
      playMessage(
        prompt("edit_all_removed", "כל הפריטים נמחקו וההזמנה בוטלה"),
        prompt("cancel_reorder", "ניתן להזמין מחדש בכל עת עד לסגירת המכירה")
      )
    );
  }

  const idx = parseInt(p.ITEM || "0", 10);

  // סיימנו לעבור על כל הפריטים
  if (idx >= items.length) {
    const total = await recalcOrderTotal(order.id);
    return yemotResponse(
      playMessage(
        prompt("edit_done", "השינויים נשמרו"),
        prompt("summary_estimated", "סכום משוער"),
        sayNumber(Math.round(total)),
        prompt("shekels", "שקלים")
      )
    );
  }

  const it = items[idx];
  const kAct = `ACT${idx}`;
  const kQtyNew = `NEWQ${idx}`;

  // הקראת הפריט ושאלה מה לעשות
  if (!p[kAct]) {
    return yemotResponse(
      read(
        messages(
          say(
            it.isSingle
              ? `${Number(it.quantity)} ${it.unit} של ${it.productName}`
              : Number(it.quantity) === 1
                ? `קרטון אחד של ${it.productName}`
                : `${Number(it.quantity)} קרטונים של ${it.productName}`
          ),
          prompt(
            "edit_item_menu",
            "להשארת הפריט כמו שהוא הקש 1. לשינוי הכמות הקש 2. למחיקת הפריט הקש 3"
          )
        ),
        { name: kAct, max: 1, min: 1, allowed: "123" }
      )
    );
  }

  // 1 = השאר כמו שהוא, ממשיכים לפריט הבא
  // המשך לפריט הבא: קריאה רקורסיבית עם ITEM מעודכן, במקום פקודת
  // ניווט. פשוט יותר ולא תלוי בתחביר של ימות.
  if (p[kAct] === "1") {
    return handleEditOrder({ ...p, ITEM: String(idx + 1) }, order, customer);
  }

  // 3 = מחיקה
  if (p[kAct] === "3") {
    await prisma.orderItem.delete({ where: { id: it.id } });
    await recalcOrderTotal(order.id);
    // אחרי מחיקה האינדקס *לא* מתקדם: הפריט הבא תופס את מקומו ברשימה,
    // ואם נתקדם נדלג עליו. מאפסים גם את ACT כדי שהשאלה תישאל מחדש.
    const cleaned = { ...p };
    delete cleaned[kAct];
    return handleEditOrder(cleaned, order, customer);
  }

  // 2 = שינוי כמות
  if (!p[kQtyNew]) {
    return yemotResponse(
      read(
        prompt(
          it.isSingle ? "ask_qty_kg" : "ask_qty_carton",
          it.isSingle ? "כמה קילוגרם תרצה" : "כמה קרטונים תרצה"
        ),
        { name: kQtyNew, max: 2, min: 1, timeout: 3, playback: "Number" }
      )
    );
  }

  const newQty = parseInt(p[kQtyNew], 10);
  if (!newQty || newQty <= 0) {
    // כמות 0 = מחיקה, זהה להתנהגות באתר
    await prisma.orderItem.delete({ where: { id: it.id } });
  } else {
    await prisma.orderItem.update({
      where: { id: it.id },
      data: {
        quantity: newQty,
        estimatedPrice: Math.round(Number(it.unitPrice) * newQty * 100) / 100,
      },
    });
  }
  await recalcOrderTotal(order.id);

  // אם הכמות אופסה הפריט נמחק - אותו טיפול כמו במחיקה ידנית
  if (!newQty || newQty <= 0) {
    const cleaned = { ...p };
    delete cleaned[kAct];
    delete cleaned[kQtyNew];
    return handleEditOrder(cleaned, order, customer);
  }
  return handleEditOrder({ ...p, ITEM: String(idx + 1) }, order, customer);
}

/**
 * חישוב מחדש של סכום ההזמנה אחרי שינוי פריטים.
 * חייב לרוץ אחרי *כל* שינוי, אחרת ההזמנה תישאר עם סכום ישן והלקוח
 * יחויב בסכום שגוי.
 */
async function recalcOrderTotal(orderId: string): Promise<number> {
  const rows = await prisma.orderItem.findMany({
    where: { orderId, isCancelled: false },
    select: { estimatedPrice: true },
  });
  const ord = await prisma.order.findUnique({
    where: { id: orderId },
    select: { pricelist: { select: { orderFee: true } } },
  });
  const fee = Number(ord?.pricelist?.orderFee || 0);
  const total =
    Math.round((rows.reduce((s, r) => s + Number(r.estimatedPrice ?? 0), 0) + fee) * 100) / 100;
  await prisma.order.update({
    where: { id: orderId },
    data: { estimatedTotal: total },
  });
  return total;
}

/**
 * §31: הודעות עם מספר הטלפון של הנציג המשויך לנקודה.
 *
 * כל מקום שאומר "פנה לנציג" חייב להשמיע גם את המספר - ללקוח טלפוני
 * אין דרך אחרת למצוא אותו. הפונקציה משותפת כדי שלא יהיה מקום אחד
 * שמפנה לנציג בלי מספר.
 *
 * המספר מוקרא ספרה-ספרה: sayNumber היה אומר "חמישים מיליון..." וזה
 * בלתי אפשרי לרישום.
 */
async function agentPhoneParts(pointId: string): Promise<string[]> {
  const links = await prisma.agentPoint.findMany({
    where: { pointId },
    select: { agent: { select: { name: true, phone: true } } },
    take: 2,
  });
  let agents = links.map((l) => l.agent).filter((a) => a?.phone);

  if (agents.length === 0) {
    const legacy = await prisma.customer.findMany({
      where: { role: "AGENT", agentPointId: pointId },
      select: { name: true, phone: true },
      take: 2,
    });
    agents = legacy.filter((a) => a.phone);
  }
  if (agents.length === 0) return [];

  const out: string[] = [];
  for (const a of agents) {
    if (a.name) out.push(say(`הנציג ${a.name}`));
    out.push(prompt("agent_phone_is", "מספר הטלפון"));
    out.push(sayDigits(String(a.phone).replace(/\D/g, "")));
  }
  return out;
}

// ─────────────────────────────────────────────────────────────
// §26: ביטול הזמנה
// ─────────────────────────────────────────────────────────────
// ביטול בטוח לביצוע בטלפון: הוא לא יוצר חיוב והוא הפיך - הלקוח יכול
// להזמין מחדש מיד. לכן מאפשרים אותו, בניגוד לעריכה.
// דורש אישור כפול כדי שהקשה מקרית לא תמחק הזמנה.
async function handleCancelOrder(
  p: Record<string, string>,
  order: { id: string; orderNumber: number; status: string; pointId: string },
  customer: any
): Promise<Response> {
  // הזמנה ששולמה כבר - לא מבטלים בטלפון, צריך החזר כספי
  if (order.status === "PAID" || order.status === "COMPLETED") {
    // §31: כל "פנה לנציג" חייב לכלול את המספר בפועל, אחרת זו הנחיה
    // ריקה - במיוחד ללקוח טלפוני שאין לו דרך אחרת למצוא אותו.
    const parts: string[] = [
      prompt("cancel_paid", "לא ניתן לבטל בטלפון הזמנה ששולמה"),
      prompt("paid_contact_agent", "הזמנה ששולמה ניתן לשנות רק דרך הנציג"),
    ];
    const ph = await agentPhoneParts(order.pointId);
    parts.push(
      ...(ph.length > 0
        ? ph
        : [prompt("no_agent_call_office", "לא נמצא נציג משויך, אנא פנה למוקד")])
    );
    return yemotResponse(playMessage(...parts));
  }

  if (!p.CANCEL) {
    return yemotResponse(
      read(
        messages(
          prompt(
            "cancel_confirm",
            "האם אתה בטוח שברצונך לבטל את ההזמנה? לאישור הביטול הקש 1. לחזרה הקש 2"
          )
        ),
        { name: "CANCEL", max: 1, min: 1, allowed: "12" }
      )
    );
  }

  if (p.CANCEL !== "1") {
    return yemotResponse(
      playMessage(prompt("cancel_aborted", "ההזמנה לא בוטלה. תודה"))
    );
  }

  await prisma.order.update({
    where: { id: order.id },
    data: {
      status: "CANCELLED",
      internalNotes: `בוטלה ע"י הלקוח במערכת הטלפונית ${new Date().toLocaleString("he-IL")}`,
    },
  });

  return yemotResponse(
    playMessage(
      prompt("cancel_done", "ההזמנה בוטלה בהצלחה"),
      prompt("cancel_reorder", "ניתן להזמין מחדש בכל עת עד לסגירת המכירה")
    )
  );
}

// ─────────────────────────────────────────────────────────────
// ההזמנות שלי
// ─────────────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════
// §76: שמיעת קוד הכניסה לאתר
// ═══════════════════════════════════════════════════════════════
// לקוח שנרשם והזמין בטלפון ורוצה עכשיו להיכנס לאתר - אין לו מייל,
// ולכן "שכחתי סיסמה" לא רלוונטי לו. כאן הוא שומע את הקוד שלו.
//
// מי שאין לו קוד עדיין (נרשם לפני §64) מקבל אחד עכשיו: זו בקשה
// מפורשת מהלקוח, מהטלפון הרשום שלו, ולכן אין כאן חשיפה - ממילא
// המספר הוא שם המשתמש והשיחה מגיעה ממנו.
async function handleLoginCode(customer: {
  id: string;
  name: string;
  // Customer.phone הוא String? בסכמה - לא לצמצם אותו כאן
  phone?: string | null;
  loginCode?: string | null;
  paymentToken?: string | null;
  paymentPreference?: string | null;
}): Promise<Response> {
  // §76: הקוד נמסר **רק** ללקוח שהוקם במלואו ע"י נציג או מנהל.
  //
  // מה מסמן "הוקם": שנקבע לו אופן תשלום - כרטיס אשראי שמור, או
  // סימון כלקוח מזומן. זה בדיוק מה שהמנהל רואה בכרטיס הלקוח, וזה
  // גם התנאי ש-§61 בודק לפני שהוא מאפשר להזמין.
  //
  // ⚠️ למה **לא** isActivated: הוא נקבע false גם ב-IVR וגם ביצירת
  // לקוח ע"י נציג, ומשמעותו "טרם קבע סיסמה בעצמו" - לא "אושר".
  // שימוש בו כאן היה מוסר קוד גם למי שממתין לטיפול.
  //
  // למה זה חשוב: לקוח שטרם אושר אינו יכול להזמין ממילא, וקוד
  // שיאפשר לו להיכנס רק ייצור תסכול - הוא ייכנס ויגלה שהכל חסום.
  const isSetUp =
    !!customer.paymentToken || customer.paymentPreference === "CASH";

  if (!isSetUp) {
    return yemotResponse(
      playMessage(
        prompt(
          "code_not_ready",
          "החשבון שלך עדיין בהקמה. נציג יחזור אליך בהקדם להשלמת הפרטים, ולאחר מכן תוכל לקבל קוד כניסה לאתר. תודה ולהתראות"
        )
      )
    );
  }

  // §76: **מקריאים בלבד - לעולם לא מייצרים כאן.**
  //
  // 🐛 מה שתוקן: הגרסה הקודמת ייצרה קוד חדש אם לא היה. התוצאה
  // הייתה שני מקורות אמת - הלקוח שומע בטלפון קוד שהמנהל לא יודע
  // עליו, והמנהל רואה בכרטיס משהו אחר (או כלום). בשיחת "שכחתי
  // קוד" השניים לא היו נפגשים.
  //
  // מקור אמת אחד: הקוד נוצר בכרטיס הלקוח אצל המנהל, ומשם בלבד.
  // ה-IVR הוא צינור הקראה.
  // §152: מקור אחד - הקוד או הסיסמה, מה שקיים.
  //
  // 🐛 עד כה נקרא `loginCode` בלבד. לקוח שנרשם באתר ובחר סיסמה
  // שמע "לא הופק עבורך קוד" - למרות שיש לו פרטי כניסה תקינים
  // ותקפים, והוא נכנס איתם לאתר מדי פעם.
  //
  // ⚠️ הקוד קודם: הוא הופק ע"י המערכת ולכן ודאי תקין. הסיסמה
  // היא הנפילה.
  const cred = resolveCredential({
    loginCode: decryptCode(customer.loginCode ?? null),
    passwordPlain: (customer as any).passwordPlain ?? null,
  });
  // ⚠️ סיסמה ארוכה מ-12 תווים אינה ניתנת להקראה מעשית - היא
  // תיחשב כ"אין" ותשלח את הלקוח לנציג, וזה עדיף על חצי דקה
  // של איות שהוא לא יצליח לכתוב.
  const code = cred?.canSpeak ? cred.value : null;

  if (!code) {
    // אין קוד, או שהפענוח נכשל (AUTH_CODE_KEY הוחלף). בשני
    // המקרים התשובה זהה: המנהל צריך להפיק, לא אנחנו.
    return yemotResponse(
      playMessage(
        prompt(
          "code_missing",
          "עדיין לא הופק עבורך קוד כניסה לאתר. נא לפנות לנציג ויופק עבורך קוד. תודה ולהתראות"
        )
      )
    );
  }

  // §152: הקראת פרטי הכניסה - ספרות או אותיות.
  //
  // 🐛 מה שהיה: sayDigits בלבד, שמקריא ספרות. לקוח שנרשם באתר
  // ובחר סיסמה עם אותיות שמע רעש או שקט - ולא היה לו איך לגלות
  // את הסיסמה שלו בטלפון.
  //
  // ⚠️ spellForPhone מאיית אות-אות בעברית ("mfkq" -> "אם, אף,
  // קיי, קיו"). הפסיקים יוצרים הפוגה כדי שהלקוח יספיק לכתוב.
  //
  // ⚠️ ערך ספרתי עדיין מוקרא ב-sayDigits: הוא נשמע טבעי יותר
  // מרצף מילים, וזה המקרה השכיח.
  const spoken = isDigitsOnly(code) ? sayDigits(code) : say(spellForPhone(code));

  // ⚠️ פעמיים: הלקוח שומע פעם אחת וצריך לזכור.
  return yemotResponse(
    playMessage(
      prompt("login_code_pre", "פרטי הכניסה שלך לאתר, יחד עם מספר הטלפון שלך, הם"),
      spoken,
      prompt("login_code_repeat", "שוב"),
      spoken,
      prompt(
        "login_code_post",
        "היכנס לאתר עם מספר הטלפון שלך והפרטים האלה. תודה ולהתראות"
      )
    )
  );
}

// ═══════════════════════════════════════════════════════════════
// §94: מטמון המחירון הפעיל
// ═══════════════════════════════════════════════════════════════
// המחירון הפעיל נשלף **בכל הקשה** של כל מתקשר, והוא כמעט לעולם
// אינו משתנה תוך כדי שיחה. עם המסד באירלנד והפונקציה בוירג'יניה,
// כל שליפה כזו היא נסיעה של ~90-200ms שהלקוח שומע כשקט.
//
// Fluid Compute מחזיק את המופע חם בין בקשות (Start Type: Hot
// בלוגים), ולכן מטמון ברמת המודול באמת חוסך נסיעות - בקשה שנייה
// באותה שיחה כבר לא תשלוף.
//
// ⚠️ TTL קצר בכוונה: 30 שניות. פתיחה או סגירה של מכירה תיכנס
// לתוקף כמעט מיד, והסיכון הוא לכל היותר חצי דקה שבה מתקשר יראה
// מצב ישן - מול חיסכון של נסיעה בכל הקשה.
let saleCache: { at: number; value: ActiveSale | null } | null = null;
const SALE_CACHE_MS = 30_000;

async function getActiveSale(): Promise<ActiveSale | null> {
  if (saleCache && Date.now() - saleCache.at < SALE_CACHE_MS) {
    return saleCache.value;
  }
  const value = await prisma.pricelist.findFirst({
    // §111: מכירה לנציגים בלבד אינה קיימת מבחינת הלקוח בטלפון.
    // הוא לא ישמע אותה, לא יוכל להזמין בה, ולא יידע שהיא קיימת.
    where: { status: "ACTIVE", agentOnly: false },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      name: true,
      closeDate: true,
      openDate: true,
      singleSurcharge: true,
      orderFee: true,
      deliveryDateText: true,
      deliveryDate: true,
      editDeadline: true,
    },
  });
  saleCache = { at: Date.now(), value: value as ActiveSale | null };
  return saleCache.value;
}

// ═══════════════════════════════════════════════════════════════
// §100: הקראת מועד החלוקה
// ═══════════════════════════════════════════════════════════════
// 🐛 מה שהיה: deliveryDateText הוא טקסט חופשי שהמנהל מזין, והוא
// הוקרא כמות שהוא. sanitizeTts מסירה נקודות ומקפים (הם מפרידי
// פרוטוקול), ולכן "18.8.2026" הפך ל-"18 8 2026" - רצף מספרים
// שנשמע מחובר ולא כתאריך.
//
// עכשיו: התאריך נבנה מהשדה deliveryDate האמיתי - יום, שם החודש
// בעברית, ובנוסף התאריך העברי. הלקוח שומע "יום רביעי, כ"ד באלול,
// שנים עשר בספטמבר" - שני הלוחות, כמו שמקובל בקהילה.
const HE_WEEKDAYS = ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"];
const HE_MONTHS = [
  "ינואר", "פברואר", "מרץ", "אפריל", "מאי", "יוני",
  "יולי", "אוגוסט", "ספטמבר", "אוקטובר", "נובמבר", "דצמבר",
];

function spokenDeliveryDate(sale: {
  deliveryDate: Date | null;
  deliveryDateText: string | null;
}): string | null {
  if (!sale.deliveryDate) {
    // אין תאריך אמיתי - נופלים לטקסט החופשי, כי עדיף משהו מכלום
    return sale.deliveryDateText || null;
  }
  const d = new Date(sale.deliveryDate);
  const parts: string[] = [];

  parts.push(`יום ${HE_WEEKDAYS[d.getDay()]}`);

  // התאריך העברי - ראשון, כי זה מה שהקהילה מתייחסת אליו
  try {
    const heb = new Intl.DateTimeFormat("he-u-ca-hebrew", {
      day: "numeric",
      month: "long",
    }).format(d);
    if (heb) parts.push(heb);
  } catch {
    // Intl בלי לוח עברי - ממשיכים בלועזי בלבד
  }

  parts.push(`${d.getDate()} ב${HE_MONTHS[d.getMonth()]}`);

  return parts.join(", ");
}

/**
 * §93: הודעת שגיאה שמחזירה לתפריט הראשי במקום לנתק.
 *
 * 🐛 הבאג: ext.ini מגדיר api_end_goto=hangup, ולכן כל id_list_message
 * שאינו מלווה ב-read **מסיים את השיחה**. שישה מסלולי שגיאה השתמשו
 * ב-playMessage, ולכן הקשה שגויה אחת ניתקה את הלקוח באמצע ההזמנה.
 *
 * הפתרון: משמיעים את השגיאה ואז go_to_folder לשורש. ימות מוחקים
 * את כל הפרמטרים שנצברו ומתחילים נקי - הלקוח חוזר לתפריט במקום
 * למצוא את עצמו מנותק.
 *
 * ⚠️ שתי הפקודות מופרדות ב-& ולא בנקודה. הנקודה היא מפריד *הודעות*
 * בתוך פקודה; שרשור פקודות בנקודה הוא בדיוק הבאג שהשבית את הקלטת
 * השם ב-§75.
 */
function errorAndReturn(message: string): Response {
  return yemotResponse(
    `${playMessage(message)}&${goToFolder(process.env.YEMOT_IVR_FOLDER || "/")}`
  );
}

/**
 * §92: שם המוצר להקראה, עם הכשרות - בלי כפילות.
 *
 * 🐛 מה שקרה: המנהל מזין שמות מוצרים שכוללים כבר את הכשרות
 * ("פרגית בדץ"), והקוד הוסיף " בכשרות בדץ" אחרי השם. התוצאה
 * בהקראה: "פרגית בדץ בכשרות בדץ" - הכשרות נשמעת פעמיים בכל מוצר.
 *
 * הבדיקה היא על השם *אחרי* ניקוי גרשיים, כי "בד״ץ" בשם ו-"בדץ"
 * בטבלת הכשרויות הם אותו דבר להקראה אבל מחרוזות שונות.
 */
function productSpokenName(prod: {
  name: string;
  phoneName?: string | null;
  kashrut?: string | null;
  kashrutRef?: { name: string } | null;
}): string {
  const base = prod.phoneName || prod.name;
  const k = prod.kashrutRef?.name || prod.kashrut || "";
  if (!k) return base;
  const norm = (t: string) => t.replace(/["'`׳״\s]/g, "");
  if (norm(base).includes(norm(k))) return base;
  return `${base} בכשרות ${k}`;
}

// §69: מה הלקוח שומע על ההזמנות שלו.
//
// 🐛 קודם: מספר + סכום + נקודה בלבד. הלקוח לא ידע אם ההזמנה שולמה,
// אם היא מוכנה לאיסוף, וכמה חויב בפועל - בדיוק השאלות שבגללן הוא
// מתקשר. עכשיו: סטטוס בעברית, מצב תשלום עם הסכום שחויב, ואפשרות
// להקיש 1 לפירוט הפריטים של ההזמנה האחרונה.
const PHONE_STATUS_LABELS: Record<string, string> = {
  PENDING_REVIEW: "התקבלה וממתינה לטיפול",
  CONFIRMED: "אושרה",
  FINAL_PRICE_SET: "המחיר הסופי נקבע",
  READY_FOR_PICKUP: "מוכנה לאיסוף",
  COMPLETED: "נמסרה",
};

async function handleMyOrders(
  p: Record<string, string>,
  customerId: string
): Promise<Response> {
  const orders = await prisma.order.findMany({
    where: { customerId, status: { notIn: ["CANCELLED"] } },
    orderBy: { createdAt: "desc" },
    take: 3,
    select: {
      id: true,
      orderNumber: true,
      status: true,
      paymentStatus: true,
      amountPaid: true,
      estimatedTotal: true,
      finalTotal: true,
      deliveredAt: true,
      pointNameSnapshot: true,
      deliveryDateSnapshot: true,
      // §201: פרטי החיוב ושם המכירה.
      //
      // הלקוח מתקשר לשאול "כמה ירד לי ועל מה" - וזו השאלה שהכי
      // מגיעה לנציג. עד היום הוא שמע פריטים וסכום, אבל לא **אם**
      // חויב, מתי, ובכמה תשלומים.
      paidAt: true,
      requestedInstallments: true,
      paymentMethod: true,
      pricelist: { select: { name: true, deliveryDateText: true } },
      // §148: רכיבים שמשנים את הסכום. בלעדיהם הלקוח שומע סכום
      // שאינו מסתדר עם הפריטים ואין לו הסבר - וזו שיחה לנציג.
      creditAmount: true,
      creditReason: true,
      appliedCreditBalance: true,
      // §263: חוב מהעבר שנגבה — להקראה בפירוט
      appliedDebt: true,
      // §263: ההערה על החוב — להקראה
      customer: { select: { debtNote: true } },
      deliveryFee: true,
      deliveryRequested: true,
      extraCharge: true,
      extraChargeReason: true,
    },
  });

  if (orders.length === 0) {
    return yemotResponse(
      playMessage(prompt("no_orders", "אין לך הזמנות במערכת"))
    );
  }

  // §148: 🐛 הקשה אחרי הפירוט - חזרה לתפריט הראשי.
  //
  // בלי זה הלקוח מקיש 1, וימות שולחים את DETEND בחזרה - אבל
  // התנאי `ORDDET === "1"` עדיין מתקיים (ימות שולחים **כל**
  // הפרמטרים שנצברו, לקח §106), והפירוט מוקרא שוב ושוב.
  //
  // ⚠️ הבדיקה **לפני** ORDDET, אחרת היא לא תגיע.
  if (p.DETEND === "1") {
    // ⚠️ אותו יעד כמו שאר החזרות במערכת - משתנה סביבה ולא נתיב
    // מקודד, כדי שהעברת התפריט בימות לא תשבור את זה.
    return yemotResponse(goToFolder(process.env.YEMOT_IVR_FOLDER || "/"));
  }

  // ─── §69: פירוט פריטים של ההזמנה האחרונה, לפי דרישה ───
  if (p.ORDDET === "1") {
    const latest = orders[0];
    const its = await prisma.orderItem.findMany({
      where: { orderId: latest.id, isCancelled: false },
      select: {
        productName: true,
        quantity: true,
        isSingle: true,
        unit: true,
        finalWeight: true,
        finalPrice: true,
        estimatedPrice: true,
      },
    });
    // §201: שם המכירה בפתיחת הפירוט.
    //
    // ⚠️ ללקוח יש כמה הזמנות בשנה, והוא לא זוכר מספרי הזמנה.
    // "מכירת ראש השנה" אומר לו מיד על מה מדובר, ומונע שיחה
    // שמתחילה ב"על איזו הזמנה אתה מדבר".
    const parts: string[] = [say("פירוט הזמנה מספר"), sayNumber(latest.orderNumber)];
    if ((latest as any).pricelist?.name) {
      parts.push(say(`ממכירת ${(latest as any).pricelist.name}`));
    }
    for (const it of its) {
      const qty = Number(it.quantity);
      // §148: 🐛 "קרטונים" היה מקודד - אותו באג של §128 שלא תוקן
      // כאן. מוצר שנמכר ביחידות הוקרא ללקוח כ"3 קרטונים של כבד".
      //
      // ⚠️ sanitizeTts מסנן גרשיים, ולכן 'ק"ג' הופך ל"קג" בהקראה.
      // מחליפים ל"קילו" שנשמע נכון.
      const qtyText = formatItemQty({
        isSingle: it.isSingle,
        quantity: qty,
        unit: it.unit,
      }).replace(/ק"ג/g, "קילו");
      parts.push(say(`${qtyText} של ${it.productName}`));
      // משקל ומחיר בפועל - רק אחרי שקילה. לפני כן מקריאים הערכה.
      if (it.finalWeight != null) {
        parts.push(say(`משקל בפועל ${Number(it.finalWeight)} קילו`));
      }
      const price =
        it.finalPrice != null ? Number(it.finalPrice) : Number(it.estimatedPrice);
      parts.push(say(it.finalPrice != null ? "מחיר" : "מחיר משוער"));
      parts.push(sayNumber(Math.round(price)));
      parts.push(prompt("shekels", "שקלים"));
    }

    // §148: הסכום הכולל בסוף הפירוט.
    //
    // ⚠️ הלקוח שמע פריט-פריט ולא קיבל סיכום. מי שמתקשר לדעת כמה
    // להביא לחלוקה נאלץ לחבר בעצמו בזמן שיחה - וזו בדיוק השאלה
    // שבגללה הוא התקשר.
    const grand =
      latest.finalTotal != null
        ? Number(latest.finalTotal)
        : Number(latest.estimatedTotal);
    parts.push(
      say(latest.finalTotal != null ? "סך הכל לתשלום" : "סך הכל משוער")
    );
    parts.push(sayNumber(Math.round(grand)));
    parts.push(prompt("shekels", "שקלים"));

    // §201: מצב החיוב.
    //
    // 🐛 הלקוח שמע פריטים וסכום, ולא ידע **אם הכסף כבר ירד**.
    // זו השאלה שהכי מגיעה לנציג: "חייבתם אותי? מתי? כמה?"
    //
    // ⚠️ הסכום שנגבה בפועל ולא הסכום המשוער: אחרי שקילה הם
    // שונים, ומה שמעניין את הלקוח זה מה שירד בכרטיס.
    const paid = latest.paymentStatus === "PAID";
    const paidAmount =
      latest.amountPaid != null ? Number(latest.amountPaid) : grand;
    const inst = Number((latest as any).requestedInstallments) || 1;

    if (paid) {
      parts.push(prompt("charged_pre", "ההזמנה חויבה"));
      // ⚠️ תאריך בשעון ישראל. השרת רץ ב-UTC, ובלי אזור זמן
      // מפורש הלקוח היה שומע תאריך שגוי סביב חצות.
      if ((latest as any).paidAt) {
        const d = new Date((latest as any).paidAt);
        parts.push(
          say(
            `בתאריך ${d.toLocaleDateString("he-IL", {
              timeZone: "Asia/Jerusalem",
              day: "numeric",
              month: "numeric",
            })}`
          )
        );
      }
      parts.push(prompt("charged_amount_pre", "בסכום"));
      parts.push(sayNumber(Math.round(paidAmount)));
      parts.push(prompt("shekels", "שקלים"));
      // ⚠️ תשלומים - רק כשיש יותר מאחד. "בתשלום אחד" הוא רעש.
      if (inst > 1) {
        parts.push(say(`ב-${inst} תשלומים`));
      }
      if (latest.paymentMethod === "CASH") {
        parts.push(prompt("paid_cash", "שולם במזומן"));
      }
    } else if (latest.finalTotal != null) {
      // ⚠️ מחיר סופי נקבע אך טרם חויב - זה הרגע שבו הלקוח הכי
      // רוצה לדעת מה יקרה, ומתי.
      parts.push(
        prompt("not_charged_yet", "ההזמנה טרם חויבה. החיוב יתבצע לפני החלוקה")
      );
    } else {
      parts.push(
        prompt(
          "pending_weighing",
          "ההזמנה טרם נשקלה. הסכום הסופי ייקבע לפי המשקל בפועל"
        )
      );
    }

    // §201: תאריך החלוקה - השאלה השנייה בתדירותה.
    const delivText =
      latest.deliveryDateSnapshot ||
      (latest as any).pricelist?.deliveryDateText ||
      null;
    if (delivText) {
      parts.push(prompt("delivery_on", "החלוקה"));
      parts.push(say(String(delivText)));
    }
    if (latest.pointNameSnapshot) {
      parts.push(prompt("at_point", "בנקודה"));
      parts.push(say(String(latest.pointNameSnapshot)));
    }

    // §148: 🐛 playMessage **מנתק** את השיחה (api_end_goto=hangup).
    // הלקוח שמע את הפירוט והשיחה נפלה, בלי דרך לחזור לתפריט או
    // לשמוע שוב. אותו לקח מ-§93.
    return yemotResponse(
      read(
        messages(
          ...parts,
          prompt("detail_end", "לחזרה לתפריט הראשי הקש 1")
        ),
        { name: "DETEND", max: 1, min: 1, allowed: "1" }
      )
    );
  }

  const parts: string[] = [];
  for (const o of orders) {
    const total = o.finalTotal != null ? Number(o.finalTotal) : Number(o.estimatedTotal);
    const isFinal = o.finalTotal != null;
    parts.push(say(`הזמנה מספר`));
    parts.push(sayNumber(o.orderNumber));

    // §69: סטטוס. deliveredAt גובר על הסטטוס הרשום - הנציג מסמן
    // מסירה וזה מה שמעניין את הלקוח, גם אם הסטטוס טרם הוסב.
    const statusLabel = o.deliveredAt
      ? "נמסרה"
      : PHONE_STATUS_LABELS[o.status] ?? null;
    if (statusLabel) {
      parts.push(prompt("order_status_pre", "מצב ההזמנה"));
      parts.push(say(statusLabel));
    }

    parts.push(say(isFinal ? "סכום סופי" : "סכום משוער"));
    parts.push(sayNumber(Math.round(total)));
    parts.push(prompt("shekels", "שקלים"));

    // §69: מצב התשלום - השאלה שבגללה מתקשרים. שולם = כולל הסכום
    // שחויב בפועל (amountPaid כשקיים, אחרת הסכום הסופי).
    if (o.paymentStatus === "PAID") {
      const paid = o.amountPaid != null ? Number(o.amountPaid) : total;
      parts.push(prompt("order_charged_pre", "ההזמנה שולמה, חויבת בסך"));
      parts.push(sayNumber(Math.round(paid)));
      parts.push(prompt("shekels", "שקלים"));
    } else if (isFinal) {
      parts.push(say("ההזמנה טרם שולמה"));
    }

    // §148: הנחות ותוספות - **רק בהזמנה האחרונה**.
    //
    // ⚠️ אורך השיחה הוא שיקול אמיתי: 3 הזמנות × 4 הנחות = כמעט
    // דקה של הקראה לפני שהלקוח יכול להקיש. מי שמתקשר רוצה תשובה
    // מהירה, והזמנות ישנות כבר שולמו וסגורות.
    //
    // הסדר זהה למייל: משלוח ותוספת מוסיפים, זיכוי ויתרה מורידים.
    const isLatest = o.id === orders[0].id;

    if (isLatest && o.deliveryRequested && o.deliveryFee != null && Number(o.deliveryFee) > 0) {
      parts.push(say("כולל דמי משלוח"));
      parts.push(sayNumber(Math.round(Number(o.deliveryFee))));
      parts.push(prompt("shekels", "שקלים"));
    }
    if (isLatest && o.extraCharge != null && Number(o.extraCharge) > 0) {
      parts.push(say("כולל חיוב נוסף"));
      parts.push(sayNumber(Math.round(Number(o.extraCharge))));
      parts.push(prompt("shekels", "שקלים"));
    }
    if (isLatest && o.creditAmount != null && Number(o.creditAmount) > 0) {
      parts.push(say("בניכוי זיכוי"));
      parts.push(sayNumber(Math.round(Number(o.creditAmount))));
      parts.push(prompt("shekels", "שקלים"));
    }
    // §263: 💸 חוב מהעבר — **לפני** יתרת הזכות.
    //
    // ⚠️ הסדר: מה שמגדיל את הסכום קודם, ואז מה שמקטין. הלקוח
    // ששומע "בניכוי 30" ואז "בתוספת 120" נשאר עם רושם הפוך.
    //
    // ⚠️ ההערה מוקראת: "בתוספת חוב קודם 120 שקלים" בלי הסבר
    // גורם ללקוח להתקשר לנציג. עם ההסבר הוא מבין.
    if (isLatest && (o as any).appliedDebt != null && Number((o as any).appliedDebt) > 0) {
      parts.push(say("בתוספת חוב קודם"));
      parts.push(sayNumber(Math.round(Number((o as any).appliedDebt))));
      parts.push(prompt("shekels", "שקלים"));
      const dn = (o as any).customer?.debtNote;
      if (dn) parts.push(say(`עבור ${dn}`));
    }
    if (isLatest && o.appliedCreditBalance != null && Number(o.appliedCreditBalance) > 0) {
      parts.push(say("בניכוי יתרת זכות"));
      parts.push(sayNumber(Math.round(Number(o.appliedCreditBalance))));
      parts.push(prompt("shekels", "שקלים"));
    }

    if (o.pointNameSnapshot) parts.push(say(`בנקודה ${o.pointNameSnapshot}`));
    if (o.deliveryDateSnapshot) parts.push(say(`בתאריך ${o.deliveryDateSnapshot}`));
  }

  // §69: פירוט לפי בקשה בלבד - לא מקריאים לכל מתקשר את כל הפריטים.
  return yemotResponse(
    read(
      messages(
        ...parts,
        prompt("orders_detail_ask", "לשמיעת פירוט הפריטים של ההזמנה האחרונה הקש 1. לסיום הקש 2")
      ),
      { name: "ORDDET", max: 1, min: 1, allowed: "12" }
    )
  );
}

// ─────────────────────────────────────────────────────────────
// נקודת החלוקה שלי
// ─────────────────────────────────────────────────────────────
async function handleMyPoint(
  customer: any,
  p: Record<string, string> = {},
  // ההזמנה הפתוחה, אם יש. נדרשת כדי להעביר גם אותה לנקודה החדשה -
  // בלי זה הלקוח היה מגיע לנקודה אחת והסחורה שלו למקום אחר.
  openOrder: { id: string; pricelistId: string | null } | null = null
): Promise<Response> {
  if (!customer.defaultPoint) {
    return yemotResponse(
      playMessage(prompt("no_point_assigned", "לא הוגדרה עבורך נקודת חלוקה, נציג יחזור אליך"))
    );
  }
  const pt = customer.defaultPoint;
  const parts: string[] = [
    prompt("your_point_is", "נקודת החלוקה שלך"),
    say(pt.name),
  ];
  // §27: כתובת ושעות - עד כה הוקרא רק שם הנקודה, וזה לא מספיק ללקוח
  // שצריך להגיע לשם בפועל.
  if (pt.city) parts.push(say(`בעיר ${pt.city}`));
  if (pt.address) {
    parts.push(prompt("point_address", "הכתובת"));
    parts.push(say(pt.address));
  }
  if (pt.deliveryHours) {
    parts.push(prompt("point_hours", "שעות החלוקה"));
    parts.push(say(pt.deliveryHours));
  }
  // §34: הגבול לשינוי נקודה הוא *מועד סגירת השינויים*, לא עצם קיום
  // ההזמנה. כל עוד המכירה פתוחה, שום דבר לא נשלח לספק ולא פוצל
  // לנקודות - ולכן שינוי בטוח, ואם יש הזמנה היא עוברת איתו.
  // אחרי המועד הסחורה כבר מוקצית ורק נציג יכול לטפל.
  let canChange = true;
  if (openOrder?.pricelistId) {
    const pl = await prisma.pricelist.findUnique({
      where: { id: openOrder.pricelistId },
      select: { editDeadline: true, closeDate: true },
    });
    const dl = pl?.editDeadline ?? pl?.closeDate ?? null;
    if (dl && new Date() > dl) canChange = false;
  }

  if (!canChange) {
    parts.push(
      prompt(
        "point_change_closed",
        "המועד לשינוי ההזמנה חלף ולא ניתן לשנות את נקודת החלוקה. לשינוי יש לפנות לנציג"
      )
    );
    if (pt.id) parts.push(...(await agentPhoneParts(pt.id)));
    return yemotResponse(playMessage(...parts));
  }

  // ─── שינוי עצמאי ───
  if (!p.CHPOINT) {
    // §107: 🐛 מלכודת - "לשינוי הקש 1" ואין שום אפשרות אחרת. מי
    // שרצה רק *לשמוע* את הנקודה (השימוש הנפוץ ביותר כאן) נשאר
    // תקוע בלי מושג מה להקיש, עד שהשיחה נופלת בטיימאאוט בשקט.
    parts.push(
      prompt(
        "point_change_offer",
        "לשינוי נקודת החלוקה הקש 1, לחזרה לתפריט הראשי הקש כוכבית"
      )
    );
    return yemotResponse(
      read(messages(...parts), { name: "CHPOINT", max: 1, min: 1, allowed: "1" })
    );
  }

  // בחירת עיר
  // §69: cityPhoneName - כתיב פונטי לעיר. נלקח מהנקודה הראשונה
  // שהגדירה אותו (הערך זהה לכל נקודות אותה עיר בפועל).
  const cities = await prisma.deliveryPoint.findMany({
    // §163: עיר שיש בה **רק** נקודה סמויה לא תוצע ללקוח.
    // בלי זה הוא היה שומע את שם העיר, בוחר בה, ומגלה שאין בה
    // נקודות - מבוי סתום בשיחה.
    where: { isActive: true, isPrivate: false },
    select: { city: true, cityPhoneName: true },
    distinct: ["city"],
    orderBy: { city: "asc" },
  });
  const cityList = cities.map((c) => c.city).filter(Boolean) as string[];

  if (!p.NEWCITY) {
    if (cityList.length === 0) {
      return yemotResponse(
        playMessage(prompt("no_points", "אין נקודות חלוקה פעילות כרגע"))
      );
    }
    return yemotResponse(
      read(
        messages(
          prompt("choose_city", "בחר עיר"),
          // §69: כתיב פונטי אם הוגדר; הבחירה לפי שם העיר האמיתי
          ...cityList.map((c, i) => {
            const tts = cities.find((x) => x.city === c)?.cityPhoneName;
            return say(`ל${tts || c} הקש ${i + 1}`);
          })
        ),
        {
          name: "NEWCITY",
          // §175: מספר הספרות לפי מספר האפשרויות בפועל.
          //
          // 🐛 max=2 קבוע גרם לכך שהלקוח הקיש ספרה אחת והמערכת
          // המתינה לשנייה שלא תגיע - שתיקה שנשמעת כמו תקלה.
          //
          // ⚠️ במקש בודד timeout ארוך הוא **נכון**: המשמעות שם
          // היא "כמה זמן להמתין להקשה", ולא "לספרה נוספת" (§100).
          max: cityList.length > 9 ? 2 : 1,
          min: 1,
          // §100: המתנה קצרה בין ספרות. שדה דו-ספרתי עם timeout
          // ארוך "נתקע" אחרי ההקשה הראשונה עד סולמית או פקיעה.
          timeout: 3,
          allowed: cityList.map((_, i) => String(i + 1)).join("."),
        }
      )
    );
  }

  const city = cityList[parseInt(p.NEWCITY, 10) - 1];
  if (!city) {
    return errorAndReturn(prompt("invalid_choice", "בחירה לא חוקית, חוזרים לתפריט"));
  }

  const pts = await prisma.deliveryPoint.findMany({
    where: { // §163: נקודה סמויה אינה מוצעת ללקוח בטלפון
      isPrivate: false,
      isActive: true, city },
    select: { id: true, name: true, phoneName: true },
    orderBy: { name: "asc" },
  });

  let newPointId: string | null = null;
  if (pts.length === 1) {
    newPointId = pts[0].id;
  } else if (!p.NEWPOINT) {
    return yemotResponse(
      read(
        messages(
          prompt("choose_point", "בחר נקודת חלוקה"),
          // §69: כתיב פונטי לשם הנקודה, אם הוגדר
          ...pts.map((x, i) => say(`ל${x.phoneName || x.name} הקש ${i + 1}`))
        ),
        {
          name: "NEWPOINT",
          // §175: מספר הספרות לפי מספר האפשרויות בפועל.
          //
          // 🐛 max=2 קבוע גרם לכך שהלקוח הקיש ספרה אחת והמערכת
          // המתינה לשנייה שלא תגיע - שתיקה שנשמעת כמו תקלה.
          //
          // ⚠️ במקש בודד timeout ארוך הוא **נכון**: המשמעות שם
          // היא "כמה זמן להמתין להקשה", ולא "לספרה נוספת" (§100).
          max: pts.length > 9 ? 2 : 1,
          min: 1,
          // §100: המתנה קצרה בין ספרות. שדה דו-ספרתי עם timeout
          // ארוך "נתקע" אחרי ההקשה הראשונה עד סולמית או פקיעה.
          timeout: 3,
          allowed: pts.map((_, i) => String(i + 1)).join("."),
        }
      )
    );
  } else {
    newPointId = pts[parseInt(p.NEWPOINT, 10) - 1]?.id ?? null;
  }

  if (!newPointId) {
    return errorAndReturn(prompt("invalid_choice", "בחירה לא חוקית, חוזרים לתפריט"));
  }

  const chosenPoint = pts.find((x) => x.id === newPointId);

  // עדכון הלקוח + ההזמנה הפתוחה בטרנזקציה. אם רק אחד מהם היה
  // מתעדכן, הלקוח היה מגיע לנקודה אחת והסחורה למקום אחר.
  await prisma.$transaction(async (tx) => {
    await tx.customer.update({
      where: { id: customer.id },
      data: { defaultPointId: newPointId },
    });
    if (openOrder?.id) {
      await tx.order.update({
        where: { id: openOrder.id },
        data: {
          pointId: newPointId,
          // ה-snapshot חייב להתעדכן גם: הוא מה שמוצג בכל המסכים
          // ובמיילים, ואם יישאר ישן הוא יסתור את הנקודה בפועל.
          pointNameSnapshot: chosenPoint?.name ?? null,
        },
      });
    }
  });

  return yemotResponse(
    playMessage(
      prompt("point_changed", "נקודת החלוקה שלך עודכנה"),
      say(chosenPoint?.name ?? ""),
      openOrder?.id
        ? prompt("point_changed_order", "ההזמנה הפעילה שלך הועברה לנקודה זו")
        : prompt("point_changed_note", "ההזמנה הבאה שלך תשויך לנקודה זו")
    )
  );
}

// ─────────────────────────────────────────────────────────────
// ביצוע הזמנה
// ─────────────────────────────────────────────────────────────
async function handleOrder(
  p: Record<string, string>,
  customer: any,
  callId: string,
  pricelist: ActiveSale | null
): Promise<Response> {
  // §61: המכירה הפעילה מגיעה מהקורא (נטענה פעם אחת בכניסה לבקשה).
  if (!pricelist) {
    return yemotResponse(
      playMessage(prompt("no_sale", "אין כרגע מכירה פעילה"))
    );
  }
  const now = new Date();
  if (pricelist.closeDate && now > pricelist.closeDate) {
    return yemotResponse(
      playMessage(prompt("sale_closed", "מועד ההרשמה למכירה הסתיים"))
    );
  }
  if (pricelist.openDate && now < pricelist.openDate) {
    return yemotResponse(
      playMessage(prompt("sale_not_open", "ההרשמה למכירה טרם נפתחה"))
    );
  }

  // הזמנה כפולה - אותה בדיקה כמו באתר
  const existing = await prisma.order.findFirst({
    where: {
      customerId: customer.id,
      pricelistId: pricelist.id,
      status: { notIn: ["CANCELLED"] },
    },
    select: { orderNumber: true },
  });
  if (existing) {
    // הלקוח כבר הזמין - מפנים לתפריט ההזמנה הפתוחה שבו יש עריכה
    // וביטול, במקום "פנה לנציג" שהוא מיותר עכשיו.
    return yemotResponse(
      playMessage(
        prompt("order_exists", "כבר קיימת לך הזמנה במכירה זו"),
        prompt(
          "order_exists_menu",
          "לצפייה בהזמנה, לשינוי או לביטול, נתק והתקשר שוב לתפריט הראשי"
        )
      )
    );
  }

  if (!customer.defaultPointId) {
    return yemotResponse(
      playMessage(prompt("no_point_assigned", "לא הוגדרה עבורך נקודת חלוקה, נציג יחזור אליך"))
    );
  }

  // טיוטה - מצב השיחה
  const draft = await prisma.phoneOrderDraft.upsert({
    where: { callId: callId || `no-call-${customer.id}` },
    create: {
      callId: callId || `no-call-${customer.id}`,
      phone: customer.phone ?? "",
      customerId: customer.id,
      pricelistId: pricelist.id,
      itemsJson: "[]",
    },
    update: {},
  });
  const items: DraftItem[] = JSON.parse(draft.itemsJson || "[]");

  // ─── אישור סופי ───
  if (p.CONFIRM) {
    if (p.CONFIRM !== "1") {
      await prisma.phoneOrderDraft.delete({ where: { id: draft.id } }).catch(() => null);
      // §93: כאן הניתוק מכוון - הלקוח ביקש לבטל וסיים.
      return yemotResponse(playMessage(prompt("order_cancelled", "ההזמנה בוטלה")));
    }
    return finalizeOrder(draft.id, items, customer, pricelist, callId);
  }

  // ─── §25 סיכום ואישור: הלקוח בחר לסיים ───
  // הפער הכי חמור שהיה: לקוח סיים הזמנה בלי לדעת שיחייבו לו את הכרטיס.
  // באתר זה מופיע במייל האישור; בטלפון חייב להיאמר בקול לפני האישור.
  // סיום: המשתמש הקיש 2 באחד מסבבי "מוצר נוסף". בודקים את הסבב
  // האחרון שהושלם (items.length - 1) ולא שם קבוע.
  const lastRound = items.length - 1;
  if (lastRound >= 0 && p[`MORE${lastRound}`] === "2") {
    if (items.length === 0) {
      return yemotResponse(
        playMessage(prompt("no_items", "לא נבחרו מוצרים. ההזמנה בוטלה"))
      );
    }

    const point = await prisma.deliveryPoint.findUnique({
      where: { id: customer.defaultPointId },
      select: { name: true, address: true, deliveryHours: true },
    });
    // §61: orderFee ו-deliveryDateText כבר נטענו עם המחירון
    const orderFee = Number(pricelist.orderFee || 0);
    const total =
      Math.round((items.reduce((a, i) => a + i.estimatedPrice, 0) + orderFee) * 100) / 100;

    const parts: string[] = [prompt("summary_intro", "סיכום ההזמנה שלך")];

    for (const it of items) {
      // הכשרות בסיכום כדי שהלקוח יאשר בדיוק את מה שהזמין
      // §92: אותו כלל כמו בתפריט - בלי כפילות כשהשם כולל כשרות
      const normK = (t: string) => t.replace(/["'`׳״\s]/g, "");
      const kSuffix =
        it.kashrut && !normK(it.productName).includes(normK(it.kashrut))
          ? ` בכשרות ${it.kashrut}`
          : "";
      parts.push(
        say(
          it.isSingle
            ? `${it.quantity} קילוגרם בודדים של ${it.productName}${kSuffix}`
            : it.quantity === 1
              ? `קרטון אחד של ${it.productName}${kSuffix}`
              : `${it.quantity} קרטונים של ${it.productName}${kSuffix}`
        )
      );
    }

    // §29: בסיכום מוקרא רק שם הנקודה ומועד החלוקה - בלי כתובת ושעות.
    // הסיבה: הסיכום כבר מכיל 15+ הודעות, וכל תוספת מאריכה את ההקראה
    // הרצופה לפני שהלקוח יכול להקיש. הכתובת והשעות רלוונטיות ביום
    // החלוקה ולא ברגע ההזמנה, והן זמינות במלואן בתפריט "נקודת החלוקה
    // שלי" ובצינתוק התזכורת שנשלח לפני החלוקה.
    if (point?.name) {
      parts.push(say(`נקודת החלוקה שלך ${point.name}`));
    }
    // §100: שני הלוחות, מהתאריך האמיתי ולא מטקסט חופשי
    const spokenDate = spokenDeliveryDate(pricelist);
    if (spokenDate) {
      parts.push(prompt("delivery_date_pre", "מועד החלוקה"));
      parts.push(say(spokenDate));
    }

    parts.push(prompt("summary_estimated", "סכום משוער"));
    parts.push(sayNumber(Math.round(total)));
    parts.push(prompt("shekels", "שקלים"));

    // ג': סטיות משקל בבודדים - הודעה שקיימת באתר ב-OrderFlow
    if (items.some((i) => i.isSingle)) {
      parts.push(
        prompt(
          "singles_note",
          "שים לב, במוצרים הנמכרים בבודדים המשקל בפועל עשוי להיות שונה במעט מהכמות שביקשת"
        )
      );
    }

    // א': הסכמה מפורשת לחיוב האוטומטי
    parts.push(
      prompt(
        "charge_notice",
        "המחיר הסופי ייקבע לאחר שקילה בפועל, והכרטיס השמור שלך יחויב אוטומטית בסכום הסופי"
      )
    );
    parts.push(prompt("confirm_ask", "לאישור ההזמנה והחיוב הקש 1. לביטול הקש 2"));

    return yemotResponse(
      read(messages(...parts), { name: "CONFIRM", max: 1, min: 1, allowed: "12" })
    );
  }

  // ─── בחירת קטגוריה ───
  // §94: רשימת הקטגוריות נחוצה **רק במסלול התפריט**. לקוח שבחר
  // הזמנה לפי מק"ט לא ישמע אותה לעולם, ובכל זאת שילמנו עליה
  // נסיעה בכל הקשה שלו.
  //
  // ⚠️ הבדיקה "אין מוצרים זמינים" נשמרת - היא פשוט עוברת למסלול
  // שבו היא רלוונטית, ובמסלול המק"ט תופסת אותה בדיקת sku_not_found.
  const inSkuMode = p.ORDMODE === "1";
  const cats = inSkuMode
    ? []
    : await prisma.pricelistProduct.findMany({
        where: { pricelistId: pricelist.id, product: { isActive: true, phoneEnabled: true } },
        select: {
          product: { select: { categoryId: true, category: { select: { id: true, name: true } } } },
        },
      });
  const catMap = new Map<string, string>();
  for (const c of cats) {
    if (c.product.category) catMap.set(c.product.category.id, c.product.category.name);
  }
  const catList = Array.from(catMap.entries());

  // §104: רשת ביטחון - תפריט ריק לא יישמע כשקט.
  //
  // הבאג הקודם היה שקוף לגמרי: הלקוח שמע כלום ובלוג הופיע 200
  // תקין. עכשיו כל מסלול קטגוריות בלי קטגוריות מקבל הודעה.
  //
  // ⚠️ הבדיקה מותנית ב-!inSkuMode בכוונה: במסלול המק"ט catList
  // ריק **מתוכנן** (§94 מדלג על השאילתה), והבדיקה כאן הייתה
  // חוסמת בדיוק את הלקוחות שהתכוונו לשרת.
  if (!inSkuMode && catList.length === 0) {
    return yemotResponse(
      playMessage(prompt("no_products", "אין מוצרים זמינים להזמנה טלפונית"))
    );
  }

  // §25: מספר הסבב הנוכחי. ימות שולחים בכל בקשה את *כל* הפרמטרים
  // שנאספו בשיחה, כולל של סבבים קודמים. בלי שם ייחודי לכל סבב, אחרי
  // בחירת "מוצר נוסף" הקוד היה רואה את CAT/PROD/QTY הישנים, מדלג על
  // השאלות, ומוסיף את אותו מוצר שוב ושוב בלולאה אינסופית.
  const round = items.length;
  const kCat = `CAT${round}`;
  const kProd = `PROD${round}`;
  const kMode = `MODE${round}`;
  const kQty = `QTY${round}`;
  const kSku = `SKU${round}`;

  // ═══ §69: הזמנה לפי מק"ט מהמודעה ═══
  //
  // הלקוח שראה את המודעה לא צריך לשמוע את כל התפריט - הוא מקיש את
  // מספר המוצר והמערכת מעלה אותו מיד. זה גם המענה המרכזי לתלונת
  // ההמתנה: הקראת קטגוריות ומוצרים היא החלק הארוך ביותר בשיחה.
  //
  // השער מוצג רק אם יש בכלל מוצרים עם מק"ט במכירה - אחרת האפשרות
  // הייתה רעש שמאריך את השיחה של כולם בשביל תכונה שאינה בשימוש.
  //
  // ORDMODE נשאל פעם אחת לשיחה (לא לכל סבב): מי שבחר מק"ט ממשיך
  // במק"טים גם ב"מוצר נוסף", כי ה-round מתקדם אבל ORDMODE נשאר.
  // §94: הספירה רצה **רק כשהיא נחוצה** - כלומר בפעם הראשונה, לפני
  // שנשאלה שאלת המק"ט.
  //
  // 🐛 קודם היא רצה בכל הקשה לאורך כל ההזמנה: הלקוח בוחר כמות,
  // מאשר, מוסיף מוצר - ובכל אחת מהן שילמנו נסיעה חוצת-אוקיינוס
  // על מספר שכבר לא משנה, כי ORDMODE נקבע מזמן.
  const skuCount = p.ORDMODE
    ? 0
    : await prisma.pricelistProduct.count({
        where: {
          pricelistId: pricelist.id,
          product: { isActive: true, phoneEnabled: true, // §270: not: null אינו חוקי — not: "" מסנן שניהם.
            phoneCode: { not: "" } },
        },
      });

  if (skuCount > 0 && !p.ORDMODE) {
    return yemotResponse(
      read(
        messages(
          prompt(
            "order_mode_ask",
            "אם ברשותך מספר מוצר מהמודעה הקש 1. לשמיעת המוצרים לפי קטגוריות הקש 2"
          )
        ),
        { name: "ORDMODE", max: 1, min: 1, allowed: "12" }
      )
    );
  }

  // chosen מוגדר פעם אחת ומשותף לשני המסלולים - מכאן והלאה זרימת
  // הכמות/בודדים זהה לחלוטין, בדיוק כמו שביקשת: אחרי כל מוצר מק"ט
  // אותה שאלת "להמשיך או לסיים" של המסלול הרגיל.
  let chosen: { price: any; product: any } | null = null;

  const productSelect = {
    id: true,
    name: true,
    unit: true,
    saleType: true,
    priceType: true,
    cartonPrice: true,
    allowSingles: true,
    singlesMode: true,
    singleUnitPrice: true,
    avgWeightPerUnit: true,
    phoneKey: true,
    // §69: כתיב פונטי - עדיפות בהקראה על השם הרגיל
    phoneName: true,
    limitedQty: true,
    limitedQtyAmount: true,
    // §33: כשרות - הלקוח חייב לדעת לפני שהוא בוחר, במיוחד כשיש
    // שני מוצרים דומים בכשרויות שונות.
    kashrut: true,
    kashrutRef: { select: { name: true } },
  } as const;

  // §104: 🐛 כאן היה `skuCount > 0 && ORDMODE === "1"` - וזו הייתה
  // התנגשות בין שני הייעולים של §94:
  //   • skuCount הוגדר 0 ברגע ש-ORDMODE נקבע (כדי לחסוך שאילתה)
  //   • cats דולג במסלול המק"ט (כדי לחסוך שאילתה נוספת)
  //
  // התוצאה: לקוח שבחר מק"ט נכשל בתנאי הזה (skuCount=0), נפל
  // למסלול הקטגוריות - שגם הוא ריק - ושמע **שקט מוחלט**.
  //
  // התנאי הנכון הוא ORDMODE בלבד: ברגע שהלקוח בחר מסלול, מספר
  // המוצרים עם מק"ט כבר לא רלוונטי להחלטה.
  if (inSkuMode) {
    // ─── מסלול מק"ט ───
    if (!p[kSku]) {
      return yemotResponse(
        read(
          messages(
            prompt("sku_ask", "הקש את מספר המוצר מהמודעה")
          ),
          // §93: playback "No" ולא "Digits".
          // 🐛 הלקוח הקיש 22 ושמע "22" בחזרה - מספר שאינו אומר לו
          // דבר. האישור המשמעותי הוא **שם המוצר**, שמוקרא מיד
          // בשלב הבא ("בחרת: אנטריקוט"). הקראת הספרות רק האריכה
          // את השיחה בכמה שניות.
          { name: kSku, max: 5, min: 1, timeout: 3, playback: "No" }
        )
      );
    }

    const found = await prisma.pricelistProduct.findFirst({
      where: {
        pricelistId: pricelist.id,
        product: {
          isActive: true,
          phoneEnabled: true,
          phoneCode: String(parseInt(p[kSku], 10)),
        },
      },
      include: { product: { select: productSelect } },
    });

    if (!found) {
      // שאילת אותו שם פרמטר מחדש - ימות דורסים את הערך הקודם, ולכן
      // זו לולאת ניסיון-חוזר טבעית בלי מצב נוסף.
      return yemotResponse(
        read(
          messages(
            prompt("sku_not_found", "מספר מוצר לא נמצא במכירה הנוכחית. נסה שוב, או הקש כוכבית לתפריט הראשי")
          ),
          { name: kSku, max: 5, min: 1, timeout: 3, playback: "No" }
        )
      );
    }

    // ═══ §95: אישור המוצר שעלה מהמק"ט ═══
    //
    // 🐛 הפער: הקשת מק"ט שגוי שקיים במערכת (טעות ספרה - 22 במקום 21)
    // הובילה ישר לשאלת הכמות על **מוצר אחר**, בלי שהלקוח יודע ובלי
    // דרך לחזור. הוא היה מגלה את הטעות רק בסיכום, או בחלוקה.
    //
    // עכשיו: המוצר והמחיר מוקראים, והלקוח מאשר. שתי הקשות במקום
    // אחת - אבל הן חוסכות הזמנה שגויה שמתגלה מאוחר מדי.
    //
    // 2 = מוצר שגוי -> חוזרים לשאלת המק"ט. איפוס SKU נעשה על ידי
    // שאילתו מחדש: ימות דורסים את הערך הקודם באותו שם פרמטר.
    // §106: 🐛 כאן היה הבאג שגרם ללולאה שאין ממנה יציאה.
    //
    // ימות שולחים בכל בקשה את **כל** הפרמטרים שנצברו בשיחה, לא
    // רק את החדש. kSkuOk היה קבוע (SKUOK{round}) לאורך כל הסבב -
    // ולכן "2" (מוצר אחר) שנשמר בו נשאר תקוע גם אחרי שהוקש מק"ט
    // חדש ונכון. הבדיקה ראתה "2" ישן ושאלה קוד מחדש, שוב ושוב,
    // בלי קשר למה שהוקש בפועל.
    //
    // התיקון: קושרים את פרמטר האישור **לקוד הספציפי** שנבדק, לא
    // רק לסבב ההזמנה. כשהקוד משתנה (21 -> 22), שם הפרמטר משתנה
    // איתו (SKUOK{round}_21 -> SKUOK{round}_22), והערך הישן פשוט
    // כבר לא רלוונטי - השאלה נשאלת נקייה מכל ניסיון קודם.
    const kSkuOk = `SKUOK${round}_${p[kSku]}`;
    if (p[kSkuOk] !== "1") {
      if (p[kSkuOk] === "2") {
        return yemotResponse(
          read(
            messages(prompt("sku_ask", "הקש את מספר המוצר מהמודעה")),
            { name: kSku, max: 5, min: 1, timeout: 3, playback: "No" }
          )
        );
      }

      // המחיר האמיתי, באותו כלל של §85: לפי משקל - מחיר לק"ג;
      // אחרת מחיר הקרטון. בלי סכומים משוערים.
      const fp = found.product;
      const base = Number(found.price ?? fp.cartonPrice);
      const perKg = fp.priceType === "PER_KG";

      return yemotResponse(
        read(
          messages(
            prompt("sku_found_pre", "המוצר שבחרת"),
            say(productSpokenName(fp)),
            prompt("sku_found_price", "במחיר"),
            sayNumber(Math.round(base * 100) / 100),
            prompt(
              perKg ? "shekels_per_kg" : "shekels",
              perKg ? "שקלים לקילו" : "שקלים"
            ),
            prompt("sku_confirm_ask", "לאישור הקש 1, למוצר אחר הקש 2")
          ),
          { name: kSkuOk, max: 1, min: 1, allowed: "12" }
        )
      );
    }

    chosen = found;
  } else {
    // ─── המסלול הרגיל: קטגוריה ואז מוצר ───
    if (!p[kCat]) {
      const menu = catList.map(([, name], i) => say(`ל${name} הקש ${i + 1}`));
      return yemotResponse(
        read(messages(prompt("choose_category", "בחר קטגוריה"), ...menu), {
          name: kCat,
          max: 2,
          min: 1,
          // §100: המתנה קצרה בין ספרות. שדה דו-ספרתי עם timeout
          // ארוך "נתקע" אחרי ההקשה הראשונה עד סולמית או פקיעה.
          timeout: 3,
          allowed: catList.map((_, i) => String(i + 1)).join("."),
        })
      );
    }

    const catId = catList[parseInt(p[kCat], 10) - 1]?.[0];
    if (!catId) {
      return errorAndReturn(prompt("invalid_choice", "בחירה לא חוקית, חוזרים לתפריט"));
    }

    // ─── בחירת מוצר ───
    const prods = await prisma.pricelistProduct.findMany({
      where: {
        pricelistId: pricelist.id,
        product: { isActive: true, phoneEnabled: true, categoryId: catId },
      },
      include: { product: { select: productSelect } },
    });
    // סדר לפי phoneKey אם הוגדר, אחרת לפי שם
    prods.sort((a, b) => {
      const ak = a.product.phoneKey ?? 999;
      const bk = b.product.phoneKey ?? 999;
      if (ak !== bk) return ak - bk;
      return a.product.name.localeCompare(b.product.name, "he");
    });

    if (prods.length === 0) {
      return yemotResponse(
        playMessage(prompt("no_products_cat", "אין מוצרים בקטגוריה זו"))
      );
    }

    if (!p[kProd]) {
      // §33: שם המוצר + הכשרות שלו. בלי זה לקוח שרואה שני מוצרים דומים
      // בתפריט לא יודע במה לבחור.
      // §69: phoneName קודם לשם הרגיל - זה כל ייעודו.
      // §92: productSpokenName מונע "פרגית בדץ בכשרות בדץ"
      const menu = prods.map((pp, i) =>
        say(`ל${productSpokenName(pp.product)} הקש ${i + 1}`)
      );
      return yemotResponse(
        read(messages(prompt("choose_product", "בחר מוצר"), ...menu), {
          name: kProd,
          max: 2,
          min: 1,
          // §100: המתנה קצרה בין ספרות. שדה דו-ספרתי עם timeout
          // ארוך "נתקע" אחרי ההקשה הראשונה עד סולמית או פקיעה.
          timeout: 3,
          allowed: prods.map((_, i) => String(i + 1)).join("."),
        })
      );
    }

    chosen = prods[parseInt(p[kProd], 10) - 1] ?? null;
  }

  if (!chosen) {
    return errorAndReturn(prompt("invalid_choice", "בחירה לא חוקית, חוזרים לתפריט"));
  }
  const prod = chosen.product;

  // ─── §27 קרטון או בודדים, עם משקל ומחיר ───
  // הלקוח צריך לדעת *מה הוא מקבל וכמה זה עולה* לפני שהוא בוחר, בדיוק
  // כמו באתר. המספרים משתנים לכל מוצר ולכן הם TTS, והטקסט סביבם
  // מוקלט - לכן ההודעות מפוצלות ל-pre/mid/post.
  //
  // התמחור זהה לאתר: קרטון מוצג במחיר המלא של הקרטון (מחיר לק"ג כפול
  // המשקל המשוער), ובודדים לפי מחיר לק"ג.
  const cartonBase = Number(chosen.price ?? prod.cartonPrice);
  const avgW = prod.avgWeightPerUnit != null ? Number(prod.avgWeightPerUnit) : null;

  // §85: 🐛 בטלפון הוקרא **סכום משוער** ולא מחיר.
  //
  // הקוד חישב `מחיר לק"ג × משקל משוער` והקריא את התוצאה, ולכן
  // אנטריקוט ב-88.90 לק"ג נשמע כ"קרטון בסכום 1,500". שני
  // כשלים בבת אחת:
  //   • המספר אינו המחיר שהלקוח משלם - הוא הערכה שתשתנה בשקילה
  //   • הוא מבלבל: הלקוח שומע 1,500 ומניח שזה מה שיחויב
  //
  // באתר המשוער עובד כי רואים לצידו "משוער" ופירוט. בטלפון יש רק
  // מספר אחד באוזן, ולכן הוא חייב להיות המחיר האמיתי.
  //
  // מכאן: מוצר שנמכר לפי משקל מוקרא במחיר לק"ג, ומוצר במחיר קבוע
  // לקרטון מוקרא במחיר הקרטון. אין הכפלה ואין הערכה.
  const isPerKg = prod.priceType === "PER_KG";
  const cartonPriceSpoken = Math.round(cartonBase * 100) / 100;

  let isSingle = false;
  if (prod.allowSingles) {
    if (!p[kMode]) {
      const parts: string[] = [];

      // §69: במסלול מק"ט הלקוח לא שמע תפריט - חייבים להקריא לו איזה
      // מוצר עלה מהמספר שהקיש, אחרת הוא מאשר כמות בלי לדעת של מה.
      // §95: אין הקראה חוזרת של שם המוצר. הוא כבר הוקרא ואושר
      // מפורשות בשלב האישור, ולכן חזרה עליו רק מאריכה את השיחה.

      // §85: המחיר האמיתי. לפי משקל - מחיר לק"ג; אחרת מחיר הקרטון.
      parts.push(
        prompt(
          isPerKg ? "mode_carton_kg" : "mode_carton_nowt",
          isPerKg ? "לקניה לפי קרטון במחיר" : "לקניה לפי קרטון במחיר"
        )
      );
      parts.push(sayNumber(cartonPriceSpoken));
      parts.push(
        prompt(
          isPerKg ? "mode_carton_kg_post" : "mode_carton_post",
          isPerKg ? "שקלים לקילו, הקש 1" : "שקלים, הקש 1"
        )
      );

      // מחיר הבודדים כולל כבר את התוספת, ולכן מוצג כמחיר סופי אחד.
      // "מחיר + תוספת" היו שני מספרים והלקוח לא היה יודע מה לשלם.
      const singlePrice = effectiveUnitPrice(
        cartonBase,
        true,
        Number(pricelist.singleSurcharge),
        prod.singlesMode,
        prod.singleUnitPrice != null ? Number(prod.singleUnitPrice) : null
      );
      const byUnits = prod.singlesMode === "UNITS";
      parts.push(
        prompt(
          byUnits ? "mode_singles_unit_pre" : "mode_singles_pre",
          byUnits ? "לקניה לפי יחידות במחיר" : "לקניה לפי קילו בודדים במחיר"
        )
      );
      parts.push(sayNumber(Math.round(singlePrice)));
      parts.push(
        prompt(
          byUnits ? "mode_singles_unit_post" : "mode_singles_post",
          byUnits ? "שקלים ליחידה, הקש 2" : "שקלים לקילו, הקש 2"
        )
      );

      return yemotResponse(
        read(messages(...parts), { name: kMode, max: 1, min: 1, allowed: "12" })
      );
    }
    isSingle = p[kMode] === "2";
  } else if (!p[kQty]) {
    // מוצר ללא בודדים: אין תפריט בחירה, אבל הלקוח עדיין צריך לשמוע
    // מה המחיר לפני שהוא נוקב בכמות. משולב בשאלת הכמות עצמה.
    const info: string[] = [];
    // §69: במסלול מק"ט - קודם איזה מוצר עלה
    // §95: ראה ההסבר למעלה - המוצר כבר אושר.
    // §85: המחיר האמיתי, לא סכום משוער. ראה ההסבר למעלה.
    info.push(prompt("carton_only_nowt", "מחיר לקרטון"));
    info.push(sayNumber(cartonPriceSpoken));
    info.push(
      prompt(
        isPerKg ? "shekels_per_kg" : "shekels",
        isPerKg ? "שקלים לקילו" : "שקלים"
      )
    );
    info.push(prompt("ask_qty_carton", "כמה קרטונים תרצה"));
    return yemotResponse(
      read(messages(...info), {
          name: kQty,
          // §100: 2 ספרות מספיקות (עד 99), והמתנה קצרה בין ספרות.
          // 20 שניות של §97 היו "כמה להמתין לספרה נוספת" - ולכן
          // אחרי הקשה אחת המערכת שתקה עד שהוקשה סולמית.
          max: 2,
          min: 1,
          timeout: 3,
          playback: "Number",
        })
    );
  }

  // ─── כמות ───
  if (!p[kQty]) {
    // ⚠️ שם המשתנה חייב להיות שונה מ-prompt: משתנה מקומי בשם זהה מצל
    // על הפונקציה המיובאת וגורם לקריאה רקורסיבית ולקריסה.
    const qtyPrompt = isSingle
      ? prompt("ask_qty_kg", "כמה קילוגרם תרצה")
      : prompt("ask_qty_carton", "כמה קרטונים תרצה");
    return yemotResponse(
      read(qtyPrompt, {
          name: kQty,
          // §100: 2 ספרות מספיקות (עד 99), והמתנה קצרה בין ספרות.
          // 20 שניות של §97 היו "כמה להמתין לספרה נוספת" - ולכן
          // אחרי הקשה אחת המערכת שתקה עד שהוקשה סולמית.
          max: 2,
          min: 1,
          timeout: 3,
          playback: "Number",
        })
    );
  }

  const qty = parseInt(p[kQty], 10);
  if (!qty || qty <= 0) {
    // §93: טעות הקלדה בכמות היא הדבר הכי שכיח בשיחה. ניתוק כאן
    // אילץ את הלקוח להתקשר מחדש ולהתחיל את ההזמנה מאפס.
    return errorAndReturn(prompt("invalid_qty", "כמות לא חוקית, חוזרים לתפריט"));
  }

  // §28: מגבלת כמות למוצר - אותה בדיקה שקיימת באתר. בלי זה הלקוח
  // הטלפוני היה מזמין בחופשיות ויוצר חריגה שהמנהל מגלה רק בדיעבד.
  if (prod.limitedQty && prod.limitedQtyAmount != null) {
    const agg = await prisma.orderItem.aggregate({
      where: {
        productId: prod.id,
        isCancelled: false,
        order: { pricelistId: pricelist.id, status: { notIn: ["CANCELLED"] } },
      },
      _sum: { quantity: true },
    });
    const already = Number(agg._sum.quantity ?? 0);
    const remaining = prod.limitedQtyAmount - already;
    if (remaining <= 0) {
      return yemotResponse(
        playMessage(
          prompt("qty_sold_out", "המוצר אזל מהמלאי במכירה זו"),
          prompt("qty_choose_other", "ניתן לבחור מוצר אחר")
        )
      );
    }
    if (qty > remaining) {
      return yemotResponse(
        read(
          messages(
            prompt("qty_limited_pre", "לא ניתן להזמין כמות זו. נותרו רק"),
            sayNumber(Math.floor(remaining)),
            prompt("qty_limited_post", "יחידות. אנא הקש כמות מחדש")
          ),
          {
          name: kQty,
          // §100: 2 ספרות מספיקות (עד 99), והמתנה קצרה בין ספרות.
          // 20 שניות של §97 היו "כמה להמתין לספרה נוספת" - ולכן
          // אחרי הקשה אחת המערכת שתקה עד שהוקשה סולמית.
          max: 2,
          min: 1,
          timeout: 3,
          playback: "Number",
        }
        )
      );
    }
  }

  // ─── חישוב מחיר - בדיוק כמו באתר ───
  // משתמש ב-cartonBase ו-avgW שחושבו למעלה לצורך ההקראה, כדי שהמחיר
  // שהלקוח *שמע* יהיה בדיוק המחיר שנשמר בהזמנה. שני חישובים נפרדים
  // היו יוצרים סיכון שאחד ישתנה והשני לא, והלקוח יחויב בסכום אחר
  // ממה שאושר לו בשיחה.
  const surcharge = Number(pricelist.singleSurcharge);
  const unitPrice = effectiveUnitPrice(
    cartonBase,
    isSingle,
    surcharge,
    prod.singlesMode,
    prod.singleUnitPrice != null ? Number(prod.singleUnitPrice) : null
  );
  const avgWeight = avgW;
  const isSinglesKg = isSingle && prod.priceType === "PER_KG";
  const est = isSinglesKg
    ? Math.round(unitPrice * qty * 100) / 100
    : smartLineEstimate(unitPrice, qty, prod.saleType, prod.priceType, avgWeight);
  const estWeight =
    isSingle && prod.singlesMode === "UNITS"
      ? null
      : isSingle
        ? qty
        : avgWeight
          ? Math.round(avgWeight * qty * 1000) / 1000
          : null;

  // הוספה לטיוטה
  items.push({
    productId: prod.id,
    productName: prod.name,
    kashrut: prod.kashrutRef?.name || prod.kashrut || null,
    // §128: היחידה האמיתית. בבודדים היא נגזרת מ-singlesMode
    // (ק"ג או יחידות), ואחרת מ-unit של המוצר.
    unit: isSingle
      ? prod.singlesMode === "UNITS"
        ? "יחידה"
        : 'ק"ג'
      : prod.unit || "קרטון",
    isSingle,
    quantity: qty,
    unitPrice,
    estimatedPrice: est ?? 0,
    estimatedWeight: estWeight,
  });
  await prisma.phoneOrderDraft.update({
    where: { id: draft.id },
    data: { itemsJson: JSON.stringify(items) },
  });

  // ─── עוד מוצר או לסיים? ───
  const confirmParts: string[] = [
    say(
      isSingle
        ? `נבחרו ${qty} קילוגרם בודדים של ${prod.name}`
        : qty === 1
          ? `נבחר קרטון אחד של ${prod.name}`
          : `נבחרו ${qty} קרטונים של ${prod.name}`
    ),
  ];
  if (estWeight && !isSingle) {
    confirmParts.push(prompt("est_weight_of", "במשקל משוער של"));
    confirmParts.push(sayNumber(Math.round(estWeight)));
    confirmParts.push(prompt("kilogram", "קילוגרם"));
  }

  return yemotResponse(
    read(
      messages(
        ...confirmParts,
        prompt("more_or_finish", "להוספת מוצר נוסף הקש 1, לסיום ההזמנה הקש 2")
      ),
      { name: `MORE${round}`, max: 1, min: 1, allowed: "12" }
    )
  );
}

// ─────────────────────────────────────────────────────────────
// יצירת ההזמנה בפועל
// ─────────────────────────────────────────────────────────────
async function finalizeOrder(
  draftId: string,
  items: DraftItem[],
  customer: any,
  pricelist: ActiveSale,
  callId: string
): Promise<Response> {
  if (items.length === 0) {
    return errorAndReturn(prompt("no_items", "לא נבחרו מוצרים, חוזרים לתפריט"));
  }

  // הגנה מפני יצירה כפולה - ימות עלולים לשלוח את אותה בקשה שוב
  const draft = await prisma.phoneOrderDraft.findUnique({
    where: { id: draftId },
    select: { orderId: true, completedAt: true },
  });
  if (draft?.orderId) {
    return yemotResponse(
      playMessage(prompt("order_already_saved", "ההזמנה כבר נקלטה"))
    );
  }

  const point = await prisma.deliveryPoint.findUnique({
    where: { id: customer.defaultPointId },
    select: { id: true, name: true, customDeliveryDateText: true },
  });

  // §61: שדות המחירון כבר נטענו בכניסה לבקשה
  const orderFee = Number(pricelist.orderFee || 0);
  const total =
    Math.round((items.reduce((s, i) => s + i.estimatedPrice, 0) + orderFee) * 100) / 100;

  const order = await prisma.order.create({
    data: {
      pricelistId: pricelist.id,
      pointId: customer.defaultPointId,
      customerId: customer.id,
      // §24: מסמן שההזמנה הגיעה מהמערכת הטלפונית
      source: "PHONE",
      phoneCallId: callId || null,
      pointNameSnapshot: point?.name ?? null,
      deliveryDateSnapshot:
        point?.customDeliveryDateText || pricelist.deliveryDateText || null,
      pricelistNameSnapshot: pricelist.name ?? null,
      customerName: customer.name,
      phone: customer.phone ?? "",
      estimatedTotal: total,
      status: "PENDING_REVIEW",
      items: {
        create: items.map((i) => ({
          productId: i.productId,
          productName: i.productName,
          // §128: היחידה האמיתית מהמוצר. בבודדים - ק"ג או יחידות
          // לפי singlesMode; אחרת - unit של המוצר עצמו.
          unit: i.unit || (i.isSingle ? 'ק"ג' : "קרטון"),
          isSingle: i.isSingle,
          quantity: i.quantity,
          unitPrice: i.unitPrice,
          estimatedPrice: i.estimatedPrice,
          estimatedWeight: i.estimatedWeight,
        })),
      },
    },
    select: { id: true, orderNumber: true },
  });

  await prisma.phoneOrderDraft.update({
    where: { id: draftId },
    data: { orderId: order.id, completedAt: new Date() },
  });

  // §25: מיילים - בדיוק כמו בהזמנה מהאתר.
  // בלי זה המנהל לא יודע שהגיעה הזמנה, והלקוח נשאר בלי תיעוד כתוב
  // של מה שהזמין בשיחה.
  //
  // השליחה עטופה ב-catch ולא חוסמת: אם Resend נופל, ההזמנה כבר נשמרה
  // ב-DB ואסור שהלקוח ישמע "אירעה שגיאה" בסוף שיחה מוצלחת.
  try {
    const full = await prisma.order.findUnique({
      where: { id: order.id },
      include: {
        items: true,
        customer: { select: { email: true } },
        point: { select: { name: true } },
      },
    });
    if (full) {
      if (full.customer?.email) {
        await sendCustomerOrderConfirmation(full as any, full.customer.email);
      }
      await sendAdminOrderNotification(full as any, full.customer?.email ?? null);
    }
  } catch (e) {
    console.error("[phone-ivr] email send failed (order was saved):", e);
  }

  // §28: מועד אחרון לשינוי - הלקוח צריך לדעת עד מתי הוא יכול לערוך.
  // §61: editDeadline/closeDate כבר נטענו עם המחירון.
  const dl = pricelist.editDeadline ?? pricelist.closeDate ?? null;
  const dlParts: string[] = [];
  if (dl) {
    dlParts.push(prompt("edit_until", "ניתן לשנות או לבטל את ההזמנה עד"));
    dlParts.push(
      say(
        dl.toLocaleDateString("he-IL", {
          weekday: "long",
          day: "numeric",
          month: "numeric",
        })
      )
    );
  }

  return yemotResponse(
    playMessage(
      prompt("order_saved", "ההזמנה נקלטה בהצלחה"),
      prompt("your_order_number", "מספר ההזמנה שלך"),
      sayNumber(order.orderNumber),
      prompt("summary_estimated", "סכום משוער"),
      sayNumber(Math.round(total)),
      prompt("shekels", "שקלים"),
      prompt("final_price_note", "המחיר הסופי ייקבע לאחר שקילה"),
      ...dlParts,
      prompt("thanks", "תודה ולהתראות")
    )
  );
}

export async function GET(req: Request) {
  try {
    return await handle(req);
  } catch (e: any) {
    console.error("[phone-ivr] error:", e);
    return yemotResponse(
      playMessage(prompt("error", "אירעה שגיאה, נסה שוב מאוחר יותר"))
    );
  }
}

export async function POST(req: Request) {
  return GET(req);
}
