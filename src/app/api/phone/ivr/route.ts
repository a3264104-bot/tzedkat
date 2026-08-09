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
  sayNumber,
  read,
  readVoice,
  normalizePhone,
  messages,
} from "@/lib/yemot-lib";
import { effectiveUnitPrice, smartLineEstimate } from "@/lib/pricing";

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

  // ═══ תפריט ראשי ═══
  if (!p.MENU) {
    return yemotResponse(
      read(
        messages(
          say(`שלום ${customer.name}`),
          say("לביצוע הזמנה הקש 1"),
          say("לשמיעת ההזמנות שלך הקש 2"),
          say("לשמיעת נקודת החלוקה שלך הקש 3")
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
          say("שלום, המספר שלך אינו רשום במערכת"),
          say("לפתיחת חשבון הקש 1"),
          say("להשארת הודעה הקש 2")
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
      playMessage(say("הודעתך נקלטה, נחזור אליך בהקדם. תודה"))
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
      read(messages(say("בחר עיר"), ...menu), {
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
    return yemotResponse(playMessage(say("בחירה לא חוקית")));
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
      read(messages(say("בחר נקודת חלוקה"), ...menu), {
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
    return yemotResponse(playMessage(say("בחירה לא חוקית")));
  }

  // שלב 3: הקלטת שם
  if (!p.NAME) {
    return yemotResponse(
      readVoice(say("אנא אמור את שמך המלא לאחר הצליל"), "NAME")
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
      // אין הסכמה מפורשת בטלפון - נאספת כשהנציג משלים את הרישום
      agreedToEmails: false,
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
      say("החשבון נפתח בהצלחה"),
      say("לצורך אישור החשבון ועדכון פרטי האשראי נציג יחזור אליך בהקדם"),
      say("תודה ולהתראות")
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
      playMessage(say("אין כרגע מכירה פעילה"))
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
      return yemotResponse(
        playMessage(say("ההזמנה בוטלה"))
      );
    }
    return finalizeOrder(draft.id, items, customer, pricelist, callId);
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

  if (!p.CAT) {
    const menu = catList.map(([, name], i) => say(`ל${name} הקש ${i + 1}`));
    return yemotResponse(
      read(messages(say("בחר קטגוריה"), ...menu), {
        name: "CAT",
        max: 2,
        min: 1,
        allowed: catList.map((_, i) => String(i + 1)).join("."),
      })
    );
  }

  const catId = catList[parseInt(p.CAT, 10) - 1]?.[0];
  if (!catId) {
    return yemotResponse(playMessage(say("בחירה לא חוקית")));
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

  if (!p.PROD) {
    const menu = prods.map((pp, i) => say(`ל${pp.product.name} הקש ${i + 1}`));
    return yemotResponse(
      read(messages(say("בחר מוצר"), ...menu), {
        name: "PROD",
        max: 2,
        min: 1,
        allowed: prods.map((_, i) => String(i + 1)).join("."),
      })
    );
  }

  const chosen = prods[parseInt(p.PROD, 10) - 1];
  if (!chosen) {
    return yemotResponse(playMessage(say("בחירה לא חוקית")));
  }
  const prod = chosen.product;

  // ─── קרטון או בודדים ───
  let isSingle = false;
  if (prod.allowSingles) {
    if (!p.MODE) {
      return yemotResponse(
        read(
          messages(
            say("בחר אופן רכישה"),
            say("לקרטון הקש 1"),
            say("לבודדים הקש 2")
          ),
          { name: "MODE", max: 1, min: 1, allowed: "12" }
        )
      );
    }
    isSingle = p.MODE === "2";
  }

  // ─── כמות ───
  if (!p.QTY) {
    const prompt = isSingle
      ? say("כמה קילוגרם תרצה")
      : say("כמה קרטונים תרצה");
    return yemotResponse(
      read(prompt, { name: "QTY", max: 3, min: 1, playback: "Number" })
    );
  }

  const qty = parseInt(p.QTY, 10);
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
        say("להוספת מוצר נוסף הקש 1"),
        say("לסיום ההזמנה הקש 2")
      ),
      { name: "MORE", max: 1, min: 1, allowed: "12" }
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
      playMessage(say("אירעה שגיאה, נסה שוב מאוחר יותר"))
    );
  }
}

export async function POST(req: Request) {
  return GET(req);
}
