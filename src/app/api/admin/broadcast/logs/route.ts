// GET /api/admin/broadcast/logs — יומן שליחות המייל ללקוחות (50 האחרונות)
//
// ⚠️ "לא הושלמה" נגזר כאן ולא נשמר: שליחה שעדיין SENDING אחרי
// STALE_MIN דקות כבר לא רצה — הפונקציה ב-Vercel נקטעה באמצע.

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/guard";

const STALE_MIN = 15;

export async function GET() {
  const g = await requireAdmin();
  if (!g.ok) return g.res;

  const logs = await prisma.broadcastLog.findMany({
    orderBy: { createdAt: "desc" },
    take: 50,
  });

  const saleIds = Array.from(new Set(logs.map((l) => l.pricelistId).filter(Boolean))) as string[];
  const sales = saleIds.length
    ? await prisma.pricelist.findMany({ where: { id: { in: saleIds } }, select: { id: true, name: true } })
    : [];
  const saleName = new Map(sales.map((s) => [s.id, s.name]));

  const staleBefore = Date.now() - STALE_MIN * 60 * 1000;

  return NextResponse.json({
    logs: logs.map((l) => {
      const pending = Math.max(0, l.total - l.sent - l.failed);
      const state =
        l.status === "DONE"
          ? "DONE"
          : l.createdAt.getTime() < staleBefore
            ? "INCOMPLETE"
            : "SENDING";
      return {
        id: l.id,
        createdAt: l.createdAt.toISOString(),
        createdBy: l.createdBy,
        subject: l.subject,
        mode: l.mode,
        saleName: l.pricelistId ? saleName.get(l.pricelistId) ?? null : null,
        attachmentCount: l.attachmentCount,
        total: l.total,
        sent: l.sent,
        failed: l.failed,
        pending,
        state,
        finishedAt: l.finishedAt?.toISOString() ?? null,
      };
    }),
  });
}
