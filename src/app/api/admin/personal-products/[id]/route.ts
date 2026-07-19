import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/guard";

// §9: עדכון/מחיקת מוצר אישי בודד
// PATCH - עדכון שדות
// DELETE - מחיקה (רק אם לא מקושר לבקשות)

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const g = await requireAdmin();
  if (!g.ok) return g.res;

  const { id } = await params;
  const b = await req.json().catch(() => ({}));

  const data: any = {};
  if (typeof b.name === "string" && b.name.trim()) data.name = b.name.trim();
  if ("imageUrl" in b) data.imageUrl = b.imageUrl || null;
  if ("description" in b) data.description = b.description || null;
  if ("maxQuantity" in b) {
    data.maxQuantity = b.maxQuantity ? Number(b.maxQuantity) : null;
  }
  if ("stock" in b) {
    data.stock = b.stock !== null && b.stock !== "" ? Number(b.stock) : null;
  }
  if ("pointId" in b) data.pointId = b.pointId || null; // §9
  if ("isActive" in b) data.isActive = !!b.isActive;
  if ("sortOrder" in b) data.sortOrder = Number(b.sortOrder) || 0;

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "אין שדות לעדכון" }, { status: 400 });
  }

  const updated = await prisma.personalProduct.update({
    where: { id },
    data,
  });

  return NextResponse.json(updated);
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const g = await requireAdmin();
  if (!g.ok) return g.res;

  const { id } = await params;

  // בדיקה שהמוצר לא מקושר לבקשות פעילות
  const linkedRequests = await prisma.personalRequestItem.count({
    where: {
      productId: id,
      request: { status: { notIn: ["CANCELLED", "DONE"] } },
    },
  });

  if (linkedRequests > 0) {
    return NextResponse.json(
      {
        error: `לא ניתן למחוק - המוצר קשור ל-${linkedRequests} בקשות פעילות. סמן כלא פעיל במקום.`,
      },
      { status: 400 }
    );
  }

  // אם יש בקשות ישנות (DONE/CANCELLED) - נסיר את הקישור
  // אבל השדה productId הוא not null, אז נצטרך לשנות את הסכמה (או פשוט להשאיר)
  // לכן: מוחקים רק אם אין קישורים בכלל
  const anyLinked = await prisma.personalRequestItem.count({
    where: { productId: id },
  });
  if (anyLinked > 0) {
    return NextResponse.json(
      {
        error: `לא ניתן למחוק - קיימות בקשות ישנות עם מוצר זה. סמן כלא פעיל במקום.`,
      },
      { status: 400 }
    );
  }

  await prisma.personalProduct.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
