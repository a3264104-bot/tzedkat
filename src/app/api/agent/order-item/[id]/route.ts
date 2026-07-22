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

  // בדיקת בעלות: פריט חייב להיות בהזמנה של הנקודה של הנציג
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

  // אם הנציג משויך לנקודה - חייב להיות שהפריט בנקודה שלו
  if (g.agent.agentPointId && item.order.pointId !== g.agent.agentPointId) {
    return NextResponse.json(
      { error: "אין הרשאה - הפריט לא בנקודה שלך" },
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
      agentPointId: true,
      commissionRateCarton: true,
      commissionRateSingles: true,
    },
  });
  if (!agent) return;

  const rateCarton = Number(agent.commissionRateCarton);
  const rateSingles = Number(agent.commissionRateSingles);

  // כל ההזמנות של הנקודה של הנציג במכירה זו
  const whereOrders: any = { pricelistId, status: { notIn: ["CANCELLED"] } };
  if (agent.agentPointId) whereOrders.pointId = agent.agentPointId;

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
