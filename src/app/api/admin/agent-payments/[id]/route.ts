// §20: מחיקת רשומת תשלום/גבייה
// DELETE /api/admin/agent-payments/[id]

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/guard";

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const g = await requireAdmin();
  if (!g.ok) return g.res;

  const { id } = await params;
  const existing = await prisma.agentPayment.findUnique({
    where: { id },
    select: { id: true },
  });
  if (!existing) {
    return NextResponse.json({ error: "רשומה לא נמצאה" }, { status: 404 });
  }
  await prisma.agentPayment.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
