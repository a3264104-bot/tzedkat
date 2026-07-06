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
    "categoryId",
    "cartonPrice",
    "allowSingles",
    "singleSurcharge",
    "unit",
    "saleType",
    "priceType",
    "packageWeight",
    "avgWeightPerUnit",
    "imageUrl",
    "kashrut",
    "isFeatured",
    "highlightNote",
    "isFrozen",
    "limitedQty",
    "limitedQtyAmount",
    "isActive",
    "sortOrder",
  ]) {
    if (k in b) data[k] = b[k];
  }
  const product = await prisma.product.update({ where: { id }, data });
  return NextResponse.json(product);
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const g = await requireAdmin();
  if (!g.ok) return g.res;
  const { id } = await params;
  const used = await prisma.orderItem.count({ where: { productId: id } });
  if (used > 0) {
    // לא מוחקים מוצר שמופיע בהזמנות — רק מסתירים
    await prisma.product.update({ where: { id }, data: { isActive: false } });
    return NextResponse.json({ ok: true, hidden: true });
  }
  await prisma.pricelistProduct.deleteMany({ where: { productId: id } });
  await prisma.product.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
