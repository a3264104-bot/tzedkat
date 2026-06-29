import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/guard";

export async function GET(req: Request) {
  const g = await requireAdmin();
  if (!g.ok) return g.res;
  const { searchParams } = new URL(req.url);
  const pricelistId = searchParams.get("pricelistId") || undefined;

  const where = pricelistId ? { pricelistId } : {};

  const orders = await prisma.order.findMany({
    where,
    include: { point: true, items: true },
  });

  const active = orders.filter((o) => o.status !== "CANCELLED");

  // dashboard numbers
  const totalOrders = active.length;
  const estimatedSales = active.reduce((s, o) => s + Number(o.estimatedTotal), 0);
  const finalSales = active.reduce((s, o) => s + Number(o.finalTotal ?? 0), 0);

  // by point
  const byPointMap = new Map<string, { name: string; orders: number; total: number }>();
  for (const o of active) {
    const cur = byPointMap.get(o.pointId) || { name: o.point.name, orders: 0, total: 0 };
    cur.orders++;
    cur.total += Number(o.finalTotal ?? o.estimatedTotal);
    byPointMap.set(o.pointId, cur);
  }
  const byPoint = Array.from(byPointMap.values()).sort((a, b) => b.orders - a.orders);

  // product summary (qty to prepare)
  const prodMap = new Map<string, { name: string; unit: string; qty: number; total: number }>();
  for (const o of active) {
    for (const it of o.items) {
      const key = it.productName;
      const cur = prodMap.get(key) || { name: it.productName, unit: it.unit, qty: 0, total: 0 };
      cur.qty += Number(it.finalWeight ?? it.quantity);
      cur.total += Number(it.finalPrice ?? it.estimatedPrice);
      prodMap.set(key, cur);
    }
  }
  const products = Array.from(prodMap.values()).sort((a, b) => b.qty - a.qty);

  // אזהרות כמות מוגבלת — סך הוזמן מול המגבלה שהמנהל הגדיר
  const limitedProducts = await prisma.product.findMany({
    where: { limitedQty: true, limitedQtyAmount: { not: null } },
    select: { id: true, name: true, unit: true, limitedQtyAmount: true },
  });
  const orderedByProductId = new Map<string, number>();
  for (const o of active) {
    for (const it of o.items) {
      const cur = orderedByProductId.get(it.productId) || 0;
      orderedByProductId.set(it.productId, cur + Number(it.finalWeight ?? it.quantity));
    }
  }
  const limitedWarnings = limitedProducts
    .map((p) => {
      const ordered = orderedByProductId.get(p.id) || 0;
      const limit = p.limitedQtyAmount as number;
      const ratio = limit > 0 ? ordered / limit : 0;
      return {
        name: p.name,
        unit: p.unit,
        ordered: Math.round(ordered * 1000) / 1000,
        limit,
        ratio,
        level: ratio >= 1 ? "over" : ratio >= 0.8 ? "near" : "ok",
      };
    })
    .filter((w) => w.level !== "ok")
    .sort((a, b) => b.ratio - a.ratio);

  // customers
  const custMap = new Map<
    string,
    { name: string; phone: string; orders: number; total: number; point: string }
  >();
  for (const o of active) {
    const key = o.phone;
    const cur = custMap.get(key) || {
      name: o.customerName,
      phone: o.phone,
      orders: 0,
      total: 0,
      point: o.point.name,
    };
    cur.orders++;
    cur.total += Number(o.finalTotal ?? o.estimatedTotal);
    custMap.set(key, cur);
  }
  const customers = Array.from(custMap.values()).sort((a, b) => b.total - a.total);

  // status breakdown
  const statusCounts: Record<string, number> = {};
  for (const o of orders) statusCounts[o.status] = (statusCounts[o.status] || 0) + 1;

  const newOrders = orders
    .filter((o) => o.status === "NEW")
    .slice(0, 10)
    .map((o) => ({
      id: o.id,
      orderNumber: o.orderNumber,
      customerName: o.customerName,
      point: o.point.name,
      total: Number(o.estimatedTotal),
      createdAt: o.createdAt,
    }));

  return NextResponse.json({
    totalOrders,
    estimatedSales: Math.round(estimatedSales * 100) / 100,
    finalSales: Math.round(finalSales * 100) / 100,
    byPoint,
    products,
    customers,
    statusCounts,
    newOrders,
    limitedWarnings,
    topProducts: products.slice(0, 5),
  });
}
