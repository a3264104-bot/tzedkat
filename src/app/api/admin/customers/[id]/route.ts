// PATCH /api/admin/customers/[id]
// עדכון פרטי לקוח + הרשאות נציג
//
// שדות נתמכים:
//   - name, email, phone (נתונים בסיסיים)
//   - passwordPlain (סיסמה גלויה למנהל, המנהל יכול לאפס)
//   - agentPointId (נקודת חלוקה משויכת - רק לנציג)
//   - agentCanSetFinalPrice, agentCanSendPaymentLink, agentCanCharge, agentCanUpdateCards (הרשאות נציג)
//   - cardNeedsUpdate (סימון שנדרש עדכון כרטיס)
//   - paymentPreference (§60: CASH / CREDIT. מעבר ל-CREDIT מחייב טוקן קיים)

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/guard";
// §114: הפקת קוד אוטומטית בהקמת לקוח
import { ensureLoginCode } from "@/lib/login-code";
import { auth } from "@/lib/auth";
import bcrypt from "bcryptjs";

const ALLOWED_FIELDS = [
  "name",
  "email",
  "phone",
  "notes",
  "agentPointId",
  "agentCanSetFinalPrice",
  "agentCanSendPaymentLink",
  "agentCanCharge",
  "agentCanUpdateCards",
  // §155: הקמת לקוחות מזומן
  "agentCanCreateCashCustomers",
  "cardNeedsUpdate",
  // §52: הפעלה/השבתה של לקוח
  "isActive",
  "deactivatedReason",
  // §145: 🐛 בלי זה השדה נשלח מהמסך ונזרק בשקט - הצ'קבוקס
  // היה מסומן, ההודעה "נשמר" הופיעה, וברענון הכל חזר לאחור.
  "wantsExcelOrder",
  // §173: שם פרטי ומשפחה
  "firstName",
  "lastName",
] as const;

// §24: נציג עם הרשאת agentCanResetPassword יכול לאפס סיסמה ללקוח -
// ורק את זה. הצורך: לקוח שנרשם בטלפון מקבל סיסמה אקראית שאיש לא יודע,
// ולרוב אין לו מייל, כך ש"שכחתי סיסמה" לא עוזר. הנציג ממילא מדבר איתו
// כדי לעדכן כרטיס, ובאותה שיחה יכול למסור סיסמה.
//
// ההגבלות: רק passwordPlain (לא שם/טלפון/הרשאות), ורק ללקוח בנקודות
// של הנציג. כל שדה אחר בבקשה נדחה.
async function resolveActor(body: any) {
  const admin = await requireAdmin();
  if (admin.ok) return { ok: true as const, isAdmin: true, agentId: null as string | null };

  const session = await auth();
  const role = (session?.user as any)?.role;
  const userId = (session?.user as any)?.id as string | undefined;
  if (!session?.user || role !== "AGENT" || !userId) {
    return { ok: false as const, res: admin.res };
  }

  const agent = await prisma.customer.findUnique({
    where: { id: userId },
    select: {
      agentCanResetPassword: true,
      // §155: הרשאת סימון מזומן
      agentCanCreateCashCustomers: true,
    },
  });

  // §181: שדות שהנציג רשאי לעדכן מתוך ההזמנה.
  //
  // 🐛 מה שהיה: "נציג רשאי לאפס סיסמה בלבד". הנציג פגש את הלקוח
  // בחלוקה, גילה שהטלפון שגוי - ולא יכול היה לתקן. הוא היה
  // צריך לפנות למנהל, וברוב המקרים פשוט ויתר. הנתון נשאר שגוי.
  //
  // ⚠️ מה **לא** ברשימה בכוונה: נקודת חלוקה (משנה למי הלקוח
  // שייך), הרשאות, מייל (מזהה כניסה), והשבתה. אלה החלטות של
  // המנהל, ופתיחתן לנציג הייתה מייצרת נזק שקשה לאתר.
  const AGENT_EDITABLE = [
    "name",
    "firstName",
    "lastName",
    "phone",
    "phone2",
    // ⚠️ paymentPreference נבדק בנפרד למטה - הוא דורש הרשאה
    // ומותר רק לכיוון מזומן.
    "paymentPreference",
    "passwordPlain",
    "newPassword",
  ];

  const keys = Object.keys(body);
  const forbidden = keys.filter((k) => !AGENT_EDITABLE.includes(k));
  if (forbidden.length > 0) {
    return {
      ok: false as const,
      res: NextResponse.json(
        {
          error: `נציג אינו רשאי לעדכן: ${forbidden.join(", ")}. יש לפנות למנהל.`,
        },
        { status: 403 }
      ),
    };
  }

  // ⚠️ איפוס סיסמה עדיין דורש הרשאה נפרדת - היא קיימת מזמן
  // ומשמעותה גישה לחשבון הלקוח.
  const wantsPassword = "passwordPlain" in body || "newPassword" in body;
  if (wantsPassword && !agent?.agentCanResetPassword) {
    return { ok: false as const, res: admin.res };
  }

  if (keys.length === 0) {
    return {
      ok: false as const,
      res: NextResponse.json({ error: "אין שדות לעדכון" }, { status: 400 }),
    };
  }

  return { ok: true as const, isAdmin: false, agentId: userId };
}

