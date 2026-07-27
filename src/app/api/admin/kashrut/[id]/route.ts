// עדכון/מחיקה של כשרות
// PATCH  /api/admin/kashrut/[id]
// DELETE /api/admin/kashrut/[id]

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/guard";

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const g = await requireAdmin();
  if (!g.ok) return g.res;

  const { id } = await params;
  const body = await req.json().catch(() => ({}));

  const data: any = {};

  if ("name" in body) {
    const name = String(body.name || "").trim();
    if (!name) return NextResponse.json({ error: "שם חובה" }, { status: 400 });
    // בדיקת כפילות
    const dup = await prisma.kashrut.findUnique({ where: { name } });
    if (dup && dup.id !== id) {
      return NextResponse.json({ error: "השם כבר תפוס" }, { status: 409 });
    }
    data.name = name;
  }
  if ("imageUrl" in body) {
    const url = String(body.imageUrl || "").trim();
    if (!url) return NextResponse.json({ error: "תמונה חובה" }, { status: 400 });
    data.imageUrl = url;
  }
  if ("sortOrder" in body) {
    data.sortOrder = Number(body.sortOrder) || 0;
  }
  if ("isActive" in body) {
    data.isActive = !!body.isActive;
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "אין שדות לעדכון" }, { status: 400 });
  }

  const kashrut = await prisma.kashrut.update({ where: { id }, data });
  return NextResponse.json({ ok: true, kashrut });
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const g = await requireAdmin();
  if (!g.ok) return g.res;

  const { id } = await params;

  // בדיקה שאף מוצר לא משתמש בזה
  const usingCount = await prisma.product.count({ where: { kashrutId: id } });
  if (usingCount > 0) {
    return NextResponse.json(
      {
        error: `לא ניתן למחוק - ${usingCount} מוצרים משתמשים בכשרות זו. שנה אותם קודם או בטל את הכשרות במקום למחוק.`,
      },
      { status: 409 }
    );
  }

  await prisma.kashrut.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
