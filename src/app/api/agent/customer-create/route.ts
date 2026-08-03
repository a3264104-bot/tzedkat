// יצירת לקוח חדש ע"י נציג - "לקוח מזדמן"
// POST /api/agent/customer-create
// Body: { name, phone, email?, defaultPointId? }
//
// יוצר Customer עם isActivated=false, סיסמא אקראית חזקה, ו-createdByAgentId=<הנציג>.
// הלקוח יכול להפעיל את החשבון מאוחר יותר ע"י "שכחתי סיסמה" (אם יש לו מייל)
// או ע"י איפוס דרך המנהל/נציג.

import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";

// יצירת סיסמא אקראית חזקה - 32 תווים, לא לזכירה, לא לשימוש חוזר
function generateStrongPassword(): string {
  return crypto.randomBytes(24).toString("base64");
}

export async function POST(req: Request) {
  const session = await auth();
  const role = (session?.user as any)?.role;
  const agentId = (session?.user as any)?.id as string;
  if (!session?.user || (role !== "AGENT" && role !== "ADMIN") || !agentId) {
    return NextResponse.json({ error: "לא מורשה" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const name = String(body.name || "").trim();
  const phoneRaw = String(body.phone || "").trim();
  const emailRaw = body.email ? String(body.email).trim() : "";
  const defaultPointId = body.defaultPointId || null;

  if (!name || name.length < 2) {
    return NextResponse.json({ error: "שם קצר מדי" }, { status: 400 });
  }
  if (!phoneRaw) {
    return NextResponse.json({ error: "טלפון חובה" }, { status: 400 });
  }

  // נירמול טלפון
  const digits = phoneRaw.replace(/\D/g, "");
  const phone = digits.startsWith("972") ? "0" + digits.slice(3) : digits;
  if (phone.length < 9 || phone.length > 10) {
    return NextResponse.json({ error: "מספר טלפון לא תקין" }, { status: 400 });
  }

  // נירמול מייל
  let email: string | null = null;
  if (emailRaw) {
    email = emailRaw.toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return NextResponse.json({ error: "מייל לא תקין" }, { status: 400 });
    }
  }

  // בדיקת כפילות טלפון
  const existingPhone = await prisma.customer.findUnique({ where: { phone } });
  if (existingPhone) {
    // אם קיים - נחזיר את הפרטים כדי שהנציג יראה
    return NextResponse.json(
      {
        error: "לקוח עם הטלפון הזה כבר קיים",
        code: "DUPLICATE_PHONE",
        existing: {
          id: existingPhone.id,
          name: existingPhone.name,
          phone: existingPhone.phone,
        },
      },
      { status: 409 }
    );
  }

  // בדיקת כפילות מייל (אם ניתן)
  if (email) {
    const existingEmail = await prisma.customer.findUnique({ where: { email } });
    if (existingEmail) {
      return NextResponse.json(
        {
          error: "לקוח עם המייל הזה כבר קיים",
          code: "DUPLICATE_EMAIL",
          existing: { id: existingEmail.id, name: existingEmail.name },
        },
        { status: 409 }
      );
    }
  }

  // אם הנציג לא ציין נקודה - משתמשים בנקודה של הנציג עצמו (הכי סביר שהלקוח יאסוף שם)
  let effectivePointId = defaultPointId;
  if (!effectivePointId) {
    const agent = await prisma.customer.findUnique({
      where: { id: agentId },
      select: { agentPointId: true },
    });
    if (agent?.agentPointId) {
      effectivePointId = agent.agentPointId;
    }
  }

  // יצירת סיסמא אקראית חזקה - הלקוח יאפס בעתיד אם ירצה
  const tempPassword = generateStrongPassword();
  const passwordHash = await bcrypt.hash(tempPassword, 10);

  const customer = await prisma.customer.create({
    data: {
      name,
      phone,
      email,
      passwordHash,
      // לא שומרים passwordPlain כאן - הסיסמא לא מיועדת לזכירה
      // אם הנציג/מנהל ירצה סיסמא לתת ללקוח, יאפס דרך הפרופיל
      passwordPlain: null,
      role: "CUSTOMER",
      isActivated: false,
      createdByAgentId: agentId,
      defaultPointId: effectivePointId,
      // דילוג על מסך "ברוכים הבאים" - כי הנציג יזמין עבורו
      hasSeenOrderIntro: true,
      // 🆕 הסכמה לקבלת מיילים - נשארת false ביצירה ע"י נציג!
      // הלקוח לא נכח פיזית ולא נתן הסכמה. הוא יידרש לאשר בכניסה הראשונה
      // שלו למערכת (דרך /account או "שכחתי סיסמה" -> הפעלה). זה חוקי חשוב,
      // גם GDPR (הסכמה מפורשת מהאדם עצמו).
      agreedToEmails: false,
      agreedToEmailsAt: null,
    },
    select: {
      id: true,
      name: true,
      phone: true,
      email: true,
      defaultPointId: true,
    },
  });

  return NextResponse.json({
    ok: true,
    customer,
  });
}
