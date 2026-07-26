// §20: המנהל מתקן משקל סופי (actualWeight) בלי לגעת ב-agentEnteredWeight
// PATCH /api/admin/weight-review-item/[id]

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/guard";

// Body: {
//   actualWeight?: number,  // המנהל מתקן - זה מה שהלקוח משלם
//   agentNote?: string,     // הערה
//   isCancelled?: boolean,  // ביטול (המנהל יכול גם)
// }
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const g = await requireAdmin();
  if (!g.ok) return g.res;

  const { id } = await params;
  const body = await req.json().catch(() => ({}));

  const item = await prisma.orderItem.findUnique({
    where: { id },
    select: {
      id: true,
      unitPrice: true,
      order: {
        select: {
          id: true,
          pricelistId: true,
          status: true,
        },
      },
    },
  });
  if (!item) {
    return NextResponse.json({ error: "פריט לא נמצא" }, { status: 404 });
  }

  const data: any = {};

  // עדכון משקל סופי - זה השדה שהמנהל מתקן
  if ("actualWeight" in body) {
    const w = Number(body.actualWeight);
    if (body.actualWeight === null || body.actualWeight === "") {
      data.actualWeight = null;
      data.finalWeight = null;
      data.finalPrice = null;
    } else {
      if (isNaN(w) || w < 0) {
        return NextResponse.json({ error: "משקל לא תקין" }, { status: 400 });
      }
      data.actualWeight = w;
      data.finalWeight = w;
      data.finalPrice = w * Number(item.unitPrice);
    }
  }

  if ("agentNote" in body) {
    data.agentNote = body.agentNote ? String(body.agentNote).trim() : null;
  }

  if ("isCancelled" in body) {
    data.isCancelled = !!body.isCancelled;
    if (data.isCancelled) {
      data.finalPrice = 0;
    }
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "אין שדות לעדכון" }, { status: 400 });
  }

  const updated = await prisma.orderItem.update({
    where: { id },
    data,
  });

  return NextResponse.json({
    ok: true,
    item: {
      id: updated.id,
      actualWeight: updated.actualWeight ? Number(updated.actualWeight) : null,
      finalWeight: updated.finalWeight ? Number(updated.finalWeight) : null,
      finalPrice: updated.finalPrice ? Number(updated.finalPrice) : null,
      agentNote: updated.agentNote,
      isCancelled: updated.isCancelled,
    },
  });
}
