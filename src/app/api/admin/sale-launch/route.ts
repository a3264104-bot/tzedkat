// ═══════════════════════════════════════════════════════════════
// §401/§403: 📣 נוסח "פתיחת מכירה" — מילוי ושמירה
// ═══════════════════════════════════════════════════════════════
// GET  /api/admin/sale-launch?pricelistId=X
//      → הנוסח הקבוע **ממולא** למכירה (שם, תאריכים — בלי סוגריים),
//        הנקודות של המכירה, ומתי כבר נשלחה הודעת פתיחה.
// POST /api/admin/sale-launch  { pricelistId, subject, email, phone }
//      → שמירה כנוסח קבוע. הטקסט מגיע **כמו שהמנהל ערך אותו** (עם
//        הערכים של המכירה הזו), והשרת מחליף אותם בחזרה במשתנים.
//
// §403: השליחה עצמה — במסך "שליחת מייל ללקוחות" (הודעה חופשית),
// דרך /api/admin/broadcast עם launchPricelistId. מקום אחד לשליחה.

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/guard";
import {
  fillLaunchPhone,
  fillLaunchText,
  getLaunchTemplates,
  tokenizeLaunchText,
} from "@/lib/sale-launch";

const SALE_SELECT = {
  id: true,
  name: true,
  status: true,
  agentOnly: true,
  closeDate: true,
  deliveryDate: true,
  deliveryDateText: true,
  launchSentAt: true,
  launchSentCount: true,
  weeklySeriesId: true,
  points: { select: { pointId: true } },
} as const;

export async function GET(req: Request) {
  const g = await requireAdmin();
  if (!g.ok) return g.res;

  const pricelistId = new URL(req.url).searchParams.get("pricelistId") || "";
  if (!pricelistId) {
    return NextResponse.json({ error: "חסרה מכירה" }, { status: 400 });
  }
  const [sale, templates, phoneAnn] = await Promise.all([
    prisma.pricelist.findUnique({ where: { id: pricelistId }, select: SALE_SELECT }),
    getLaunchTemplates(),
    prisma.phoneAnnouncement.findFirst({
      where: { pricelistId, oncePerCaller: true, isActive: true },
      orderBy: { createdAt: "desc" },
      select: { id: true, _count: { select: { heard: true } } },
    }),
  ]);
  if (!sale) {
    return NextResponse.json({ error: "המכירה לא נמצאה" }, { status: 404 });
  }

  return NextResponse.json({
    sale: {
      id: sale.id,
      name: sale.name,
      launchSentAt: sale.launchSentAt,
      launchSentCount: sale.launchSentCount,
      weekly: !!sale.weeklySeriesId,
      pointIds: sale.points.map((p) => p.pointId),
    },
    filled: {
      subject: fillLaunchText(templates.subject, sale).replace(/\n/g, " "),
      email: fillLaunchText(templates.email, sale),
      phone: fillLaunchPhone(templates.phone, sale),
    },
    phoneAnnouncement: phoneAnn ? { heardCount: phoneAnn._count.heard } : null,
  });
}

export async function POST(req: Request) {
  const g = await requireAdmin();
  if (!g.ok) return g.res;

  const b = await req.json().catch(() => ({}));
  const pricelistId = String(b.pricelistId || "");
  const subject = String(b.subject ?? "").trim();
  const email = String(b.email ?? "").trim();
  const phone = String(b.phone ?? "").trim();
  if (!subject || !email || !phone) {
    return NextResponse.json(
      { error: "יש למלא כותרת, תוכן ונוסח לטלפון לפני השמירה" },
      { status: 400 }
    );
  }
  const sale = pricelistId
    ? await prisma.pricelist.findUnique({ where: { id: pricelistId }, select: SALE_SELECT })
    : null;
  if (!sale) {
    return NextResponse.json({ error: "המכירה לא נמצאה" }, { status: 404 });
  }

  // הערכים של המכירה הזו → משתנים, כדי שבמכירה הבאה יתחלפו לבד
  const data = {
    saleLaunchSubject: tokenizeLaunchText(subject, sale),
    saleLaunchEmail: tokenizeLaunchText(email, sale),
    saleLaunchPhone: tokenizeLaunchText(phone, sale),
  };
  await prisma.systemSettings.upsert({
    where: { id: "singleton" },
    update: data,
    create: { id: "singleton", ...data },
  });
  return NextResponse.json({ ok: true });
}
