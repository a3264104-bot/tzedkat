// ═══════════════════════════════════════════════════════════════
// §167: סגירת פניות פתוחות בהקמת לקוח
// ═══════════════════════════════════════════════════════════════
// 🐛 השורש של "הלקוח כבר קיים":
//
// לקוח משאיר הודעה בטלפון -> המנהל חוזר אליו -> מקים אותו במסך
// הלקוחות -> **וההודעה נשארת פתוחה לנצח**.
//
// כי customerId על ההודעה נקבע ברגע השיחה. מתקשר שלא היה רשום
// אז מקבל null, ואף אחד לא מחבר בין השניים אחר כך.
//
// התוצאה בפועל: 6 מתוך 9 ההודעות ה"חדשות" היו של לקוחות שכבר
// קיימים במערכת. המנהל לחץ "הקם לקוח" וקיבל "כבר קיים".
//
// ⚠️ הפונקציה נקראת מכל מסלול שמקים לקוח - מנהל, נציג, והרשמה
// עצמית. מסלול אחד שיישכח יחזיר את הבעיה.

import type { PrismaClient } from "@prisma/client";

/**
 * §167: סוגר כל פנייה פתוחה שקשורה לטלפון הזה.
 *
 * @returns כמה נסגרו - להחזרה למסך, כדי שהמנהל יראה שזה קרה.
 *
 * ⚠️ **לא חוסם.** כשל כאן לא יבטל הקמת לקוח שכבר בוצעה. הפנייה
 * תישאר פתוחה וניתן לסגור אותה ידנית - וזה עדיף בהרבה על לקוח
 * שלא נוצר בגלל שגיאה בניקוי.
 */
export async function closeOpenRequestsForPhone(
  prisma: PrismaClient | any,
  phone: string | null | undefined,
  customerId: string,
  note = "נסגר אוטומטית — הלקוח הוקם במערכת"
): Promise<{ messages: number; signups: number }> {
  const p = String(phone ?? "").trim();
  if (!p) return { messages: 0, signups: 0 };

  try {
    // ⚠️ שתי טבלאות נפרדות: PhoneMessage הן "שיחזרו אליי",
    // ו-PhoneSignupRequest הן "נרשמתי וצריך כרטיס". שתיהן
    // מוצגות באותו מסך, ולכן שתיהן צריכות להיסגר.
    const [msgs, signups] = await Promise.all([
      prisma.phoneMessage.updateMany({
        where: { phone: p, status: "NEW" },
        data: {
          status: "HANDLED",
          handledAt: new Date(),
          adminNote: note,
          // ⚠️ קישור ללקוח שנוצר: בלעדיו ההודעה תישאר "יתומה"
          // וגם בעתיד לא נדע למי היא שייכת.
          customerId,
        },
      }),
      prisma.phoneSignupRequest.updateMany({
        where: {
          phone: p,
          status: { in: ["NEW", "ASSIGNED", "CONTACTED"] },
        },
        data: {
          status: "COMPLETED",
          completedAt: new Date(),
          note,
        },
      }),
    ]);

    const total = msgs.count + signups.count;
    if (total > 0) {
      console.log(
        `[close-requests] phone=${p} closed messages=${msgs.count} signups=${signups.count}`
      );
    }
    return { messages: msgs.count, signups: signups.count };
  } catch (e) {
    console.error("[close-requests] failed (customer was created):", e);
    return { messages: 0, signups: 0 };
  }
}
