// ═══════════════════════════════════════════════════════════════
// §398: 👤 הנציג הופך מזדמן ללקוח
// ═══════════════════════════════════════════════════════════════
// POST /api/agent/walkin/[id]/convert
// Body: { phone?, pointId?, allowNoPhone? }
//
// ראה src/lib/walkin-convert-lib.ts — כל ההיגיון שם, משותף למנהל.
//
// ⚠️ הרשאה: רק הנציג שרשם את המזדמן (או מנהל), ונקודה רק מבין
// הנקודות שלו.

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAgent } from "@/lib/agent-guard";
import { convertWalkinToCustomer } from "@/lib/walkin-convert-lib";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const g = await requireAgent();
  if (!g.ok) return g.res;

  const { id } = await params;
  const walkin = await prisma.walkinOrder.findUnique({
    where: { id },
    select: { agentId: true },
  });
  if (!walkin) {
    return NextResponse.json({ error: "המזדמן לא נמצא (אולי כבר הומר)" }, { status: 404 });
  }
  if (walkin.agentId !== g.agent.id && !g.isAdmin) {
    return NextResponse.json({ error: "אין הרשאה" }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const result = await convertWalkinToCustomer(id, {
    phone: body.phone ? String(body.phone) : null,
    pointId: body.pointId ? String(body.pointId) : null,
    allowNoPhone: body.allowNoPhone === true,
    actorLabel: g.isAdmin ? `מנהל: ${g.agent.name}` : `נציג: ${g.agent.name}`,
    allowedPointIds: g.isAdmin ? null : g.agentPointIds,
  });

  if (!result.ok) {
    const status = result.code === "NOT_FOUND" ? 404 : result.code === "FORBIDDEN_POINT" ? 403 : 400;
    return NextResponse.json(
      {
        error: result.error,
        code: result.code,
        needsPhone: result.code === "NEEDS_PHONE" || result.code === "INVALID_PHONE",
        needsPoint: result.code === "NEEDS_POINT",
        points: result.points,
      },
      { status }
    );
  }
  return NextResponse.json(result);
}
