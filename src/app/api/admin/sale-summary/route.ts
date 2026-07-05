import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/guard";

// סיכום מכירה מרוכז למנהל:
// - כמה הוזמן מכל מוצר (לדעת כמה להזמין מהספק)
// - התראות על מוצרים מוגבלים שמתקרבים/עברו את המכסה
// - פירוט לפי נקודת חלוקה (לרשימות איסוף)
// - סיכום תשלומים
export async function GET(req: Request) {
  const g = await requireAdmin();
  if (!g.ok) return g.res;

  const { searchParams } = new URL(req.url);
  const pricelistIdParam = searchParams.get("pricelistId");

  // ברירת מחדל: המכירה הפעילה. אפשר לבקש מכירה אחרת עם ?pricelistId=
  const pricelist = pricelistIdParam
    ? await prisma.pricelist.findUnique({ where: { id: pricelistIdParam } })
    : await prisma.pricelist.findFirst({
        where: { status: "ACTIVE" },
        orderBy: { createdAt: "desc" },
      });

  if (!pricelist) {
    return NextResponse.json({ error: "אין מכירה פעילה" }, { status: 404 });
  }

  // כל ההזמנות של המכירה (לא מבוטלות), עם פריטים ונקודה
  const orders = await prisma.order.findMany({
    where: { pricelistId: pricelist.id, status: { not: "CANCELLED" } },
    include: {
      items: { include: { product: { select: { id: true, limitedQty: true, limitedQtyAmount: true, saleType: true, priceType: true } } } },
      point: { select: { id: true, name: true, city: true } },
    },
    orderBy: { orderNumber: "asc" },
  });

  // ===== אגרגציה לפי מוצר =====
  type ProductAgg = {
    productId: string;
    productName: string;
    unit: string;
    totalQuantity: number;
    singlesQuantity: number;
    totalEstimatedWeight: number;
    totalActualWeight: number;
    orderCount: number;
    limitedQty: boolean;
    limitedQtyAmount: number | null;
  };
  const byProduct = new Map<string, ProductAgg>();

  // ===== אגרגציה לפי נקודה =====
  type PointAgg = {
    pointId: string;
    pointName: string;
    city: string | null;
    orderCount: number;
    paidCount: number;
    estimatedTotal: number;
    finalTotal: number;
    orders: {
      orderNumber: number;
      customerName: string;
      phone: string;
      status: string;
      paymentStatus: string;
      itemCount: number;
      finalTotal: number | null;
      estimatedTotal: number;
      items: { productName: string; quantity: number; unit: string; isSingle: boolean }[];
    }[];
  };
  const byPoint = new Map<string, PointAgg>();

  // ===== סיכום תשלומים =====
  const paymentSummary = {
    totalOrders: orders.length,
    paid: 0,
    pending: 0,
    estimatedSum: 0,
    finalSum: 0,
    paidSum: 0,
  };

  for (const o of orders) {
    paymentSummary.estimatedSum += Number(o.estimatedTotal);
    if (o.finalTotal != null) paymentSummary.finalSum += Number(o.finalTotal);
    if (o.paymentStatus === "PAID") {
      paymentSummary.paid++;
      paymentSummary.paidSum += Number(o.amountPaid ?? o.finalTotal ?? 0);
    } else {
      paymentSummary.pending++;
    }

    // מוצרים
    for (const it of o.items) {
      const key = it.productId;
      let agg = byProduct.get(key);
      if (!agg) {
        agg = {
          productId: it.productId,
          productName: it.productName,
          unit: it.unit,
          totalQuantity: 0,
          singlesQuantity: 0,
          totalEstimatedWeight: 0,
          totalActualWeight: 0,
          orderCount: 0,
          limitedQty: it.product?.limitedQty ?? false,
          limitedQtyAmount: it.product?.limitedQtyAmount ?? null,
        };
        byProduct.set(key, agg);
      }
      agg.totalQuantity += Number(it.quantity);
      if (it.isSingle) agg.singlesQuantity += Number(it.quantity);
      if (it.estimatedWeight != null) agg.totalEstimatedWeight += Number(it.estimatedWeight);
      if (it.finalWeight != null) agg.totalActualWeight += Number(it.finalWeight);
      agg.orderCount++;
    }

    // נקודות
    const pKey = o.pointId;
    let pAgg = byPoint.get(pKey);
    if (!pAgg) {
      pAgg = {
        pointId: o.pointId,
        pointName: o.point?.name ?? o.pointNameSnapshot ?? "",
        city: o.point?.city ?? null,
        orderCount: 0,
        paidCount: 0,
        estimatedTotal: 0,
        finalTotal: 0,
        orders: [],
      };
      byPoint.set(pKey, pAgg);
    }
    pAgg.orderCount++;
    if (o.paymentStatus === "PAID") pAgg.paidCount++;
    pAgg.estimatedTotal += Number(o.estimatedTotal);
    if (o.finalTotal != null) pAgg.finalTotal += Number(o.finalTotal);
    pAgg.orders.push({
      orderNumber: o.orderNumber,
      customerName: o.customerName,
      phone: o.phone,
      status: o.status,
      paymentStatus: o.paymentStatus,
      itemCount: o.items.length,
      finalTotal: o.finalTotal != null ? Number(o.finalTotal) : null,
      estimatedTotal: Number(o.estimatedTotal),
      items: o.items.map((it) => ({
        productName: it.productName,
        quantity: Number(it.quantity),
        unit: it.unit,
        isSingle: it.isSingle,
      })),
    });
  }

  // עיגולים + התראות מלאי מוגבל
  const products = Array.from(byProduct.values())
    .map((p) => {
      const overLimit =
        p.limitedQty && p.limitedQtyAmount != null && p.totalQuantity >= p.limitedQtyAmount;
      const nearLimit =
        p.limitedQty &&
        p.limitedQtyAmount != null &&
        !overLimit &&
        p.totalQuantity >= p.limitedQtyAmount * 0.8;
      return {
        ...p,
        totalQuantity: Math.round(p.totalQuantity * 1000) / 1000,
        totalEstimatedWeight: Math.round(p.totalEstimatedWeight * 1000) / 1000,
        totalActualWeight: Math.round(p.totalActualWeight * 1000) / 1000,
        overLimit,
        nearLimit,
      };
    })
    .sort((a, b) => b.totalQuantity - a.totalQuantity);

  const points = Array.from(byPoint.values())
    .map((p) => ({
      ...p,
      estimatedTotal: Math.round(p.estimatedTotal * 100) / 100,
      finalTotal: Math.round(p.finalTotal * 100) / 100,
    }))
    .sort((a, b) => a.pointName.localeCompare(b.pointName, "he"));

  paymentSummary.estimatedSum = Math.round(paymentSummary.estimatedSum * 100) / 100;
  paymentSummary.finalSum = Math.round(paymentSummary.finalSum * 100) / 100;
  paymentSummary.paidSum = Math.round(paymentSummary.paidSum * 100) / 100;

  return NextResponse.json({
    pricelist: {
      id: pricelist.id,
      name: pricelist.name,
      deliveryDateText: pricelist.deliveryDateText,
      status: pricelist.status,
    },
    paymentSummary,
    products,
    points,
  });
}
