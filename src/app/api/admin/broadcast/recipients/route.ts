// GET /api/admin/broadcast/recipients
// מחזיר את הרשימות שמסך הברודקאסט צריך: כל הלקוחות עם מייל + כל נקודות החלוקה.
// מוגן ב-requireAdmin.

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/guard";

export async function GET() {
  const g = await requireAdmin();
  if (!g.ok) return g.res;

  const [customers, points] = await Promise.all([
    prisma.customer.findMany({
      where: {
        role: "CUSTOMER",
        email: { not: null },
      },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        defaultPointId: true,
        defaultPoint: { select: { name: true } },
      },
      orderBy: { name: "asc" },
    }),
    prisma.deliveryPoint.findMany({
      where: { isActive: true },
      select: { id: true, name: true, city: true },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    }),
  ]);

  return NextResponse.json({
    points,
    customers: customers.map((c) => ({
      id: c.id,
      name: c.name,
      email: c.email,
      phone: c.phone,
      pointId: c.defaultPointId,
      pointName: c.defaultPoint?.name ?? null,
    })),
  });
}
