import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/guard";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const g = await requireAdmin();
  if (!g.ok) return g.res;
  const { id } = await params;
  const b = await req.json();

  const data: any = {};
  if ("name" in b) data.name = String(b.name).trim();
  if ("imageUrl" in b) data.imageUrl = b.imageUrl || null;
  if ("description" in b) data.description = b.description || null;
  if ("isActive" in b) data.isActive = !!b.isActive;
  if ("sortOrder" in b) data.sortOrder = Number(b.sortOrder);
  if ("maxQuantity" in b) data.maxQuantity = b.maxQuantity ? Number(b.maxQuantity) : null;
  if ("stock" in b) data.stock = b.stock != null && b.stock !== "" ? Number(b.stock) : null;

  await prisma.personalProduct.update({ where: { id }, data });
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const g = await requireAdmin();
  if (!g.ok) return g.res;
  const { id } = await params;
  // אם יש בקשות שכוללות את המוצר - משביתים במקום מחיקה (שמירת היסטוריה)
  const used = await prisma.personalRequestItem.count({ where: { productId: id } });
  if (used > 0) {
    await prisma.personalProduct.update({ where: { id }, data: { isActive: false } });
    return NextResponse.json({ ok: true, deactivated: true });
  }
  await prisma.personalProduct.delete({ where: { id } });
  return NextResponse.json({ ok: true, deleted: true });
}
