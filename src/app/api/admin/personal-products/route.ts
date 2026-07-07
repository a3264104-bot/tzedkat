import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/guard";

// מוצרי מודול ההזמנות האישיות (נפרד ממוצרי המכירה)
export async function GET() {
  const g = await requireAdmin();
  if (!g.ok) return g.res;
  const products = await prisma.personalProduct.findMany({
    orderBy: { sortOrder: "asc" },
  });
  return NextResponse.json(products);
}

export async function POST(req: Request) {
  const g = await requireAdmin();
  if (!g.ok) return g.res;
  const b = await req.json();
  if (!b.name?.trim()) {
    return NextResponse.json({ error: "יש להזין שם מוצר" }, { status: 400 });
  }
  const product = await prisma.personalProduct.create({
    data: {
      name: b.name.trim(),
      imageUrl: b.imageUrl || null,
      description: b.description || null,
      isActive: b.isActive ?? true,
      sortOrder: b.sortOrder ?? 0,
      maxQuantity: b.maxQuantity ? Number(b.maxQuantity) : null,
      stock: b.stock != null && b.stock !== "" ? Number(b.stock) : null,
    },
  });
  return NextResponse.json(product);
}
