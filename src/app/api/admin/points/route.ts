import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/guard";

export async function GET() {
  const g = await requireAdmin();
  if (!g.ok) return g.res;
  const points = await prisma.deliveryPoint.findMany({ orderBy: { sortOrder: "asc" } });
  return NextResponse.json(points);
}

export async function POST(req: Request) {
  const g = await requireAdmin();
  if (!g.ok) return g.res;
  const b = await req.json();
  const point = await prisma.deliveryPoint.create({
    data: {
      name: b.name,
      city: b.city ?? null,
      address: b.address ?? null,
      contactName: b.contactName ?? null,
      phone: b.phone ?? null,
      email: b.email ?? null,
      deliveryHours: b.deliveryHours ?? null,
      notes: b.notes ?? null,
      isActive: b.isActive ?? true,
      sortOrder: b.sortOrder ?? 0,
    },
  });
  return NextResponse.json(point);
}
