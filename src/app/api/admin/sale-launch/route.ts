// ═══════════════════════════════════════════════════════════════
// §401: 📣 הודעת פתיחת מכירה — מייל לכל הלקוחות + הודעה בטלפון
// ═══════════════════════════════════════════════════════════════
// GET  /api/admin/sale-launch?pricelistId=X
//      → הנוסח הקבוע, הנוסח הממולא למכירה, כמה נמענים, מתי נשלח
// POST /api/admin/sale-launch
//      { pricelistId, subject, email, phone, sendEmail, sendPhone,
//        saveAsDefault?, force? }
//      הנוסחים מגיעים **עם המשתנים** ({מכירה}…) והשרת ממלא אותם.
//
// ⚠️ שליחה כפולה: מייל לכל הלקוחות אי אפשר להחזיר. אחרי שליחה אחת
// launchSentAt נקבע, ושליחה נוספת דורשת force (המסך שואל).
//
// ⚠️ הטלפון: הודעה **חד-פעמית לכל מתקשר** (oncePerCaller). הודעת
// פתיחה קודמת של אותה מכירה מכובה — לא שתי הודעות פתיחה ברצף.

import { NextResponse } from "next/server";
import { waitUntil } from "@vercel/functions";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/guard";
import {
  fillLaunchPhone,
  fillLaunchText,
  getLaunchTemplates,
  launchRecipientsWhere,
  sendEmailsInBatches,
  textToHtml,
} from "@/lib/sale-launch";

const SALE_SELECT = {
  id: true,
  name: true,
  status: true,
  agentOnly: true,
  closeDate: true,
  deliveryDate: true,
  deliveryDateText: true,
  launchSentAt: true,
  launchSentCount: true,
} as const;

export async function GET(req: Request) {
  const g = await requireAdmin();
  if (!g.ok) return g.res;

  const pricelistId = new URL(req.url).searchParams.get("pricelistId") || "";
  const [sale, templates] = await Promise.all([
    pricelistId
      ? prisma.pricelist.findUnique({ where: { id: pricelistId }, select: SALE_SELECT })
      : Promise.resolve(null),
    getLaunchTemplates(),
  ]);
  if (!pricelistId) {
    // רק הנוסח הקבוע (למסך העריכה)
    return NextResponse.json({ templates });
  }
  if (!sale) {
    return NextResponse.json({ error: "המכירה לא נמצאה" }, { status: 404 });
  }

  const [recipientCount, phoneAnn] = await Promise.all([
    prisma.customer.count({ where: (await launchRecipientsWhere(sale.id)) as any }),
    prisma.phoneAnnouncement.findFirst({
      where: { pricelistId: sale.id, oncePerCaller: true, isActive: true },
      orderBy: { createdAt: "desc" },
      select: { id: true, text: true, _count: { select: { heard: true } } },
    }),
  ]);

  return NextResponse.json({
    sale,
    templates,
    filled: {
      subject: fillLaunchText(templates.subject, sale),
      email: fillLaunchText(templates.email, sale),
      phone: fillLaunchPhone(templates.phone, sale),
    },
    recipientCount,
    phoneAnnouncement: phoneAnn
      ? { id: phoneAnn.id, text: phoneAnn.text, heardCount: phoneAnn._count.heard }
      : null,
  });
}

