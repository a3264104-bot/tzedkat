import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/guard";

// §9: רשימת כל הבקשות האישיות למנהל
// GET /api/admin/personal-requests

export async function GET() {
  const g = await requireAdmin();
  if (!g.ok) return g.res;

  const requests = await prisma.personalRequest.findMany({
    orderBy: [{ hasUnreadForAdmin: "desc" }, { updatedAt: "desc" }],
    take: 200,
    include: {
      items: { select: { productName: true, quantity: true } },
    },
  });

  return NextResponse.json(
    requests.map((r) => ({
      id: r.id,
      requestNumber: r.requestNumber,
      customerName: r.customerName,
      phone: r.phone,
      notes: r.notes,
      status: r.status,
      hasUnreadForAdmin: r.hasUnreadForAdmin,
      hasUnreadForCustomer: r.hasUnreadForCustomer,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
      items: r.items,
    }))
  );
}
