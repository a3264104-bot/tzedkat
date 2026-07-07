import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/guard";

// רשימת בקשות ההזמנה האישיות למנהל
export async function GET() {
  const g = await requireAdmin();
  if (!g.ok) return g.res;
  const requests = await prisma.personalRequest.findMany({
    include: { items: true, customer: { select: { email: true } } },
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json(
    requests.map((r) => ({
      id: r.id,
      requestNumber: r.requestNumber,
      customerName: r.customerName,
      phone: r.phone,
      email: r.customer?.email ?? null,
      notes: r.notes,
      status: r.status,
      createdAt: r.createdAt,
      items: r.items.map((it) => ({ productName: it.productName, quantity: it.quantity })),
    }))
  );
}

export async function PATCH(req: Request) {
  const g = await requireAdmin();
  if (!g.ok) return g.res;
  const { id, status } = await req.json();
  if (!id || !status) {
    return NextResponse.json({ error: "חסרים נתונים" }, { status: 400 });
  }
  const allowed = ["NEW", "IN_PROGRESS", "CONTACTED", "WAITING", "DONE", "CANCELLED"];
  if (!allowed.includes(status)) {
    return NextResponse.json({ error: "סטטוס לא תקין" }, { status: 400 });
  }
  await prisma.personalRequest.update({ where: { id }, data: { status } });
  return NextResponse.json({ ok: true });
}
