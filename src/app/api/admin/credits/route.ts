// ═══════════════════════════════════════════════════════════════
// §126: פיקוח על זיכויים
// ═══════════════════════════════════════════════════════════════
// GET /api/admin/credits?pricelistId=
//
// כל נציג רשאי לזכות לקוח בכל סכום, בלי תקרה ובלי אישור. הפיקוח
// היחיד הוא שהמנהל יראה את זה - וכדי שיראה, צריך מסך.
//
// המסך מציג שני דברים שונים:
//   • זיכויים שניתנו במכירה - מי, כמה, למה, ומתי
//   • יתרות זכות פתוחות - כסף שהעמותה חייבת ללקוחות

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/guard";

export async function GET(req: Request) {
  const g = await requireAdmin();
  if (!g.ok) return g.res;

  const url = new URL(req.url);
  const pricelistId = url.searchParams.get("pricelistId") || undefined;

  // ⚠️ מקבילות: השאילתות עצמאיות, ועם המסד באירלנד כל אחת היא
  // נסיעה חוצת-אוקיינוס. הרצה בטור מוסיפה שניות לטעינת המסך.
  const [credits, balances, agents, deliveries] = await Promise.all([
    // זיכויים שניתנו
    prisma.order.findMany({
      where: {
        // §270: `{ not: null }` אינו חוקי — gt: 0 מסנן גם NULL.
        creditAmount: { gt: 0 },
        ...(pricelistId ? { pricelistId } : {}),
      },
      orderBy: { creditAt: "desc" },
      select: {
        id: true,
        orderNumber: true,
        customerName: true,
        phone: true,
        creditAmount: true,
        creditReason: true,
        creditById: true,
        creditAt: true,
        paymentStatus: true,
        finalTotal: true,
        pointNameSnapshot: true,
        pricelist: { select: { id: true, name: true } },
      },
    }),

    // יתרות זכות פתוחות - כסף שהעמותה חייבת
    prisma.customer.findMany({
      where: { creditBalance: { gt: 0 } },
      orderBy: { creditBalance: "desc" },
      select: {
        id: true,
        name: true,
        phone: true,
        creditBalance: true,
        creditBalanceNote: true,
        creditBalanceAt: true,
      },
    }),

    // שמות הנציגים - creditById הוא מזהה, והמנהל צריך שם
    prisma.customer.findMany({
      where: { role: { in: ["AGENT", "ADMIN"] } },
      select: { id: true, name: true },
    }),

    // §134: מי מבקש משלוח.
    //
    // ⚠️ בלי הרשימה הזו הנציג מסמן משלוחים והמנהל לא יודע כמה
    // יש, לאן, וכמה כסף זה. זו רשימת עבודה ליום החלוקה.
    prisma.order.findMany({
      where: {
        deliveryRequested: true,
        status: { not: "CANCELLED" },
        ...(pricelistId ? { pricelistId } : {}),
      },
      orderBy: { deliverySetAt: "desc" },
      select: {
        id: true,
        orderNumber: true,
        customerName: true,
        phone: true,
        deliveryFee: true,
        deliveryAddress: true,
        deliveryNote: true,
        deliverySetById: true,
        pointNameSnapshot: true,
        finalTotal: true,
        paymentStatus: true,
      },
    }),
  ]);

  const agentName = new Map(agents.map((a) => [a.id, a.name]));

  const rows = credits.map((o) => ({
    orderId: o.id,
    orderNumber: o.orderNumber,
    customerName: o.customerName,
    phone: o.phone,
    amount: Number(o.creditAmount),
    reason: o.creditReason,
    // ⚠️ נפילה למזהה כשהנציג נמחק - עדיף מזהה מאשר "לא ידוע",
    // כי לפחות אפשר לחקור אותו במסד.
    byName: o.creditById ? agentName.get(o.creditById) ?? o.creditById : "—",
    at: o.creditAt?.toISOString() ?? null,
    pointName: o.pointNameSnapshot,
    saleName: o.pricelist?.name ?? null,
    // זיכוי על הזמנה ששולמה הפך ליתרה; אחרת הוא נוכה מהחיוב
    asBalance: o.paymentStatus === "PAID" || o.paymentStatus === "PARTIALLY_PAID",
    finalTotal: o.finalTotal != null ? Number(o.finalTotal) : null,
  }));

  const totalCredited = Math.round(rows.reduce((s, r) => s + r.amount, 0) * 100) / 100;
  const totalOpenBalance =
    Math.round(balances.reduce((s, b) => s + Number(b.creditBalance), 0) * 100) / 100;

  // ─── ריכוז לפי נציג ───
  // ⚠️ זו התצוגה שמגלה חריגה: נציג שמזכה הרבה יותר מהאחרים בולט
  // מיד, בלי שצריך לקרוא כל שורה.
  const byAgent = new Map<string, { name: string; count: number; total: number }>();
  for (const r of rows) {
    const cur = byAgent.get(r.byName) ?? { name: r.byName, count: 0, total: 0 };
    cur.count++;
    cur.total = Math.round((cur.total + r.amount) * 100) / 100;
    byAgent.set(r.byName, cur);
  }

  const deliveryRows = deliveries.map((d) => ({
    orderId: d.id,
    orderNumber: d.orderNumber,
    customerName: d.customerName,
    phone: d.phone,
    fee: d.deliveryFee != null ? Number(d.deliveryFee) : 0,
    address: d.deliveryAddress,
    note: d.deliveryNote,
    byName: d.deliverySetById
      ? agentName.get(d.deliverySetById) ?? d.deliverySetById
      : "—",
    pointName: d.pointNameSnapshot,
    paid: d.paymentStatus === "PAID" || d.paymentStatus === "PARTIALLY_PAID",
  }));
  const totalDeliveryFees =
    Math.round(deliveryRows.reduce((s, d) => s + d.fee, 0) * 100) / 100;

  return NextResponse.json({
    deliveries: deliveryRows,
    deliveryTotals: {
      count: deliveryRows.length,
      totalFees: totalDeliveryFees,
    },
    credits: rows,
    balances: balances.map((b) => ({
      customerId: b.id,
      name: b.name,
      phone: b.phone,
      balance: Number(b.creditBalance),
      note: b.creditBalanceNote,
      at: b.creditBalanceAt?.toISOString() ?? null,
    })),
    byAgent: Array.from(byAgent.values()).sort((a, b) => b.total - a.total),
    totals: {
      totalCredited,
      creditCount: rows.length,
      totalOpenBalance,
      balanceCount: balances.length,
    },
  });
}
