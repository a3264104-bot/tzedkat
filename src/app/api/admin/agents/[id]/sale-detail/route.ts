// §20: פירוט מלא של פעילות נציג במכירה מסוימת
// GET /api/admin/agents/[id]/sale-detail?pricelistId=X
// מחזיר את כל ההזמנות שהנציג טיפל בהן + כל המזדמנים שלו

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/guard";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const g = await requireAdmin();
  if (!g.ok) return g.res;

  const { id } = await params;
  const url = new URL(req.url);
  const pricelistId = url.searchParams.get("pricelistId");

  if (!pricelistId) {
    return NextResponse.json({ error: "pricelistId חובה" }, { status: 400 });
  }

  // פרטי הנציג
  const agent = await prisma.customer.findUnique({
    where: { id: id },
    select: {
      id: true,
      name: true,
      phone: true,
      email: true,
      role: true,
      agentPointId: true,
      agentPoint: { select: { id: true, name: true, city: true } },
      commissionRateCarton: true,
      commissionRateSingles: true,
    },
  });

  if (!agent) {
    return NextResponse.json({ error: "נציג לא נמצא" }, { status: 404 });
  }

  // פרטי המכירה
  const pricelist = await prisma.pricelist.findUnique({
    where: { id: pricelistId },
    select: {
      id: true,
      name: true,
      status: true,
      deliveryDate: true,
      deliveryDateText: true,
    },
  });

  if (!pricelist) {
    return NextResponse.json({ error: "מחירון לא נמצא" }, { status: 404 });
  }

  // הזמנות של *כל* נקודות הנציג במכירה זו.
  // 🐛 תוקן: הסינון היה לפי agentPointId היחיד (deprecated), ולכן נציג
  // המשויך לכמה נקודות הוצג עם חלק מההזמנות שלו בלבד.
  const agentPointsRows = await prisma.agentPoint.findMany({
    where: { agentId: id },
    select: { pointId: true },
  });
  const agentPointIds =
    agentPointsRows.length > 0
      ? agentPointsRows.map((ap) => ap.pointId)
      : agent.agentPointId
        ? [agent.agentPointId]
        : [];

  const whereOrders: any = {
    pricelistId,
    status: { notIn: ["CANCELLED"] },
  };
  if (agentPointIds.length > 0) {
    whereOrders.pointId = { in: agentPointIds };
  }

  const orders = await prisma.order.findMany({
    where: whereOrders,
    orderBy: [{ createdAt: "asc" }],
    include: {
      point: { select: { id: true, name: true } },
      items: {
        include: {
          product: { select: { id: true, name: true, unit: true } },
        },
      },
    },
  });

  // מזדמנים שלו במכירה
  // 🐛 תוקן באג חמור: היה `where: { pricelistId, id }` - כלומר חיפש מזדמן
  // שה-id שלו זהה ל-id של הנציג, מה שכמעט תמיד החזיר אפס תוצאות.
  // כתוצאה מכך המסך הציג 0 מזדמנים ו-0₪ הכנסות מהם לכל נציג, וגם
  // stats.totalRevenue יצא נמוך מדי. השדה הנכון הוא agentId.
  const walkins = await prisma.walkinOrder.findMany({
    where: { pricelistId, agentId: id },
    orderBy: { createdAt: "desc" },
    include: {
      items: {
        include: {
          product: { select: { id: true, name: true, unit: true } },
        },
      },
    },
  });

  // סיכום הנציג
  const summary = await prisma.agentSaleSummary.findUnique({
    where: { pricelistId_agentId: { pricelistId, agentId: id } },
  });

  // תשלומים של הנציג במכירה זו
  const payments = await prisma.agentPayment.findMany({
    where: { agentId: id, pricelistId },
    orderBy: { createdAt: "desc" },
  });

  // חישוב סטטיסטיקות
  let totalOrderRevenue = 0;
  let itemsEntered = 0;
  let itemsTotal = 0;
  let itemsCancelled = 0;

  for (const o of orders) {
    for (const it of o.items) {
      if (it.isCancelled) {
        itemsCancelled++;
        continue;
      }
      itemsTotal++;
      if (it.agentEnteredWeight) itemsEntered++;
      if (it.finalPrice) totalOrderRevenue += Number(it.finalPrice);
      else if (it.estimatedPrice) totalOrderRevenue += Number(it.estimatedPrice);
    }
  }

  let walkinRevenue = 0;
  let walkinCash = 0;
  for (const w of walkins) {
    walkinRevenue += Number(w.totalAmount);
    if (w.paymentMethod === "CASH" && w.paymentReceived) {
      walkinCash += Number(w.totalAmount);
    }
  }

  return NextResponse.json({
    agent: {
      id: agent.id,
      name: agent.name,
      phone: agent.phone,
      email: agent.email,
      point: agent.agentPoint,
      commissionRateCarton: Number(agent.commissionRateCarton),
      commissionRateSingles: Number(agent.commissionRateSingles),
    },
    pricelist: {
      id: pricelist.id,
      name: pricelist.name,
      status: pricelist.status,
      deliveryDate: pricelist.deliveryDate?.toISOString() || null,
      deliveryDateText: pricelist.deliveryDateText,
    },
    stats: {
      totalOrders: orders.length,
      totalWalkins: walkins.length,
      itemsTotal,
      itemsEntered,
      itemsCancelled,
      totalOrderRevenue,
      walkinRevenue,
      walkinCash,
      totalRevenue: totalOrderRevenue + walkinRevenue,
    },
    orders: orders.map((o) => ({
      id: o.id,
      orderNumber: o.orderNumber,
      customerName: o.customerName,
      phone: o.phone,
      status: o.status,
      finalTotal: o.finalTotal ? Number(o.finalTotal) : null,
      point: o.point,
      createdAt: o.createdAt.toISOString(),
      items: o.items.map((it) => ({
        id: it.id,
        productName: it.productName,
        unit: it.unit,
        isSingle: it.isSingle,
        quantity: Number(it.quantity),
        unitPrice: Number(it.unitPrice),
        estimatedWeight: it.estimatedWeight ? Number(it.estimatedWeight) : null,
        actualWeight: it.actualWeight ? Number(it.actualWeight) : null,
        agentEnteredWeight: it.agentEnteredWeight ? Number(it.agentEnteredWeight) : null,
        finalPrice: it.finalPrice ? Number(it.finalPrice) : null,
        agentNote: it.agentNote,
        isCancelled: it.isCancelled,
        originalProductId: it.originalProductId,
      })),
    })),
    walkins: walkins.map((w) => ({
      id: w.id,
      walkinNumber: w.walkinNumber,
      customerName: w.customerName,
      customerPhone: w.customerPhone,
      customerEmail: w.customerEmail,
      paymentMethod: w.paymentMethod,
      paymentReceived: w.paymentReceived,
      paymentNote: w.paymentNote,
      totalAmount: Number(w.totalAmount),
      notes: w.notes,
      summarySentAt: w.summarySentAt?.toISOString() || null,
      createdAt: w.createdAt.toISOString(),
      items: w.items.map((it) => ({
        id: it.id,
        productName: it.productName,
        weight: Number(it.weight),
        unitPrice: Number(it.unitPrice),
        totalPrice: Number(it.totalPrice),
        isSingle: it.isSingle,
      })),
    })),
    summary: summary
      ? {
          status: summary.status,
          totalCartonWeight: Number(summary.totalCartonWeight),
          totalSinglesWeight: Number(summary.totalSinglesWeight),
          totalWalkinWeight: Number(summary.totalWalkinWeight),
          totalCommission: Number(summary.totalCommission),
          cartonCommission: Number(summary.cartonCommission),
          singlesCommission: Number(summary.singlesCommission),
          remainderNote: summary.remainderNote,
          confirmedAt: summary.confirmedAt?.toISOString() || null,
        }
      : null,
    payments: payments.map((p) => ({
      id: p.id,
      amount: Number(p.amount),
      type: p.type,
      method: p.method,
      note: p.note,
      createdAt: p.createdAt.toISOString(),
    })),
  });
}
