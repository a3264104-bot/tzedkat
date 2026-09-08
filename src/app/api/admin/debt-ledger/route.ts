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

  const rows = await prisma.debtLedger.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: 200,
    include: {
      customer: { select: { id: true, name: true, phone: true } },
    },
  });

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

  // סיכומים
  const totals = { added: 0, collected: 0, restored: 0, adjusted: 0 };
  for (const r of rows) {
    const a = Number(r.amount);
    if (r.kind === "ADD") totals.added += a;
    else if (r.kind === "COLLECT") totals.collected += -a;
    else if (r.kind === "RESTORE") totals.restored += a;
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
    totals: {
      added: Math.round(totals.added * 100) / 100,
      collected: Math.round(totals.collected * 100) / 100,
      restored: Math.round(totals.restored * 100) / 100,
      adjusted: Math.round(totals.adjusted * 100) / 100,
    },
  });
}
