import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/guard";

export async function GET() {
  const g = await requireAdmin();
  if (!g.ok) return g.res;
  const cats = await prisma.category.findMany({ orderBy: { sortOrder: "asc" } });
  return NextResponse.json(cats);
}

export async function POST(req: Request) {
  const g = await requireAdmin();
  if (!g.ok) return g.res;
  const b = await req.json();
  const cat = await prisma.category.create({
    data: { name: b.name, sortOrder: b.sortOrder ?? 0 },
  });
  return NextResponse.json(cat);
}
