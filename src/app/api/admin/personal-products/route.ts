import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/guard";

// §9: ניהול מוצרים אישיים על ידי מנהל
// GET - רשימה
// POST - הוספת מוצר חדש
// Body: { name, imageUrl?, description?, maxQuantity?, stock?, pointId?, isActive?, sortOrder? }

export async function GET() {
  const g = await requireAdmin();
  if (!g.ok) return g.res;

  const products = await prisma.personalProduct.findMany({
    orderBy: [{ isActive: "desc" }, { sortOrder: "asc" }, { createdAt: "desc" }],
    include: {
      point: { select: { id: true, name: true, city: true } },
    },
  });

  return NextResponse.json(products);
}

export async function POST(req: Request) {
  const g = await requireAdmin();
  if (!g.ok) return g.res;

  const b = await req.json().catch(() => ({}));
  const name = String(b.name || "").trim();

  if (!name) {
    return NextResponse.json({ error: "יש להזין שם" }, { status: 400 });
  }

  const created = await prisma.personalProduct.create({
    data: {
      name,
      imageUrl: b.imageUrl || null,
      description: b.description || null,
      maxQuantity: b.maxQuantity ? Number(b.maxQuantity) : null,
      stock: b.stock !== undefined && b.stock !== null && b.stock !== "" ? Number(b.stock) : null,
      pointId: b.pointId || null, // §9: נקודת חלוקה ייעודית
      isActive: b.isActive !== false,
      sortOrder: Number(b.sortOrder) || 0,
    },
  });

  return NextResponse.json(created);
}
