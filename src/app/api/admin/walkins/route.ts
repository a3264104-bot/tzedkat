// ═══════════════════════════════════════════════════════════════
// §398: 🚶➜👤 מזדמנים שעוד לא נרשמו כלקוחות — רשימה והמרה
// ═══════════════════════════════════════════════════════════════
// GET  /api/admin/walkins            — כל המזדמנים שנותרו
// POST /api/admin/walkins            — המרה
//   Body: { ids: string[], overrides?: { [id]: { phone?, pointId?, allowNoPhone? } } }
//   מחזיר תוצאה לכל מזדמן: הומר / חסר טלפון / חסר נקודה.
//
// ⚠️ ברצף ולא במקביל: שני מזדמנים עם אותו טלפון (אותו אדם בשתי
// חלוקות) — במקביל שניהם היו מקימים לקוח, והשני היה נכשל על
// הטלפון הייחודי. ברצף, השני מוצא את הלקוח שהראשון הקים.

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/guard";
import { convertWalkinToCustomer } from "@/lib/walkin-convert-lib";

export async function GET() {
  const g = await requireAdmin();
  if (!g.ok) return g.res;

  const walkins = await prisma.walkinOrder.findMany({
    select: {
      id: true,
      walkinNumber: true,
      customerName: true,
      customerPhone: true,
      customerEmail: true,
      paymentMethod: true,
      paymentReceived: true,
      totalAmount: true,
      createdAt: true,
      pointId: true,
      point: { select: { name: true } },
      pricelist: { select: { id: true, name: true } },
      agent: {
        select: {
          id: true,
          name: true,
          agentPointId: true,
          agentPoints: { select: { pointId: true } },
        },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  const points = await prisma.deliveryPoint.findMany({
    where: { isActive: true },
    select: { id: true, name: true, city: true },
    orderBy: { name: "asc" },
  });

  return NextResponse.json({
    walkins: walkins.map((w) => {
      const agentPointIds =
        w.agent.agentPoints.length > 0
          ? w.agent.agentPoints.map((a) => a.pointId)
          : w.agent.agentPointId
            ? [w.agent.agentPointId]
            : [];
      return {
        id: w.id,
        walkinNumber: w.walkinNumber,
        customerName: w.customerName,
        customerPhone: w.customerPhone,
        customerEmail: w.customerEmail,
        paymentMethod: w.paymentMethod,
        paymentReceived: w.paymentReceived,
        totalAmount: Number(w.totalAmount),
        createdAt: w.createdAt.toISOString(),
        pointId: w.pointId,
        pointName: w.point?.name ?? null,
        // הנקודה שתיקבע בהמרה בלי בחירה (נציג עם נקודה אחת)
        autoPointId: w.pointId ?? (agentPointIds.length === 1 ? agentPointIds[0] : null),
        agentPointIds,
        pricelistId: w.pricelist.id,
        pricelistName: w.pricelist.name,
        agentId: w.agent.id,
        agentName: w.agent.name,
      };
    }),
    points,
  });
}

export async function POST(req: Request) {
  const g = await requireAdmin();
  if (!g.ok) return g.res;

  const body = await req.json().catch(() => ({}));
  const ids: string[] = Array.isArray(body.ids) ? body.ids.map(String) : [];
  const overrides: Record<string, { phone?: string; pointId?: string; allowNoPhone?: boolean }> =
    body.overrides && typeof body.overrides === "object" ? body.overrides : {};
  if (ids.length === 0) {
    return NextResponse.json({ error: "לא נבחרו מזדמנים" }, { status: 400 });
  }
  if (ids.length > 500) {
    return NextResponse.json({ error: "עד 500 בפעם אחת" }, { status: 400 });
  }

  const actor =
    (g.session?.user as any)?.name || (g.session?.user as any)?.email || "מנהל";
  const results = [];
  for (const id of ids) {
    const o = overrides[id] ?? {};
    try {
      const r = await convertWalkinToCustomer(id, {
        phone: o.phone ? String(o.phone) : null,
        pointId: o.pointId ? String(o.pointId) : null,
        allowNoPhone: o.allowNoPhone === true,
        actorLabel: `מנהל: ${actor}`,
        allowedPointIds: null,
      });
      results.push({ id, ...r });
    } catch (e: any) {
      console.error("[admin-walkins] convert failed", id, e);
      results.push({ id, ok: false, code: "ERROR", error: e?.message || "שגיאה" });
    }
  }

  return NextResponse.json({
    converted: results.filter((r) => r.ok).length,
    results,
  });
}
