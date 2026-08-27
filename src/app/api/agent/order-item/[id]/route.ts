// §20: עדכון פריט בהזמנה על ידי הנציג
// PATCH /api/agent/order-item/[id]
// Body: {
//   agentEnteredWeight?: number,  // משקל בפועל (לעמלה - נעול)
//   actualWeight?: number,        // משקל לחיוב הלקוח (יכול להיות זהה, המנהל יתקן אח"כ)
//   agentNote?: string,           // הערה חופשית
//   isCancelled?: boolean,        // ביטול פריט (לקוח לא רצה)
//   replaceWithProductId?: string,// החלפת מוצר
// }

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAgent } from "@/lib/agent-guard";
// §147: מייל מחיר סופי - הלקוח צריך לדעת כמה לשלם
import { sendFinalPriceEmail } from "@/lib/email";
// §124: קיזוז יתרת זכות
import { applyBalanceToOrder } from "@/lib/credit-balance-lib";

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const g = await requireAgent();
  if (!g.ok) return g.res;

  const { id } = await params;
  const body = await req.json().catch(() => ({}));

  // בדיקת בעלות: פריט חייב להיות בהזמנה של אחת מהנקודות של הנציג
  const item = await prisma.orderItem.findUnique({
    where: { id },
    include: {
      order: {
        select: {
          id: true,
          pointId: true,
          pricelistId: true,
          status: true,
          // §309: נעילה אחרי שליחת המייל
          weightsLockedAt: true,
        },
      },
      product: {
        select: {
          id: true,
          name: true,
          cartonPrice: true,
          singlesMode: true,
          singleUnitPrice: true,
          singleSurcharge: true,
        },
      },
    },
  });

  if (!item) {
    return NextResponse.json({ error: "פריט לא נמצא" }, { status: 404 });
  }
  // §309: 🔒 **משקל נעול אחרי שליחת המייל.**
  //
  // המייל הוא הרגע שבו הסכום הופך למחייב - הלקוח מחזיק בידו
  // מספר. שינוי משקל אחריו יוצר פער בין מה שהוא יודע למה
  // שייגבה.
  //
  // ⚠️ זה בדיוק מה שקרה בהזמנה 616: מייל ב-20:31 עם ₪89.05,
  // ותיקון ב-20:32 ל-₪128.84.
  //
  // ⚠️ המנהל יכול לשחרר: /admin/orders/[id] → "פתח לעריכה".
  // נעילה בלי מפתח היא מלכודת.
  if ((item.order as any)?.weightsLockedAt) {
    return NextResponse.json(
      {
        error:
          "ההזמנה נעולה — נשלח ללקוח מייל עם הסכום הסופי. לשינוי יש לפנות למנהל.",
        code: "WEIGHTS_LOCKED",
      },
      { status: 423 }
    );
  }


  // 🐛 תוקן: הבדיקה השתמשה ב-agentPointId היחיד (deprecated), ולכן נציג
  // המשויך לכמה נקודות נחסם מלעדכן משקלים בכל נקודה חוץ מהראשונה.
  // §176: 🐛 ההערה כאן אמרה "ריק = בלי הגבלה (מנהל)" - וזו בדיוק
  // ההנחה השגויה. מנהל מזוהה ב-isAdmin; נציג עם מערך ריק הוא
  // נציג **בלי נקודות**, ולא נציג עם גישה לכל המערכת.
  if (!g.isAdmin && !g.agentPointIds.includes(item.order.pointId)) {
    return NextResponse.json(
      { error: "אין הרשאה - הפריט לא באחת מהנקודות שלך" },
      { status: 403 }
    );
  }

  // הזמנות שהושלמו לא ניתנות לעריכה
  if (item.order.status === "COMPLETED" || item.order.status === "CANCELLED") {
    return NextResponse.json(
      { error: "לא ניתן לערוך פריט בהזמנה שהושלמה או בוטלה" },
      { status: 400 }
    );
  }

  const data: any = {};

  // עדכון משקל בפועל (agentEnteredWeight נעול לעמלה)
  if ("agentEnteredWeight" in body) {
    // §141: null = ביטול השקילה, לא משקל 0.
    //
    // 🐛 `Number(null)` הוא 0, ולכן מחיקה הייתה נשמרת כ"הלקוח לא
    // קיבל" - ערך תקף לגמרי שהתא היה מציג כירוק. הנציג שרצה
    // לבטל משקל שגוי קיבל 0, וההזמנה נסגרה בסכום שגוי.
    //
    // ⚠️ ההבחנה קריטית: null = טרם נשקל (חוסם סגירת מכירה),
    // 0 = נשקל ומולא במפורש (תקף).
    if (body.agentEnteredWeight === null) {
      data.agentEnteredWeight = null;
      data.agentEnteredById = null;
      // המשקל והמחיר הנגזרים מתאפסים גם הם - אחרת נשאר מחיר
      // סופי שאין לו בסיס.
      data.actualWeight = null;
      data.finalWeight = null;
      data.finalPrice = null;
    } else {
    const w = Number(body.agentEnteredWeight);
    if (isNaN(w) || w < 0) {
      return NextResponse.json({ error: "משקל לא תקין" }, { status: 400 });
    }
    data.agentEnteredWeight = w;
    data.agentEnteredById = g.agent.id;
    // ה-actualWeight מסונכרן אלא אם המנהל עדכן ידנית לפני
    if (item.actualWeight === null || Number(item.actualWeight) === Number(item.agentEnteredWeight || 0)) {
      data.actualWeight = w;
      data.finalWeight = w;
      // §119: 🐛 חיוב לפי המחיר שנקבע בפועל.
      //
      // כאן היה `w * unitPrice` - כלומר **מחיר המחירון**. במוצר
      // מועדף שהנציג תמחר ב-139.90, הלקוח היה מחויב 129.90:
      //   • הלקוח משלם פחות ממה שסוכם איתו בעל פה
      //   • ההפרש שהנציג הרוויח לא נגבה מאיש
      //   • הסיכום הציג לנציג עמלה של 11 ש"ח שמעולם לא נכנסה
      //
      // agentSetPrice הוא המחיר שהלקוח באמת אמור לשלם; unitPrice
      // נשאר המחירון ומשמש רק לחישוב העמלה.
      const chargePrice =
        item.agentSetPrice != null ? Number(item.agentSetPrice) : Number(item.unitPrice);
      data.finalPrice = Math.round(w * chargePrice * 100) / 100;
    }
    }
  }

  // הערת נציג
  if ("agentNote" in body) {
    data.agentNote = body.agentNote ? String(body.agentNote).trim() : null;
  }

  // ביטול פריט
  if ("isCancelled" in body) {
    data.isCancelled = !!body.isCancelled;
    if (data.isCancelled) {
      // אם מבוטל - מאפס מחיר סופי
      data.finalPrice = 0;
    }
  }

  // החלפת מוצר
  if (body.replaceWithProductId) {
    const newProduct = await prisma.product.findUnique({
      where: { id: String(body.replaceWithProductId) },
      select: {
        id: true,
        name: true,
        unit: true,
        cartonPrice: true,
        singlesMode: true,
        singleUnitPrice: true,
        singleSurcharge: true,
      },
    });
    if (!newProduct) {
      return NextResponse.json({ error: "מוצר החלופי לא נמצא" }, { status: 404 });
    }
    // שמירת מוצר מקורי לתיעוד (אם עדיין לא נשמר)
    if (!item.originalProductId) {
      data.originalProductId = item.productId;
    }
    data.productId = newProduct.id;
    data.productName = newProduct.name;
    data.unit = newProduct.unit;
    // חישוב מחיר לפי המוצר החדש
    let newUnitPrice = Number(newProduct.cartonPrice);
    if (item.isSingle && newProduct.singlesMode === "UNITS" && newProduct.singleUnitPrice) {
      newUnitPrice = Number(newProduct.singleUnitPrice);
    } else if (item.isSingle && newProduct.singleSurcharge) {
      newUnitPrice = Number(newProduct.cartonPrice) + Number(newProduct.singleSurcharge);
    }
    data.unitPrice = newUnitPrice;
    // עדכון finalPrice אם יש משקל
    const w = data.agentEnteredWeight ?? Number(item.actualWeight || 0);
    if (w > 0 && !data.isCancelled) {
      data.finalPrice = w * newUnitPrice;
    }
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "אין שדות לעדכון" }, { status: 400 });
  }

  const updated = await prisma.orderItem.update({
    where: { id },
    data,
    include: {
      product: { select: { id: true, name: true, unit: true } },
    },
  });

  // §123: חישוב מחדש של המחיר הסופי - כולל הזיכוי.
  //
  // ⚠️ שני דברים נסגרים כאן:
  //
  // 1. עד היום רק המנהל קבע finalTotal. הנציג שקל, סימן "טופל",
  //    וההזמנה נשארה בלי מחיר סופי עד שהמנהל נגע בה - כלומר גם
  //    בלי אפשרות לחייב או לסמן מזומן.
  //
  // 2. וכשהמנהל כן חישב, הוא היה עלול לדרוס זיכוי שהנציג נתן.
  //    שני החישובים מנכים אותו עכשיו באותה נוסחה.
  //
  // ⚠️ רק כשכל הפריטים נשקלו. חישוב חלקי היה קובע מחיר שאינו
  // משקף את ההזמנה, והחיוב היה יוצא שגוי - הבאג שכבר תוקן פעם
  // בצד המנהל.
  await recomputeOrderTotal(item.order.id);

  // §299: 🐌 **סיכום הנציג מחושב מחדש בכל תא.**
  //
  // recalculateAgentSummary סורק את כל ההזמנות של הנציג במכירה
  // ומסכם משקלים ועמלות. עם 34 לקוחות ו-100 פריטים זה שאילתה
  // כבדה - ובכל הזנת משקל היא רצה שוב.
  //
  // התוצאה בשטח: הנציג מקליד משקל, ומחכה 2-3 שניות לכל תא.
  // בחלוקה עם 40 לקוחות זה עשר דקות של המתנה מצטברת.
  //
  // ⚠️ הפתרון: לא ממתינים לה. הסיכום נדרש רק כשהנציג פותח את
  // מסך הסיכום או סוגר את המכירה - לא בזמן ההקלדה.
  //
  // ⚠️ void ולא await: היא רצה ברקע, והתשובה חוזרת מיד. אם היא
  // נכשלת, החישוב הבא יתקן - הוא ממילא סורק הכל מחדש.
  void recalculateAgentSummary(
    item.order.pricelistId || "",
    g.agent.id
  ).catch((e) => {
    console.error("[order-item] agent summary recalc failed:", e);
  });

  // §72: אם זה היה הפריט הפעיל האחרון - ההזמנה כולה מתבטלת.
  // אותו כלל כמו אצל המנהל: הזמנה בלי פריטים היא רשומת רפאים
  // שמופיעה כ"ממתינה לשקילה" בלי שיש מה לשקול, ויוצרת פער בין
  // הדשבורד (סופר פריטים) לרשימת ההזמנות (מציגה סטטוס).
  if (updated.isCancelled) {
    const remaining = await prisma.orderItem.count({
      where: { orderId: updated.orderId, isCancelled: false },
    });
    if (remaining === 0) {
      await prisma.order.update({
        where: { id: updated.orderId },
        data: {
          status: "CANCELLED",
          internalNotes: "בוטלה אוטומטית - בוטלו כל הפריטים",
        },
      });
      console.log(
        `[agent-order-item] order ${updated.orderId} auto-cancelled (last item cancelled)`
      );
    }
  }

  return NextResponse.json({
    ok: true,
    item: {
      id: updated.id,
      productId: updated.productId,
      productName: updated.productName,
      agentEnteredWeight: updated.agentEnteredWeight
        ? Number(updated.agentEnteredWeight)
        : null,
      // §304: != null — משקל 0 חוזר כ-0, לא כ-null.
      actualWeight:
        updated.actualWeight != null ? Number(updated.actualWeight) : null,
      finalPrice: updated.finalPrice ? Number(updated.finalPrice) : null,
      agentNote: updated.agentNote,
      isCancelled: updated.isCancelled,
      originalProductId: updated.originalProductId,
    },
  });
}

