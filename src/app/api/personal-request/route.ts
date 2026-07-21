import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { Resend } from "resend";

// §9: יצירת בקשה אישית - עם עגלה (מספר פריטים)
// POST /api/personal-request
// Body: { customerName, phone, notes?, items: [{ productId, quantity }] }

const FROM_ADDRESS = "צדקת רבותינו <orders@tzidkat.com>";
const ADMIN_EMAIL = "m5402088@gmail.com";

function getResend() {
  return new Resend(process.env.RESEND_API_KEY);
}

export async function POST(req: Request) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "יש להתחבר" }, { status: 401 });
    }
    const customerId = (session.user as any).id as string;

    const body = await req.json().catch(() => ({}));
    const customerName = String(body.customerName || "").trim();
    const phone = String(body.phone || "").trim();
    const notes = body.notes ? String(body.notes).trim() : null;
    const items = Array.isArray(body.items) ? body.items : [];

    if (!customerName) {
      return NextResponse.json({ error: "יש להזין שם" }, { status: 400 });
    }
    if (!phone) {
      return NextResponse.json({ error: "יש להזין טלפון" }, { status: 400 });
    }
    if (items.length === 0) {
      return NextResponse.json({ error: "יש לבחור לפחות מוצר אחד" }, { status: 400 });
    }

    // וידוא שכל המוצרים קיימים ופעילים + זמינים להזמנה אישית
    const productIds = items.map((it: any) => String(it.productId));
    const products = await prisma.product.findMany({
      where: {
        id: { in: productIds },
        isActive: true,
        allowPersonalOrder: true,
      },
    });
    const pMap = new Map(products.map((p) => [p.id, p]));

    const validItems: {
      productId: string;
      productName: string;
      quantity: number;
    }[] = [];

    for (const item of items) {
      const p = pMap.get(String(item.productId));
      if (!p) continue;
      const qty = Number(item.quantity);
      if (!qty || qty < 1) continue;
      validItems.push({
        productId: p.id,
        productName: p.name,
        quantity: Math.min(qty, 99),
      });
    }

    if (validItems.length === 0) {
      return NextResponse.json({ error: "אין מוצרים תקינים בבקשה" }, { status: 400 });
    }

    // יצירת הבקשה
    const request = await prisma.personalRequest.create({
      data: {
        customerId,
        customerName,
        phone,
        notes,
        status: "NEW",
        hasUnreadForAdmin: true,
        hasUnreadForCustomer: false,
        items: {
          create: validItems,
        },
      },
      select: {
        id: true,
        requestNumber: true,
      },
    });

    // מייל למנהל
    try {
      const itemsList = validItems.map((it) => `• ${it.productName} × ${it.quantity}`).join("<br>");
      await getResend().emails.send({
        from: FROM_ADDRESS,
        to: ADMIN_EMAIL,
        subject: `בקשה אישית חדשה #${request.requestNumber}`,
        html: `<div dir="rtl" style="font-family:Arial,sans-serif;padding:16px;">
          <h2 style="color:#C0461E;">בקשה אישית חדשה #${request.requestNumber}</h2>
          <p><strong>לקוח:</strong> ${customerName}</p>
          <p><strong>טלפון:</strong> ${phone}</p>
          ${notes ? `<p><strong>הערות:</strong> ${notes}</p>` : ""}
          <h3>פריטים:</h3>
          <p>${itemsList}</p>
          <p style="margin-top:20px;color:#666;">
            <a href="https://tzidkat.com/admin/personal-requests">לניהול בקשות אישיות</a>
          </p>
        </div>`,
      });
    } catch (e) {
      console.error("Failed to send admin notification email:", e);
    }

    // מייל אישור ללקוח
    try {
      const customer = await prisma.customer.findUnique({
        where: { id: customerId },
        select: { email: true },
      });
      if (customer?.email) {
        const itemsList = validItems.map((it) => `• ${it.productName} × ${it.quantity}`).join("<br>");
        await getResend().emails.send({
          from: FROM_ADDRESS,
          to: customer.email,
          subject: `הבקשה שלך #${request.requestNumber} התקבלה`,
          html: `<div dir="rtl" style="font-family:Arial,sans-serif;padding:16px;background:#fff8d8;">
            <div style="max-width:600px;margin:0 auto;background:#fff;border-radius:12px;padding:24px;">
              <h2 style="color:#C0461E;">הבקשה שלך התקבלה!</h2>
              <p>שלום ${customerName},</p>
              <p>קיבלנו את בקשתך למוצרים אישיים. מספר הבקשה: <strong>#${request.requestNumber}</strong></p>
              <div style="background:#eff6ff;padding:12px;border-radius:8px;border-right:4px solid #2563eb;">
                <h3 style="margin-top:0;">פריטים מבוקשים:</h3>
                <p>${itemsList}</p>
              </div>
              <p>ניצור איתך קשר בהקדם לתיאום. תוכל לעקוב אחר סטטוס הבקשה באזור האישי.</p>
              <p style="color:#888;font-size:12px;margin-top:20px;">
                צדקת רבותינו — עופות, בשר ודגים
              </p>
            </div>
          </div>`,
        });
      }
    } catch (e) {
      console.error("Failed to send customer confirmation email:", e);
    }

    return NextResponse.json({
      ok: true,
      id: request.id,
      requestNumber: request.requestNumber,
    });
  } catch (e: any) {
    console.error("POST /api/personal-request error:", e);
    return NextResponse.json({ error: "שגיאת שרת" }, { status: 500 });
  }
}
