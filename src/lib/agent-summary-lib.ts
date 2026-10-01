// ═══════════════════════════════════════════════════════════════
// §398: 🧮 סיכום הנציג במכירה — מקור אחד
// ═══════════════════════════════════════════════════════════════
// הפונקציה הייתה מועתקת בשלושה קבצים (שקילה, הוספת מזדמן, מחיקת
// מזדמן), ושתי ההעתקות של המזדמנים היו ישנות:
//   • סיננו לפי agentPointId היחיד (deprecated) — נציג רב-נקודתי
//     קיבל עמלה על נקודה אחת בלבד
//   • לא כללו עמלת מחיר מותאם (§119) — מחיקת מזדמן הורידה אותה
//   • לא דילגו על מנהל (§70)
// עכשיו כולם קוראים לכאן, וההמרה של מזדמן ללקוח (§398) גם.

import { prisma } from "@/lib/prisma";

export async function recalculateAgentSummary(pricelistId: string, agentId: string) {
  if (!pricelistId) return;

  const agent = await prisma.customer.findUnique({
    where: { id: agentId },
    select: {
      role: true,
      agentPointId: true,
      // 🆕 כל נקודות הנציג (many-to-many)
      agentPoints: { select: { pointId: true } },
      commissionRateCarton: true,
      commissionRateSingles: true,
    },
  });
  if (!agent) return;

  // §70: מנהל אינו מקבל עמלה ואין לו סיכום נציג.
  //
  // 🐛 הבאג שנסגר כאן היה פיננסי וחמור: אצל מנהל agentPointIds ריק,
  // ואז `if (agentPointIds.length > 0)` דילג על קביעת הסינון - כלומר
  // whereOrders נשאר בלי pointId ו**כל ההזמנות במכירה כולה** נספרו
  // לזכותו. מנהל שנכנס פעם אחת למסך המכירה ועדכן משקל היה מקבל
  // שורת עמלה על מחזור המכירה השלם, ומופיע בדוח התשלומים לנציגים.
  //
  // מנהל שמשויך לנקודות (כפי שאתה עובד) אינו יוצא מן הכלל: השיוך
  // שלו הוא תפעולי, לא עמלתי.
  if (agent.role === "ADMIN") return;

  const rateCarton = Number(agent.commissionRateCarton);
  const rateSingles = Number(agent.commissionRateSingles);

  // 🐛 תוקן: החישוב סינן לפי agentPointId היחיד (deprecated), ולכן נציג
  // המשויך לכמה נקודות קיבל עמלה רק על נקודה אחת - כלומר הפסיד כסף.
  // עכשיו מסננים לפי *כל* נקודותיו, עם נפילה ל-agentPointId הישן
  // אם עדיין לא הועבר ל-many-to-many.
  const agentPointIds =
    agent.agentPoints.length > 0
      ? agent.agentPoints.map((ap) => ap.pointId)
      : agent.agentPointId
        ? [agent.agentPointId]
        : [];

  // §70: נציג בלי נקודות כלל - אין לו על מה לקבל עמלה.
  //
  // 🐛 אותו דפוס בדיוק כמו אצל המנהל: מערך ריק גרם לכך שהסינון לא
  // נקבע, וכל המכירה נספרה לזכותו. מערך ריק אינו "בלי הגבלה" - הוא
  // "אין נקודות", ושתי המשמעויות הפוכות.
  if (agentPointIds.length === 0) return;

  // כל ההזמנות של נקודות הנציג במכירה זו
  const whereOrders: any = {
    pricelistId,
    status: { notIn: ["CANCELLED"] },
    pointId: { in: agentPointIds },
  };

  const orders = await prisma.order.findMany({
    where: whereOrders,
    include: {
      items: { where: { isCancelled: false } },
    },
  });

  let totalCartonWeight = 0;
  let totalSinglesWeight = 0;
  // §392: לקוחות *ייחודיים* — ללקוח יכולות להיות כמה הזמנות באותה
  // מכירה (הזמנה נוספת אחרי תשלום), והוא נספר פעם אחת.
  const customersWithDataSet = new Set<string>();
  // §119: עמלת מוצרים מועדפים שתומחרו ע"י הנציג.
  //
  // ⚠️ **זו הפונקציה שכותבת את totalCommission למסד**, וממנה
  // קורא דוח התשלומים לנציגים אצל המנהל. בלי התוספת כאן, הנציג
  // רואה 11 ש"ח במסך שלו והמנהל משלם לו שקל - שני מספרים שונים
  // לאותה מכירה, ולשניהם יש הוכחה על המסך.
  let customCommission = 0;

  for (const order of orders) {
    let hasData = false;
    for (const it of order.items) {
      // 📌 בכוונה agentEnteredWeight ולא actualWeight: העמלה מגיעה על מה
      // שהנציג שקל וחילק בפועל, ולא על תיקון שהמנהל ביצע אחר כך.
      // §304: != null — 0 הוא משקל שהוזן, לא חוסר.
      const w =
        it.agentEnteredWeight != null ? Number(it.agentEnteredWeight) : 0;
      if (w > 0) {
        hasData = true;
        if (it.agentSetPrice != null) {
          // רצפת הנציג = המחירון פחות השקל שתמיד שלו.
          // ⚠️ המוצר **אינו** נספר גם בקרטונים/בודדים - אחרת
          // הנציג מקבל גם שקל וגם את ההפרש על אותו קילו.
          const floor = Number(it.unitPrice) - rateCarton;
          const perKg = Number(it.agentSetPrice) - floor;
          // ⚠️ perKg <= 0 אינו אמור לקרות (השרת חוסם מחיר נמוך
          // מהמחירון), אבל אם נתון ישן או פגום מגיע לכאן - הפריט
          // **חייב** ליפול לכלל הרגיל ולא להיעלם.
          //
          // 🐛 קודם היה `if (perKg > 0)` בלבד: פריט כזה לא נספר
          // לא במותאם ולא בקרטונים, והנציג הפסיד גם את השקל שלו.
          if (perKg > 0) {
            customCommission += perKg * w;
          } else if (it.isSingle) {
            totalSinglesWeight += w;
          } else {
            totalCartonWeight += w;
          }
        } else if (it.isSingle) {
          totalSinglesWeight += w;
        } else {
          totalCartonWeight += w;
        }
      }
    }
    if (hasData) customersWithDataSet.add(order.customerId);
  }
  const customersWithData = customersWithDataSet.size;

  // מזדמנים
  const walkins = await prisma.walkinOrder.findMany({
    where: { pricelistId, agentId },
    include: { items: true },
  });
  let totalWalkinWeight = 0;
  let totalWalkinCarton = 0;
  let totalWalkinSingles = 0;
  for (const w of walkins) {
    for (const it of w.items) {
      const wt = Number(it.weight);
      totalWalkinWeight += wt;
      if (it.isSingle) totalWalkinSingles += wt;
      else totalWalkinCarton += wt;
    }
  }

  const cartonCommission = (totalCartonWeight + totalWalkinCarton) * rateCarton;
  const singlesCommission = (totalSinglesWeight + totalWalkinSingles) * rateSingles;
  // §119: שלושת הרכיבים. customCommission נפרד כי הוא לא נגזר
  // מתעריף לק"ג אלא מהפרש מחיר.
  const totalCommission =
    Math.round((cartonCommission + singlesCommission + customCommission) * 100) / 100;

  await prisma.agentSaleSummary.upsert({
    where: { pricelistId_agentId: { pricelistId, agentId } },
    create: {
      pricelistId,
      agentId,
      status: "DRAFT",
      totalCartonWeight,
      totalSinglesWeight,
      totalWalkinWeight,
      totalCustomers: customersWithData,
      totalWalkins: walkins.length,
      cartonCommission,
      singlesCommission,
      customCommission: Math.round(customCommission * 100) / 100,
      totalCommission,
    },
    update: {
      totalCartonWeight,
      totalSinglesWeight,
      totalWalkinWeight,
      totalCustomers: customersWithData,
      totalWalkins: walkins.length,
      cartonCommission,
      singlesCommission,
      // §119: 🐛 חסר כאן. create כלל את השדה ו-update לא, ולכן
      // בעדכון חוזר (כל שקילה!) הערך היה נשאר מהפעם הראשונה
      // בזמן ש-totalCommission כן מתעדכן - שני מספרים שלא מסתדרים.
      customCommission: Math.round(customCommission * 100) / 100,
      totalCommission,
    },
  });
}