// חישוב מחדש של סיכום הנציג במכירה - נקרא אחרי כל שינוי
async function recalculateAgentSummary(pricelistId: string, agentId: string) {
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
  let customersWithData = 0;
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
    if (hasData) customersWithData++;
  }

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

/**
 * §123: חישוב מחדש של המחיר הסופי, כולל ניכוי זיכוי.
 *
 * זהה בנוסחה לחישוב שבצד המנהל. שתי נוסחאות נפרדות היו נפרדות
 * ביום שמישהו משנה אחת מהן, והלקוח היה מחויב בסכום שתלוי במי
 * נגע בהזמנה אחרון.
 */
async function recomputeOrderTotal(orderId: string): Promise<void> {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: {
      pricelistId: true,
      creditAmount: true,
      customerId: true,
      // §134: דמי משלוח - חלק מהסכום לחיוב
      deliveryFee: true,
      deliveryRequested: true,
      // §135: חיוב נוסף
      extraCharge: true,
      items: { where: { isCancelled: false }, select: { finalPrice: true } },
    },
  });
  if (!order || order.items.length === 0) return;

  // כל הפריטים חייבים להיות שקולים. אחרת המחיר אינו סופי.
  if (!order.items.every((i) => i.finalPrice !== null)) return;

  const itemsSum = order.items.reduce((s, i) => s + Number(i.finalPrice), 0);
  const pl = order.pricelistId
    ? await prisma.pricelist.findUnique({
        where: { id: order.pricelistId },
        select: { orderFee: true },
      })
    : null;
  const credit = order.creditAmount != null ? Number(order.creditAmount) : 0;

  // §134: 🐛 בלי דמי המשלוח כאן, **כל שקילה הייתה מוחקת אותם**.
  // הנציג מסמן משלוח, מזין משקל, והסכום חוזר לבלי משלוח - בלי
  // שאיש ישים לב עד שהלקוח מקבל חיוב נמוך מהמוסכם.
  const delivery =
    order.deliveryRequested && order.deliveryFee != null
      ? Number(order.deliveryFee)
      : 0;
  // §135: חיוב נוסף. בלעדיו כל שקילה הייתה מוחקת אותו - אותו
  // באג בדיוק שהיה עם דמי המשלוח.
  const extra = order.extraCharge != null ? Number(order.extraCharge) : 0;

  const beforeBalance = Math.max(
    0,
    Math.round(
      (itemsSum + Number(pl?.orderFee ?? 0) + delivery + extra - credit) * 100
    ) / 100
  );

  // §124: קיזוז יתרת זכות מהזמנות קודמות.
  //
  // ⚠️ אידמפוטנטי: הפונקציה מחזירה ליתרה את מה שכבר קוזז בהזמנה
  // הזו לפני שהיא מחשבת מחדש. בלי זה, כל שקילה הייתה גוזלת
  // מהיתרה שוב - והלקוח היה מאבד אותה תוך דקות.
  const { payable } = await applyBalanceToOrder(
    prisma,
    orderId,
    order.customerId,
    beforeBalance
  );

  // §147: 🐛 המחיר הסופי נקבע כאן, אבל הלקוח לא ידע.
  //
  // sendFinalPriceEmail נשלח רק ממסלול המנהל. מאז §123 הנציג
  // קובע את המחיר בעצמו בשקילה - והלקוח נשאר בלי שום הודעה.
  //
  // ⚠️ זה קריטי ללקוח **מזומן**: הוא צריך לדעת כמה להביא לחלוקה.
  // לקוח אשראי יגלה כשהכרטיס יחויב, אבל מזומן פשוט יגיע בלי סכום.
  //
  // ⚠️ נשלח **פעם אחת בלבד**. recomputeOrderTotal רץ בכל שקילה,
  // ובלי הבדיקה הזו הלקוח היה מקבל עשרה מיילים באותה דקה.
  const wasSet = await prisma.order.findUnique({
    where: { id: orderId },
    select: {
      finalTotal: true,
      finalPriceNotifiedAt: true,
      // §266: הסטטוס הנוכחי - כדי לא לדרוס PAID או CHARGING
      paymentStatus: true,
      customer: { select: { email: true, paymentPreference: true } },
    },
  });

  // §266: 🚨 **הסטטוס לא עודכן — וזה השורש.**
  //
  // מה שקרה בשטח: נציג שוקל, finalTotal נקבע, ו-paymentStatus
  // נשאר PENDING. המסך הציג "ממתין לשקילה" על הזמנה שכבר נשקלה,
  // והכפתור "חייב עכשיו" לא הופיע.
  //
  // רדפנו אחרי זה שעה - תיוג, סינון, hasToken - וכל אלה היו
  // תסמינים. **המקור היה כאן**: המסלול היחיד שכותב finalTotal
  // בלי לסמן שההזמנה מוכנה.
  //
  // ⚠️ READY_TO_CHARGE **רק** מ-PENDING או AWAITING_WEIGHING:
  // הזמנה ששולמה, נמצאת בחיוב, או שהכרטיס שלה בעייתי - הסטטוס
  // שלה משמעותי ואסור לדרוס אותו.
  const readyStatuses = ["PENDING", "AWAITING_WEIGHING", "TOKEN_CREATED"];
  const shouldMarkReady =
    payable > 0 && readyStatuses.includes(wasSet?.paymentStatus ?? "PENDING");

  await prisma.order.update({
    where: { id: orderId },
    data: {
      finalTotal: payable,
      ...(shouldMarkReady ? { paymentStatus: "READY_TO_CHARGE" } : {}),
    },
  });

  // §303: 🐛 **מייל נשלח בכל הזנת משקל.**
  //
  // המצב מהשטח: הנציג מזין משקל, מתקן, מזין שוב - והלקוח מקבל
  // מייל על כל שינוי. הוא רואה שלושה מיילים עם שלושה סכומים
  // שונים ולא יודע מה נכון.
  //
  // ⚠️ וגרוע מזה: המייל נשלח **לפני** שהמחיר סופי. תיקון אחרי
  // המייל אומר שהלקוח מחזיק בידו סכום שגוי.
  //
  // ⚠️ הפתרון: לא שולחים אוטומטית. המנהל שולח כשהוא מוכן,
  // מכפתור ייעודי - אחרי שכל השקילות הסתיימו.
  //
  // ⚠️ הקוד נשאר כאן ומושבת בדגל: כשתרצה להחזיר את השליחה
  // האוטומטית, זו שורה אחת. מחיקה הייתה מאלצת בנייה מחדש.
  const AUTO_EMAIL_ON_FINAL_PRICE = false;

  if (
    AUTO_EMAIL_ON_FINAL_PRICE &&
    wasSet?.customer?.email &&
    !wasSet.finalPriceNotifiedAt
  ) {
    const full = await prisma.order.findUnique({
      where: { id: orderId },
      include: { items: true, customer: true },
    });
    if (full) {
      // לא חוסם: כשל מייל לא יבטל מחיר שכבר נקבע
      sendFinalPriceEmail(full as any, wasSet.customer.email)
        .then((res) =>
          prisma.order.update({
            where: { id: orderId },
            data: res.ok
              ? { finalPriceNotifiedAt: new Date() }
              : { customerNotifyError: res.error },
          }).catch(() => null)
        )
        .catch((e) => console.error("[final-price] email failed:", e));
    }
  }
}
