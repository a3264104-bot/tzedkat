// §inbound: מי מקבל את קובץ ההזמנה במייל בכל פתיחת מכירה (wantsExcelOrder)
// GET  → כל הלקוחות הפעילים עם מייל (לרשימה עם סימון), ומי מסומן
// POST { customerIds: string[], wants: boolean } → סימון / ביטול (גם כמה בבת אחת)
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/guard";

export async function GET() {
  const g = await requireAdmin();
  if (!g.ok) return g.res;
  const all = await prisma.customer.findMany({
    where: { isActive: true, role: "CUSTOMER", email: { not: "" } },
    select: {
      id: true,
      name: true,
      email: true,
      phone: true,
      wantsExcelOrder: true,
      paymentToken: true,
      paymentPreference: true,
      defaultPointId: true,
      defaultPoint: { select: { name: true } },
    },
    orderBy: { name: "asc" },
  });
  return NextResponse.json({
    customers: all
      .filter((c) => c.email)
      .map((c) => ({
        id: c.id,
        name: c.name,
        email: c.email,
        phone: c.phone,
        wants: c.wantsExcelOrder,
        pointId: c.defaultPointId,
        pointName: c.defaultPoint?.name ?? null,
        // בלי כרטיס (ולא מזומן) — הקובץ יישלח, אבל הזמנה ממנו תידחה עם בקשה להסדיר תשלום
        canOrder: !!c.paymentToken || c.paymentPreference === "CASH",
      })),
  });
}

export async function POST(req: Request) {
  const g = await requireAdmin();
  if (!g.ok) return g.res;
  const b = await req.json().catch(() => ({}));
  const ids: string[] = Array.isArray(b.customerIds)
    ? b.customerIds.map(String)
    : b.customerId
      ? [String(b.customerId)]
      : [];
  if (ids.length === 0) return NextResponse.json({ error: "לא נבחרו לקוחות" }, { status: 400 });
  // רק לקוחות עם מייל אפשר לסמן (אחרת אין לאן לשלוח)
  const r = await prisma.customer.updateMany({
    where: { id: { in: ids }, ...(b.wants ? { email: { not: "" } } : {}) },
    data: { wantsExcelOrder: !!b.wants },
  });
  return NextResponse.json({ ok: true, updated: r.count });
}
