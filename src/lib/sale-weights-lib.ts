// ═══════════════════════════════════════════════════════════════
// ⚖️ סיכום משקלים של מכירה — כל ההזמנות וכל המשקלים שהוזנו
// ═══════════════════════════════════════════════════════════════
// משותף למסך (/admin/sale-weights) ולאקסל (גיליון לכל נקודה).
// מבנה: נקודה → לקוח (הזמנה) → פריט, עם הכמות שהוזמנה, משקל לכל
// קרטון (weightParts), סה"כ משקל ומחיר.
//
// ⚠️ הזמנות מבוטלות לא נכללות. פריט מבוטל מוצג (מסומן) ולא נספר.

import { prisma } from "@/lib/prisma";

export type WeightItem = {
  productName: string;
  isSingle: boolean;
  unit: string;
  quantity: number;
  /** משקל לכל קרטון, אם הוזן בפירוט */
  parts: (number | null)[] | null;
  /** המשקל שהוזן (הנציג) / בפועל */
  weight: number | null;
  unitPrice: number;
  finalPrice: number | null;
  cancelled: boolean;
};
export type WeightOrder = {
  orderNumber: number;
  customerName: string;
  phone: string;
  paymentStatus: string;
  locked: boolean;
  finalTotal: number | null;
  items: WeightItem[];
  missing: number;
};
export type WeightPoint = {
  pointId: string;
  pointName: string;
  orders: WeightOrder[];
  totalWeight: number;
  totalFinal: number;
  missing: number;
  /** סיכום לפי מוצר בנקודה */
  products: { name: string; quantity: number; weight: number }[];
};

const r3 = (n: number) => Math.round(n * 1000) / 1000;
const r2 = (n: number) => Math.round(n * 100) / 100;

export async function loadSaleWeights(pricelistId: string) {
  const pricelist = await prisma.pricelist.findUnique({
    where: { id: pricelistId },
    select: { id: true, name: true, status: true, deliveryDateText: true },
  });
  if (!pricelist) return null;

  const orders = await prisma.order.findMany({
    where: { pricelistId, status: { not: "CANCELLED" } },
    orderBy: [{ customerName: "asc" }],
    select: {
      orderNumber: true,
      customerName: true,
      phone: true,
      paymentStatus: true,
      agentClosedAt: true,
      weightsLockedAt: true,
      finalTotal: true,
      pointId: true,
      pointNameSnapshot: true,
      point: { select: { name: true } },
      items: {
        orderBy: { productName: "asc" },
        select: {
          productName: true,
          isSingle: true,
          unit: true,
          quantity: true,
          weightParts: true,
          agentEnteredWeight: true,
          actualWeight: true,
          unitPrice: true,
          agentSetPrice: true,
          finalPrice: true,
          isCancelled: true,
        },
      },
    },
  });

  const byPoint = new Map<string, WeightPoint>();
  for (const o of orders) {
    const key = o.pointId;
    let p = byPoint.get(key);
    if (!p) {
      p = {
        pointId: key,
        pointName: o.point?.name ?? o.pointNameSnapshot ?? "ללא נקודה",
        orders: [],
        totalWeight: 0,
        totalFinal: 0,
        missing: 0,
        products: [],
      };
      byPoint.set(key, p);
    }
    const items: WeightItem[] = o.items.map((it) => {
      const w =
        it.actualWeight != null
          ? Number(it.actualWeight)
          : it.agentEnteredWeight != null
            ? Number(it.agentEnteredWeight)
            : null;
      return {
        productName: it.productName,
        isSingle: it.isSingle,
        unit: it.unit,
        quantity: Number(it.quantity),
        parts: Array.isArray(it.weightParts)
          ? (it.weightParts as unknown[]).map((x) => (x == null ? null : Number(x)))
          : null,
        weight: w,
        unitPrice: Number(it.agentSetPrice ?? it.unitPrice),
        finalPrice: it.finalPrice != null ? Number(it.finalPrice) : null,
        cancelled: it.isCancelled,
      };
    });
    const missing = items.filter((i) => !i.cancelled && i.weight == null).length;
    p.orders.push({
      orderNumber: o.orderNumber,
      customerName: o.customerName,
      phone: o.phone,
      paymentStatus: o.paymentStatus,
      locked: !!(o.agentClosedAt || o.weightsLockedAt),
      finalTotal: o.finalTotal != null ? Number(o.finalTotal) : null,
      items,
      missing,
    });
    p.missing += missing;
    p.totalFinal = r2(p.totalFinal + (o.finalTotal != null ? Number(o.finalTotal) : 0));
    for (const i of items) {
      if (i.cancelled) continue;
      p.totalWeight = r3(p.totalWeight + (i.weight ?? 0));
      const name = i.productName + (i.isSingle ? " (בודדים)" : "");
      let pr = p.products.find((x) => x.name === name);
      if (!pr) {
        pr = { name, quantity: 0, weight: 0 };
        p.products.push(pr);
      }
      pr.quantity = r3(pr.quantity + i.quantity);
      pr.weight = r3(pr.weight + (i.weight ?? 0));
    }
  }

  const points = [...byPoint.values()].sort((a, b) => a.pointName.localeCompare(b.pointName, "he"));
  for (const p of points) p.products.sort((a, b) => a.name.localeCompare(b.name, "he"));
  return {
    pricelist,
    points,
    totals: {
      orders: orders.length,
      weight: r3(points.reduce((s, p) => s + p.totalWeight, 0)),
      final: r2(points.reduce((s, p) => s + p.totalFinal, 0)),
      missing: points.reduce((s, p) => s + p.missing, 0),
    },
  };
}
