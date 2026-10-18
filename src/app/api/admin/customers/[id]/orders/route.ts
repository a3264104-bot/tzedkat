// ═══════════════════════════════════════════════════════════════
// היסטוריית ההזמנות של לקוח — לכרטיס הלקוח במסך המנהל
// ═══════════════════════════════════════════════════════════════
// GET /api/admin/customers/[id]/orders
//
// עד כה המנהל ראה בכרטיס רק "12 הזמנות" וקישור להזמנה הפעילה. כדי
// לענות ללקוח "מה הזמנתי בראש השנה?" או "שילמתי?" היה צריך לעבור
// למסך ההזמנות, לבחור מכירה ולחפש — מכירה אחרי מכירה.
//
// ⚠️ קריאה בלבד. כל המכירות, מהחדשה לישנה, כולל מבוטלות (הן חלק
// מההיסטוריה), עם תקרה כדי שלקוח ותיק לא יטען אלפי שורות.

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/guard";

const LIMIT = 200;

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const g = await requireAdmin();
  if (!g.ok) return g.res;
  const { id } = await params;

  const customer = await prisma.customer.findUnique({
    where: { id },
    select: { id: true, debtBalance: true, creditBalance: true },
  });
  if (!customer) {
    return NextResponse.json({ error: "לקוח לא נמצא" }, { status: 404 });
  }

  const [orders, total] = await Promise.all([
    prisma.order.findMany({
      where: { customerId: id },
      orderBy: { createdAt: "desc" },
      take: LIMIT,
      select: {
        id: true,
        orderNumber: true,
        createdAt: true,
        status: true,
        paymentStatus: true,
        source: true,
        estimatedTotal: true,
        finalTotal: true,
        amountPaid: true,
        deliveredAt: true,
        pointNameSnapshot: true,
        point: { select: { name: true } },
        pricelist: { select: { id: true, name: true } },
        _count: { select: { items: { where: { isCancelled: false } } } },
      },
    }),
    prisma.order.count({ where: { customerId: id } }),
  ]);

  const rows = orders.map((o) => ({
    id: o.id,
    orderNumber: o.orderNumber,
    createdAt: o.createdAt.toISOString(),
    status: o.status,
    paymentStatus: o.paymentStatus,
    source: o.source || "WEB",
    estimatedTotal: Number(o.estimatedTotal ?? 0),
    finalTotal: o.finalTotal != null ? Number(o.finalTotal) : null,
    amountPaid: Number(o.amountPaid ?? 0),
    delivered: !!o.deliveredAt,
    pointName: o.point?.name ?? o.pointNameSnapshot ?? null,
    saleId: o.pricelist?.id ?? null,
    saleName: o.pricelist?.name ?? null,
    itemCount: o._count.items,
  }));

  // סיכום — בלי מבוטלות
  const active = rows.filter((r) => r.status !== "CANCELLED");
  const paidSum = active.reduce((s, r) => s + r.amountPaid, 0);

  return NextResponse.json({
    total,
    shown: rows.length,
    activeCount: active.length,
    paidSum: Math.round(paidSum * 100) / 100,
    debtBalance: Number(customer.debtBalance ?? 0),
    creditBalance: Number(customer.creditBalance ?? 0),
    orders: rows,
  });
}
