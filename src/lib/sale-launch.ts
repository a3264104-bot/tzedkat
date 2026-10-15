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
//
// §403: המנהל **לא רואה את המשתנים**. במסך "שליחת מייל ללקוחות" הוא
// בוחר "📣 פתיחת מכירה: <מכירה>" והטקסט מגיע ממולא. שמירה כנוסח קבוע
// מחליפה את הערכים בחזרה למשתנים (tokenizeLaunchText).

import { prisma } from "@/lib/prisma";

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
  tokenizeLaunchText,
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
