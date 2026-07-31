// PATCH /api/admin/customers/[id]
// עדכון פרטי לקוח + הרשאות נציג
//
// שדות נתמכים:
//   - name, email, phone (נתונים בסיסיים)
//   - passwordPlain (סיסמה גלויה למנהל, המנהל יכול לאפס)
//   - agentPointId (נקודת חלוקה משויכת - רק לנציג)
//   - agentCanSetFinalPrice, agentCanSendPaymentLink, agentCanCharge, agentCanUpdateCards (הרשאות נציג)
//   - cardNeedsUpdate (סימון שנדרש עדכון כרטיס)

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/guard";
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
  "cardNeedsUpdate",
] as const;

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const g = await requireAdmin();
  if (!g.ok) return g.res;

  const { id } = await params;
  const body = await req.json().catch(() => ({}));

  const data: any = {};

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

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "אין שדות לעדכון" }, { status: 400 });
  }

  try {
    const customer = await prisma.customer.update({
      where: { id },
      data,
    });
    return NextResponse.json({ ok: true, customer });
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
