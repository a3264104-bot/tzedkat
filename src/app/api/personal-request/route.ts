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
      isSingle: boolean;
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
        // §73: בודדים - נאכף מול המוצר ולא נלקח כפשוטו מהקליינט.
        // מוצר שאינו נמכר בבודדים יישמר כקרטון גם אם נשלח אחרת.
        isSingle: !!item.isSingle && !!p.allowSingles,
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
      // §73: המנהל חייב לראות אם ביקשו קרטון או בודדים - זה משנה
      // לגמרי מה הוא מזמין מהספק.
      const itemsList = validItems
        .map(
          (it) =>
            `• ${it.productName} × ${it.quantity}${it.isSingle ? " (בודדים)" : ""}`
        )
        .join("<br>");
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
        const itemsList = validItems
          .map(
            (it) =>
              `• ${it.productName} × ${it.quantity}${it.isSingle ? " (בודדים)" : ""}`
          )
          .join("<br>");
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

// ═══════════════════════════════════════════════════════════════
// §73: ביטול בקשה ע"י הלקוח
// ═══════════════════════════════════════════════════════════════
// PATCH /api/personal-request
// Body: { requestId, action: "cancel" }
//
// למה ביטול ולא מחיקה: הבקשה היא שיחה מתמשכת בין הלקוח למנהל,
// ובה היסטוריית הודעות. מחיקה הייתה מוחקת גם את הצ'אט ומשאירה את
// המנהל בלי הקשר - במיוחד אם הוא כבר בירר מול הספק.
//
// אין כאן שלב "אושרה" שחוסם ביטול: המודל העסקי הוא בירור, לא
// הזמנה מחייבת. אם המנהל כבר הזמין, הוא רואה את הביטול בצ'אט
// (הודעת מערכת + סימון "לא נקרא") וחוזר ללקוח.

export async function PATCH(req: Request) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "יש להתחבר" }, { status: 401 });
    }
    const customerId = (session.user as any).id as string;

    const body = await req.json().catch(() => ({}));
    const requestId = String(body.requestId || "").trim();
    const action = String(body.action || "");

    if (action !== "cancel") {
      return NextResponse.json({ error: "פעולה לא מוכרת" }, { status: 400 });
    }
    if (!requestId) {
      return NextResponse.json({ error: "חסר מזהה בקשה" }, { status: 400 });
    }

    // ⚠️ בעלות: הבדיקה על customerId ולא רק על קיום הבקשה. בלעדיה
    // כל לקוח מחובר היה יכול לבטל בקשה של אחר על ידי ניחוש מזהה.
    const request = await prisma.personalRequest.findFirst({
      where: { id: requestId, customerId },
      select: { id: true, requestNumber: true, status: true, customerName: true },
    });
    if (!request) {
      return NextResponse.json({ error: "בקשה לא נמצאה" }, { status: 404 });
    }
    if (request.status === "CANCELLED") {
      return NextResponse.json({ error: "הבקשה כבר בוטלה" }, { status: 400 });
    }
    if (request.status === "DONE") {
      return NextResponse.json(
        { error: "הבקשה כבר הושלמה ולא ניתן לבטל אותה. ניתן לפנות בהודעה." },
        { status: 400 }
      );
    }

    await prisma.personalRequest.update({
      where: { id: requestId },
      data: {
        status: "CANCELLED",
        // המנהל צריך לראות שמשהו קרה, גם אם הוא לא פתוח על המסך
        hasUnreadForAdmin: true,
      },
    });

    // הודעת מערכת בצ'אט - כדי שהביטול יופיע בתוך השיחה עם חותמת
    // זמן, ולא רק כשינוי סטטוס שקט שאי אפשר לדעת מתי קרה.
    await prisma.personalRequestMessage
      .create({
        data: {
          requestId,
          senderType: "CUSTOMER",
          senderName: request.customerName,
          message: "הלקוח ביטל את הבקשה.",
        },
      })
      .catch((e) => {
        // כשל בהודעה לא מבטל את הביטול עצמו
        console.error("[personal-request] cancel message failed:", e);
      });

    console.log(
      `[personal-request] request #${request.requestNumber} cancelled by customer ${customerId}`
    );

    return NextResponse.json({ ok: true, status: "CANCELLED" });
  } catch (e) {
    console.error("PATCH /api/personal-request error:", e);
    return NextResponse.json({ error: "שגיאת שרת" }, { status: 500 });
  }
}
