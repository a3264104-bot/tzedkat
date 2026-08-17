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

  // §60: 🐛 תוקן דפוס ג'. הסינון נשען רק על agentPointId הישן:
  // נציג רב-נקודתי (agentPoints[] מלא, agentPointId ריק) קיבל סינון
  // *ריק* וראה את כל הלקוחות במערכת. עכשיו: כל הנקודות עם נפילה
  // לשדה הישן, ונציג בלי נקודות כלל מקבל רשימה ריקה - לא הכל.
  let pointFilter: any = {};
  if (g.role === "AGENT") {
    const agentPoints = await prisma.agentPoint.findMany({
      where: { agentId: g.agent!.id },
      select: { pointId: true },
    });
    const myPointIds = agentPoints.map((ap) => ap.pointId);
    if (myPointIds.length === 0 && g.agent?.agentPointId) {
      myPointIds.push(g.agent.agentPointId);
    }
    if (myPointIds.length === 0) {
      return NextResponse.json([]);
    }
    pointFilter = {
      OR: [
        { defaultPointId: { in: myPointIds } },
        { orders: { some: { pointId: { in: myPointIds } } } },
      ],
    };
  }

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
      // §60: לתצוגת 💵 בכל UI שצורך את הרשימה הזו
      paymentPreference: c.paymentPreference,
      orderCount: c._count.orders,
    }))
  );
}
