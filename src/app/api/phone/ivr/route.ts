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
import { cleanName } from "@/lib/identity";
import {
  sendCustomerOrderConfirmation,
  sendAdminOrderNotification,
} from "@/lib/email";

type DraftItem = {
  productId: string;
  productName: string;
  // §33: נשמר בטיוטה כדי שהסיכום יקריא אותה בלי שאילתה נוספת
  kashrut?: string | null;
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
  // YEMOT_IVR_FOLDER = נתיב השלוחה של המערכת בימות (למשל "/9").
  // ברירת מחדל "/" - השלוחה הראשית.
  const starPressed = Object.entries(p).some(
    ([k, v]) => v === "*" && !k.startsWith("Api") && k !== "hangup"
  );
  if (starPressed) {
    return yemotResponse(goToFolder(process.env.YEMOT_IVR_FOLDER || "/"));
  }

  // ─── זיהוי הלקוח ───
  const customer = await prisma.customer.findUnique({
    where: { phone },
    select: {
      id: true,
      name: true,
      role: true,
      // §61: 🐛 phone לא נשלף, ולכן `customer.phone ?? ""` בטיוטה
      // ובהזמנה נתן תמיד מחרוזת ריקה. PhoneOrderDraft.phone היה ריק
      // בכל הרשומות, וה-@@index([phone]) עליו לא שירת דבר.
      phone: true,
      paymentToken: true,
      // §60: לקוח מזומן מזמין בלי כרטיס
      paymentPreference: true,
      // §52: לקוח מושבת
      isActive: true,
      defaultPointId: true,
      defaultPoint: { select: { id: true, name: true } },
      // §76: לשמיעת קוד הכניסה לאתר (תפריט 4)
      loginCode: true,
    },
  });

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
  const canOrder = !!customer.paymentToken || customer.paymentPreference === "CASH";
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
  // §61: נשלפים כאן כל שדות המחירון שנדרשים בהמשך המסלול, כדי שלא
  // ייטענו שוב ושוב. ראה ActiveSale למעלה.
  const activeSale = await prisma.pricelist.findFirst({
    where: { status: "ACTIVE" },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      name: true,
      closeDate: true,
      openDate: true,
      singleSurcharge: true,
      orderFee: true,
      deliveryDateText: true,
      editDeadline: true,
    },
  });

  const openOrder = activeSale
    ? await prisma.order.findFirst({
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
    : null;

  // ─── §30: הודעה למתקשרים ───
  // מוקראת פעם אחת בכניסה, לפני התפריט. הסינון כפול ומכוון:
  //   1. רק ללקוח שיש לו הזמנה פעילה במכירה - למי שלא הזמין העדכון
  //      לא רלוונטי ורק מבלבל.
  //   2. רק אם ההודעה מיועדת לנקודה שלו (או גלובלית) - "החלוקה בקרלין
  //      נדחתה" לא צריך להישמע ללקוח מנדבורנא.
  // ANNOUNCED מסמן שכבר הושמעה, כדי שלא תחזור בכל שלב בשיחה.
  if (openOrder && !p.ANNOUNCED) {
    const now2 = new Date();
    const ann = await prisma.phoneAnnouncement.findFirst({
      where: {
        pricelistId: activeSale!.id,
        isActive: true,
        OR: [{ expiresAt: null }, { expiresAt: { gt: now2 } }],
        // גלובלית או ספציפית לנקודה של הלקוח
        AND: [{ OR: [{ pointId: null }, { pointId: openOrder.pointId }] }],
      },
      // הודעה ספציפית לנקודה גוברת על גלובלית
      orderBy: [{ pointId: "desc" }, { createdAt: "desc" }],
      select: { text: true },
    });

    if (ann?.text) {
      return yemotResponse(
        read(
          messages(
            prompt("announcement_intro", "הודעה חשובה"),
            say(ann.text),
            prompt("announcement_continue", "להמשך הקש 1")
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
    const canHearCode =
      !!customer.paymentToken || customer.paymentPreference === "CASH";

    return yemotResponse(
      read(
        messages(
          say(`שלום ${customer.name}`),
          canHearCode
            ? prompt(
                "menu_main_code",
                "ברוכים הבאים לצדקת רבותינו. לביצוע הזמנה הקש 1, לשמיעת ההזמנות שלך הקש 2, לשמיעת נקודת החלוקה שלך הקש 3, לשמיעת קוד הכניסה לאתר הקש 4"
              )
            : prompt(
                "menu_main",
                "ברוכים הבאים לצדקת רבותינו. לביצוע הזמנה הקש 1, לשמיעת ההזמנות שלך הקש 2, לשמיעת נקודת החלוקה שלך הקש 3"
              )
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
    where: { isActive: true },
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
        max: 2,
        min: 1,
        allowed: cityList.map((_, i) => String(i + 1)).join("."),
      })
    );
  }

  const cityIdx = parseInt(p.CITY, 10) - 1;
  const city = cityList[cityIdx];
  if (!city) {
    return yemotResponse(playMessage(prompt("invalid_choice", "בחירה לא חוקית")));
  }

  // שלב 2: נקודה בעיר. אם יש רק אחת - נבחרת אוטומטית.
  const points = await prisma.deliveryPoint.findMany({
    where: { isActive: true, city },
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
        max: 2,
        min: 1,
        allowed: points.map((_, i) => String(i + 1)).join("."),
      })
    );
  } else {
    pointId = points[parseInt(p.POINT, 10) - 1]?.id ?? null;
  }

  if (!pointId) {
    return yemotResponse(playMessage(prompt("invalid_choice", "בחירה לא חוקית")));
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
  const rawName = cleanName(String(p.NAME ?? "").replace(/^Digits-/, ""));

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
      readVoice(
        messages(
          ptLabel ? prompt("chosen_pre", "בחרת") : "",
          ptLabel ? say(ptLabel) : "",
          prompt("ask_name", "אנא אמור את שמך המלא לאחר הצליל")
        ),
        "NAME"
      )
    );
  }

  // נקלט ריק - ממשיכים עם שם זמני. עדיף חשבון שהנציג יתקן את שמו
  // מאשר שיחה שנתקעת והלקוח לא נרשם בכלל.
  const finalName = rawName || "לקוח טלפוני";

  // אישור השם - בשליטתנו ולא של ימות. מוצג רק כשבאמת נקלט שם;
  // אין טעם לבקש אישור על "לקוח טלפוני".
  if (rawName && p.NAMEOK !== "1") {
    if (p.NAMEOK === "2") {
      // ביקש לתקן - שואלים מחדש. NAME נדרס בערך החדש.
      return yemotResponse(
        readVoice(
          prompt("ask_name_again", "אנא אמור את שמך המלא שוב לאחר הצליל"),
          "NAME"
        )
      );
    }
    return yemotResponse(
      read(
        messages(
          prompt("name_confirm_pre", "השם שנקלט"),
          say(rawName),
          prompt("name_confirm_ask", "לאישור הקש 1, לשינוי הקש 2")
        ),
        { name: "NAMEOK", max: 1, min: 1, allowed: "12" }
      )
    );
  }

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
  const name = finalName;

  // הגנה מפני יצירה כפולה אם ימות שולחים את אותה בקשה פעמיים
  const already = await prisma.customer.findUnique({ where: { phone } });
  if (already) {
    return yemotResponse(
      playMessage(prompt("account_exists", "החשבון כבר קיים במערכת, נציג יחזור אליך"))
    );
  }

  const passwordHash = await bcrypt.hash(generateStrongPassword(), 10);

  const created = await prisma.customer.create({
    data: {
      name,
      phone,
      passwordHash,
      // לא שומרים passwordPlain - הסיסמה לא מיועדת למסירה ללקוח
      passwordPlain: null,
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
        { name: kQtyNew, max: 3, min: 1, playback: "Number" }
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
  const code = decryptCode(customer.loginCode ?? null);

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

  // ⚠️ ספרה-ספרה ופעמיים: הלקוח שומע פעם אחת וצריך לזכור.
  return yemotResponse(
    playMessage(
      prompt("login_code_pre", "קוד הכניסה שלך לאתר, יחד עם מספר הטלפון שלך, הוא"),
      sayDigits(code),
      prompt("login_code_repeat", "שוב"),
      sayDigits(code),
      prompt(
        "login_code_post",
        "היכנס לאתר עם מספר הטלפון שלך והקוד הזה. תודה ולהתראות"
      )
    )
  );
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
    },
  });

  if (orders.length === 0) {
    return yemotResponse(
      playMessage(prompt("no_orders", "אין לך הזמנות במערכת"))
    );
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
    const parts: string[] = [say("פירוט הזמנה מספר"), sayNumber(latest.orderNumber)];
    for (const it of its) {
      const qty = Number(it.quantity);
      parts.push(
        say(
          it.isSingle
            ? `${qty} קילוגרם בודדים של ${it.productName}`
            : `${qty} קרטונים של ${it.productName}`
        )
      );
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
    return yemotResponse(playMessage(...parts));
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
    parts.push(prompt("point_change_offer", "לשינוי נקודת החלוקה הקש 1"));
    return yemotResponse(
      read(messages(...parts), { name: "CHPOINT", max: 1, min: 1, allowed: "1" })
    );
  }

  // בחירת עיר
  // §69: cityPhoneName - כתיב פונטי לעיר. נלקח מהנקודה הראשונה
  // שהגדירה אותו (הערך זהה לכל נקודות אותה עיר בפועל).
  const cities = await prisma.deliveryPoint.findMany({
    where: { isActive: true },
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
          max: 2,
          min: 1,
          allowed: cityList.map((_, i) => String(i + 1)).join("."),
        }
      )
    );
  }

  const city = cityList[parseInt(p.NEWCITY, 10) - 1];
  if (!city) {
    return yemotResponse(playMessage(prompt("invalid_choice", "בחירה לא חוקית")));
  }

  const pts = await prisma.deliveryPoint.findMany({
    where: { isActive: true, city },
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
          max: 2,
          min: 1,
          allowed: pts.map((_, i) => String(i + 1)).join("."),
        }
      )
    );
  } else {
    newPointId = pts[parseInt(p.NEWPOINT, 10) - 1]?.id ?? null;
  }

  if (!newPointId) {
    return yemotResponse(playMessage(prompt("invalid_choice", "בחירה לא חוקית")));
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
      const kSuffix = it.kashrut ? ` בכשרות ${it.kashrut}` : "";
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
    if (pricelist.deliveryDateText) {
      parts.push(say(`מועד החלוקה ${pricelist.deliveryDateText}`));
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
  const cats = await prisma.pricelistProduct.findMany({
    where: { pricelistId: pricelist.id, product: { isActive: true, phoneEnabled: true } },
    select: { product: { select: { categoryId: true, category: { select: { id: true, name: true } } } } },
  });
  const catMap = new Map<string, string>();
  for (const c of cats) {
    if (c.product.category) catMap.set(c.product.category.id, c.product.category.name);
  }
  const catList = Array.from(catMap.entries());

  if (catList.length === 0) {
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
  const skuCount = await prisma.pricelistProduct.count({
    where: {
      pricelistId: pricelist.id,
      product: { isActive: true, phoneEnabled: true, phoneCode: { not: null } },
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

  if (skuCount > 0 && p.ORDMODE === "1") {
    // ─── מסלול מק"ט ───
    if (!p[kSku]) {
      return yemotResponse(
        read(
          messages(
            prompt("sku_ask", "הקש את מספר המוצר מהמודעה")
          ),
          { name: kSku, max: 5, min: 1, timeout: 10, playback: "Digits" }
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
          { name: kSku, max: 5, min: 1, timeout: 10, playback: "Digits" }
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
          allowed: catList.map((_, i) => String(i + 1)).join("."),
        })
      );
    }

    const catId = catList[parseInt(p[kCat], 10) - 1]?.[0];
    if (!catId) {
      return yemotResponse(playMessage(prompt("invalid_choice", "בחירה לא חוקית")));
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
      const menu = prods.map((pp, i) => {
        const k = pp.product.kashrutRef?.name || pp.product.kashrut || "";
        const nm = pp.product.phoneName || pp.product.name;
        return say(
          k ? `ל${nm} בכשרות ${k} הקש ${i + 1}` : `ל${nm} הקש ${i + 1}`
        );
      });
      return yemotResponse(
        read(messages(prompt("choose_product", "בחר מוצר"), ...menu), {
          name: kProd,
          max: 2,
          min: 1,
          allowed: prods.map((_, i) => String(i + 1)).join("."),
        })
      );
    }

    chosen = prods[parseInt(p[kProd], 10) - 1] ?? null;
  }

  if (!chosen) {
    return yemotResponse(playMessage(prompt("invalid_choice", "בחירה לא חוקית")));
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
      if (p.ORDMODE === "1") {
        const k = prod.kashrutRef?.name || prod.kashrut || "";
        parts.push(prompt("sku_chosen", "בחרת"));
        parts.push(say(k ? `${prod.phoneName || prod.name} בכשרות ${k}` : prod.phoneName || prod.name));
      }

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
    if (p.ORDMODE === "1") {
      const k = prod.kashrutRef?.name || prod.kashrut || "";
      info.push(prompt("sku_chosen", "בחרת"));
      info.push(say(k ? `${prod.phoneName || prod.name} בכשרות ${k}` : prod.phoneName || prod.name));
    }
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
      read(messages(...info), { name: kQty, max: 3, min: 1, playback: "Number" })
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
      read(qtyPrompt, { name: kQty, max: 3, min: 1, playback: "Number" })
    );
  }

  const qty = parseInt(p[kQty], 10);
  if (!qty || qty <= 0) {
    return yemotResponse(playMessage(prompt("invalid_qty", "כמות לא חוקית")));
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
          { name: kQty, max: 3, min: 1, playback: "Number" }
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
    return yemotResponse(playMessage(prompt("no_items", "לא נבחרו מוצרים")));
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
          unit: i.isSingle ? "ק\"ג" : "קרטון",
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
