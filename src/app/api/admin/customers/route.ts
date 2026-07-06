import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/guard";

// רשימת/חיפוש לקוחות למנהל
export async function GET(req: Request) {
  const g = await requireAdmin();
  if (!g.ok) return g.res;

  const { searchParams } = new URL(req.url);
  const q = (searchParams.get("q") || "").trim();

  const searchFilter = q
    ? {
        OR: [
          { name: { contains: q, mode: "insensitive" as const } },
          { phone: { contains: q } },
          { email: { contains: q, mode: "insensitive" as const } },
        ],
      }
    : {};

  const customers = await prisma.customer.findMany({
    where: { role: "CUSTOMER", ...searchFilter },
    include: {
      defaultPoint: { select: { name: true } },
      _count: { select: { orders: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  return NextResponse.json(
    customers.map((c) => ({
      id: c.id,
      name: c.name,
      phone: c.phone,
      email: c.email,
      pointName: c.defaultPoint?.name ?? null,
      orderCount: c._count.orders,
      hasPaymentToken: !!c.paymentToken,
      createdAt: c.createdAt,
    }))
  );
}
