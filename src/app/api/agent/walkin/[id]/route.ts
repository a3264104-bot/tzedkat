// §20: עדכון / מחיקת מזדמן
// PATCH /api/agent/walkin/[id] - עדכון פרטים או תשלום
// DELETE /api/agent/walkin/[id] - מחיקה

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAgent } from "@/lib/agent-guard";

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const g = await requireAgent();
  if (!g.ok) return g.res;

  const { id } = await params;
  const walkin = await prisma.walkinOrder.findUnique({
    where: { id },
    select: {
      id: true,
      agentId: true,
      pricelistId: true,
    },
  });
  if (!walkin) {
    return NextResponse.json({ error: "מזדמן לא נמצא" }, { status: 404 });
  }
  // רק הנציג שיצר יכול לערוך (או מנהל)
  if (walkin.agentId !== g.agent.id && !g.isAdmin) {
    return NextResponse.json({ error: "אין הרשאה" }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const data: any = {};

  if ("customerName" in body) {
    const n = String(body.customerName || "").trim();
    if (!n) return NextResponse.json({ error: "שם חובה" }, { status: 400 });
    data.customerName = n;
  }
  if ("customerPhone" in body) data.customerPhone = body.customerPhone || null;
  if ("paymentMethod" in body) {
    const allowed = ["CASH", "CARD_TERMINAL", "TRANSFER", "ONLINE"];
    if (!allowed.includes(body.paymentMethod)) {
      return NextResponse.json({ error: "אמצעי תשלום לא תקין" }, { status: 400 });
    }
    data.paymentMethod = body.paymentMethod;
  }
  if ("paymentReceived" in body) data.paymentReceived = !!body.paymentReceived;
  if ("paymentNote" in body) data.paymentNote = body.paymentNote || null;
  if ("notes" in body) data.notes = body.notes || null;

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "אין שדות לעדכון" }, { status: 400 });
  }

  const updated = await prisma.walkinOrder.update({
    where: { id },
    data,
  });

  return NextResponse.json({ ok: true, walkin: { id: updated.id } });
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const g = await requireAgent();
  if (!g.ok) return g.res;

  const { id } = await params;
  const walkin = await prisma.walkinOrder.findUnique({
    where: { id },
    select: { id: true, agentId: true, pricelistId: true },
  });
  if (!walkin) {
    return NextResponse.json({ error: "מזדמן לא נמצא" }, { status: 404 });
  }
  if (walkin.agentId !== g.agent.id && !g.isAdmin) {
    return NextResponse.json({ error: "אין הרשאה" }, { status: 403 });
  }

  await prisma.walkinOrder.delete({ where: { id } });

  // עדכון סיכום הנציג
  const agent = await prisma.customer.findUnique({
    where: { id: walkin.agentId },
    select: {
      agentPointId: true,
      commissionRateCarton: true,
      commissionRateSingles: true,
    },
  });
  if (agent) {
    await recalculateAgentSummary(walkin.pricelistId, walkin.agentId);
  }

  return NextResponse.json({ ok: true });
}

async function recalculateAgentSummary(pricelistId: string, agentId: string) {
  const agent = await prisma.customer.findUnique({
    where: { id: agentId },
    select: {
      agentPointId: true,
      commissionRateCarton: true,
      commissionRateSingles: true,
    },
  });
  if (!agent) return;

  const rateCarton = Number(agent.commissionRateCarton);
  const rateSingles = Number(agent.commissionRateSingles);

  const whereOrders: any = { pricelistId, status: { notIn: ["CANCELLED"] } };
  if (agent.agentPointId) whereOrders.pointId = agent.agentPointId;

  const orders = await prisma.order.findMany({
    where: whereOrders,
    include: { items: { where: { isCancelled: false } } },
  });

  let totalCartonWeight = 0;
  let totalSinglesWeight = 0;
  let customersWithData = 0;
  for (const order of orders) {
    let hasData = false;
    for (const it of order.items) {
      const w = it.agentEnteredWeight ? Number(it.agentEnteredWeight) : 0;
      if (w > 0) {
        hasData = true;
        if (it.isSingle) totalSinglesWeight += w;
        else totalCartonWeight += w;
      }
    }
    if (hasData) customersWithData++;
  }

  const walkins = await prisma.walkinOrder.findMany({
    where: { pricelistId, agentId },
    include: { items: true },
  });
  let totalWalkinWeight = 0;
  let totalWalkinCarton = 0;
  let totalWalkinSingles = 0;
  for (const w of walkins) {
    for (const it of w.items) {
      const wt = Number(it.weight);
      totalWalkinWeight += wt;
      if (it.isSingle) totalWalkinSingles += wt;
      else totalWalkinCarton += wt;
    }
  }

  const cartonCommission = (totalCartonWeight + totalWalkinCarton) * rateCarton;
  const singlesCommission = (totalSinglesWeight + totalWalkinSingles) * rateSingles;
  const totalCommission = cartonCommission + singlesCommission;

  await prisma.agentSaleSummary.upsert({
    where: { pricelistId_agentId: { pricelistId, agentId } },
    create: {
      pricelistId,
      agentId,
      status: "DRAFT",
      totalCartonWeight,
      totalSinglesWeight,
      totalWalkinWeight,
      totalCustomers: customersWithData,
      totalWalkins: walkins.length,
      cartonCommission,
      singlesCommission,
      totalCommission,
    },
    update: {
      totalCartonWeight,
      totalSinglesWeight,
      totalWalkinWeight,
      totalCustomers: customersWithData,
      totalWalkins: walkins.length,
      cartonCommission,
      singlesCommission,
      totalCommission,
    },
  });
}
