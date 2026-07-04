import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";

// guard לנציג - מחזיר את רשומת הנציג המלאה (כולל הרשאות) או שגיאה
async function requireAgent() {
  const session = await auth();
  if (!session?.user) {
    return { ok: false as const, res: NextResponse.json({ error: "יש להתחבר" }, { status: 401 }) };
  }
  const role = (session.user as any).role;
  if (role !== "AGENT" && role !== "ADMIN") {
    return { ok: false as const, res: NextResponse.json({ error: "אין הרשאה" }, { status: 403 }) };
  }
  const id = (session.user as any).id as string;
  const agent = await prisma.customer.findUnique({ where: { id } });
  // מנהל שנכנס לאזור נציג - מטופל כנציג ללא הגבלות
  return { ok: true as const, agent, role };
}

// חיפוש לקוחות (בכפוף להרשאת הנקודה של הנציג)
export async function GET(req: Request) {
  const g = await requireAgent();
  if (!g.ok) return g.res;

  const { searchParams } = new URL(req.url);
  const q = (searchParams.get("q") || "").trim();

  // הגבלת נקודה: אם לנציג יש agentPointId, מציגים רק לקוחות ששייכים לנקודה הזו
  // (כברירת מחדל defaultPointId, או שהזמינו לנקודה הזו בעבר)
  const pointFilter =
    g.role === "AGENT" && g.agent?.agentPointId
      ? {
          OR: [
            { defaultPointId: g.agent.agentPointId },
            { orders: { some: { pointId: g.agent.agentPointId } } },
          ],
        }
      : {};

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
    where: {
      role: "CUSTOMER", // רק לקוחות רגילים, לא נציגים/מנהלים
      ...pointFilter,
      ...searchFilter,
    },
    include: {
      defaultPoint: { select: { name: true, city: true } },
      _count: { select: { orders: true } },
    },
    orderBy: { name: "asc" },
    take: 50,
  });

  return NextResponse.json(
    customers.map((c) => ({
      id: c.id,
      name: c.name,
      phone: c.phone,
      email: c.email,
      defaultPointName: c.defaultPoint?.name ?? null,
      orderCount: c._count.orders,
    }))
  );
}
