// §54: יצירת לקוח על ידי המנהל.
//
// POST   /api/admin/customer-create  — יצירת לקוח חדש
// GET    /api/admin/customer-create?phone=X — חיפוש לפי טלפון
//
// למה endpoint נפרד מזה של הנציג: לנציג יש נקודת חלוקה משלו, והלקוח
// משויך אליה אוטומטית. למנהל אין נקודה - הוא חייב לבחור אחת במפורש,
// אחרת הלקוח נשאר בלי נקודה ולא יוכל להזמין.

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
// §167: סגירת פניות טלפוניות פתוחות בהקמת לקוח
import { closeOpenRequestsForPhone } from "@/lib/close-requests-lib";
// §121: הפקת קוד כניסה אוטומטית בכל יצירת לקוח
import { ensureLoginCode } from "@/lib/login-code";
import { requireAdmin } from "@/lib/guard";
import bcrypt from "bcryptjs";
import { normalizePhone, isValidPhone, cleanName } from "@/lib/identity";
// §162: חוסם טלפון נוסף שכבר משמש לזיהוי של לקוח אחר
import { validatePhone2 } from "@/lib/phone2-lib";

// סיסמה קריאה: בלי תווים שקל לבלבל (0/O, 1/l) - היא נמסרת בטלפון
function generatePassword(): string {
  const letters = "abcdefghjkmnpqrstuvwxyz";
  const numbers = "23456789";
  let out = "";
  for (let i = 0; i < 4; i++) out += letters[Math.floor(Math.random() * letters.length)];
  for (let i = 0; i < 4; i++) out += numbers[Math.floor(Math.random() * numbers.length)];
  return out;
}

// §71: 🐛 כאן היה הבאג. הנירמול המקומי הסיר רק רווחים, מקפים
// וסוגריים - אבל **לא** המיר קידומת 972 ולא הסיר את ה-"+".
// לקוח שהוזן ע"י מנהל כ-"+972501234567" ולקוח שנרשם באתר כ-
// "0501234567" הם אותו אדם עם שתי מחרוזות שונות, ולכן ה-@unique
// של המסד לא חסם ונוצרה כפילות.
//
// עכשיו כל מסלולי היצירה עוברים דרך אותה פונקציה ב-lib.

// ─────────────────────────────────────────────────────────────
// GET - חיפוש לקוח קיים לפי טלפון
// ─────────────────────────────────────────────────────────────
export async function GET(req: Request) {
  const g = await requireAdmin();
  if (!g.ok) return g.res;

  const { searchParams } = new URL(req.url);
  const phone = normalizePhone(searchParams.get("phone") || "");
  if (phone.length < 9) {
    return NextResponse.json({ found: false });
  }

  const c = await prisma.customer.findFirst({
    where: { phone },
    select: {
      id: true,
      name: true,
      phone: true,
      email: true,
      role: true,
      isActive: true,
      paymentToken: true,
      paymentPreference: true,
      cardLast4: true,
      defaultPoint: { select: { id: true, name: true } },
      _count: { select: { orders: true } },
    },
  });

  if (!c) return NextResponse.json({ found: false });

  return NextResponse.json({
    found: true,
    customer: {
      id: c.id,
      name: c.name,
      phone: c.phone,
      email: c.email,
      role: c.role,
      isActive: c.isActive,
      hasCard: !!c.paymentToken,
      // §60: אופן התשלום - לתצוגת 💵 במסך המנהל
      paymentPreference: c.paymentPreference,
      cardLast4: c.cardLast4,
      pointId: c.defaultPoint?.id ?? null,
      pointName: c.defaultPoint?.name ?? null,
      orderCount: c._count.orders,
    },
  });
}

