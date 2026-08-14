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

  // ─── סיכום מוצרים ─────────────────────────────────────────────
  // 🐛 תוקן ערבוב יחידות: הקוד הישן עשה `qty += finalWeight ?? quantity`,
  // כלומר חיבר קרטונים (2) עם ק"ג (16.86) לאותו מספר, והציג אותו עם
  // יחידה אחת. גרוע מזה - המספר "השתנה" תוך כדי המכירה: ברגע שפריט
  // נשקל, הקרטונים שלו נעלמו והוחלפו בק"ג.
  //
  // המודל האמיתי (לפי תעודות הספק): כל שורה היא קרטונים + המשקל שלהם.
  //   cartons      = כמות קרטונים שהוזמנה (יחידת ההזמנה מהספק)
  //   singlesKg    = ק"ג של בודדים (מתומחרים בנפרד, יקר יותר לק"ג)
  //   actualKg     = ק"ג שנשקלו בפועל (משני הסוגים)
  const prodMap = new Map<
    string,
    {
      name: string;
      unit: string;
      cartons: number;
      singlesKg: number;
      // §38: יחידת ההזמנה בפועל. מוצר ארוז ("בקר טחון 500 ג'") נמכר
      // ביחידות ולא בקרטונים, והוצג כ"2 קרטון" בדשבורד.
      unitLabel: string;
      actualKg: number;
      weighedCartons: number;
      total: number;
    }
  >();
  for (const o of active) {
    for (const it of o.items) {
      const key = it.productName;
      const cur =
        prodMap.get(key) || {
          name: it.productName,
          unit: it.unit,
          cartons: 0,
          singlesKg: 0,
          unitLabel: it.unit || "קרטון",
          actualKg: 0,
          weighedCartons: 0,
          total: 0,
        };
      const qty = Number(it.quantity);
      const actual = it.actualWeight != null ? Number(it.actualWeight) : null;

      if (it.isSingle) {
        // בודדים: הכמות היא כבר ק"ג
        cur.singlesKg += qty;
      } else {
        // קרטונים: הכמות היא מספר קרטונים
        cur.cartons += qty;
        if (actual != null) cur.weighedCartons += qty;
      }
      if (actual != null) cur.actualKg += actual;

      cur.total += Number(it.finalPrice ?? it.estimatedPrice);
      prodMap.set(key, cur);
    }
  }
  const products = Array.from(prodMap.values())
    .map((p) => ({
      ...p,
      cartons: Math.round(p.cartons * 1000) / 1000,
      singlesKg: Math.round(p.singlesKg * 1000) / 1000,
      unitLabel: p.unitLabel,
      actualKg: Math.round(p.actualKg * 1000) / 1000,
      total: Math.round(p.total * 100) / 100,
    }))
    .sort((a, b) => b.cartons + b.singlesKg - (a.cartons + a.singlesKg));

  // אזהרות כמות מוגבלת — סך הוזמן מול המגבלה שהמנהל הגדיר
  // 🐛 תוקן: הספירה הייתה `finalWeight ?? quantity`, כלומר אחרי שקילה
  // המערכת השוותה ק"ג מול מגבלה שמוגדרת ביחידות (limitedQtyAmount הוא Int),
  // ויצרה אזהרות שווא. המגבלה נמדדת ביחידת ההזמנה - כמות, לא משקל.
  const limitedProducts = await prisma.product.findMany({
    where: { limitedQty: true, limitedQtyAmount: { not: null } },
    select: { id: true, name: true, unit: true, limitedQtyAmount: true },
  });
  const orderedByProductId = new Map<string, number>();
  for (const o of active) {
    for (const it of o.items) {
      const cur = orderedByProductId.get(it.productId) || 0;
      orderedByProductId.set(it.productId, cur + Number(it.quantity));
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
  // ⚠️ שים לב: statusCounts סופר את *כל* ההזמנות כולל מבוטלות, בעוד
  // totalOrders סופר רק פעילות. הצרכן אחראי להפריד בתצוגה.
  const statusCounts: Record<string, number> = {};
  for (const o of orders) statusCounts[o.status] = (statusCounts[o.status] || 0) + 1;

  // §24: פילוח לפי מקור ההזמנה - כמה מגיע מהאתר, מהטלפון, ומנציגים.
  // מודד את האימוץ של הערוץ הטלפוני בפועל.
  const sourceCounts: Record<string, number> = {};
  for (const o of active) {
    const src = (o as any).source || "WEB";
    sourceCounts[src] = (sourceCounts[src] || 0) + 1;
  }

  // 🆕 פילוח לפי paymentStatus - שדה נפרד לגמרי מ-status.
  // בלי זה, צרכנים שמחפשים PAYMENT_PENDING / PAID / READY_TO_CHARGE
  // ב-statusCounts תמיד יקבלו 0, כי הערכים האלה חיים ב-paymentStatus.
  // נספר רק הזמנות פעילות (בלי מבוטלות) כדי שיתאים ל-totalOrders.
  const payStatusCounts: Record<string, number> = {};
  for (const o of active) {
    if (!o.paymentStatus) continue;
    payStatusCounts[o.paymentStatus] = (payStatusCounts[o.paymentStatus] || 0) + 1;
  }

  // 🐛 תוקן: הסינון היה על status === "NEW" - סטטוס שלא קיים יותר
  // (הוחלף ב-PENDING_REVIEW), ולכן הרשימה תמיד חזרה ריקה.
  const newOrders = active
    .filter((o) => o.status === "PENDING_REVIEW")
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
    payStatusCounts,
    sourceCounts,
    newOrders,
    limitedWarnings,
    topProducts: products.slice(0, 5),
  });
}
