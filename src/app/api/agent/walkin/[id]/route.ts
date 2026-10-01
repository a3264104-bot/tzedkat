// §20: עדכון / מחיקת מזדמן
// PATCH /api/agent/walkin/[id] - עדכון פרטים או תשלום
// DELETE /api/agent/walkin/[id] - מחיקה

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAgent } from "@/lib/agent-guard";
// §398: סיכום הנציג — מקור אחד
import { recalculateAgentSummary } from "@/lib/agent-summary-lib";

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
  if ("customerEmail" in body) {
    const em = body.customerEmail ? String(body.customerEmail).trim() : null;
    if (em && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em)) {
      return NextResponse.json({ error: "כתובת מייל לא תקינה" }, { status: 400 });
    }
    data.customerEmail = em;
  }
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
  await recalculateAgentSummary(walkin.pricelistId, walkin.agentId);

  return NextResponse.json({ ok: true });
}