// ─────────────────────────────────────────────────────────────
// POST - יצירת לקוח
// ─────────────────────────────────────────────────────────────
export async function POST(req: Request) {
  const g = await requireAdmin();
  if (!g.ok) return g.res;

  const b = await req.json().catch(() => ({}));
  const name = cleanName(b.name);
  const phone = normalizePhone(b.phone || "");
  const email = b.email ? String(b.email).trim().toLowerCase() : null;

  // §161: טלפון נוסף. משמש ליצירת קשר בחלוקה, **וגם** לזיהוי
  // במערכת הטלפונית - הלקוח יכול להתקשר משני המספרים.
  //
  // §162: 🐛 בלי הבדיקה, אפשר היה להזין מספר שכבר משמש לזיהוי
  // של לקוח אחר - ואז **שניהם** לא היו מזוהים בטלפון, כי ה-IVR
  // דוחה התאמה מרובה. זו תקלה שקשה מאוד לאבחן בדיעבד.
  const p2 = await validatePhone2(prisma, b.phone2);
  if (!p2.ok) {
    return NextResponse.json(
      { error: p2.error, code: "PHONE2_CONFLICT", conflictWith: p2.conflictWith },
      { status: 409 }
    );
  }
  const defaultPointId = b.defaultPointId ? String(b.defaultPointId) : null;
  // §60: אופן תשלום. ברירת מחדל CREDIT - לקוח שהמנהל מקים בטלפון
  // אמור להוסיף כרטיס. CASH נבחר מפורשות ללקוח שמשלם בחלוקה.
  const paymentPreference = b.paymentPreference === "CASH" ? "CASH" : "CREDIT";
  if (
    b.paymentPreference != null &&
    b.paymentPreference !== "CASH" &&
    b.paymentPreference !== "CREDIT"
  ) {
    return NextResponse.json(
      { error: "אופן תשלום לא תקין - יש לבחור מזומן או אשראי" },
      { status: 400 }
    );
  }

  if (name.length < 2) {
    return NextResponse.json({ error: "שם קצר מדי" }, { status: 400 });
  }
  if (!isValidPhone(phone)) {
    return NextResponse.json(
      { error: "מספר טלפון לא תקין. יש להזין מספר ישראלי תקין." },
      { status: 400 }
    );
  }
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: "כתובת מייל לא תקינה" }, { status: 400 });
  }

  // §54: נקודת חלוקה חובה. למנהל אין נקודת ברירת מחדל כמו לנציג,
  // ולקוח בלי נקודה לא יכול להזמין - ההזמנה תיחסם בשלב האחרון.
  if (!defaultPointId) {
    return NextResponse.json(
      { error: "יש לבחור נקודת חלוקה ללקוח" },
      { status: 400 }
    );
  }
  const point = await prisma.deliveryPoint.findUnique({
    where: { id: defaultPointId },
    select: { id: true, isActive: true, name: true },
  });
  if (!point || !point.isActive) {
    return NextResponse.json({ error: "נקודת חלוקה לא תקינה" }, { status: 400 });
  }

  // כפילות טלפון
  const dupPhone = await prisma.customer.findFirst({
    where: { phone },
    select: { id: true, name: true, role: true },
  });
  if (dupPhone) {
    return NextResponse.json(
      {
        error: `לקוח בשם "${dupPhone.name}" כבר קיים עם טלפון זה`,
        code: "DUPLICATE_PHONE",
        existing: dupPhone,
      },
      { status: 409 }
    );
  }

  if (email) {
    const dupEmail = await prisma.customer.findUnique({
      where: { email },
      select: { id: true },
    });
    if (dupEmail) {
      return NextResponse.json(
        { error: "המייל כבר בשימוש על ידי לקוח אחר", code: "DUPLICATE_EMAIL" },
        { status: 409 }
      );
    }
  }

  const password = generatePassword();
  const customer = await prisma.customer.create({
    data: {
      name,
      phone,
      phone2: p2.value,
      email,
      defaultPointId,
      passwordHash: await bcrypt.hash(password, 10),
      // נשמר גלוי כדי שהמנהל יוכל למסור ללקוח - אותה גישה כמו
      // באיפוס סיסמה במסך הלקוחות.
      passwordPlain: password,
      role: "CUSTOMER",
      createdByAgentId: null,
      // §60: אופן התשלום שנבחר
      paymentPreference,
    },
    select: { id: true, name: true, phone: true, email: true, paymentPreference: true },
  });

  // §167: סגירת פניות טלפוניות פתוחות של אותו מספר.
  //
  // 🐛 בלי זה ההודעה נשארת "חדשה" לנצח: customerId עליה נקבע
  // ברגע השיחה, ומתקשר שלא היה רשום אז מקבל null - ואף אחד לא
  // מחבר בין השניים אחר כך. המנהל היה רואה בקשה, לוחץ "הקם
  // לקוח", ומקבל "כבר קיים".
  //
  // ⚠️ await ולא fire-and-forget: ב-Vercel הפונקציה מסתיימת עם
  // התשובה, ועבודה ברקע נקטעת.
  const closed = await closeOpenRequestsForPhone(prisma, phone, customer.id);

  // §121: קוד כניסה לכל לקוח, מרגע היצירה.
  //
  // 🐛 הפער: לקוח שנוצר כאן קיבל סיסמה אקראית שלא נשמרת בגלוי -
  // כלומר לא הייתה לו שום דרך להיכנס. בכרטיס שלו הופיע "אין קוד",
  // ובטלפון אפשרות "שמיעת קוד" לא הייתה זמינה.
  //
  // ⚠️ לא חוסם: כשל בהפקה לא יפיל יצירת לקוח שכבר הצליחה.
  await ensureLoginCode(prisma, customer.id);

  console.log(
    `[admin-customer-create] ${g.session?.user?.email} created customer ${customer.id} at point ${point.name} payment=${paymentPreference}`
  );

  return NextResponse.json({
    ok: true,
    customer,
    password,
    pointName: point.name,
  });
}
