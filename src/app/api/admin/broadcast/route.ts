// POST /api/admin/broadcast
// שולח מייל עם הודעה מוכנה לרשימת נמענים.
//
// Body: {
//   subject: string,
//   message: string,        // טקסט פשוט - ייהפך ל-HTML עם שמירה על שורות חדשות
//   mode: "all" | "point" | "manual",
//   pointIds?: string[],    // רק אם mode=point
//   customerIds?: string[], // רק אם mode=manual
//   launchPricelistId?: string, // §403: 📣 הודעת פתיחת מכירה
//   phoneText?: string,         // §403: הנוסח לטלפון (בפתיחת מכירה)
//   force?: boolean,            // §403: שליחה חוזרת של הודעת פתיחה
// }
//
// §403: 📣 **פתיחת מכירה** — אותה שליחה, ושני הבדלים:
//   1. הטלפון: הודעה **חד-פעמית לכל מתקשר** במכירה הזו (oncePerCaller),
//      שנשמעת עד סגירת ההזמנות — גם למי שעוד לא הזמין.
//   2. נרשם שנשלחה (launchSentAt) — ושליחה שנייה דורשת אישור.
//
// הגנות:
//   - רק ADMIN יכול לשלוח
//   - Resend Free tier: 100 מיילים בשעה. משלחים בקצב 8 בשנייה עם פאוזה כל batch.
//   - השליחה רצה ברקע דרך waitUntil: מחזירים 200 מיד עם count,
//     ו-Vercel ממתין לסיום המשימה במקום לקטוע אותה.

import { NextResponse } from "next/server";
import { waitUntil } from "@vercel/functions";
import { prisma } from "@/lib/prisma";
// §396: הודעה קולית למכירה שהמתקשר שומע (רגילה/שבועית)
import { resolveCustomerSaleId } from "@/lib/weekly-sales";
import { requireAdmin } from "@/lib/guard";
import {
  cleanBroadcastAttachments,
  type BroadcastAttachment,
} from "@/lib/broadcast-attachments";
import { sendBroadcastBatch, type SaleExcelInfo } from "@/lib/email";
// §inbound: קובץ הזמנה אישי מצורף להודעת פתיחה
import { loadSaleExcelBase, buildCustomerSaleFile, saleFileName, type SaleExcelBase } from "@/lib/excel-sale-file";
import {
  createPhoneAnnouncement,
  expiryForDelivery,
} from "@/lib/announcement-helper";
import { voiceInBackground } from "@/lib/phone-voice";

// 🐛 Resend מגביל ל-2 בקשות בשנייה. 8 מיילים במקביל כל 1.2 שניות חרגו
// פי 3 — בהודעת הפתיחה של חשון נכשלו 575 מתוך 743. עכשיו: Batch API
// (100 מיילים בבקשה אחת), בקשה אחת כל 0.7 שניות, וניסיון חוזר על 429.
const BATCH_SIZE = 100;
const BATCH_DELAY_MS = 700;
const RATE_LIMIT_RETRIES = 4;

