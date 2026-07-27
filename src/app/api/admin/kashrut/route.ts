// ניהול כשרויות - למנהל
// GET  /api/admin/kashrut - רשימה
// POST /api/admin/kashrut - יצירה

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/guard";

export async function GET(req: Request) {
  const g = await requireAdmin();
  if (!g.ok) return g.res;

  const { searchParams } = new URL(req.url);
  const activeOnly = searchParams.get("activeOnly") === "1";

  const kashruts = await prisma.kashrut.findMany({
    where: activeOnly ? { isActive: true } : {},
    include: {
      _count: { select: { products: true } },
    },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
  });

  return NextResponse.json(
    kashruts.map((k) => ({
      id: k.id,
      name: k.name,
      imageUrl: k.imageUrl,
      sortOrder: k.sortOrder,
      isActive: k.isActive,
      productCount: k._count.products,
    }))
  );
}

export async function POST(req: Request) {
  const g = await requireAdmin();
  if (!g.ok) return g.res;

  const body = await req.json().catch(() => ({}));
  const name = String(body.name || "").trim();
  const imageUrl = String(body.imageUrl || "").trim();
  const sortOrder = Number(body.sortOrder ?? 0);

  if (!name) {
    return NextResponse.json({ error: "שם כשרות חובה" }, { status: 400 });
  }
  if (!imageUrl) {
    return NextResponse.json({ error: "יש להעלות תמונה" }, { status: 400 });
  }

  const existing = await prisma.kashrut.findUnique({ where: { name } });
  if (existing) {
    return NextResponse.json(
      { error: "כשרות בשם זה כבר קיימת" },
      { status: 409 }
    );
  }

  const kashrut = await prisma.kashrut.create({
    data: { name, imageUrl, sortOrder },
  });

  return NextResponse.json({ ok: true, kashrut });
}
