// §20: סגירת / הערה על סיכום נציג
// PATCH /api/agent/summary/[pricelistId]
// Body: { remainderNote?: string, confirm?: boolean }

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAgent } from "@/lib/agent-guard";

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ pricelistId: string }> }
) {
  const g = await requireAgent();
  if (!g.ok) return g.res;

  const { pricelistId } = await params;
  const body = await req.json().catch(() => ({}));

  // חיפוש/יצירה של הסיכום
  let summary = await prisma.agentSaleSummary.findUnique({
    where: {
      pricelistId_agentId: {
        pricelistId,
        agentId: g.agent.id,
      },
    },
  });

  if (!summary) {
    summary = await prisma.agentSaleSummary.create({
      data: {
        pricelistId,
        agentId: g.agent.id,
        status: "DRAFT",
      },
    });
  }

  const data: any = {};
  if ("remainderNote" in body) {
    data.remainderNote = body.remainderNote ? String(body.remainderNote).trim() : null;
  }
  if (body.confirm === true) {
    data.status = "CONFIRMED";
    data.confirmedAt = new Date();
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "אין שדות לעדכון" }, { status: 400 });
  }

  const updated = await prisma.agentSaleSummary.update({
    where: { id: summary.id },
    data,
  });

  return NextResponse.json({
    ok: true,
    summary: {
      id: updated.id,
      status: updated.status,
      totalCartonWeight: Number(updated.totalCartonWeight),
      totalSinglesWeight: Number(updated.totalSinglesWeight),
      totalWalkinWeight: Number(updated.totalWalkinWeight),
      totalCustomers: updated.totalCustomers,
      totalWalkins: updated.totalWalkins,
      totalCommission: Number(updated.totalCommission),
      remainderNote: updated.remainderNote,
      confirmedAt: updated.confirmedAt?.toISOString(),
    },
  });
}
