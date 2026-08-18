// §113: מצב המכירה — שלב, קליטת סחורה, והתאמה כספית.
//
// GET  /api/admin/sale-status/[pricelistId]
// POST /api/admin/sale-status/[pricelistId]   { productId, cartonsReceived, weightReceived, costPerKg, notes }

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/guard";
import {
  computeSaleStage,
  buildReconciliation,
  type ReconciliationRow,
} from "@/lib/sale-lifecycle";

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
      id: true,
      name: true,
      status: true,
      closeDate: true,
      deliveryDateText: true,
      agentOnly: true,
    },
  });
  if (!pricelist) {
    return NextResponse.json({ error: "מכירה לא נמצאה" }, { status: 404 });
  }

  // ⚠️ מקבילות: השאילתות עצמאיות זו מזו, ועם המסד באירלנד כל אחת
  // היא נסיעה חוצת-אוקיינוס. הרצה בטור כאן הייתה מוסיפה שניות
  // לטעינת המסך. (אותו לקח מ-§94 ב-IVR.)
  const [products, deliveries, plans, orders] = await Promise.all([
    prisma.pricelistProduct.findMany({
      where: { pricelistId },
      select: {
        price: true,
        product: {
          // ⚠️ supplierName שייך ל-DeliveryNote (שם הספק בתעודה)
          // ולא ל-Product. אין שדה ספק על המוצר עצמו.
          select: { id: true, name: true, unit: true, cartonPrice: true },
        },
      },
    }),
    // §113: מה שהגיע מהספק מגיע מתעודות המשלוח שכבר קיימות
    // במערכת (עם OCR), ולא מטבלה נפרדת.
    //
    // ⚠️ CONFIRMED בלבד: תעודה ב-DRAFT היא פלט OCR שהמנהל טרם
    // אישר, והיא עשויה לכלול שגיאות זיהוי. בניית השוואה כספית
    // על נתונים לא מאושרים הייתה מייצרת מסקנות שגויות.
    prisma.deliveryNoteItem.findMany({
      where: {
        deliveryNote: { pricelistId, status: "CONFIRMED" },
        productId: { not: null },
      },
      select: {
        productId: true,
        quantity: true,
        weight: true,
        costPerKg: true,
      },
    }),
    prisma.supplierOrderPlan.findMany({
      where: { pricelistId },
      select: { productId: true, extraCartons: true, scope: true },
    }),
    prisma.order.findMany({
      where: { pricelistId, status: { not: "CANCELLED" } },
      select: {
        id: true,
        paymentStatus: true,
        finalTotal: true,
        items: {
          where: { isCancelled: false },
          select: {
            productId: true,
            agentEnteredWeight: true,
            actualWeight: true,
            finalPrice: true,
            estimatedPrice: true,
          },
        },
      },
    }),
  ]);

  // ─── צבירה לפי מוצר ───
  const distributed = new Map<string, { weight: number; revenue: number }>();
  let missingWeights = 0;

  for (const o of orders) {
    for (const it of o.items) {
      // agentEnteredWeight הוא מקור האמת לשקילה. actualWeight נשמר
      // כנפילה למקרים ישנים שבהם המנהל הזין ישירות.
      const w =
        it.agentEnteredWeight != null
          ? Number(it.agentEnteredWeight)
          : it.actualWeight != null
            ? Number(it.actualWeight)
            : null;
      if (w === null) {
        missingWeights++;
        continue;
      }
      const cur = distributed.get(it.productId) ?? { weight: 0, revenue: 0 };
      cur.weight += w;
      // הכנסה בפועל אם נקבעה, אחרת המשוער - כדי שהתמונה לא תהיה
      // ריקה לפני קביעת המחיר הסופי
      cur.revenue += Number(it.finalPrice ?? it.estimatedPrice ?? 0);
      distributed.set(it.productId, cur);
    }
  }

  // §113: צבירה לפי מוצר. אותו מוצר יכול להופיע בכמה תעודות
  // (משלוח מפוצל), ולכן סוכמים ולא לוקחים את האחרון.
  //
  // העלות ממוצעת **משוקללת לפי משקל** ולא ממוצע פשוט: 100 ק"ג
  // ב-30 ש"ח ו-10 ק"ג ב-50 ש"ח אינם 40 - הם 31.8. ממוצע פשוט
  // היה מנפח את העלות ומקטין את הרווח המוצג.
  const deliveryByProduct = new Map<
    string,
    { cartons: number; weight: number; costWeighted: number; costedWeight: number }
  >();
  for (const it of deliveries) {
    if (!it.productId) continue;
    const cur =
      deliveryByProduct.get(it.productId) ??
      { cartons: 0, weight: 0, costWeighted: 0, costedWeight: 0 };
    const w = Number(it.weight);
    cur.cartons += Number(it.quantity);
    cur.weight += w;
    if (it.costPerKg != null) {
      cur.costWeighted += Number(it.costPerKg) * w;
      cur.costedWeight += w;
    }
    deliveryByProduct.set(it.productId, cur);
  }
  // תכנון "ALL" הוא הכולל; תכנון לנקודה מסוימת מסתכם עליו
  const plannedByProduct = new Map<string, number>();
  for (const pl of plans) {
    const cur = plannedByProduct.get(pl.productId) ?? 0;
    plannedByProduct.set(pl.productId, cur + Number(pl.extraCartons));
  }

  const rows: ReconciliationRow[] = products.map((pp) => {
    const d = deliveryByProduct.get(pp.product.id);
    const dist = distributed.get(pp.product.id) ?? { weight: 0, revenue: 0 };
    const weightReceived = d?.weight ?? 0;
    // ממוצע משוקלל, ורק אם הוזנה עלות למשקל כלשהו
    const costPerKg =
      d && d.costedWeight > 0 ? d.costWeighted / d.costedWeight : null;
    const diff = weightReceived - dist.weight;

    return {
      productId: pp.product.id,
      productName: pp.product.name,
      cartonsOrdered: plannedByProduct.get(pp.product.id) ?? null,
      cartonsReceived: d?.cartons ?? 0,
      weightReceived,
      weightDistributed: dist.weight,
      diff,
      diffPercent: weightReceived > 0 ? (diff / weightReceived) * 100 : null,
      costPerKg,
      totalCost: costPerKg != null ? costPerKg * weightReceived : null,
      revenue: dist.revenue,
    } as ReconciliationRow & Record<string, any>;
  });

  const unpaidOrders = orders.filter(
    (o) => o.paymentStatus !== "PAID" && o.paymentStatus !== "PARTIALLY_PAID"
  ).length;

  const stage = computeSaleStage({
    status: pricelist.status,
    closeDate: pricelist.closeDate,
    orderCount: orders.length,
    supplierPlanCount: plans.length,
    deliveredProductCount: deliveryByProduct.size,
    missingWeights,
    unpaidOrders,
  });

  return NextResponse.json({
    pricelist: {
      id: pricelist.id,
      name: pricelist.name,
      status: pricelist.status,
      agentOnly: pricelist.agentOnly,
      deliveryDateText: pricelist.deliveryDateText,
      closeDate: pricelist.closeDate?.toISOString() ?? null,
    },
    stage,
    counts: {
      orders: orders.length,
      missingWeights,
      unpaidOrders,
      products: products.length,
      deliveredProducts: deliveryByProduct.size,
    },
    rows,
    totals: buildReconciliation(rows),
  });
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ pricelistId: string }> }
) {
  const g = await requireAdmin();
  if (!g.ok) return g.res;
  const { pricelistId } = await params;
  const b = await req.json().catch(() => ({}));

  const productId = String(b.productId || "");
  if (!productId) {
    return NextResponse.json({ error: "חסר מזהה מוצר" }, { status: 400 });
  }

  // ⚠️ הערך הזה הופך לבסיס לחישוב רווח, ולכן ערך שגוי אינו "תצוגה
  // מכוערת" אלא מסקנה עסקית שגויה. עדיף לדחות מאשר לשמור.
  const raw = b.costPerKg;
  let costPerKg: number | null = null;
  if (raw !== null && raw !== undefined && raw !== "") {
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 0) {
      return NextResponse.json(
        { error: 'העלות לק"ג חייבת להיות מספר חיובי' },
        { status: 400 }
      );
    }
    if (n > 10000) {
      // תפיסת טעות הקלדה מובהקת (למשל סכום כולל במקום מחיר לק"ג)
      return NextResponse.json(
        { error: 'העלות לק"ג נראית שגויה. יש להזין מחיר לקילוגרם, לא סכום כולל.' },
        { status: 400 }
      );
    }
    costPerKg = n;
  }

  // §113: העלות נשמרת על **כל שורות התעודה** של אותו מוצר במכירה.
  //
  // מוצר יכול להגיע בכמה משלוחים, והמחיר מהספק זהה לכולם באותה
  // מכירה. עדכון שורה אחת בלבד היה מייצר חישוב חלקי שנראה תקין.
  //
  // CONFIRMED בלבד - אותו נימוק כמו בקריאה: לא בונים נתון כספי
  // על תעודה שהמנהל טרם אישר.
  const result = await prisma.deliveryNoteItem.updateMany({
    where: {
      productId,
      deliveryNote: { pricelistId, status: "CONFIRMED" },
    },
    data: { costPerKg },
  });

  if (result.count === 0) {
    return NextResponse.json(
      {
        error:
          "לא נמצאה שורה מאושרת בתעודות המשלוח עבור המוצר הזה. יש לוודא שהתעודה נקלטה ואושרה.",
      },
      { status: 404 }
    );
  }

  return NextResponse.json({ ok: true, updated: result.count, costPerKg });
}
