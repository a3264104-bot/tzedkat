// §inbound: מי מקבל את קובץ ההזמנה במייל בכל פתיחת מכירה (wantsExcelOrder)
// GET  ?q=   → הרשימה הנוכחית, ואם יש q — גם תוצאות חיפוש להוספה
// POST { customerId, wants } → הוספה / הסרה
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/guard";

const SELECT = {
  id: true,
  name: true,
  email: true,
  phone: true,
  paymentToken: true,
  paymentPreference: true,
  defaultPoint: { select: { name: true } },
} as const;

function view(c: any) {
  return {
    id: c.id,
    name: c.name,
    email: c.email,
    phone: c.phone,
    pointName: c.defaultPoint?.name ?? null,
    // בלי כרטיס (ולא מזומן) — הקובץ יישלח, אבל הזמנה ממנו תידחה עם בקשה להסדיר תשלום
    canOrder: !!c.paymentToken || c.paymentPreference === "CASH",
  };
}

export async function GET(req: Request) {
  const g = await requireAdmin();
  if (!g.ok) return g.res;
  const q = (new URL(req.url).searchParams.get("q") || "").trim();
  const [list, found] = await Promise.all([
    prisma.customer.findMany({
      where: { wantsExcelOrder: true, isActive: true },
      select: SELECT,
      orderBy: { name: "asc" },
    }),
    q.length >= 2
      ? prisma.customer.findMany({
          where: {
            isActive: true,
            wantsExcelOrder: false,
            OR: [
              { name: { contains: q, mode: "insensitive" } },
              { email: { contains: q, mode: "insensitive" } },
              { phone: { contains: q.replace(/\D/g, "") || q } },
            ],
          },
          select: SELECT,
          take: 15,
          orderBy: { name: "asc" },
        })
      : Promise.resolve([]),
  ]);
  return NextResponse.json({ list: list.map(view), found: found.map(view) });
}

export async function POST(req: Request) {
  const g = await requireAdmin();
  if (!g.ok) return g.res;
  const b = await req.json().catch(() => ({}));
  const customerId = String(b.customerId || "");
  if (!customerId) return NextResponse.json({ error: "חסר לקוח" }, { status: 400 });
  const c = await prisma.customer.findUnique({ where: { id: customerId }, select: { email: true } });
  if (!c) return NextResponse.json({ error: "לקוח לא נמצא" }, { status: 404 });
  if (b.wants && !c.email) {
    return NextResponse.json({ error: "ללקוח אין כתובת מייל — יש להוסיף מייל בכרטיס הלקוח" }, { status: 400 });
  }
  await prisma.customer.update({ where: { id: customerId }, data: { wantsExcelOrder: !!b.wants } });
  return NextResponse.json({ ok: true });
}
