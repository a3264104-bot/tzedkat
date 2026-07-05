import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/guard";

export async function GET() {
  const g = await requireAdmin();
  if (!g.ok) return g.res;
  const products = await prisma.product.findMany({
    include: { category: true },
    orderBy: [{ category: { sortOrder: "asc" } }, { sortOrder: "asc" }],
  });
  return NextResponse.json(products);
}

export async function POST(req: Request) {
  const g = await requireAdmin();
  if (!g.ok) return g.res;
  const b = await req.json();
  const product = await prisma.product.create({
    data: {
      name: b.name,
      categoryId: b.categoryId,
      cartonPrice: b.cartonPrice,
      allowSingles: b.allowSingles ?? false,
      singleSurcharge: b.singleSurcharge ?? null,
      unit: b.unit ?? 'ק"ג',
      saleType: b.saleType ?? "WEIGHT",
      priceType: b.priceType ?? "REGULAR",
      packageWeight: b.packageWeight ?? null,
      avgWeightPerUnit: b.avgWeightPerUnit ?? null,
      isFrozen: b.isFrozen ?? false,
      limitedQty: b.limitedQty ?? false,
      limitedQtyAmount: b.limitedQtyAmount ?? null,
      isActive: b.isActive ?? true,
      sortOrder: b.sortOrder ?? 0,
    },
  });
  return NextResponse.json(product);
}
