import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { Resend } from "resend";
import crypto from "crypto";
import { PAYMENT_STATUS_LABELS, PAYMENT_METHOD_LABELS, STATUS_LABELS } from "@/lib/pricing";

// מחזיר את פרטי הלקוח המחובר + היסטוריית ההזמנות שלו
export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "יש להתחבר" }, { status: 401 });
  }
  const customerId = (session.user as any).id as string;

  const customer = await prisma.customer.findUnique({
    where: { id: customerId },
    include: {
      defaultPoint: { select: { id: true, name: true, city: true } },
      orders: {
        orderBy: { createdAt: "desc" },
        include: {
          point: { select: { name: true, city: true } },
          items: true,
        },
      },
    },
  });

  if (!customer) {
    return NextResponse.json({ error: "לקוח לא נמצא" }, { status: 404 });
  }

  // לא מחזירים passwordHash / paymentToken ללקוח
  return NextResponse.json({
    name: customer.name,
    phone: customer.phone,
    email: customer.email,
    cardLast4: customer.cardLast4,
    defaultPoint: customer.defaultPoint,
    orders: customer.orders.map((o) => ({
      id: o.id,
      orderNumber: o.orderNumber,
      status: o.status,
      statusLabel: STATUS_LABELS[o.status] ?? o.status,
      paymentStatus: o.paymentStatus,
      paymentStatusLabel: PAYMENT_STATUS_LABELS[o.paymentStatus] ?? o.paymentStatus,
      paymentMethod: o.paymentMethod,
      paymentMethodLabel: o.paymentMethod ? PAYMENT_METHOD_LABELS[o.paymentMethod] : null,
      paymentLink: o.paymentLink,
      pointName: o.point?.name ?? o.pointNameSnapshot,
      deliveryDate: o.deliveryDateSnapshot,
      estimatedTotal: Number(o.estimatedTotal),
      finalTotal: o.finalTotal != null ? Number(o.finalTotal) : null,
      createdAt: o.createdAt,
      itemCount: o.items.length,
    })),
  });
}

// עדכון תחנת ברירת מחדל
export async function PATCH(req: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "יש להתחבר" }, { status: 401 });
  }
  const customerId = (session.user as any).id as string;

  const body = await req.json();

  const customer = await prisma.customer.findUnique({ where: { id: customerId } });
  if (!customer) {
    return NextResponse.json({ error: "לקוח לא נמצא" }, { status: 404 });
  }

  // ── הוספת/עדכון מייל עצמאי ──
  if (body.action === "update-email") {
    const email = body.email ? String(body.email).trim().toLowerCase() : null;
    if (!email) return NextResponse.json({ error: "יש להזין כתובת מייל" }, { status: 400 });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return NextResponse.json({ error: "כתובת מייל לא תקינה" }, { status: 400 });
    }
    const dup = await prisma.customer.findUnique({ where: { email } });
    if (dup && dup.id !== customerId) {
      return NextResponse.json({ error: "המייל כבר שייך לחשבון אחר" }, { status: 409 });
    }
    await prisma.customer.update({ where: { id: customerId }, data: { email } });
    return NextResponse.json({ ok: true, email });
  }

  // ── שליחת קישור איפוס סיסמה למייל של הלקוח עצמו ──
  if (body.action === "send-reset") {
    if (!customer.email) {
      return NextResponse.json(
        { error: "אין מייל בחשבון — הוסף מייל תחילה כדי לאפס סיסמה בעצמך" },
        { status: 400 }
      );
    }
    const token = crypto.randomBytes(32).toString("hex");
    await prisma.customer.update({
      where: { id: customerId },
      data: { resetToken: token, resetTokenExpiry: new Date(Date.now() + 60 * 60 * 1000) },
    });
    try {
      const resetUrl = `${process.env.NEXT_PUBLIC_APP_URL || "https://tzidkat.com"}/reset-password?token=${token}`;
      const resend = new Resend(process.env.RESEND_API_KEY);
      await resend.emails.send({
        from: "צדקת רבותינו <orders@tzidkat.com>",
        to: customer.email,
        subject: "איפוס סיסמה — צדקת רבותינו",
        html: `
          <div dir="rtl" lang="he" style="font-family:Arial,sans-serif;background:#fff8d8;padding:24px;">
            <div style="max-width:480px;margin:0 auto;background:#fff;border-radius:16px;padding:24px;border:1px solid #eee;">
              <h2 style="color:#27272A;">איפוס סיסמה</h2>
              <p>קיבלנו בקשה לאיפוס הסיסמה לחשבונך. הקישור תקף לשעה אחת בלבד.</p>
              <a href="${resetUrl}" style="display:inline-block;background:#C0461E;color:#fff;padding:12px 24px;border-radius:10px;text-decoration:none;margin:16px 0;">לאיפוס הסיסמה</a>
              <p style="color:#888;font-size:13px;">אם לא ביקשת איפוס, אפשר להתעלם מהודעה זו.</p>
            </div>
          </div>`,
      });
    } catch (e) {
      console.error("account send-reset email failed:", e);
      return NextResponse.json({ error: "שליחת המייל נכשלה" }, { status: 500 });
    }
    return NextResponse.json({ ok: true, sentTo: customer.email });
  }

  const data: any = {};

  if ("defaultPointId" in body) {
    // מוודאים שהנקודה קיימת ופעילה
    if (body.defaultPointId) {
      const point = await prisma.deliveryPoint.findUnique({
        where: { id: body.defaultPointId },
      });
      if (!point || !point.isActive) {
        return NextResponse.json({ error: "נקודת חלוקה לא תקינה" }, { status: 400 });
      }
    }
    data.defaultPointId = body.defaultPointId || null;
  }

  const updated = await prisma.customer.update({
    where: { id: customerId },
    data,
    include: { defaultPoint: { select: { id: true, name: true, city: true } } },
  });

  return NextResponse.json({ ok: true, defaultPoint: updated.defaultPoint });
}