export async function POST(req: Request) {
  const g = await requireAdmin();
  if (!g.ok) return g.res;

  const body = await req.json().catch(() => ({}));
  const subject = String(body?.subject || "").trim();
  const message = String(body?.message || "").trim();
  const mode = String(body?.mode || "");
  const pointIds: string[] = Array.isArray(body?.pointIds) ? body.pointIds : [];
  const customerIds: string[] = Array.isArray(body?.customerIds) ? body.customerIds : [];
  const launchPricelistId = body?.launchPricelistId ? String(body.launchPricelistId) : "";
  const phoneText = String(body?.phoneText ?? "").trim();
  // §404: 📎 תמונה / PDF — רק כאלה שהועלו דרכנו
  const attachments = cleanBroadcastAttachments(body?.attachments);

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

  // §403: 📣 פתיחת מכירה — בדיקות לפני ששולחים משהו
  const launchSale = launchPricelistId
    ? await prisma.pricelist.findUnique({
        where: { id: launchPricelistId },
        select: {
          id: true,
          status: true,
          agentOnly: true,
          closeDate: true,
          launchSentAt: true,
          launchSentCount: true,
        },
      })
    : null;
  if (launchPricelistId) {
    if (!launchSale) {
      return NextResponse.json({ error: "המכירה לא נמצאה" }, { status: 404 });
    }
    // ⚠️ "נפתחה" על מכירה שהלקוח לא יכול להזמין בה — שקר
    if (launchSale.status !== "ACTIVE") {
      return NextResponse.json({ error: "המכירה אינה פעילה — הפעל אותה לפני ההודעה" }, { status: 400 });
    }
    if (launchSale.agentOnly) {
      return NextResponse.json({ error: "מכירה לנציגים בלבד אינה מוצגת ללקוחות" }, { status: 400 });
    }
    if (launchSale.closeDate && launchSale.closeDate < new Date()) {
      return NextResponse.json({ error: "המכירה כבר נסגרה להזמנות" }, { status: 400 });
    }
    if (launchSale.launchSentAt && body?.force !== true) {
      return NextResponse.json(
        {
          error: `הודעת פתיחה למכירה הזו כבר נשלחה (${launchSale.launchSentCount} נמענים, ${launchSale.launchSentAt.toLocaleString("he-IL", { timeZone: "Asia/Jerusalem" })}).`,
          code: "ALREADY_SENT",
        },
        { status: 409 }
      );
    }
    if (body?.alsoPhone && !phoneText) {
      return NextResponse.json({ error: "יש למלא את הנוסח לטלפון" }, { status: 400 });
    }
  }

  // בניית where clause לפי mode.
  // בכל המצבים: רק לקוחות שאישרו לקבל מיילים שיווקיים!
  // מיילים תפעוליים (אישור הזמנה/חיוב) עוברים ערוצים אחרים ולא כפופים לזה.
  const where: any = {
    role: "CUSTOMER",
    email: { not: null },
    agreedToEmails: true,
      // §52: לקוח לא פעיל לא מקבל מיילים - זו כל מטרת ההשבתה
      isActive: true,
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

  // 🐛 תוקן: הקריאה הייתה fire-and-forget בלי await, וב-Vercel זה נקטע
  // ברגע שה-route מחזיר תשובה - המיילים פשוט לא נשלחו.
  //
  // כאן לא ניתן פשוט להוסיף await: שליחה למאות נמענים בקצב מבוקר
  // עלולה לחרוג מזמן הריצה. waitUntil הוא הפתרון הנכון - הוא מבטיח
  // ש-Vercel ימתין לסיום המשימה גם אחרי שהתשובה נשלחה.
  // §403: נרשם **לפני** השליחה — לחיצה כפולה לא תשלח פעמיים
  if (launchSale) {
    await prisma.pricelist.update({
      where: { id: launchSale.id },
      data: { launchSentAt: new Date(), launchSentCount: recipients.length },
    });
  }

  // יומן שליחות: נרשם **לפני** השליחה, כל נמען כ-PENDING. כך שליחה
  // שנקטעה באמצע נראית במסך ("לא הושלמה") ולא נעלמת בשקט.
  //
  // ⚠️ כשל ברישום לא עוצר את השליחה — היומן הוא תיעוד, לא תנאי.
  let logId: string | null = null;
  try {
    const log = await prisma.broadcastLog.create({
      data: {
        createdBy: g.session?.user?.email ?? null,
        subject,
        mode,
        pricelistId: launchSale?.id ?? null,
        attachmentCount: attachments.length,
        total: recipients.length,
      },
      select: { id: true },
    });
    logId = log.id;
    await prisma.broadcastRecipient.createMany({
      data: recipients.map((r) => ({
        broadcastId: log.id,
        customerId: r.id,
        name: r.name,
        email: r.email ?? "",
      })),
    });
  } catch (e) {
    console.error("[broadcast] failed to create send log:", e);
  }

  // 📎 קובץ ההזמנה האישי — לכל מכירה פעילה שנבחרה (ובהודעת פתיחה: המכירה שלה)
  const excelSaleId = body?.attachSaleExcel ? String(body?.excelPricelistId || launchSale?.id || "") : "";
  let excelBase: SaleExcelBase | null = null;
  if (excelSaleId) {
    const sale = await prisma.pricelist.findUnique({
      where: { id: excelSaleId },
      select: { status: true, agentOnly: true },
    });
    if (!sale || sale.status !== "ACTIVE" || sale.agentOnly) {
      return NextResponse.json({ error: "אפשר לצרף קובץ הזמנה רק של מכירה פעילה ללקוחות" }, { status: 400 });
    }
    excelBase = await loadSaleExcelBase(excelSaleId);
  }
  waitUntil(
    sendBroadcastAsync(recipients, subject, messageHtml, attachments, logId, excelBase).catch((err) => {
      console.error("[broadcast] async send error:", err);
    })
  );

  // §32: הודעה קולית מקבילה, כדי שגם לקוח בלי מייל יקבל את העדכון
  // כשיתקשר. נוצרת רק אם המנהל ביקש - לא כל ברודקסט רלוונטי לטלפון
  // (למשל מייל שיווקי כללי).
  let announcementCreated = false;
  if (body?.alsoPhone && launchSale) {
    // §403: 📣 פעם אחת לכל מתקשר. הודעת פתיחה קודמת של המכירה — מכובה.
    await prisma.phoneAnnouncement.updateMany({
      where: { pricelistId: launchSale.id, oncePerCaller: true, isActive: true },
      data: { isActive: false },
    });
    const launchAnn = await prisma.phoneAnnouncement.create({
      data: {
        pricelistId: launchSale.id,
        pointId: null,
        text: phoneText.slice(0, 450),
        isActive: true,
        oncePerCaller: true,
        // נשמעת עד סגירת ההזמנות; בלי תאריך סגירה — עד שמכבים
        expiresAt: launchSale.closeDate ?? null,
        createdBy: g.session?.user?.email ?? null,
      },
      select: { id: true },
    });
    // §410: 🎙️ קול טבעי ברקע
    voiceInBackground([launchAnn.id]);
    announcementCreated = true;
  } else if (body?.alsoPhone) {
    // §396: 🔁 ההודעה הקולית נקשרת **למכירה שהמתקשר שומע**.
    //
    // ה-IVR שולף הודעות לפי המכירה של הלקוח. לקוח של נקודה שבועית
    // (כשאין רגילה שכוללת אותה) שומע את השבוע — והודעה שנקשרה רק
    // לרגילה לא הייתה מגיעה אליו.
    //
    // ⚠️ לפי נקודה: המכירה של אותה נקודה. גלובלית: הרגילה + כל
    // שבוע פעיל, כדי שכולם ישמעו.
    const regular = await prisma.pricelist.findFirst({
      where: { status: "ACTIVE", weeklySeriesId: null, agentOnly: false },
      orderBy: { createdAt: "desc" },
      select: { id: true, deliveryDate: true },
    });
    const targets: { pricelistId: string; pointId: string | null; deliveryDate: Date | null }[] = [];
    if (mode === "point" && pointIds.length > 0) {
      for (const pt of pointIds) {
        const saleId = await resolveCustomerSaleId(pt);
        if (!saleId) continue;
        const sale =
          saleId === regular?.id
            ? regular
            : await prisma.pricelist.findUnique({
                where: { id: saleId },
                select: { id: true, deliveryDate: true },
              });
        if (sale) targets.push({ pricelistId: sale.id, pointId: pt, deliveryDate: sale.deliveryDate });
      }
    } else {
      if (regular) targets.push({ pricelistId: regular.id, pointId: null, deliveryDate: regular.deliveryDate });
      const weeks = await prisma.pricelist.findMany({
        where: { status: "ACTIVE", weeklySeriesId: { not: null } },
        select: { id: true, deliveryDate: true },
      });
      for (const w of weeks) targets.push({ pricelistId: w.id, pointId: null, deliveryDate: w.deliveryDate });
    }
    for (const t of targets) {
      const res = await createPhoneAnnouncement({
        pricelistId: t.pricelistId,
        pointId: t.pointId,
        // הכותרת והתוכן יחד, כי בטלפון אין "נושא" נפרד
        text: `${subject}. ${message}`,
        // §36: התפוגה נקבעת ע"י המנהל בטופס ולא לפי תאריך החלוקה.
        expiresAt: body?.phoneExpiry
          ? new Date(body.phoneExpiry)
          : expiryForDelivery(t.deliveryDate),
        createdBy: g.session?.user?.email ?? null,
      });
      if (res.ok) announcementCreated = true;
    }
  }

  return NextResponse.json({
    ok: true,
    recipientCount: recipients.length,
    // יומן השליחה — המסך מקשר אליו כדי לעקוב אחרי ההתקדמות
    logId,
    attachmentCount: attachments.length,
    announcementCreated,
    message:
      `השליחה החלה לרקע. ${recipients.length} מיילים יישלחו בקצב מבוקר.` +
      (announcementCreated
        ? launchSale
          ? " כל מתקשר למערכת הטלפונית ישמע את ההודעה פעם אחת."
          : " ההודעה תוקרא גם למתקשרים למערכת הטלפונית."
        : ""),
  });
}

// שליחה בקצב עם ניהול batches
async function sendBroadcastAsync(
  recipients: { id: string; name: string; email: string | null }[],
  subject: string,
  messageHtml: string,
  attachments: BroadcastAttachment[] = [],
  /** יומן השליחה — null אם הרישום נכשל (השליחה ממשיכה בכל זאת) */
  logId: string | null = null,
  /** §inbound: אם צורף — קובץ הזמנה אישי לכל נמען */
  excelBase: SaleExcelBase | null = null
) {
  const total = recipients.length;
  let sent = 0;
  let failed = 0;

  console.log(`[broadcast] Starting async send: ${total} recipients`);

  for (let i = 0; i < total; i += BATCH_SIZE) {
    const batch = recipients.slice(i, i + BATCH_SIZE);
    let withEmail = batch.filter((r) => !!r.email) as {
      id: string;
      name: string;
      email: string;
      file?: { filename: string; content: Buffer; info: SaleExcelInfo };
    }[];

    // 📎 קובץ אישי לכל נמען (שם, טלפון, נקודה, חתימה) — נבנה לכל batch
    if (excelBase && withEmail.length) {
      const info = await prisma.customer.findMany({
        where: { id: { in: withEmail.map((r) => r.id) } },
        select: { id: true, name: true, phone: true, defaultPoint: { select: { name: true } } },
      });
      const byId = new Map(info.map((c) => [c.id, c]));
      const filename = saleFileName(excelBase.pricelist.name);
      withEmail = await Promise.all(
        withEmail.map(async (r) => {
          const c = byId.get(r.id);
          if (!c) return r;
          const content = await buildCustomerSaleFile(excelBase, {
            id: c.id,
            name: c.name,
            phone: c.phone,
            pointName: c.defaultPoint?.name ?? null,
          });
          return {
            ...r,
            file: {
              filename,
              content,
              info: {
                pointName: c.defaultPoint?.name ?? null,
                saleName: excelBase.pricelist.name,
                deliveryDateText: excelBase.pricelist.deliveryDateText,
                closeText: excelBase.closeText,
              },
            },
          };
        })
      );
    }

    // ניסיון חוזר עם המתנה גדלה כשחורגים ממגבלת הקצב
    let res = await sendBroadcastBatch(withEmail, subject, messageHtml, attachments);
    for (let attempt = 1; !res.ok && res.rateLimited && attempt <= RATE_LIMIT_RETRIES; attempt++) {
      await new Promise((r) => setTimeout(r, 1500 * attempt));
      res = await sendBroadcastBatch(withEmail, subject, messageHtml, attachments);
    }

    // ⛔ נגמרה המכסה ב-Resend: עוצרים כאן. כל השאר ייכשל באותה סיבה, וכל
    // ניסיון נוסף רק מעכב. כל מי שלא נשלח מסומן "נכשל" עם הסיבה — כך
    // היומן מציג אזהרה וכפתור "שלח שוב" למחר.
    if (!res.ok && res.quota) {
      const reason =
        res.quota === "daily"
          ? "⛔ נגמרה מכסת המיילים היומית של ספק המיילים — לא נשלח"
          : "⛔ נגמרה מכסת המיילים החודשית של ספק המיילים — לא נשלח";
      const rest = recipients.slice(i);
      failed += rest.length;
      console.error(`[broadcast] quota exceeded (${res.quota}) — stopping. ${rest.length} not sent.`);
      if (logId) {
        await prisma.broadcastRecipient
          .updateMany({
            where: { broadcastId: logId, status: "PENDING" },
            data: { status: "FAILED", error: reason },
          })
          .catch((e) => console.error("[broadcast] failed to mark quota failures:", e));
      }
      break;
    }

    const outcome = new Map<string, { ok: true; id: string } | { ok: false; error: string }>();
    for (const r of batch) if (!r.email) outcome.set(r.id, { ok: false, error: "אין כתובת מייל" });
    withEmail.forEach((r, j) => {
      outcome.set(r.id, res.ok ? res.results[j] : { ok: false, error: res.error });
    });

    const updates: Promise<unknown>[] = [];
    for (const r of batch) {
      const o = outcome.get(r.id)!;
      if (o.ok) {
        sent++;
        if (logId) {
          updates.push(
            prisma.broadcastRecipient.updateMany({
              where: { broadcastId: logId, customerId: r.id },
              data: { status: "SENT", resendId: o.id, sentAt: new Date(), error: null },
            })
          );
        }
      } else {
        failed++;
        console.error("[broadcast] send failed:", r.email, o.error);
        if (logId) {
          updates.push(
            prisma.broadcastRecipient.updateMany({
              where: { broadcastId: logId, customerId: r.id },
              data: { status: "FAILED", error: o.error.slice(0, 500) },
            })
          );
        }
      }
    }
    // ⚠️ המונים מתעדכנים בכל batch ולא רק בסוף: שליחה שנקטעה תראה
    // כמה כבר יצאו, ולא 0.
    if (logId) {
      updates.push(prisma.broadcastLog.update({ where: { id: logId }, data: { sent, failed } }));
      await Promise.allSettled(updates);
    }

    // המתנה לפני הbatch הבא (חוץ מהאחרון)
    if (i + BATCH_SIZE < total) {
      await new Promise((resolve) => setTimeout(resolve, BATCH_DELAY_MS));
    }
  }

  console.log(`[broadcast] Done. sent=${sent}, failed=${failed}, total=${total}`);
  if (logId) {
    await prisma.broadcastLog
      .update({
        where: { id: logId },
        data: { sent, failed, status: "DONE", finishedAt: new Date() },
      })
      .catch((e) => console.error("[broadcast] failed to close send log:", e));
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
