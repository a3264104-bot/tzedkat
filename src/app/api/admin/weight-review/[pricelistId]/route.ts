// §20: API בקרת משקלים - המנהל רואה מה הנציג הזין ויכול לתקן
// GET /api/admin/weight-review/[pricelistId]

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/guard";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ pricelistId: string }> }
) {
  const g = await requireAdmin();
  if (!g.ok) return g.res;

  const { pricelistId } = await params;

  const pricelist = await prisma.pricelist.findUnique({
    where: { id: pricelistId },
    select: {
      id: true, name: true, status: true,
      deliveryDate: true, deliveryDateText: true,
    },
  });
  if (!pricelist) {
    return NextResponse.json({ error: "מחירון לא נמצא" }, { status: 404 });
  }

  // רשימת נציגים לצורך תצוגה
  const agents = await prisma.customer.findMany({
    where: { role: "AGENT" },
    select: { id: true, name: true },
  });
  const agentMap = new Map(agents.map((a) => [a.id, a.name]));

  // כל הזמנות של המכירה
  const orders = await prisma.order.findMany({
    where: {
      pricelistId,
      status: { notIn: ["CANCELLED"] },
    },
    orderBy: [{ createdAt: "asc" }],
    include: {
      point: { select: { id: true, name: true } },
      items: {
        select: {
          id: true,
          productId: true,
          productName: true,
          unit: true,
          isSingle: true,
          quantity: true,
          unitPrice: true,
          estimatedWeight: true,
          estimatedPrice: true,
          actualWeight: true,
          finalWeight: true,
          finalPrice: true,
          agentEnteredWeight: true,
          agentEnteredById: true,
          agentNote: true,
          isCancelled: true,
          originalProductId: true,
        },
      },
    },
  });

  return NextResponse.json({
    pricelist: {
      id: pricelist.id,
      name: pricelist.name,
      status: pricelist.status,
      deliveryDate: pricelist.deliveryDate?.toISOString() || null,
      deliveryDateText: pricelist.deliveryDateText,
    },
    orders: orders.map((o) => ({
      id: o.id,
      orderNumber: o.orderNumber,
      customerName: o.customerName,
      phone: o.phone,
      status: o.status,
      point: o.point,
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
        estimatedPrice: Number(it.estimatedPrice),
        actualWeight: it.actualWeight ? Number(it.actualWeight) : null,
        finalWeight: it.finalWeight ? Number(it.finalWeight) : null,
        finalPrice: it.finalPrice ? Number(it.finalPrice) : null,
        agentEnteredWeight: it.agentEnteredWeight ? Number(it.agentEnteredWeight) : null,
        agentEnteredBy: it.agentEnteredById ? agentMap.get(it.agentEnteredById) || null : null,
        agentNote: it.agentNote,
        isCancelled: it.isCancelled,
        originalProductId: it.originalProductId,
      })),
    })),
  });
}
