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
} from "@/lib/yemot-lib";
import { effectiveUnitPrice, smartLineEstimate } from "@/lib/pricing";
import {
  sendCustomerOrderConfirmation,
  sendAdminOrderNotification,
} from "@/lib/email";

type DraftItem = {
  productId: string;
  productName: string;
  isSingle: boolean;
  quantity: number;
  unitPrice: number;
  estimatedPrice: number;
  estimatedWeight: number | null;
};

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
      playMessage(say("אירעה שגיאה בזיהוי המספר"))
    );
  }

  // ─── זיהוי הלקוח ───
  const customer = await prisma.customer.findUnique({
    where: { phone },
    select: {
      id: true,
      name: true,
      role: true,
      paymentToken: true,
      defaultPointId: true,
      defaultPoint: { select: { id: true, name: true } },
    },
  });

  // ═══ לקוח לא רשום ═══
  if (!customer) {
    return handleUnregistered(p, phone, callId);
  }

  // ═══ לקוח ללא כרטיס מאומת ═══
  // חסום מהזמנה בדיוק כמו באתר. לא בונים כאן מסלול תשלום חלופי -
  // נציג יעדכן כרטיס והלקוח יוכל להזמין בשיחה הבאה.
  if (!customer.paymentToken) {
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
  const activeSale = await prisma.pricelist.findFirst({
    where: { status: "ACTIVE" },
    orderBy: { createdAt: "desc" },
    select: { id: true },
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

    if (p.OPEN === "1") return handleMyOrders(customer.id);
    if (p.OPEN === "2") return handleChangeRequest(openOrder.pointId);
    if (p.OPEN === "3") return handleCancelOrder(p, openOrder, customer);
    if (p.OPEN === "4") return handleMyPoint(customer);
  }

  // ═══ תפריט ראשי (אין הזמנה פתוחה) ═══
  if (!p.MENU) {
    return yemotResponse(
      read(
        messages(
          say(`שלום ${customer.name}`),
          prompt("menu_main", "לביצוע הזמנה הקש 1, לשמיעת ההזמנות שלך הקש 2, לשמיעת נקודת החלוקה שלך הקש 3")
        ),
        { name: "MENU", max: 1, min: 1, allowed: "123" }
      )
    );
  }

  if (p.MENU === "2") return handleMyOrders(customer.id);
  if (p.MENU === "3") return handleMyPoint(customer);
  return handleOrder(p, customer, callId);
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
          prompt("menu_unregistered", "שלום, המספר שלך אינו רשום במערכת. לפתיחת חשבון הקש 1, להשארת הודעה הקש 2")
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
  const cities = await prisma.deliveryPoint.findMany({
    where: { isActive: true },
    select: { city: true },
    distinct: ["city"],
    orderBy: { city: "asc" },
  });
  const cityList = cities.map((c) => c.city).filter(Boolean) as string[];

  if (!p.CITY) {
    if (cityList.length === 0) {
      return yemotResponse(
        playMessage(say("אין נקודות חלוקה פעילות כרגע"))
      );
    }
    const menu = cityList.map((c, i) => say(`ל${c} הקש ${i + 1}`));
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
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });

  let pointId: string | null = null;
  if (points.length === 1) {
    pointId = points[0].id;
  } else if (!p.POINT) {
    const menu = points.map((pt, i) => say(`ל${pt.name} הקש ${i + 1}`));
    return yemotResponse(
      read(messages(prompt("choose_point", "בחר נקודת חלוקה"), ...menu), {
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

  // שלב 3: הקלטת שם
  if (!p.NAME) {
    return yemotResponse(
      readVoice(prompt("ask_name", "אנא אמור את שמך המלא לאחר הצליל"), "NAME")
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
  const name = String(p.NAME).replace(/^Digits-/, "").trim() || "לקוח טלפוני";

  // הגנה מפני יצירה כפולה אם ימות שולחים את אותה בקשה פעמיים
  const already = await prisma.customer.findUnique({ where: { phone } });
  if (already) {
    return yemotResponse(
      playMessage(say("החשבון כבר קיים במערכת, נציג יחזור אליך"))
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

  await prisma.phoneSignupRequest.create({
    data: {
      customerId: created.id,
      phone,
      customerName: name,
      pointId,
      callId: callId || null,
      status: "NEW",
    },
  });

  return yemotResponse(
    playMessage(
      prompt("signup_done", "החשבון נפתח בהצלחה. לצורך אישור החשבון ועדכון פרטי האשראי נציג יחזור אליך בהקדם. תודה ולהתראות")
    )
  );
}

// ─────────────────────────────────────────────────────────────
// §26: בקשת שינוי הזמנה - הפניה לנציג של הנקודה
// ─────────────────────────────────────────────────────────────
// שינוי פריטים בטלפון מורכב ומועד לטעויות, ולכן הלקוח מופנה לנציג.
// אבל "פנה לנציג" בלי מספר הוא משפט ריק - במיוחד ללקוח טלפוני שאין
// לו מייל ולא נכנס לאתר. לכן מקריאים את המספר בפועל.
async function handleChangeRequest(pointId: string): Promise<Response> {
  // הנציגים של הנקודה. many-to-many, עם נפילה לשיוך הישן.
  const links = await prisma.agentPoint.findMany({
    where: { pointId },
    select: { agent: { select: { name: true, phone: true } } },
    take: 3,
  });
  let agents = links.map((l) => l.agent).filter((a) => a?.phone);

  if (agents.length === 0) {
    const legacy = await prisma.customer.findMany({
      where: { role: "AGENT", agentPointId: pointId },
      select: { name: true, phone: true },
      take: 3,
    });
    agents = legacy.filter((a) => a.phone);
  }

  if (agents.length === 0) {
    return yemotResponse(
      playMessage(
        prompt(
          "change_no_agent",
          "לשינוי ההזמנה יש לפנות לנציג. לא נמצא נציג משויך לנקודה שלך, אנא פנה למוקד"
        )
      )
    );
  }

  const parts: string[] = [
    prompt("change_via_agent", "לשינוי ההזמנה יש לפנות לנציג של נקודת החלוקה שלך"),
  ];
  for (const a of agents) {
    if (a.name) parts.push(say(`הנציג ${a.name}`));
    parts.push(prompt("agent_phone_is", "מספר הטלפון"));
    // ספרה-ספרה, אחרת המנוע יקריא "חמש מאות שלושים ואלפיים" וזה לא ניתן לרישום
    parts.push(sayDigits(String(a.phone).replace(/\D/g, "")));
  }

  return yemotResponse(playMessage(...parts));
}

// ─────────────────────────────────────────────────────────────
// §26: ביטול הזמנה
// ─────────────────────────────────────────────────────────────
// ביטול בטוח לביצוע בטלפון: הוא לא יוצר חיוב והוא הפיך - הלקוח יכול
// להזמין מחדש מיד. לכן מאפשרים אותו, בניגוד לעריכה.
// דורש אישור כפול כדי שהקשה מקרית לא תמחק הזמנה.
async function handleCancelOrder(
  p: Record<string, string>,
  order: { id: string; orderNumber: number; status: string },
  customer: any
): Promise<Response> {
  // הזמנה ששולמה כבר - לא מבטלים בטלפון, צריך החזר כספי
  if (order.status === "PAID" || order.status === "COMPLETED") {
    return yemotResponse(
      playMessage(
        prompt(
          "cancel_paid",
          "לא ניתן לבטל בטלפון הזמנה ששולמה. אנא פנה לנציג"
        )
      )
    );
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
async function handleMyOrders(customerId: string): Promise<Response> {
  const orders = await prisma.order.findMany({
    where: { customerId, status: { notIn: ["CANCELLED"] } },
    orderBy: { createdAt: "desc" },
    take: 3,
    select: {
      orderNumber: true,
      status: true,
      estimatedTotal: true,
      finalTotal: true,
      pointNameSnapshot: true,
      deliveryDateSnapshot: true,
    },
  });

  if (orders.length === 0) {
    return yemotResponse(
      playMessage(say("אין לך הזמנות במערכת"))
    );
  }

  const parts: string[] = [];
  for (const o of orders) {
    const total = o.finalTotal != null ? Number(o.finalTotal) : Number(o.estimatedTotal);
    const isFinal = o.finalTotal != null;
    parts.push(say(`הזמנה מספר`));
    parts.push(sayNumber(o.orderNumber));
    parts.push(say(isFinal ? "סכום סופי" : "סכום משוער"));
    parts.push(sayNumber(Math.round(total)));
    parts.push(say("שקלים"));
    if (o.pointNameSnapshot) parts.push(say(`בנקודה ${o.pointNameSnapshot}`));
    if (o.deliveryDateSnapshot) parts.push(say(`בתאריך ${o.deliveryDateSnapshot}`));
  }

  return yemotResponse(playMessage(...parts));
}

// ─────────────────────────────────────────────────────────────
// נקודת החלוקה שלי
// ─────────────────────────────────────────────────────────────
async function handleMyPoint(customer: any): Promise<Response> {
  if (!customer.defaultPoint) {
    return yemotResponse(
      playMessage(say("לא הוגדרה עבורך נקודת חלוקה, נציג יחזור אליך"))
    );
  }
  return yemotResponse(
    playMessage(
      say(`נקודת החלוקה שלך היא ${customer.defaultPoint.name}`),
      say("לשינוי נקודת החלוקה יש לפנות לנציג")
    )
  );
}

// ─────────────────────────────────────────────────────────────
// ביצוע הזמנה
// ─────────────────────────────────────────────────────────────
async function handleOrder(
  p: Record<string, string>,
  customer: any,
  callId: string
): Promise<Response> {
  // המכירה הפעילה - בדיוק אותה מכירה של האתר
  const pricelist = await prisma.pricelist.findFirst({
    where: { status: "ACTIVE" },
    orderBy: { createdAt: "desc" },
    select: { id: true, name: true, closeDate: true, openDate: true, singleSurcharge: true },
  });

  if (!pricelist) {
    return yemotResponse(
      playMessage(prompt("no_sale", "אין כרגע מכירה פעילה"))
    );
  }
  const now = new Date();
  if (pricelist.closeDate && now > pricelist.closeDate) {
    return yemotResponse(
      playMessage(say("מועד ההרשמה למכירה הסתיים"))
    );
  }
  if (pricelist.openDate && now < pricelist.openDate) {
    return yemotResponse(
      playMessage(say("ההרשמה למכירה טרם נפתחה"))
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
    return yemotResponse(
      playMessage(
        say("כבר קיימת לך הזמנה במכירה זו"),
        say("לשינוי ההזמנה יש לפנות לנציג")
      )
    );
  }

  if (!customer.defaultPointId) {
    return yemotResponse(
      playMessage(say("לא הוגדרה עבורך נקודת חלוקה, נציג יחזור אליך"))
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
    const plFee = await prisma.pricelist.findUnique({
      where: { id: pricelist.id },
      select: { orderFee: true, deliveryDateText: true },
    });
    const orderFee = Number(plFee?.orderFee || 0);
    const total =
      Math.round((items.reduce((a, i) => a + i.estimatedPrice, 0) + orderFee) * 100) / 100;

    const parts: string[] = [prompt("summary_intro", "סיכום ההזמנה שלך")];

    for (const it of items) {
      parts.push(
        say(
          it.isSingle
            ? `${it.quantity} קילוגרם בודדים של ${it.productName}`
            : it.quantity === 1
              ? `קרטון אחד של ${it.productName}`
              : `${it.quantity} קרטונים של ${it.productName}`
        )
      );
    }

    // ד': פרטי הנקודה - באתר הלקוח רואה כתובת ושעות, בטלפון הוא שמע רק שם
    if (point?.name) {
      parts.push(say(`נקודת החלוקה שלך ${point.name}`));
      if (point.address) parts.push(say(`בכתובת ${point.address}`));
      if (point.deliveryHours) parts.push(say(`שעות החלוקה ${point.deliveryHours}`));
    }
    if (plFee?.deliveryDateText) {
      parts.push(say(`מועד החלוקה ${plFee.deliveryDateText}`));
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
      playMessage(say("אין מוצרים זמינים להזמנה טלפונית"))
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
    include: {
      product: {
        select: {
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
        },
      },
    },
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
      playMessage(say("אין מוצרים בקטגוריה זו"))
    );
  }

  if (!p[kProd]) {
    const menu = prods.map((pp, i) => say(`ל${pp.product.name} הקש ${i + 1}`));
    return yemotResponse(
      read(messages(prompt("choose_product", "בחר מוצר"), ...menu), {
        name: kProd,
        max: 2,
        min: 1,
        allowed: prods.map((_, i) => String(i + 1)).join("."),
      })
    );
  }

  const chosen = prods[parseInt(p[kProd], 10) - 1];
  if (!chosen) {
    return yemotResponse(playMessage(prompt("invalid_choice", "בחירה לא חוקית")));
  }
  const prod = chosen.product;

  // ─── קרטון או בודדים ───
  let isSingle = false;
  if (prod.allowSingles) {
    if (!p[kMode]) {
      return yemotResponse(
        read(
          messages(
            prompt("choose_mode", "בחר אופן רכישה: לקרטון הקש 1, לבודדים הקש 2")
          ),
          { name: kMode, max: 1, min: 1, allowed: "12" }
        )
      );
    }
    isSingle = p[kMode] === "2";
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
    return yemotResponse(playMessage(say("כמות לא חוקית")));
  }

  // ─── חישוב מחיר - בדיוק כמו באתר ───
  const base = Number(chosen.price ?? prod.cartonPrice);
  const surcharge = Number(pricelist.singleSurcharge);
  const unitPrice = effectiveUnitPrice(
    base,
    isSingle,
    surcharge,
    prod.singlesMode,
    prod.singleUnitPrice != null ? Number(prod.singleUnitPrice) : null
  );
  const avgWeight = prod.avgWeightPerUnit != null ? Number(prod.avgWeightPerUnit) : null;
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
    confirmParts.push(say("במשקל משוער של"));
    confirmParts.push(sayNumber(Math.round(estWeight)));
    confirmParts.push(say("קילוגרם"));
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
  pricelist: any,
  callId: string
): Promise<Response> {
  if (items.length === 0) {
    return yemotResponse(playMessage(say("לא נבחרו מוצרים")));
  }

  // הגנה מפני יצירה כפולה - ימות עלולים לשלוח את אותה בקשה שוב
  const draft = await prisma.phoneOrderDraft.findUnique({
    where: { id: draftId },
    select: { orderId: true, completedAt: true },
  });
  if (draft?.orderId) {
    return yemotResponse(
      playMessage(say("ההזמנה כבר נקלטה"))
    );
  }

  const point = await prisma.deliveryPoint.findUnique({
    where: { id: customer.defaultPointId },
    select: { id: true, name: true, customDeliveryDateText: true },
  });
  const plFull = await prisma.pricelist.findUnique({
    where: { id: pricelist.id },
    select: { name: true, deliveryDateText: true, orderFee: true },
  });

  const orderFee = Number(plFull?.orderFee || 0);
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
        point?.customDeliveryDateText || plFull?.deliveryDateText || null,
      pricelistNameSnapshot: plFull?.name ?? null,
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

  return yemotResponse(
    playMessage(
      say("ההזמנה נקלטה בהצלחה"),
      say("מספר ההזמנה שלך"),
      sayNumber(order.orderNumber),
      say("סכום משוער"),
      sayNumber(Math.round(total)),
      say("שקלים"),
      say("המחיר הסופי ייקבע לאחר שקילה"),
      say("תודה ולהתראות")
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
