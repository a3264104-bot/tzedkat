import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/guard";
import { Resend } from "resend";

// POST /api/admin/notify-arrival
//
// ח5: שליחת מייל "הסחורה הגיעה לנקודת חלוקה" ללקוחות.
// Body: { pointId?: string }
//   - אם pointId ← שולח רק ללקוחות שהזמינו לנקודה הזו
//   - אם ריק ← שולח לכל הנקודות (מכירה פעילה)

const FROM_ADDRESS = "צדקת רבותינו <orders@tzidkat.com>";

function getResend() {
  return new Resend(process.env.RESEND_API_KEY);
}

export async function POST(req: Request) {
  const g = await requireAdmin();
  if (!g.ok) return g.res;

  try {
    const body = await req.json().catch(() => ({}));
    const pointId = body.pointId || null;

    // מכירה פעילה
    const pricelist = await prisma.pricelist.findFirst({
      where: { status: "ACTIVE" },
      orderBy: { createdAt: "desc" },
      select: { id: true, name: true, deliveryDateText: true },
    });

    if (!pricelist) {
      return NextResponse.json({ error: "אין מכירה פעילה" }, { status: 400 });
    }

    // הזמנות פעילות למכירה הזו — לפי נקודה או כולן
    const orders = await prisma.order.findMany({
      where: {
        pricelistId: pricelist.id,
        status: { notIn: ["CANCELLED"] },
        ...(pointId ? { pointId } : {}),
      },
      include: {
        customer: { select: { email: true, name: true } },
        point: { select: { name: true, address: true, deliveryHours: true } },
      },
    });

    // סינון לקוחות עם מייל — לא שולחים כפילויות
    const seen = new Set<string>();
    const recipients: {
      email: string;
      name: string;
      pointName: string;
      pointAddress: string | null;
      deliveryHours: string | null;
    }[] = [];

    for (const o of orders) {
      const email = o.customer?.email;
      if (!email || seen.has(email)) continue;
      seen.add(email);
      recipients.push({
        email,
        name: o.customer.name,
        pointName: o.point?.name || o.pointNameSnapshot || "",
        pointAddress: o.point?.address || null,
        deliveryHours: o.point?.deliveryHours || null,
      });
    }

    if (recipients.length === 0) {
      return NextResponse.json({
        ok: true,
        sent: 0,
        message: "אין לקוחות עם מייל להודעה",
      });
    }

    // שליחה
    const resend = getResend();
    let sent = 0;
    let failed = 0;

    for (const r of recipients) {
      try {
        await resend.emails.send({
          from: FROM_ADDRESS,
          to: r.email,
          subject: `הסחורה הגיעה! - צדקת רבותינו`,
          html: `<div dir="rtl" lang="he" style="font-family:Arial,Helvetica,sans-serif;background:#fff8d8;padding:24px;">
            <div style="max-width:600px;margin:0 auto;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #eee;">
              <div style="background:#C0461E;color:#fff;padding:20px 24px;">
                <h1 style="margin:0;font-size:20px;">הסחורה הגיעה!</h1>
              </div>
              <div style="padding:24px;color:#27272A;">
                <p>שלום ${r.name},</p>
                <div style="background:#E1F5EE;border-radius:10px;padding:14px;margin:16px 0;border-right:4px solid #059669;">
                  <p style="margin:0;color:#065F46;font-weight:600;font-size:16px;">
                    ההזמנה שלך מוכנה לאיסוף!
                  </p>
                </div>
                <p style="font-size:15px;"><strong>📍 נקודת חלוקה:</strong> ${r.pointName}</p>
                ${r.pointAddress ? `<p style="font-size:14px;color:#666;">כתובת: ${r.pointAddress}</p>` : ""}
                ${r.deliveryHours ? `<p style="font-size:14px;color:#666;">🕐 שעות: ${r.deliveryHours}</p>` : ""}
                <p style="margin-top:16px;font-size:14px;color:#C0461E;font-weight:600;">
                  יש לבוא בהקדם לאסוף את ההזמנה.
                </p>
              </div>
              <div style="padding:16px 24px;background:#f4f4f5;color:#888;font-size:12px;text-align:center;">
                צדקת רבותינו — עופות, בשר ודגים
              </div>
            </div>
          </div>`,
        });
        sent++;
      } catch (e) {
        console.error(`Failed to send arrival email to ${r.email}:`, e);
        failed++;
      }
    }

    // רישום ב-log שהוודעות נשלחו
    const pointName = pointId
      ? (await prisma.deliveryPoint.findUnique({ where: { id: pointId }, select: { name: true } }))?.name || pointId
      : "כל הנקודות";

    console.log(
      `[notify-arrival] ${g.session?.user?.email} sent arrival notification for "${pointName}": ${sent} sent, ${failed} failed`
    );

    return NextResponse.json({
      ok: true,
      sent,
      failed,
      total: recipients.length,
      pointName,
    });
  } catch (e: any) {
    console.error("POST /api/admin/notify-arrival error:", e);
    return NextResponse.json({ error: "שגיאת שרת" }, { status: 500 });
  }
}
