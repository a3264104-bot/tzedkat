// §20: helper לוודא שהמשתמש הוא נציג פעיל
// שימוש: const g = await requireAgent(); if (!g.ok) return g.res;

import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function requireAgent() {
  const session = await auth();
  if (!session?.user) {
    return {
      ok: false as const,
      res: NextResponse.json({ error: "יש להתחבר" }, { status: 401 }),
    };
  }
  const userId = (session.user as any).id as string;
  const role = (session.user as any).role as string;

  if (role !== "AGENT" && role !== "ADMIN") {
    return {
      ok: false as const,
      res: NextResponse.json({ error: "אין הרשאה" }, { status: 403 }),
    };
  }

  // טעינת פרטי הנציג (עם agentPointId + עמלות)
  const agent = await prisma.customer.findUnique({
    where: { id: userId },
    select: {
      id: true,
      name: true,
      role: true,
      agentPointId: true,
      agentPoint: { select: { id: true, name: true, city: true } },
      commissionRateCarton: true,
      commissionRateSingles: true,
    },
  });

  if (!agent) {
    return {
      ok: false as const,
      res: NextResponse.json({ error: "נציג לא נמצא" }, { status: 404 }),
    };
  }

  return {
    ok: true as const,
    session,
    userId,
    role,
    agent,
    isAdmin: role === "ADMIN",
  };
}
