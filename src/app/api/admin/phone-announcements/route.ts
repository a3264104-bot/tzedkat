// §30: ניהול הודעות למתקשרים למערכת הטלפונית.
//
// GET    /api/admin/phone-announcements?pricelistId=
// POST   /api/admin/phone-announcements   { pricelistId, pointId?, text, expiresAt? }
// PATCH  /api/admin/phone-announcements   { id, isActive?, text?, expiresAt? }
// DELETE /api/admin/phone-announcements?id=
//
// ההודעה מוקראת בשיחה רק ללקוח שיש לו הזמנה פעילה במכירה, ורק אם היא
// מיועדת לנקודה שלו. pointId ריק = כל הנקודות.

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/guard";

export async function GET(req: Request) {
  const g = await requireAdmin();
  if (!g.ok) return g.res;

  const { searchParams } = new URL(req.url);
  const pricelistId = searchParams.get("pricelistId") || undefined;

  const rows = await prisma.phoneAnnouncement.findMany({
    where: pricelistId ? { pricelistId } : {},
    orderBy: [{ isActive: "desc" }, { createdAt: "desc" }],
    include: {
      point: { select: { id: true, name: true, city: true } },
      pricelist: { select: { id: true, name: true, status: true } },
    },
    take: 100,
  });

  // כמה לקוחות ישמעו כל הודעה - חשוב שהמנהל ידע לפני שהוא מפרסם
  const withCounts = await Promise.all(
    rows.map(async (r) => {
      const count = await prisma.order.count({
        where: {
          pricelistId: r.pricelistId,
          status: { notIn: ["CANCELLED"] },
          deliveredAt: null,
          ...(r.pointId ? { pointId: r.pointId } : {}),
        },
      });
      return {
        id: r.id,
        pricelistId: r.pricelistId,
        pricelistName: r.pricelist?.name ?? "",
        pointId: r.pointId,
        pointName: r.point?.name ?? null,
        pointCity: r.point?.city ?? null,
        text: r.text,
        isActive: r.isActive,
        expiresAt: r.expiresAt?.toISOString() ?? null,
        createdAt: r.createdAt.toISOString(),
        // מספר הלקוחות שההודעה תגיע אליהם בפועל
        reachCount: count,
        isExpired: !!(r.expiresAt && r.expiresAt < new Date()),
      };
    })
  );

  return NextResponse.json({ rows: withCounts });
}

export async function POST(req: Request) {
  const g = await requireAdmin();
  if (!g.ok) return g.res;

  const b = await req.json().catch(() => ({}));
  const pricelistId = String(b.pricelistId || "").trim();
  const text = String(b.text || "").trim();

  if (!pricelistId || !text) {
    return NextResponse.json({ error: "חסרה מכירה או תוכן ההודעה" }, { status: 400 });
  }
  // מגבלת ימות להקראה ממוחשבת. חותכים כאן ולא בשיחה, כדי שהמנהל
  // יראה מיד שההודעה ארוכה מדי ולא יגלה זאת אחרי שלקוחות שמעו חצי.
  if (text.length > 450) {
    return NextResponse.json(
      { error: "ההודעה ארוכה מדי. מקסימום 450 תווים" },
      { status: 400 }
    );
  }

  const created = await prisma.phoneAnnouncement.create({
    data: {
      pricelistId,
      pointId: b.pointId ? String(b.pointId) : null,
      text,
      expiresAt: b.expiresAt ? new Date(b.expiresAt) : null,
      createdBy: g.session?.user?.email ?? null,
      isActive: true,
    },
    select: { id: true },
  });

  return NextResponse.json({ ok: true, id: created.id });
}

export async function PATCH(req: Request) {
  const g = await requireAdmin();
  if (!g.ok) return g.res;

  const b = await req.json().catch(() => ({}));
  const id = String(b.id || "").trim();
  if (!id) return NextResponse.json({ error: "חסר מזהה" }, { status: 400 });

  const data: any = {};
  if ("isActive" in b) data.isActive = !!b.isActive;
  if ("text" in b) {
    const t = String(b.text).trim();
    if (t.length > 450) {
      return NextResponse.json({ error: "ההודעה ארוכה מדי" }, { status: 400 });
    }
    data.text = t;
  }
  if ("expiresAt" in b) {
    data.expiresAt = b.expiresAt ? new Date(b.expiresAt) : null;
  }
  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "אין שדות לעדכון" }, { status: 400 });
  }

  await prisma.phoneAnnouncement.update({ where: { id }, data });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: Request) {
  const g = await requireAdmin();
  if (!g.ok) return g.res;

  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  if (!id) return NextResponse.json({ error: "חסר מזהה" }, { status: 400 });

  await prisma.phoneAnnouncement.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
