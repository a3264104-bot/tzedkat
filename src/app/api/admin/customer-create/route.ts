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
import { requireAdmin } from "@/lib/guard";
import bcrypt from "bcryptjs";

// סיסמה קריאה: בלי תווים שקל לבלבל (0/O, 1/l) - היא נמסרת בטלפון
function generatePassword(): string {
  const letters = "abcdefghjkmnpqrstuvwxyz";
  const numbers = "23456789";
  let out = "";
  for (let i = 0; i < 4; i++) out += letters[Math.floor(Math.random() * letters.length)];
  for (let i = 0; i < 4; i++) out += numbers[Math.floor(Math.random() * numbers.length)];
  return out;
}

function normalizePhone(raw: string): string {
  return String(raw || "").replace(/[\s\-()]/g, "").trim();
}

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
  const name = String(b.name || "").trim();
  const phone = normalizePhone(b.phone || "");
  const email = b.email ? String(b.email).trim().toLowerCase() : null;
  const defaultPointId = b.defaultPointId ? String(b.defaultPointId) : null;

  if (name.length < 2) {
    return NextResponse.json({ error: "שם קצר מדי" }, { status: 400 });
  }
  if (phone.length < 9) {
    return NextResponse.json({ error: "מספר טלפון לא תקין" }, { status: 400 });
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
      email,
      defaultPointId,
      passwordHash: await bcrypt.hash(password, 10),
      // נשמר גלוי כדי שהמנהל יוכל למסור ללקוח - אותה גישה כמו
      // באיפוס סיסמה במסך הלקוחות.
      passwordPlain: password,
      role: "CUSTOMER",
      createdByAgentId: null,
    },
    select: { id: true, name: true, phone: true, email: true },
  });

  console.log(
    `[admin-customer-create] ${g.session?.user?.email} created customer ${customer.id} at point ${point.name}`
  );

  return NextResponse.json({
    ok: true,
    customer,
    password,
    pointName: point.name,
  });
}
