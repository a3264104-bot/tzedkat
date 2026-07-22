// §20: מסך הנציג למכירה
// GET /api/agent/sale/[pricelistId] - טעינת כל הנתונים למסך הנציג

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAgent } from "@/lib/agent-guard";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ pricelistId: string }> }
) {
  const g = await requireAgent();
  if (!g.ok) return g.res;

  const { pricelistId } = await params;

  // בדיקה שהמחירון קיים
  const pricelist = await prisma.pricelist.findUnique({
    where: { id: pricelistId },
    select: {
      id: true,
      name: true,
      status: true,
      deliveryDate: true,
      deliveryDateText: true,
      editDeadline: true,
    },
  });
  if (!pricelist) {
    return NextResponse.json({ error: "מחירון לא נמצא" }, { status: 404 });
  }

  // הזמנות: אם הנציג משויך לנקודה - רק ההזמנות שלה. אם לא - הכל (מנהל)
  const whereOrders: any = { pricelistId };
  if (g.agent.agentPointId) {
    whereOrders.pointId = g.agent.agentPointId;
  }

  const orders = await prisma.order.findMany({
    where: {
      ...whereOrders,
      status: { notIn: ["CANCELLED"] },
    },
    orderBy: [{ createdAt: "asc" }],
    include: {
      point: { select: { id: true, name: true, city: true } },
      customer: { select: { id: true, name: true, phone: true } },
      items: {
        include: {
          product: {
            select: {
              id: true,
              name: true,
              unit: true,
              cartonPrice: true,
              singlesMode: true,
              singleUnitPrice: true,
              singleSurcharge: true,
              avgWeightPerUnit: true,
              imageUrl: true,
            },
          },
        },
      },
    },
  });

  // מזדמנים של הנציג הזה במכירה הזאת
  const walkins = await prisma.walkinOrder.findMany({
    where: {
      pricelistId,
      agentId: g.agent.id,
    },
    orderBy: { createdAt: "desc" },
    include: {
      items: {
        include: {
          product: { select: { id: true, name: true, unit: true } },
        },
      },
    },
  });

  // תעודות משלוח מאושרות למכירה זו - הנציג רואה כמה יש לו לחלוקה
  const deliveryNotes = await prisma.deliveryNote.findMany({
    where: {
      pricelistId,
      status: "CONFIRMED",
    },
    include: {
      items: {
        include: {
          product: { select: { id: true, name: true } },
        },
      },
    },
  });

  // סיכום ק"ג לפי מוצר מהתעודות (מקור אמת לקרטונים)
  const productWeightsFromNotes: Record<string, number> = {};
  for (const note of deliveryNotes) {
    for (const item of note.items) {
      if (item.productId) {
        productWeightsFromNotes[item.productId] =
          (productWeightsFromNotes[item.productId] || 0) + Number(item.weight);
      }
    }
  }

  // סיכום נציג במכירה זו (אם קיים)
  let summary = await prisma.agentSaleSummary.findUnique({
    where: {
      pricelistId_agentId: {
        pricelistId,
        agentId: g.agent.id,
      },
    },
  });
  if (!summary) {
    summary = await prisma.agentSaleSummary.create({
      data: {
        pricelistId,
        agentId: g.agent.id,
        status: "DRAFT",
      },
    });
  }

  // מוצרים זמינים למכירה זו - לצורך החלפת מוצר / הוספת מזדמן
  const availableProducts = await prisma.pricelistProduct.findMany({
    where: { pricelistId },
    include: {
      product: {
        select: {
          id: true,
          name: true,
          unit: true,
          categoryId: true,
          category: { select: { name: true } },
          cartonPrice: true,
          singlesMode: true,
          singleUnitPrice: true,
          singleSurcharge: true,
        },
      },
    },
  });

  return NextResponse.json({
    pricelist,
    agent: {
      id: g.agent.id,
      name: g.agent.name,
      point: g.agent.agentPoint,
      commissionRateCarton: Number(g.agent.commissionRateCarton),
      commissionRateSingles: Number(g.agent.commissionRateSingles),
    },
    orders: orders.map((o) => ({
      id: o.id,
      orderNumber: o.orderNumber,
      customerName: o.customerName,
      phone: o.phone,
      customer: o.customer,
      point: o.point,
      status: o.status,
      finalTotal: o.finalTotal ? Number(o.finalTotal) : null,
      items: o.items.map((it) => ({
        id: it.id,
        productId: it.productId,
        productName: it.productName,
        unit: it.unit,
        isSingle: it.isSingle,
        quantity: Number(it.quantity),
        unitPrice: Number(it.unitPrice),
        estimatedWeight: it.estimatedWeight ? Number(it.estimatedWeight) : null,
        actualWeight: it.actualWeight ? Number(it.actualWeight) : null,
        agentEnteredWeight: it.agentEnteredWeight ? Number(it.agentEnteredWeight) : null,
        agentNote: it.agentNote,
        isCancelled: it.isCancelled,
        originalProductId: it.originalProductId,
        product: {
          ...it.product,
          cartonPrice: Number(it.product.cartonPrice),
          singleUnitPrice: it.product.singleUnitPrice
            ? Number(it.product.singleUnitPrice)
            : null,
          singleSurcharge: it.product.singleSurcharge
            ? Number(it.product.singleSurcharge)
            : null,
          avgWeightPerUnit: it.product.avgWeightPerUnit
            ? Number(it.product.avgWeightPerUnit)
            : null,
        },
      })),
    })),
    walkins: walkins.map((w) => ({
      id: w.id,
      walkinNumber: w.walkinNumber,
      customerName: w.customerName,
      customerPhone: w.customerPhone,
      paymentMethod: w.paymentMethod,
      paymentReceived: w.paymentReceived,
      paymentNote: w.paymentNote,
      totalAmount: Number(w.totalAmount),
      notes: w.notes,
      items: w.items.map((it) => ({
        id: it.id,
        productId: it.productId,
        productName: it.productName,
        weight: Number(it.weight),
        unitPrice: Number(it.unitPrice),
        isSingle: it.isSingle,
        totalPrice: Number(it.totalPrice),
        product: it.product,
      })),
      createdAt: w.createdAt.toISOString(),
    })),
    deliveryNotes: deliveryNotes.map((n) => ({
      id: n.id,
      supplierName: n.supplierName,
      noteNumber: n.noteNumber,
      confirmedAt: n.confirmedAt?.toISOString(),
      items: n.items.map((it) => ({
        productId: it.productId,
        productName: it.product?.name || it.productNameOnNote,
        quantity: it.quantity,
        weight: Number(it.weight),
      })),
    })),
    productWeightsFromNotes,
    availableProducts: availableProducts.map((pp) => ({
      productId: pp.productId,
      price: Number(pp.price),
      product: {
        ...pp.product,
        cartonPrice: Number(pp.product.cartonPrice),
        singleUnitPrice: pp.product.singleUnitPrice
          ? Number(pp.product.singleUnitPrice)
          : null,
        singleSurcharge: pp.product.singleSurcharge
          ? Number(pp.product.singleSurcharge)
          : null,
      },
    })),
    summary: {
      id: summary.id,
      status: summary.status,
      totalCartonWeight: Number(summary.totalCartonWeight),
      totalSinglesWeight: Number(summary.totalSinglesWeight),
      totalWalkinWeight: Number(summary.totalWalkinWeight),
      totalCustomers: summary.totalCustomers,
      totalWalkins: summary.totalWalkins,
      totalCommission: Number(summary.totalCommission),
      remainderNote: summary.remainderNote,
      confirmedAt: summary.confirmedAt?.toISOString(),
    },
  });
}
