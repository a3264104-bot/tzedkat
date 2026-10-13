// ═══════════════════════════════════════════════════════════════
// §368: ספר החובות — כל תנועה, לפי לקוח / מכירה / נציג
// ═══════════════════════════════════════════════════════════════
// GET /api/admin/debt-ledger?customerId=X
// GET /api/admin/debt-ledger?pricelistId=X
// GET /api/admin/debt-ledger?agentId=X
// GET /api/admin/debt-ledger                 ← הכל, 200 אחרונות
//
// הצורך: המנהל רואה "חוב ₪370" על לקוח ולא יודע מאיפה, מי רשם,
// ומתי נגבה. debtBalance הוא מספר אחד — הספר הוא ההיסטוריה.
//
// ⚠️ שלושה מסננים, שאילתה אחת: הדוח לפי מכירה ("כמה חוב נוצר
// במכירת פסח") ולפי נציג ("כמה חוב גבה משה") הם אותם נתונים
// מזוויות שונות.

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/guard";

export async function GET(req: Request) {
  const g = await requireAdmin();
  if (!g.ok) return g.res;

  const { searchParams } = new URL(req.url);
  const customerId = searchParams.get("customerId");
  const pricelistId = searchParams.get("pricelistId");
  const agentId = searchParams.get("agentId");

  const where: any = {};
  if (customerId) where.customerId = customerId;
  if (pricelistId) where.pricelistId = pricelistId;
  if (agentId) where.agentId = agentId;

  // §399: ⚡ הכל בסיבוב אחד, ובמקביל:
  //   rows        — 200 התנועות האחרונות (לטבלה)
  //   byKind      — סיכומים על **כל** התנועות (לא רק 200 האחרונות)
  //   outstanding — מי חייב עכשיו (Customer.debtBalance > 0)
  //   unpaid      — הזמנות עם מחיר סופי שטרם שולמו במלואן
  //
  // 🐛 מה שהיה במסך: "חייבים עכשיו (22)" עם 22 שורות ריקות של ₪0.00.
  // המסך קרא את /api/admin/debts — שמחזיר **הזמנות שלא שולמו**, לא
  // לקוחות עם חוב — וחיפש בהן name ו-debtBalance שאינם קיימים. כלומר
  // 22 ההזמנות שממתינות לחיוב הוצגו כ-22 "חייבים" בלי שם ובלי סכום.
  // ובנוסף המסך טען את כל רשימת התשלומים (250 הזמנות מלאות) רק כדי
  // לסכום שני מספרים.
  const [rows, byKind, outstanding, unpaidAgg] = await Promise.all([
    prisma.debtLedger.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: 200,
      include: {
        customer: { select: { id: true, name: true, phone: true } },
      },
    }),
    prisma.debtLedger.groupBy({
      by: ["kind"],
      where,
      _sum: { amount: true },
    }),
    prisma.customer.findMany({
      where: { debtBalance: { gt: 0 } },
      select: { id: true, name: true, phone: true, debtBalance: true, debtNote: true },
      orderBy: { debtBalance: "desc" },
    }),
    prisma.order.aggregate({
      where: {
        status: { not: "CANCELLED" },
        finalTotal: { gt: 0 },
        paymentStatus: {
          notIn: ["PAID", "CHARGING", "PAYMENT_PENDING", "DEBT_CARRIED", "REFUNDED"],
        },
        items: { some: { isCancelled: false } },
      },
      _count: { _all: true },
      _sum: { finalTotal: true, amountPaid: true },
    }),
  ]);

  // שמות המכירות והנציגים — במקום include (הם לא relations בסכמה)
  const plIds = Array.from(new Set(rows.map((r) => r.pricelistId).filter(Boolean))) as string[];
  const agIds = Array.from(new Set(rows.map((r) => r.agentId).filter(Boolean))) as string[];
  const [pls, ags] = await Promise.all([
    plIds.length
      ? prisma.pricelist.findMany({ where: { id: { in: plIds } }, select: { id: true, name: true } })
      : [],
    agIds.length
      ? prisma.customer.findMany({ where: { id: { in: agIds } }, select: { id: true, name: true } })
      : [],
  ]);
  const plName = new Map(pls.map((p) => [p.id, p.name]));
  const agName = new Map(ags.map((a) => [a.id, a.name]));

  // מספרי הזמנות
  const orderIds = Array.from(new Set(rows.map((r) => r.orderId).filter(Boolean))) as string[];
  const orders = orderIds.length
    ? await prisma.order.findMany({ where: { id: { in: orderIds } }, select: { id: true, orderNumber: true } })
    : [];
  const orderNum = new Map(orders.map((o) => [o.id, o.orderNumber]));

  // סיכומים — §399: על כל התנועות. קודם נסכמו רק 200 השורות שנטענו,
  // ו"נגבה סה״כ" היה קטן מהאמת ברגע שהספר עבר 200 תנועות.
  const totals = { added: 0, collected: 0, restored: 0, adjusted: 0 };
  for (const g2 of byKind) {
    const a = Number(g2._sum.amount ?? 0);
    if (g2.kind === "ADD") totals.added += a;
    else if (g2.kind === "COLLECT") totals.collected += -a;
    else if (g2.kind === "RESTORE") totals.restored += a;
    else totals.adjusted += a;
  }

  return NextResponse.json({
    rows: rows.map((r) => ({
      id: r.id,
      kind: r.kind,
      amount: Number(r.amount),
      balanceAfter: Number(r.balanceAfter),
      note: r.note,
      customer: r.customer,
      orderNumber: r.orderId ? orderNum.get(r.orderId) ?? null : null,
      pricelistName: r.pricelistId ? plName.get(r.pricelistId) ?? null : null,
      agentName: r.agentId ? agName.get(r.agentId) ?? null : null,
      createdBy: r.createdBy,
      createdAt: r.createdAt.toISOString(),
    })),
    // §399: מי חייב עכשיו — לקוחות עם חוב קודם פתוח
    outstanding: outstanding.map((c) => ({
      id: c.id,
      name: c.name,
      phone: c.phone,
      debt: Number(c.debtBalance),
      note: c.debtNote,
    })),
    // §399: הזמנות שטרם שולמו במלואן — היתרה בלבד (בלי מה שכבר שולם)
    unpaid: {
      count: unpaidAgg._count._all,
      sum:
        Math.round(
          (Number(unpaidAgg._sum.finalTotal ?? 0) - Number(unpaidAgg._sum.amountPaid ?? 0)) * 100
        ) / 100,
    },
    totals: {
      added: Math.round(totals.added * 100) / 100,
      collected: Math.round(totals.collected * 100) / 100,
      restored: Math.round(totals.restored * 100) / 100,
      adjusted: Math.round(totals.adjusted * 100) / 100,
    },
  });
}
