// ═══════════════════════════════════════════════════════════════
// §401: 📣 הודעת פתיחת מכירה — נוסח קבוע, מייל + טלפון
// ═══════════════════════════════════════════════════════════════
// המנהל פותח מכירה ורוצה להודיע ללקוחות. במקום לנסח כל פעם מחדש:
// נוסח קבוע (הגדרות), שהמשתנים בו מתמלאים מהמכירה:
//   {מכירה}  — שם המכירה
//   {חלוקה}  — תאריך החלוקה (הטקסט העברי אם הוזן)
//   {סגירה}  — עד מתי פתוח להזמנות
//   {אתר}    — כתובת האתר
//
// ⚠️ משתנה שאין לו ערך (למשל מכירה בלי תאריך סגירה) — כל השורה
// (במייל) או המשפט (בטלפון) שבהם הוא מופיע יורדים, במקום "עד ." ריק.

import { prisma } from "@/lib/prisma";
import { sendBroadcastEmail } from "@/lib/email";

export {
  DEFAULT_LAUNCH_SUBJECT,
  DEFAULT_LAUNCH_EMAIL,
  DEFAULT_LAUNCH_PHONE,
  LAUNCH_VARS,
  launchValues,
  fillLaunchText,
  fillLaunchPhone,
  siteUrl,
  textToHtml,
} from "@/lib/sale-launch-text";
export type { LaunchSale } from "@/lib/sale-launch-text";
import {
  DEFAULT_LAUNCH_SUBJECT,
  DEFAULT_LAUNCH_EMAIL,
  DEFAULT_LAUNCH_PHONE,
} from "@/lib/sale-launch-text";

export async function getLaunchTemplates() {
  const s = await prisma.systemSettings.findUnique({
    where: { id: "singleton" },
    select: { saleLaunchSubject: true, saleLaunchEmail: true, saleLaunchPhone: true },
  });
  return {
    subject: s?.saleLaunchSubject || DEFAULT_LAUNCH_SUBJECT,
    email: s?.saleLaunchEmail || DEFAULT_LAUNCH_EMAIL,
    phone: s?.saleLaunchPhone || DEFAULT_LAUNCH_PHONE,
    isDefault: {
      subject: !s?.saleLaunchSubject,
      email: !s?.saleLaunchEmail,
      phone: !s?.saleLaunchPhone,
    },
  };
}

/**
 * הנמענים: לקוחות פעילים שאישרו מיילים, בנקודות של המכירה.
 *
 * ⚠️ לפי הנקודות של המכירה — מכירה שבועית של נקודה אחת לא שולחת
 * מייל לכל הלקוחות. לקוח בלי נקודה מקבל רק במכירה רגילה.
 */
export async function launchRecipientsWhere(pricelistId: string) {
  const pl = await prisma.pricelist.findUnique({
    where: { id: pricelistId },
    select: { weeklySeriesId: true, points: { select: { pointId: true } } },
  });
  const pointIds = pl?.points.map((p) => p.pointId) ?? [];
  const pointFilter: any[] = [{ defaultPointId: { in: pointIds } }];
  if (pl && !pl.weeklySeriesId) pointFilter.push({ defaultPointId: null });
  return {
    role: "CUSTOMER",
    email: { not: null },
    agreedToEmails: true,
    isActive: true,
    OR: pointFilter,
  };
}

const BATCH_SIZE = 8;
const BATCH_DELAY_MS = 1200;

/** שליחה בקצב מבוקר (Resend) — כמו §broadcast */
export async function sendEmailsInBatches(
  recipients: { name: string; email: string | null }[],
  subject: string,
  messageHtml: string,
  tag = "launch"
) {
  let sent = 0;
  let failed = 0;
  for (let i = 0; i < recipients.length; i += BATCH_SIZE) {
    const batch = recipients.slice(i, i + BATCH_SIZE);
    const results = await Promise.allSettled(
      batch.map((r) =>
        r.email
          ? sendBroadcastEmail(r.name, r.email, subject, messageHtml)
          : Promise.resolve({ ok: false as const, error: "no email" })
      )
    );
    for (const res of results) {
      if (res.status === "fulfilled" && res.value.ok) sent++;
      else failed++;
    }
    if (i + BATCH_SIZE < recipients.length) {
      await new Promise((r) => setTimeout(r, BATCH_DELAY_MS));
    }
  }
  console.log(`[${tag}] done sent=${sent} failed=${failed} total=${recipients.length}`);
  return { sent, failed };
}
