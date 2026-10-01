// ═══════════════════════════════════════════════════════════════
// §397: 🔍 פירוט חשבון הנציג — ממה בנוי כל סכום
// ═══════════════════════════════════════════════════════════════
// GET /api/admin/agent-breakdown?agentId=<id>
//
// מחזיר את השורות שמהן מחושבים הסכומים בכרטיס הנציג:
//   orders   — כל הזמנה בנקודות שלו + לאן הלך הכסף (אשראי / מזומן
//              אצלו / מזומן אצל המנהל / טרם נגבה / הועבר לחוב)
//   walkins  — מזדמנים (לקוחות מזדמנים בחלוקה), עם אמצעי התשלום
//   sales    — העמלה לפי מכירה
//
// ⚠️ אותה פונקציית סיווג של הסיכום (classifyOrderMoney) — הסכום
// בכרטיס תמיד שווה לסכום השורות כאן.

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/guard";
import {
  classifyOrderMoney,
  loadAgentMoneyOrders,
  resolveAgentPointIds,
} from "@/lib/agent-money-lib";

export async function GET(req: Request) {
  const g = await requireAdmin();
  if (!g.ok) return g.res;

  const agentId = new URL(req.url).searchParams.get("agentId") || "";
  if (!agentId) {
    return NextResponse.json({ error: "חסר נציג" }, { status: 400 });
  }

  const agent = await prisma.customer.findUnique({
    where: { id: agentId },
    select: { id: true, name: true },
  });
  if (!agent) {
    return NextResponse.json({ error: "נציג לא נמצא" }, { status: 404 });
  }
  // §398: אותן נקודות ואותן הזמנות בדיוק כמו בכרטיס (computeAgentCashAccount)
  const pointIds = await resolveAgentPointIds(agent.id);

  const [orders, walkins, summaries, points] = await Promise.all([
    loadAgentMoneyOrders(agent.id, pointIds),
    prisma.walkinOrder.findMany({
      where: { agentId },
      select: {
        id: true,
        walkinNumber: true,
        customerName: true,
        customerPhone: true,
        paymentMethod: true,
        paymentReceived: true,
        paymentNote: true,
        totalAmount: true,
        createdAt: true,
        pricelistId: true,
        pricelist: { select: { name: true } },
        point: { select: { name: true } },
      },
      orderBy: { createdAt: "desc" },
    }),
    prisma.agentSaleSummary.findMany({
      where: { agentId },
      select: {
        pricelistId: true,
        pricelist: { select: { name: true } },
        totalCartonWeight: true,
        totalSinglesWeight: true,
        totalWalkinWeight: true,
        cartonCommission: true,
        singlesCommission: true,
        customCommission: true,
        totalCommission: true,
        status: true,
      },
      orderBy: { createdAt: "desc" },
    }),
    // ⚠️ כל הנקודות של ההזמנות — מזומן שהנציג גבה יכול להיות גם
    // בנקודה שכבר אינה שלו
    prisma.deliveryPoint.findMany({ select: { id: true, name: true } }),
  ]);

  const pointName = new Map(points.map((p) => [p.id, p.name]));

  return NextResponse.json({
    agent: { id: agent.id, name: agent.name },
    orders: orders.map(({ order: o, inPoints, mine }) => {
      const m = classifyOrderMoney(o);
      return {
        id: o.id,
        orderNumber: o.orderNumber,
        customerName: o.customerName,
        pointName: pointName.get(o.pointId) ?? "",
        pricelistId: o.pricelistId,
        pricelistName: o.pricelist?.name ?? "",
        status: o.status,
        paymentStatus: o.paymentStatus,
        paymentMethod: o.paymentMethod,
        receivedBy: o.receivedByUserId,
        paidAt: o.paidAt?.toISOString() ?? null,
        total: Number(o.finalTotal ?? o.estimatedTotal ?? 0),
        weighed: o.finalTotal != null,
        debtPart: m.debtPart,
        collected: m.collected,
        // §398: כל שורה נספרת בסיכום בדיוק לפי השדות האלה
        inPoints,
        cardRev: inPoints ? m.cardRev : 0,
        adminCashRev: inPoints ? m.adminCashRev : 0,
        pending: inPoints ? m.pending : 0,
        agentCash: mine ? m.agentCash : 0,
        collectedBucket: m.collectedBucket,
        bucket: m.bucket,
      };
    }),
    walkins: walkins.map((w) => ({
      id: w.id,
      walkinNumber: w.walkinNumber,
      customerName: w.customerName,
      customerPhone: w.customerPhone,
      paymentMethod: w.paymentMethod,
      paymentReceived: w.paymentReceived,
      paymentNote: w.paymentNote,
      totalAmount: Number(w.totalAmount),
      createdAt: w.createdAt.toISOString(),
      pricelistId: w.pricelistId,
      pricelistName: w.pricelist?.name ?? "",
      pointName: w.point?.name ?? "",
      // ⚠️ אותו תנאי של "מזומן שאסף (מזדמנים)" בסיכום
      countsAsCashHeld: w.paymentMethod === "CASH" && w.paymentReceived,
    })),
    sales: summaries.map((s) => ({
      pricelistId: s.pricelistId,
      pricelistName: s.pricelist.name,
      cartonKg: Number(s.totalCartonWeight) + Number(s.totalWalkinWeight),
      singlesKg: Number(s.totalSinglesWeight),
      cartonCommission: Number(s.cartonCommission),
      singlesCommission: Number(s.singlesCommission),
      customCommission: Number(s.customCommission),
      totalCommission: Number(s.totalCommission),
      status: s.status,
    })),
  });
}
