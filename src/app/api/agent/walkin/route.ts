// §20: יצירת/קריאת מזדמנים
// POST /api/agent/walkin - יצירת הזמנת מזדמן חדשה
// GET /api/agent/walkin?pricelistId=X - רשימה (של הנציג בלבד)

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAgent } from "@/lib/agent-guard";

// Body ל-POST:
// {
//   pricelistId: string,
//   customerName: string,
//   customerPhone?: string,
//   paymentMethod: "CASH" | "CARD_TERMINAL" | "TRANSFER" | "ONLINE",
//   paymentReceived?: boolean,   // ברירת מחדל true (למזומן/אשראי במסוף)
//   paymentNote?: string,
//   notes?: string,
//   items: [{ productId, weight, isSingle, unitPrice? }]
// }
export async function POST(req: Request) {
  const g = await requireAgent();
  if (!g.ok) return g.res;

  const body = await req.json().catch(() => ({}));
  const pricelistId = String(body.pricelistId || "").trim();
  const customerName = String(body.customerName || "").trim();
  const customerPhone = body.customerPhone ? String(body.customerPhone).trim() : null;
  const customerEmail = body.customerEmail ? String(body.customerEmail).trim() : null;
  const paymentMethod = String(body.paymentMethod || "CASH").trim();
  const items = Array.isArray(body.items) ? body.items : [];

  // ולידציה
  if (!pricelistId) {
    return NextResponse.json({ error: "pricelistId חובה" }, { status: 400 });
  }
  if (!customerName) {
    return NextResponse.json({ error: "שם לקוח חובה" }, { status: 400 });
  }
  if (customerEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customerEmail)) {
    return NextResponse.json({ error: "כתובת מייל לא תקינה" }, { status: 400 });
  }
  const allowedMethods = ["CASH", "CARD_TERMINAL", "TRANSFER", "ONLINE"];
  if (!allowedMethods.includes(paymentMethod)) {
    return NextResponse.json({ error: "אמצעי תשלום לא תקין" }, { status: 400 });
  }
  if (items.length === 0) {
    return NextResponse.json({ error: "יש להוסיף לפחות פריט אחד" }, { status: 400 });
  }

  // ולידציה + חישוב מחירים לפי המוצרים
  const productIds = items.map((it: any) => String(it.productId));
  const products = await prisma.product.findMany({
    where: { id: { in: productIds } },
    include: {
      pricelists: {
        where: { pricelistId },
        select: { price: true },
      },
    },
  });
  const pMap = new Map(products.map((p) => [p.id, p]));

  let totalAmount = 0;
  const validItems: any[] = [];
  for (const item of items) {
    const p = pMap.get(String(item.productId));
    if (!p) continue;
    const weight = Number(item.weight);
    if (isNaN(weight) || weight <= 0) continue;
    const isSingle = !!item.isSingle;

    // חישוב מחיר: אם סופק unitPrice מפורש - משתמשים בו. אחרת מהמחירון של המכירה או מ-cartonPrice
    let unitPrice = Number(item.unitPrice);
    if (isNaN(unitPrice) || unitPrice <= 0) {
      if (p.pricelists[0]?.price) {
        unitPrice = Number(p.pricelists[0].price);
      } else {
        unitPrice = Number(p.cartonPrice);
      }
      if (isSingle && p.singlesMode === "UNITS" && p.singleUnitPrice) {
        unitPrice = Number(p.singleUnitPrice);
      } else if (isSingle && p.singleSurcharge) {
        unitPrice = unitPrice + Number(p.singleSurcharge);
      }
    }

    const totalPrice = weight * unitPrice;
    totalAmount += totalPrice;

    validItems.push({
      productId: p.id,
      productName: p.name,
      weight,
      unitPrice,
      isSingle,
      totalPrice,
    });
  }

  if (validItems.length === 0) {
    return NextResponse.json({ error: "אין פריטים תקינים" }, { status: 400 });
  }

  // ברירת מחדל של paymentReceived לפי אמצעי התשלום
  let paymentReceived = body.paymentReceived;
  if (typeof paymentReceived !== "boolean") {
    // מזומן + אשראי במסוף = מיד. העברה + אשראי אונליין = מחכה לוודאות
    paymentReceived = paymentMethod === "CASH" || paymentMethod === "CARD_TERMINAL";
  }

  // §44: שיוך המזדמן לנקודת חלוקה.
  // נציג עם נקודה אחת - משויך אוטומטית בלי לשאול.
  // נציג עם כמה נקודות - חייב לבחור, אחרת ההתחשבנות לפי נקודה שגויה.
  const apList = await prisma.agentPoint.findMany({
    where: { agentId: g.agent.id },
    select: { pointId: true },
  });
  const myPoints =
    apList.length > 0
      ? apList.map((r) => r.pointId)
      : g.agent.agentPointId
        ? [g.agent.agentPointId]
        : [];

  let walkinPointId: string | null = null;
  if (body.pointId) {
    walkinPointId = String(body.pointId);
    if (myPoints.length > 0 && !myPoints.includes(walkinPointId)) {
      return NextResponse.json(
        { error: "הנקודה שנבחרה אינה משויכת אליך" },
        { status: 403 }
      );
    }
  } else if (myPoints.length === 1) {
    walkinPointId = myPoints[0];
  } else if (myPoints.length > 1) {
    return NextResponse.json(
      {
        error: "יש לבחור נקודת חלוקה",
        needsPoint: true,
        points: await prisma.deliveryPoint.findMany({
          where: { id: { in: myPoints } },
          select: { id: true, name: true, city: true },
          orderBy: { name: "asc" },
        }),
      },
      { status: 400 }
    );
  }

  const walkin = await prisma.walkinOrder.create({
    data: {
      pricelistId,
      agentId: g.agent.id,
      pointId: walkinPointId,
      customerName,
      customerPhone,
      customerEmail,
      paymentMethod,
      paymentReceived,
      paymentNote: body.paymentNote ? String(body.paymentNote).trim() : null,
      notes: body.notes ? String(body.notes).trim() : null,
      totalAmount,
      items: { create: validItems },
    },
    include: {
      items: {
        include: {
          product: { select: { id: true, name: true, unit: true } },
        },
      },
      // §44: הנקודה נדרשת לפירוט העמלות לפי נקודה
      point: { select: { id: true, name: true } },
    },
  });

  // עדכון סיכום הנציג
  await recalculateAgentSummary(pricelistId, g.agent.id);

  return NextResponse.json({
    ok: true,
    walkin: {
      id: walkin.id,
      walkinNumber: walkin.walkinNumber,
      pointId: walkin.pointId,
      pointName: walkin.point?.name ?? null,
      customerName: walkin.customerName,
      customerPhone: walkin.customerPhone,
      customerEmail: walkin.customerEmail,
      paymentMethod: walkin.paymentMethod,
      paymentReceived: walkin.paymentReceived,
      paymentNote: walkin.paymentNote,
      totalAmount: Number(walkin.totalAmount),
      notes: walkin.notes,
      items: walkin.items.map((it) => ({
        id: it.id,
        productId: it.productId,
        productName: it.productName,
        weight: Number(it.weight),
        unitPrice: Number(it.unitPrice),
        isSingle: it.isSingle,
        totalPrice: Number(it.totalPrice),
      })),
      createdAt: walkin.createdAt.toISOString(),
    },
  });
}

// חישוב מחדש של סיכום הנציג במכירה - נקרא אחרי כל שינוי במזדמנים
async function recalculateAgentSummary(pricelistId: string, agentId: string) {
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

  const whereOrders: any = { pricelistId, status: { notIn: ["CANCELLED"] } };
  // 🐛 תוקן: הסינון היה לפי agentPointId היחיד (deprecated), ולכן
  // נציג המשויך לכמה נקודות קיבל עמלה על נקודה אחת בלבד. אותו באג
  // שתוקן כבר ב-agent-guard ובמסך המכירה, ונשאר כאן.
  const apRows = await prisma.agentPoint.findMany({
    where: { agentId },
    select: { pointId: true },
  });
  const agentPointIds =
    apRows.length > 0
      ? apRows.map((r) => r.pointId)
      : agent.agentPointId
        ? [agent.agentPointId]
        : [];
  if (agentPointIds.length > 0) whereOrders.pointId = { in: agentPointIds };

  const orders = await prisma.order.findMany({
    where: whereOrders,
    include: { items: { where: { isCancelled: false } } },
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
