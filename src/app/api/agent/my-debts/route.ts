// §20: הנציג רואה את יתרתו + היסטוריה שלו בלבד
// GET /api/agent/my-debts

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAgent } from "@/lib/agent-guard";

export async function GET() {
  const g = await requireAgent();
  if (!g.ok) return g.res;

  const agentId = g.agent.id;

  const summaries = await prisma.agentSaleSummary.findMany({
    where: { agentId },
    include: {
      pricelist: {
        select: {
          id: true,
          name: true,
          deliveryDate: true,
          status: true,
        },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  const payments = await prisma.agentPayment.findMany({
    where: { agentId },
    include: {
      pricelist: { select: { id: true, name: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  // חישוב יתרה - זהה למסך המנהל
  const totalCommission = summaries.reduce(
    (s, x) => s + Number(x.totalCommission),
    0
  );
  const totalPaid = payments
    .filter((p) => p.type === "PAID")
    .reduce((s, p) => s + Number(p.amount), 0);
  const totalCollected = payments
    .filter((p) => p.type === "COLLECTED")
    .reduce((s, p) => s + Number(p.amount), 0);

  const cashFromWalkins = await summaries.reduce(async (accP, x) => {
    const acc = await accP;
    const cash = await prisma.walkinOrder.aggregate({
      where: {
        pricelistId: x.pricelistId,
        agentId,
        paymentMethod: "CASH",
        paymentReceived: true,
      },
      _sum: { totalAmount: true },
    });
    return acc + Number(cash._sum.totalAmount || 0);
  }, Promise.resolve(0));

  const balance =
    totalCommission - totalPaid - (cashFromWalkins - totalCollected);

  return NextResponse.json({
    agent: {
      name: g.agent.name,
      point: g.agent.agentPoint,
      commissionRateCarton: Number(g.agent.commissionRateCarton),
      commissionRateSingles: Number(g.agent.commissionRateSingles),
    },
    summaries: summaries.map((s) => ({
      id: s.id,
      pricelistId: s.pricelistId,
      pricelistName: s.pricelist.name,
      deliveryDate: s.pricelist.deliveryDate?.toISOString() || null,
      status: s.status,
      totalCartonWeight: Number(s.totalCartonWeight),
      totalSinglesWeight: Number(s.totalSinglesWeight),
      totalWalkinWeight: Number(s.totalWalkinWeight),
      totalCustomers: s.totalCustomers,
      totalWalkins: s.totalWalkins,
      totalCommission: Number(s.totalCommission),
      remainderNote: s.remainderNote,
      confirmedAt: s.confirmedAt?.toISOString() || null,
    })),
    payments: payments.map((p) => ({
      id: p.id,
      amount: Number(p.amount),
      type: p.type,
      method: p.method,
      note: p.note,
      pricelistName: p.pricelist?.name || null,
      createdAt: p.createdAt.toISOString(),
    })),
    totals: {
      totalCommission,
      totalPaid,
      totalCollected,
      totalCashCollected: cashFromWalkins,
      balance,
      debtDirection:
        balance > 0
          ? "OWED_TO_AGENT"
          : balance < 0
          ? "OWED_BY_AGENT"
          : "SETTLED",
    },
  });
}
