// ═══════════════════════════════════════════════════════════════
// §396: 🔁 סדרות שבועיות — רשימה ויצירה
// ═══════════════════════════════════════════════════════════════
// GET  /api/admin/weekly-series        → כל הסדרות + השבוע הנוכחי
// POST /api/admin/weekly-series        → סדרה חדשה
//
// Body (POST/PATCH):
//   { name, isActive?, switchDay, switchMinute, orderFee, singleSurcharge,
//     deliveryNote?, pointIds: string[],
//     products: { productId, price: number|null }[] }

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/guard";
import { ensureWeeklySales, countUndelivered } from "@/lib/weekly-sales";
import { parseSeriesBody } from "@/lib/weekly-series-validate";

export async function GET() {
  const g = await requireAdmin();
  if (!g.ok) return g.res;

  // ⚠️ קודם מוודאים שהשבועות מעודכנים — המנהל צריך לראות את
  // המצב האמיתי, לא מה שהיה לפני דקה.
  await ensureWeeklySales(true);

  const series = await prisma.weeklySeries.findMany({
    orderBy: { createdAt: "asc" },
    include: {
      points: { include: { point: { select: { id: true, name: true, city: true } } } },
      products: { select: { productId: true, price: true } },
      pricelists: {
        orderBy: { weekStart: "desc" },
        take: 1,
        select: {
          id: true,
          name: true,
          status: true,
          weekStart: true,
          weekEnd: true,
          weekClosedAt: true,
          _count: { select: { orders: true } },
        },
      },
      _count: { select: { pricelists: true } },
    },
  });

  const now = Date.now();
  const out = [];
  for (const s of series) {
    const cur = s.pricelists[0] ?? null;
    const ended = !!cur?.weekEnd && now >= cur.weekEnd.getTime();
    const undelivered =
      cur && cur.status === "ACTIVE" && ended ? await countUndelivered(cur.id) : 0;
    out.push({
      id: s.id,
      name: s.name,
      isActive: s.isActive,
      switchDay: s.switchDay,
      switchMinute: s.switchMinute,
      orderFee: Number(s.orderFee),
      singleSurcharge: Number(s.singleSurcharge),
      deliveryNote: s.deliveryNote,
      points: s.points.map((p) => p.point),
      products: s.products.map((p) => ({
        productId: p.productId,
        price: p.price != null ? Number(p.price) : null,
      })),
      weeksCount: s._count.pricelists,
      current: cur
        ? {
            id: cur.id,
            name: cur.name,
            status: cur.status,
            weekStart: cur.weekStart?.toISOString() ?? null,
            weekEnd: cur.weekEnd?.toISOString() ?? null,
            ordersCount: cur._count.orders,
            ended,
            undelivered,
          }
        : null,
    });
  }
  return NextResponse.json(out);
}

export async function POST(req: Request) {
  const g = await requireAdmin();
  if (!g.ok) return g.res;
  const b = await req.json().catch(() => ({}));

  const parsed = await parseSeriesBody(b, null);
  if ("error" in parsed) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  const created = await prisma.weeklySeries.create({
    data: {
      ...parsed.fields,
      points: { create: parsed.pointIds.map((pointId) => ({ pointId })) },
      products: {
        create: parsed.products.map((p) => ({
          productId: p.productId,
          price: p.price,
        })),
      },
    },
    select: { id: true },
  });

  // ⚠️ השבוע הראשון נפתח מיד — המנהל מצפה לראות אותו ברשימה.
  await ensureWeeklySales(true);

  return NextResponse.json({ ok: true, id: created.id });
}