export async function POST(req: Request) {
  const g = await requireAdmin();
  if (!g.ok) return g.res;

  const b = await req.json().catch(() => ({}));
  const pricelistId = String(b.pricelistId || "");
  const subjectT = String(b.subject ?? "").trim();
  const emailT = String(b.email ?? "").trim();
  const phoneT = String(b.phone ?? "").trim();
  const sendEmail = b.sendEmail === true;
  const sendPhone = b.sendPhone === true;

  // §401: שמירת הנוסח כקבוע — גם בלי לשלוח (מסך העריכה)
  if (b.saveAsDefault === true) {
    if (!subjectT || !emailT || !phoneT) {
      return NextResponse.json({ error: "יש למלא כותרת, נוסח מייל ונוסח טלפון" }, { status: 400 });
    }
    await prisma.systemSettings.upsert({
      where: { id: "singleton" },
      update: { saleLaunchSubject: subjectT, saleLaunchEmail: emailT, saleLaunchPhone: phoneT },
      create: {
        id: "singleton",
        saleLaunchSubject: subjectT,
        saleLaunchEmail: emailT,
        saleLaunchPhone: phoneT,
      },
    });
  }
  if (!sendEmail && !sendPhone) {
    return NextResponse.json({ ok: true, saved: b.saveAsDefault === true });
  }

  if (!pricelistId) {
    return NextResponse.json({ error: "חסרה מכירה" }, { status: 400 });
  }
  const sale = await prisma.pricelist.findUnique({ where: { id: pricelistId }, select: SALE_SELECT });
  if (!sale) {
    return NextResponse.json({ error: "המכירה לא נמצאה" }, { status: 404 });
  }
  // ⚠️ מכירה שאינה פעילה / לנציגים בלבד — הלקוח לא יכול להזמין בה,
  // והודעה "נפתחה" הייתה שקר.
  if (sale.status !== "ACTIVE") {
    return NextResponse.json({ error: "המכירה אינה פעילה — הפעל אותה לפני ההודעה" }, { status: 400 });
  }
  if (sale.agentOnly) {
    return NextResponse.json({ error: "מכירה לנציגים בלבד אינה מוצגת ללקוחות" }, { status: 400 });
  }
  if (sale.closeDate && new Date(sale.closeDate) < new Date()) {
    return NextResponse.json({ error: "המכירה כבר נסגרה להזמנות" }, { status: 400 });
  }
  if (sendEmail && sale.launchSentAt && b.force !== true) {
    return NextResponse.json(
      {
        error: `הודעת פתיחה כבר נשלחה במייל למכירה זו (${sale.launchSentCount} נמענים). לשליחה חוזרת יש לאשר.`,
        code: "ALREADY_SENT",
      },
      { status: 409 }
    );
  }

  let emailCount = 0;
  if (sendEmail) {
    if (!subjectT || !emailT) {
      return NextResponse.json({ error: "יש למלא כותרת ותוכן למייל" }, { status: 400 });
    }
    const subject = fillLaunchText(subjectT, sale).replace(/\n/g, " ");
    const body = fillLaunchText(emailT, sale);
    const recipients = await prisma.customer.findMany({
      where: (await launchRecipientsWhere(sale.id)) as any,
      select: { name: true, email: true },
    });
    if (recipients.length > 3000) {
      return NextResponse.json(
        { error: `יותר מדי נמענים (${recipients.length}). מקסימום 3000.` },
        { status: 400 }
      );
    }
    emailCount = recipients.length;
    // ⚠️ מסמנים **לפני** השליחה: לחיצה כפולה לא תשלח פעמיים
    await prisma.pricelist.update({
      where: { id: sale.id },
      data: { launchSentAt: new Date(), launchSentCount: emailCount },
    });
    if (recipients.length > 0) {
      waitUntil(
        sendEmailsInBatches(recipients, subject, textToHtml(body), "sale-launch").catch((e) =>
          console.error("[sale-launch] send error:", e)
        )
      );
    }
  }

  let phoneCreated = false;
  if (sendPhone) {
    if (!phoneT) {
      return NextResponse.json({ error: "יש למלא נוסח להודעה הטלפונית" }, { status: 400 });
    }
    const text = fillLaunchPhone(phoneT, sale).slice(0, 450);
    // הודעת פתיחה קודמת של המכירה — מכובה (לא שתיים ברצף)
    await prisma.phoneAnnouncement.updateMany({
      where: { pricelistId: sale.id, oncePerCaller: true, isActive: true },
      data: { isActive: false },
    });
    await prisma.phoneAnnouncement.create({
      data: {
        pricelistId: sale.id,
        pointId: null,
        text,
        isActive: true,
        oncePerCaller: true,
        // נשמעת עד סגירת ההזמנות; בלי תאריך סגירה — עד שמכבים
        expiresAt: sale.closeDate ?? null,
        createdBy: g.session?.user?.email ?? null,
      },
    });
    phoneCreated = true;
  }

  return NextResponse.json({
    ok: true,
    emailCount,
    phoneCreated,
    message:
      (sendEmail ? `המייל נשלח ברקע ל-${emailCount} לקוחות. ` : "") +
      (phoneCreated ? "ההודעה הטלפונית פעילה — כל מתקשר ישמע אותה פעם אחת." : ""),
  });
}
