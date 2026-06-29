import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/guard";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const g = await requireAdmin();
  if (!g.ok) return g.res;
  const { id } = await params;
  const b = await req.json();
  const data: any = {};
  for (const k of [
    "name",
    "city",
    "address",
    "contactName",
    "phone",
    "email",
    "deliveryHours",
    "notes",
    "isActive",
    "sortOrder",
  ]) {
    if (k in b) data[k] = b[k];
  }
  const point = await prisma.deliveryPoint.update({ where: { id }, data });
  return NextResponse.json(point);
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const g = await requireAdmin();
  if (!g.ok) return g.res;
  const { id } = await params;
  const used = await prisma.order.count({ where: { pointId: id } });
  if (used > 0) {
    await prisma.deliveryPoint.update({ where: { id }, data: { isActive: false } });
    return NextResponse.json({ ok: true, hidden: true });
  }
  await prisma.pricelistPoint.deleteMany({ where: { pointId: id } });
  await prisma.deliveryPoint.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
