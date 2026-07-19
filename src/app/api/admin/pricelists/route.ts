import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/guard";

export async function GET() {
  const g = await requireAdmin();
  if (!g.ok) return g.res;
  const lists = await prisma.pricelist.findMany({
    include: {
      _count: { select: { orders: true, products: true, points: true } },
    },
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json(lists);
}

export async function POST(req: Request) {
  const g = await requireAdmin();
  if (!g.ok) return g.res;
  const b = await req.json();

  // duplicate from existing
  if (b.duplicateFrom) {
    const src = await prisma.pricelist.findUnique({
      where: { id: b.duplicateFrom },
      include: { products: true, points: true },
    });
    if (!src) return NextResponse.json({ error: "מחירון מקור לא נמצא" }, { status: 404 });
    const copy = await prisma.pricelist.create({
      data: {
        name: b.name || `${src.name} (העתק)`,
        status: "DRAFT",
        singleSurcharge: src.singleSurcharge,
        notes: src.notes,
        deliveryDateText: src.deliveryDateText,
        products: { create: src.products.map((p) => ({ productId: p.productId, price: p.price })) },
        points: { create: src.points.map((p) => ({ pointId: p.pointId })) },
      },
    });
    return NextResponse.json(copy);
  }

  const list = await prisma.pricelist.create({
    data: {
      name: b.name,
      status: b.status ?? "DRAFT",
      singleSurcharge: b.singleSurcharge ?? 3,
      notes: b.notes ?? null,
      deliveryDateText: b.deliveryDateText ?? null,
      openDate: b.openDate ? new Date(b.openDate) : null,
      closeDate: b.closeDate ? new Date(b.closeDate) : null,
      editDeadline: b.editDeadline ? new Date(b.editDeadline) : null,
      deliveryDate: b.deliveryDate ? new Date(b.deliveryDate) : null,
      deliveryDateEnd: b.deliveryDateEnd ? new Date(b.deliveryDateEnd) : null,
      products: b.productIds?.length
        ? { create: b.productIds.map((id: string) => ({ productId: id })) }
        : undefined,
      points: b.pointIds?.length
        ? { create: b.pointIds.map((id: string) => ({ pointId: id })) }
        : undefined,
    },
  });
  return NextResponse.json(list);
}
