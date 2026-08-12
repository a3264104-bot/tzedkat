// POST /api/admin/broadcast
// שולח מייל עם הודעה מוכנה לרשימת נמענים.
//
// Body: {
//   subject: string,
//   message: string,        // טקסט פשוט - ייהפך ל-HTML עם שמירה על שורות חדשות
//   mode: "all" | "point" | "manual",
//   pointIds?: string[],    // רק אם mode=point
//   customerIds?: string[], // רק אם mode=manual
// }
//
// הגנות:
//   - רק ADMIN יכול לשלוח
//   - Resend Free tier: 100 מיילים בשעה. משלחים בקצב 8 בשנייה עם פאוזה כל batch.
//   - קריאה fire-and-forget: מחזירים 200 מיד עם count, השליחה עצמה רצה ברקע.
//     אחרת - הבקשה תזרוק timeout ב-Vercel לפני שהשליחה תסתיים.

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/guard";
import { sendBroadcastEmail } from "@/lib/email";
import {
  createPhoneAnnouncement,
  expiryForDelivery,
} from "@/lib/announcement-helper";

const BATCH_SIZE = 8; // מיילים בבת אחת
const BATCH_DELAY_MS = 1200; // המתנה בין batches (Resend rate limit)

export async function POST(req: Request) {
  const g = await requireAdmin();
  if (!g.ok) return g.res;

  const body = await req.json().catch(() => ({}));
  const subject = String(body?.subject || "").trim();
  const message = String(body?.message || "").trim();
  const mode = String(body?.mode || "");
  const pointIds: string[] = Array.isArray(body?.pointIds) ? body.pointIds : [];
  const customerIds: string[] = Array.isArray(body?.customerIds) ? body.customerIds : [];

  if (!subject) {
    return NextResponse.json({ error: "יש להזין כותרת" }, { status: 400 });
  }
  if (!message) {
    return NextResponse.json({ error: "יש להזין תוכן הודעה" }, { status: 400 });
  }
  if (!["all", "point", "manual"].includes(mode)) {
    return NextResponse.json({ error: "מצב לא תקין" }, { status: 400 });
  }
  if (mode === "point" && pointIds.length === 0) {
    return NextResponse.json({ error: "יש לבחור לפחות נקודה אחת" }, { status: 400 });
  }
  if (mode === "manual" && customerIds.length === 0) {
    return NextResponse.json({ error: "יש לבחור לפחות לקוח אחד" }, { status: 400 });
  }

  // בניית where clause לפי mode.
  // בכל המצבים: רק לקוחות שאישרו לקבל מיילים שיווקיים!
  // מיילים תפעוליים (אישור הזמנה/חיוב) עוברים ערוצים אחרים ולא כפופים לזה.
  const where: any = {
    role: "CUSTOMER",
    email: { not: null },
    agreedToEmails: true,
  };
  if (mode === "point") {
    where.defaultPointId = { in: pointIds };
  } else if (mode === "manual") {
    where.id = { in: customerIds };
  }
  // mode === "all" - אין תנאי נוסף מעבר לbase

  const recipients = await prisma.customer.findMany({
    where,
    select: { id: true, name: true, email: true },
  });

  if (recipients.length === 0) {
    return NextResponse.json(
      { error: "לא נמצאו נמענים תואמים" },
      { status: 400 }
    );
  }

  // הגנת שפיות: לא יותר מ-3000 בפעולה אחת
  if (recipients.length > 3000) {
    return NextResponse.json(
      { error: `יותר מדי נמענים (${recipients.length}). מקסימום 3000.` },
      { status: 400 }
    );
  }

  // המרת טקסט → HTML (שמירת שורות חדשות, escape בסיסי)
  const messageHtml = escapeHtml(message).replace(/\n/g, "<br/>");

  // Fire and forget: אין await, השליחה רצה ברקע
  sendBroadcastAsync(recipients, subject, messageHtml).catch((err) => {
    console.error("[broadcast] async send error:", err);
  });

  // §32: הודעה קולית מקבילה, כדי שגם לקוח בלי מייל יקבל את העדכון
  // כשיתקשר. נוצרת רק אם המנהל ביקש - לא כל ברודקסט רלוונטי לטלפון
  // (למשל מייל שיווקי כללי).
  let announcementCreated = false;
  if (body?.alsoPhone) {
    const activeSale = await prisma.pricelist.findFirst({
      where: { status: "ACTIVE" },
      orderBy: { createdAt: "desc" },
      select: { id: true, deliveryDate: true },
    });
    if (activeSale) {
      // בברודקסט לפי נקודות - הודעה נפרדת לכל נקודה, כדי שהסינון
      // בשיחה יעבוד. בשאר המצבים הודעה אחת גלובלית.
      const targets =
        mode === "point" && pointIds.length > 0 ? pointIds : [null];
      for (const pt of targets) {
        const res = await createPhoneAnnouncement({
          pricelistId: activeSale.id,
          pointId: pt,
          // הכותרת והתוכן יחד, כי בטלפון אין "נושא" נפרד
          text: `${subject}. ${message}`,
          // §36: התפוגה נקבעת ע"י המנהל בטופס ולא לפי תאריך החלוקה.
          // הודעה כללית ("החלוקה נדחתה לשעה 18:00") לא קשורה בהכרח
          // ליום החלוקה, ולכן ברירת מחדל לפיו הייתה משאירה אותה
          // באוויר ימים אחרי שכבר לא רלוונטית.
          expiresAt: body?.phoneExpiry
            ? new Date(body.phoneExpiry)
            : expiryForDelivery(activeSale.deliveryDate),
          createdBy: g.session?.user?.email ?? null,
        });
        if (res.ok) announcementCreated = true;
      }
    }
  }

  return NextResponse.json({
    ok: true,
    recipientCount: recipients.length,
    announcementCreated,
    message:
      `השליחה החלה לרקע. ${recipients.length} מיילים יישלחו בקצב מבוקר.` +
      (announcementCreated ? " ההודעה תוקרא גם למתקשרים למערכת הטלפונית." : ""),
  });
}

// שליחה בקצב עם ניהול batches
async function sendBroadcastAsync(
  recipients: { id: string; name: string; email: string | null }[],
  subject: string,
  messageHtml: string
) {
  const total = recipients.length;
  let sent = 0;
  let failed = 0;

  console.log(`[broadcast] Starting async send: ${total} recipients`);

  for (let i = 0; i < total; i += BATCH_SIZE) {
    const batch = recipients.slice(i, i + BATCH_SIZE);

    // שליחה מקבילית של הbatch הנוכחי
    const results = await Promise.allSettled(
      batch.map((r) => {
        if (!r.email) return Promise.resolve({ ok: false, error: "no email" });
        return sendBroadcastEmail(r.name, r.email, subject, messageHtml);
      })
    );

    for (const res of results) {
      if (res.status === "fulfilled" && "ok" in res.value && res.value.ok) {
        sent++;
      } else {
        failed++;
        const err =
          res.status === "rejected"
            ? String(res.reason)
            : (res.value as any)?.error || "unknown";
        console.error("[broadcast] send failed:", err);
      }
    }

    // המתנה לפני הbatch הבא (חוץ מהאחרון)
    if (i + BATCH_SIZE < total) {
      await new Promise((resolve) => setTimeout(resolve, BATCH_DELAY_MS));
    }
  }

  console.log(`[broadcast] Done. sent=${sent}, failed=${failed}, total=${total}`);
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
