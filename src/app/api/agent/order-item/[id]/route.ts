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
        select: { id: true, pointId: true, pricelistId: true, status: true },
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

  // 🐛 תוקן: הבדיקה השתמשה ב-agentPointId היחיד (deprecated), ולכן נציג
  // המשויך לכמה נקודות נחסם מלעדכן משקלים בכל נקודה חוץ מהראשונה.
  // g.agentPointIds מכיל את *כל* נקודות הנציג. ריק = בלי הגבלה (מנהל).
  if (g.agentPointIds.length > 0 && !g.agentPointIds.includes(item.order.pointId)) {
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
      // חישוב מחיר בפועל לפי המשקל החדש
      data.finalPrice = w * Number(item.unitPrice);
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

  // עדכון סיכום הנציג בזמן אמת
  await recalculateAgentSummary(item.order.pricelistId || "", g.agent.id);

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
      actualWeight: updated.actualWeight ? Number(updated.actualWeight) : null,
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

  for (const order of orders) {
    let hasData = false;
    for (const it of order.items) {
      // 📌 בכוונה agentEnteredWeight ולא actualWeight: העמלה מגיעה על מה
      // שהנציג שקל וחילק בפועל, ולא על תיקון שהמנהל ביצע אחר כך.
      const w = it.agentEnteredWeight ? Number(it.agentEnteredWeight) : 0;
      if (w > 0) {
        hasData = true;
        if (it.isSingle) totalSinglesWeight += w;
        else totalCartonWeight += w;
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
  const totalCommission = cartonCommission + singlesCommission;

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
      totalCommission,
    },
  });
}
