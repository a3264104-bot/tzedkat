import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/guard";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const g = await requireAdmin();
  if (!g.ok) return g.res;
  const { id } = await params;
  const order = await prisma.order.findUnique({
    where: { id },
    include: { point: true, items: { include: { product: true } }, pricelist: true },
  });
  return NextResponse.json(order);
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const g = await requireAdmin();
  if (!g.ok) return g.res;
  const { id } = await params;
  const b = await req.json();

  // update order header fields
  const data: any = {};
  for (const k of ["status", "internalNotes", "notes", "customerName", "phone", "phone2", "pointId"]) {
    if (k in b) data[k] = b[k];
  }

  // update items (final weight / final price / quantity / add / remove)
  if (Array.isArray(b.items)) {
    for (const it of b.items) {
      if (it._delete && it.id) {
        await prisma.orderItem.delete({ where: { id: it.id } });
        continue;
      }
      if (it.id) {
        const idata: any = {};
        for (const k of ["quantity", "finalWeight", "finalPrice"]) {
          if (k in it) idata[k] = it[k];
        }
        await prisma.orderItem.update({ where: { id: it.id }, data: idata });
      } else if (it.productId) {
        const product = await prisma.product.findUnique({ where: { id: it.productId } });
        if (product) {
          const unitPrice = Number(it.unitPrice ?? product.cartonPrice);
          await prisma.orderItem.create({
            data: {
              orderId: id,
              productId: product.id,
              productName: product.name,
              unit: product.unit,
              isSingle: it.isSingle ?? false,
              quantity: it.quantity ?? 1,
              unitPrice,
              estimatedPrice: Math.round(unitPrice * (it.quantity ?? 1) * 100) / 100,
            },
          });
        }
      }
    }
  }

  // recompute finalTotal from items if any final prices exist
  if ("recomputeFinal" in b || Array.isArray(b.items)) {
    const items = await prisma.orderItem.findMany({ where: { orderId: id } });
    const hasFinal = items.some((i) => i.finalPrice !== null);
    if (hasFinal) {
      const total = items.reduce(
        (s, i) => s + Number(i.finalPrice ?? i.estimatedPrice),
        0
      );
      data.finalTotal = Math.round(total * 100) / 100;
    }
    const est = items.reduce((s, i) => s + Number(i.estimatedPrice), 0);
    data.estimatedTotal = Math.round(est * 100) / 100;
  }
  if ("finalTotal" in b) data.finalTotal = b.finalTotal;

  const order = await prisma.order.update({
    where: { id },
    data,
    include: { point: true, items: true },
  });
  return NextResponse.json(order);
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const g = await requireAdmin();
  if (!g.ok) return g.res;
  const { id } = await params;
  await prisma.order.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