// ═══════════════════════════════════════════════════════════════
// §150: שליפת לקוח בודד לפי מזהה
// ═══════════════════════════════════════════════════════════════
// GET /api/admin/customers/[id]
//
// למה: פתיחת כרטיס לקוח מקישור ישיר (§109) הייתה תלויה בכך
// שהחיפוש ברשימה יחזיר אותו. פורמט טלפון שונה, לקוח מושבת, או
// רשימה חתוכה (§127) - וכל אחד מהם שבר את זה בשקט.
//
// ⚠️ אותו מבנה תשובה כמו ברשימה, כדי שהקליינט יוכל להשתמש בו
// ישירות בלי המרה. שדות שונים בין שני המקורות היו מייצרים מודל
// עריכה חלקי שנראה תקין.
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const g = await requireAdmin();
  if (!g.ok) return g.res;

  const { id } = await params;

  const c = await prisma.customer.findUnique({
    where: { id },
    include: {
      defaultPoint: { select: { name: true, city: true } },
      _count: { select: { orders: true } },
      agentPoints: {
        select: { point: { select: { id: true, name: true, city: true } } },
      },
    },
  });

  if (!c) {
    return NextResponse.json({ error: "לקוח לא נמצא" }, { status: 404 });
  }

  return NextResponse.json({
    id: c.id,
    name: c.name,
    phone: c.phone,
    email: c.email,
    city: c.defaultPoint?.city ?? null,
    pointName: c.defaultPoint?.name ?? null,
    orderCount: c._count.orders,
    hasPaymentToken: !!c.paymentToken,
    cardLast4: c.cardLast4,
    cardExpiry: c.cardExpiry,
    cardNeedsUpdate: c.cardNeedsUpdate,
    defaultPointId: c.defaultPointId,
    passwordPlain: c.passwordPlain,
    hasLoginCode: !!c.loginCode,
    hasPassword: !!c.passwordHash,
    wantsExcelOrder: !!c.wantsExcelOrder,
    // §173: שם פרטי ומשפחה
    firstName: c.firstName ?? null,
    lastName: c.lastName ?? null,
    creditBalance: Number(c.creditBalance ?? 0),
    loginCodeSetAt: c.loginCodeSetAt,
    lockedUntil: c.lockedUntil,
    failedLoginAttempts: c.failedLoginAttempts,
    paymentPreference: c.paymentPreference,
    role: c.role,
    agentPointId: c.agentPointId,
    agentPoints: c.agentPoints.map((ap) => ap.point),
    agentCanSetFinalPrice: c.agentCanSetFinalPrice,
    agentCanSendPaymentLink: c.agentCanSendPaymentLink,
    agentCanCharge: c.agentCanCharge,
    agentCanUpdateCards: c.agentCanUpdateCards,
    // §155: הרשאת הקמת לקוחות מזומן
    agentCanCreateCashCustomers: c.agentCanCreateCashCustomers,
    isActive: c.isActive,
    deactivatedAt: c.deactivatedAt,
    deactivatedReason: c.deactivatedReason,
    createdAt: c.createdAt,
  });
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await req.json().catch(() => ({}));

  const actor = await resolveActor(body);
  if (!actor.ok) return actor.res;

  // נציג - מוודאים שהלקוח שייך לאחת מנקודותיו
  if (!actor.isAdmin && actor.agentId) {
    const agent = await prisma.customer.findUnique({
      where: { id: actor.agentId },
      select: {
        agentPointId: true,
        agentPoints: { select: { pointId: true } },
      },
    });
    const pointIds =
      agent && agent.agentPoints.length > 0
        ? agent.agentPoints.map((ap) => ap.pointId)
        : agent?.agentPointId
          ? [agent.agentPointId]
          : [];
    if (pointIds.length > 0) {
      const target = await prisma.customer.findUnique({
        where: { id },
        select: { defaultPointId: true },
      });
      const belongs =
        (target?.defaultPointId != null && pointIds.includes(target.defaultPointId)) ||
        (await prisma.order.count({
          where: { customerId: id, pointId: { in: pointIds } },
        })) > 0;
      if (!belongs) {
        return NextResponse.json(
          { error: "אין הרשאה - הלקוח אינו משויך לנקודות שלך" },
          { status: 403 }
        );
      }
    }
  }

  const data: any = {};
  // §90: אזהרה שמוחזרת למסך - לא שדה במסד. חייבת להיות מחוץ
  // ל-data, אחרת Prisma נופל על שדה לא מוכר.
  let prefWarning: string | null = null;
  // §114: הקוד שהופק אוטומטית, אם הופק. מוחזר למסך כדי שהמנהל
  // יוכל למסור אותו ללקוח מיד ולא יצטרך לחפש אותו אחר כך.
  let generatedCode: string | null = null;

  // §151: 🐛 שינוי סיסמה לא עבד כלל.
  //
  // מסך הלקוחות שולח `newPassword`, ואף route לא קלט אותו. המנהל
  // הזין סיסמה חדשה, ראה "נשמר! מסור ללקוח את הסיסמה", והלקוח
  // ניסה להיכנס איתה ונכשל - כי היא מעולם לא נשמרה.
  //
  // ⚠️ נשמרת פעמיים: hash לאימות, וגלוי לתצוגה. הלקוח מתקשר
  // ואומר "שכחתי", והמנהל צריך לענות בלי לאפס.
  if (body.newPassword) {
    const pw = String(body.newPassword);
    if (pw.length < 4) {
      return NextResponse.json(
        { error: "הסיסמה חייבת להיות באורך 4 תווים לפחות" },
        { status: 400 }
      );
    }
    data.passwordHash = await bcrypt.hash(pw, 10);
    data.passwordPlain = pw;
    // ⚠️ ניקוי נעילה: מנהל שמשנה סיסמה עושה את זה כדי שהלקוח
    // ייכנס. נעילה שנשארה הייתה חוסמת אותו מיד אחרי.
    data.failedLoginAttempts = 0;
    data.lockedUntil = null;
  }

  // §82: נקודת חלוקה של הלקוח.
  //
  // 🐛 השדה לא היה מטופל כאן כלל - מסך הלקוחות יכול היה לשלוח
  // אותו, והשרת התעלם בשקט. המנהל היה משנה נקודה, רואה "נשמר",
  // והשינוי לא היה קיים.
  //
  // מנהל בלבד: שיוך לקוח לנקודה קובע לאיזה נציג הוא שייך ומי
  // מקבל עמלה עליו.
  if ("defaultPointId" in body) {
    if (!actor.isAdmin) {
      return NextResponse.json(
        { error: "רק מנהל רשאי לשנות נקודת חלוקה של לקוח" },
        { status: 403 }
      );
    }
    const pid = body.defaultPointId ? String(body.defaultPointId) : null;
    if (pid) {
      const exists = await prisma.deliveryPoint.findUnique({
        where: { id: pid },
        // §163: isPrivate - כדי להחזיר חיווי למסך.
        //
        // ⚠️ השיוך עצמו **מותר**: זו כל מטרת הנקודה הסמויה -
        // המנהל משייך אליה לקוח שיש לו חנות. מה שחסום הוא שהלקוח
        // יבחר בה בעצמו, וזה נאכף בסינון שבמסך ההזמנה.
        select: { id: true, name: true, isPrivate: true },
      });
      if (!exists) {
        return NextResponse.json(
          { error: "נקודת החלוקה שנבחרה אינה קיימת" },
          { status: 400 }
        );
      }
    }
    data.defaultPointId = pid;
  }

  // §90: אופן תשלום - מזומן או אשראי, לבחירת המנהל.
  //
  // 🐛 החסימה שהוסרה: §60 חסם מעבר ל-CREDIT ללקוח בלי כרטיס
  // בטענה "אין מצב ביניים אשראי בלי כרטיס". הטענה הייתה שגויה -
  // זהו בדיוק המצב ההתחלתי של **כל** לקוח חדש: CREDIT בלי טוקן,
  // חסום מהזמנה עד שיוזן כרטיס (§61 אוכף את זה).
  //
  // התוצאה בפועל: מנהל שסימן לקוח כמזומן נתקע - הוא לא יכול היה
  // לבטל את הסימון בלי להזין כרטיס שאין לו. לקוח שהוגדר בטעות
  // כמזומן נשאר כזה לנצח.
  //
  // עכשיו: המנהל מחליט. מעבר ל-CREDIT בלי כרטיס הוא מצב תקף
  // שמשמעותו "הלקוח חייב להסדיר אשראי לפני שיוכל להזמין".
  if ("paymentPreference" in body) {
    const pref = body.paymentPreference;
    if (pref !== "CASH" && pref !== "CREDIT") {
      return NextResponse.json(
        { error: "אופן תשלום לא תקין - יש לבחור מזומן או אשראי" },
        { status: 400 }
      );
    }
    // §155: נציג עם הרשאה יכול לסמן לקוח כמזומן.
    //
    // 🐛 מה שהיה: חסימה מוחלטת לנציג. התוצאה - נציג פגש לקוח בלי
    // כרטיס בחלוקה, לא יכול היה לסמן אותו כמזומן, והלקוח לא הצליח
    // להזמין בפעם הבאה. כל מקרה כזה הגיע אליך.
    //
    // ⚠️ **רק לכיוון מזומן.** מעבר לאשראי דורש טוקן קיים ונשאר
    // אצל המנהל - זה מסלול שיכול לנעול לקוח מחוץ למערכת.
    if (!actor.isAdmin) {
      if (pref !== "CASH") {
        return NextResponse.json(
          { error: "נציג רשאי לסמן לקוח כמזומן בלבד. מעבר לאשראי נעשה ע\"י המנהל." },
          { status: 403 }
        );
      }
      const perm = actor.agentId
        ? await prisma.customer.findUnique({
            where: { id: actor.agentId },
            select: { agentCanCreateCashCustomers: true },
          })
        : null;
      if (!perm?.agentCanCreateCashCustomers) {
        return NextResponse.json(
          {
            error:
              "אין לך הרשאה לסמן לקוחות כמזומן. יש לפנות למנהל.",
            code: "NO_CASH_PERMISSION",
          },
          { status: 403 }
        );
      }
    }

    // ⚠️ אזהרה ולא חסימה: מעבר מ-CASH ל-CREDIT בזמן שיש הזמנות
    // פתוחות שנפתחו כמזומן. ההזמנות עצמן אינן משתנות - אבל המנהל
    // צריך לדעת שהן ימתינו לחיוב בכרטיס שעדיין לא קיים.
    let warning: string | null = null;
    if (pref === "CREDIT") {
      const target = await prisma.customer.findUnique({
        where: { id },
        select: {
          paymentToken: true,
          _count: {
            select: {
              orders: { where: { status: { notIn: ["CANCELLED", "COMPLETED"] } } },
            },
          },
        },
      });
      if (!target?.paymentToken) {
        warning =
          target && target._count.orders > 0
            ? `הלקוח הועבר לאשראי ואין לו כרטיס שמור. יש לו ${target._count.orders} הזמנות פתוחות שימתינו לחיוב, והוא לא יוכל לפתוח הזמנות חדשות עד שיוזן כרטיס.`
            : "הלקוח הועבר לאשראי ואין לו כרטיס שמור. הוא לא יוכל להזמין עד שיוזן כרטיס.";
      }
    }
    prefWarning = warning;

    data.paymentPreference = pref;

    // §114: סימון כלקוח מזומן = הלקוח הוקם ויכול להזמין. זה הרגע
    // שבו הוא צריך גם דרך להיכנס לאתר, ולכן הקוד מופק כאן.
    //
    // ⚠️ רק בכיוון CASH: מעבר ל-CREDIT בלי כרטיס משאיר אותו חסום
    // (§90), ואין טעם בקוד למי שלא יכול להזמין. כשיוזן הכרטיס -
    // save-token יפיק את הקוד.
    if (pref === "CASH") {
      generatedCode = await ensureLoginCode(prisma, id);
    }

    // §61: סימון כמזומן הוא השלמת הטיפול בבקשת ההרשמה הטלפונית -
    // אין כרטיס לאמת, הגבייה מוסדרת. בלי זה הבקשה נשארת "ממתינה"
    // לנצח והמנהל רואה לקוח שכבר טופל כתקוע. אותו היגיון כמו
    // ב-/api/agent/customer-payment-pref ובשמירת טוקן (§56).
    if (pref === "CASH") {
      const closed = await prisma.phoneSignupRequest.updateMany({
        where: { customerId: id, status: { notIn: ["COMPLETED"] } },
        data: { status: "COMPLETED", completedAt: new Date() },
      });
      if (closed.count > 0) {
        console.log(
          `[admin-customer-update] closed ${closed.count} phone signup request(s) for customer=${id} (marked as CASH)`
        );
      }
    }
  }

  // §52: חותמת הזמן של ההשבתה נגזרת מהשדה ולא נשלחת מהלקוח -
  // כדי שלא ניתן יהיה לזייף אותה, ושהיא תמיד תשקף את המציאות.
  if ("isActive" in body) {
    data.deactivatedAt = body.isActive === false ? new Date() : null;
    if (body.isActive !== false) data.deactivatedReason = null;
  }

  // שדות רגילים
  for (const field of ALLOWED_FIELDS) {
    if (field in body) {
      data[field] = body[field];
    }
  }

  // איפוס סיסמה - passwordPlain עם ערך אמיתי
  if ("passwordPlain" in body && body.passwordPlain) {
    const plain = String(body.passwordPlain).trim();
    if (plain.length < 6) {
      return NextResponse.json(
        { error: "סיסמה חייבת להיות באורך 6 תווים לפחות" },
        { status: 400 }
      );
    }
    data.passwordPlain = plain;
    data.passwordHash = await bcrypt.hash(plain, 10);
    // אם המנהל מאפס, אנחנו סוגרים גם reset token אם היה
    data.resetToken = null;
    data.resetTokenExpiry = null;
  }

  // אימות מייל אם עודכן
  if ("email" in body && body.email) {
    const email = String(body.email).toLowerCase().trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return NextResponse.json({ error: "מייל לא תקין" }, { status: 400 });
    }
    // בדיקת כפילות
    const existing = await prisma.customer.findUnique({ where: { email } });
    if (existing && existing.id !== id) {
      return NextResponse.json(
        { error: "המייל כבר בשימוש ע\"י לקוח אחר" },
        { status: 409 }
      );
    }
    data.email = email;
  }

  // אימות טלפון אם עודכן
  if ("phone" in body && body.phone) {
    const digits = String(body.phone).replace(/\D/g, "");
    const phone = digits.startsWith("972") ? "0" + digits.slice(3) : digits;
    if (phone.length < 9 || phone.length > 10) {
      return NextResponse.json({ error: "מספר טלפון לא תקין" }, { status: 400 });
    }
    const existing = await prisma.customer.findUnique({ where: { phone } });
    if (existing && existing.id !== id) {
      return NextResponse.json(
        { error: "הטלפון כבר בשימוש ע\"י לקוח אחר" },
        { status: 409 }
      );
    }
    data.phone = phone;
  }

  // 🆕 טיפול מיוחד ב-agentPointIds (many-to-many)
  // הclient שולח מערך של pointIds. אנחנו מוחקים את כל הקשרים הקיימים
  // של הנציג ויוצרים מחדש. כך גם הוספה וגם הסרה מטופלות באותה הפעולה.
  // זה מבוצע בטרנזקציה - אם משהו נכשל, אין שינוי חלקי.
  let agentPointIds: string[] | null = null;
  if ("agentPointIds" in body) {
    if (!Array.isArray(body.agentPointIds)) {
      return NextResponse.json(
        { error: "agentPointIds חייב להיות מערך" },
        { status: 400 }
      );
    }
    // דה-דופלוקציה + סינון strings בלבד
    agentPointIds = Array.from(
      new Set(
        body.agentPointIds
          .filter((x: unknown) => typeof x === "string" && x.trim().length > 0)
          .map((x: string) => x.trim())
      )
    );
  }

  if (Object.keys(data).length === 0 && agentPointIds === null) {
    return NextResponse.json({ error: "אין שדות לעדכון" }, { status: 400 });
  }

  try {
    // אם יש עדכון של רשימת נקודות - עושים בטרנזקציה
    if (agentPointIds !== null) {
      // וידוא שכל pointIds תקינים לפני מחיקה
      if (agentPointIds.length > 0) {
        const foundPoints = await prisma.deliveryPoint.findMany({
          where: { id: { in: agentPointIds } },
          select: { id: true },
        });
        if (foundPoints.length !== agentPointIds.length) {
          return NextResponse.json(
            { error: "אחת מנקודות החלוקה שצוינו לא קיימת" },
            { status: 400 }
          );
        }

        // §70: נקודת חלוקה שייכת לנציג אחד בלבד.
        //
        // למה זה נאכף בקוד ולא כאינדקס ייחודי במסד: הטבלה נבנתה
        // כ-many-to-many (נציג אחד ↔ כמה נקודות), והכיוון ההפוך פתוח
        // מבחינה מבנית. הוספת @@unique([pointId]) הייתה מיגרציה
        // שנכשלת אם קיימת כבר כפילות, ובלי הודעה שאומרת *מי* תופס.
        //
        // ההודעה נוקבת בשם הנציג והנקודה בכוונה: "הנקודה תפוסה"
        // מותיר את המנהל לחפש ידנית מי מתוך עשרות הנציגים.
        //
        // ⚠️ הכלל חל על **נציגים בלבד**. מנהל יכול להיות רשום בכמה
        // נקודות במקביל, והוא גם אינו חוסם נציג מלהשתייך לאותה נקודה -
        // הוא נוכח שם בתפקיד ניהולי ולא כנציג המקבל עמלה.
        //
        // לכן שתי הבדיקות:
        //   1. אם *הנערך* הוא מנהל - לא בודקים כלל.
        //   2. התנגשות נספרת רק מול נציג (role=AGENT) קיים.
        const target = await prisma.customer.findUnique({
          where: { id },
          select: { role: true },
        });
        const conflicts =
          target?.role === "ADMIN"
            ? []
            : await prisma.agentPoint.findMany({
                where: {
                  pointId: { in: agentPointIds },
                  NOT: { agentId: id },
                  agent: { role: "AGENT" },
                },
                select: {
                  agent: { select: { id: true, name: true } },
                  point: { select: { name: true, city: true } },
                },
              });
        if (conflicts.length > 0) {
          const list = conflicts
            .map(
              (c) =>
                `${c.point.name}${c.point.city ? ` (${c.point.city})` : ""} — משויכת ל${c.agent.name}`
            )
            .join("; ");
          return NextResponse.json(
            {
              error: `לא ניתן לשייך: ${list}. יש להסיר את השיוך הקיים תחילה.`,
              code: "POINT_TAKEN",
              conflicts: conflicts.map((c) => ({
                agentId: c.agent.id,
                agentName: c.agent.name,
                pointName: c.point.name,
              })),
            },
            { status: 409 }
          );
        }
      }
      const customer = await prisma.$transaction(async (tx) => {
        // מחיקת כל הקשרים הקיימים של הנציג
        await tx.agentPoint.deleteMany({ where: { agentId: id } });
        // יצירת הקשרים החדשים
        if (agentPointIds!.length > 0) {
          await tx.agentPoint.createMany({
            data: agentPointIds!.map((pid) => ({
              agentId: id,
              pointId: pid,
            })),
          });
        }
        // עדכון שאר השדות (אם יש)
        if (Object.keys(data).length > 0) {
          return tx.customer.update({ where: { id }, data });
        }
        return tx.customer.findUnique({ where: { id } });
      });
      return NextResponse.json({ ok: true, customer, warning: prefWarning, generatedCode });
    }
    // עדכון רגיל (בלי שינוי נקודות)
    const customer = await prisma.customer.update({
      where: { id },
      data,
    });
    return NextResponse.json({ ok: true, customer, warning: prefWarning, generatedCode });
  } catch (e: any) {
    console.error("customer update error:", e);
    return NextResponse.json({ error: e.message || "שגיאה" }, { status: 500 });
  }
}

// DELETE /api/admin/customers/[id]
// מחיקת לקוח (רק אם אין לו הזמנות)
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const g = await requireAdmin();
  if (!g.ok) return g.res;

  const { id } = await params;

  const orderCount = await prisma.order.count({ where: { customerId: id } });
  if (orderCount > 0) {
    return NextResponse.json(
      {
        error: `לא ניתן למחוק - יש ${orderCount} הזמנות ללקוח. ניתן להשבית במקום.`,
      },
      { status: 409 }
    );
  }

  await prisma.customer.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
