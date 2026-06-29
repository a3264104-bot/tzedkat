import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/guard";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const g = await requireAdmin();
  if (!g.ok) return g.res;
  const { id } = await params;
  const list = await prisma.pricelist.findUnique({
    where: { id },
    include: {
      products: { include: { product: true } },
      points: { include: { point: true } },
    },
  });
  return NextResponse.json(list);
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const g = await requireAdmin();
  if (!g.ok) return g.res;
  const { id } = await params;
  const b = await req.json();

  // making active deactivates others
  if (b.status === "ACTIVE") {
    await prisma.pricelist.updateMany({
      where: { status: "ACTIVE", NOT: { id } },
      data: { status: "CLOSED" },
    });
  }

  const data: any = {};
  for (const k of ["name", "status", "notes", "deliveryDateText"]) {
    if (k in b) data[k] = b[k];
  }
  if ("singleSurcharge" in b) data.singleSurcharge = b.singleSurcharge;
  if ("openDate" in b) data.openDate = b.openDate ? new Date(b.openDate) : null;
  if ("closeDate" in b) data.closeDate = b.closeDate ? new Date(b.closeDate) : null;
  if ("deliveryDate" in b) data.deliveryDate = b.deliveryDate ? new Date(b.deliveryDate) : null;

  const list = await prisma.pricelist.update({ where: { id }, data });

  // update product membership / prices
  if (b.products) {
    await prisma.pricelistProduct.deleteMany({ where: { pricelistId: id } });
    await prisma.pricelistProduct.createMany({
      data: b.products.map((p: any) => ({
        pricelistId: id,
        productId: p.productId,
        price: p.price ?? null,
      })),
    });
  }
  // update point membership
  if (b.pointIds) {
    await prisma.pricelistPoint.deleteMany({ where: { pricelistId: id } });
    await prisma.pricelistPoint.createMany({
      data: b.pointIds.map((pid: string) => ({ pricelistId: id, pointId: pid })),
    });
  }

  return NextResponse.json(list);
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const g = await requireAdmin();
  if (!g.ok) return g.res;
  const { id } = await params;
  const used = await prisma.order.count({ where: { pricelistId: id } });
  if (used > 0)
    return NextResponse.json({ error: "לא ניתן למחוק מחירון עם הזמנות" }, { status: 400 });
  await prisma.pricelist.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
