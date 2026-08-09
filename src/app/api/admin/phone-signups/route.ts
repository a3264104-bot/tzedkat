// §24: ניהול בקשות פתיחת חשבון שהתקבלו במערכת הטלפונית.
//
// GET   /api/admin/phone-signups?status=&pointId=
//       רשימת הבקשות. נציג רואה רק את הנקודות שלו; מנהל רואה הכל.
// PATCH /api/admin/phone-signups
//       Body: { id, action, ... } — שיוך נציג, סימון יצירת קשר, כישלון.
//
// למה זה קיים: לקוח שנרשם בטלפון לא יכול להזמין עד שנציג יעדכן לו
// פרטי אשראי (אין דרך להזין כרטיס בטלפון בלי לעבור בסולק). בלי מסך
// שמנהל את זה, לקוחות פשוט נופלים בין הכיסאות.

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";

// אימות: מנהל רואה הכל, נציג רואה רק את הנקודות שלו.
async function resolveAccess() {
  const session = await auth();
  if (!session?.user) {
    return { ok: false as const, status: 401, error: "unauthorized" };
  }
  const userId = (session.user as any).id as string;
  const role = (session.user as any).role as string;
  if (role !== "ADMIN" && role !== "AGENT") {
    return { ok: false as const, status: 403, error: "forbidden" };
  }
  if (role === "ADMIN") {
    return { ok: true as const, role, userId, pointIds: null as string[] | null };
  }
  // נציג - שולפים את כל נקודותיו (many-to-many, עם נפילה לישן)
  const agent = await prisma.customer.findUnique({
    where: { id: userId },
    select: {
      agentPointId: true,
      agentPoints: { select: { pointId: true } },
    },
  });
  const pointIds =
    agent && agent.agentPoints.length > 0
      ? agent.agentPoints.map((ap) => ap.pointId)
      : agent?.agentPointId
        ? [agent.agentPointId]
        : [];
  return { ok: true as const, role, userId, pointIds };
}

export async function GET(req: Request) {
  const acc = await resolveAccess();
  if (!acc.ok) {
    return NextResponse.json({ error: acc.error }, { status: acc.status });
  }

  const { searchParams } = new URL(req.url);
  const status = searchParams.get("status") || undefined;
  const pointId = searchParams.get("pointId") || undefined;

  const where: any = {};
  if (status && status !== "all") where.status = status;
  if (pointId) where.pointId = pointId;
  // נציג מוגבל לנקודותיו. רשימה ריקה = אין לו נקודות = לא רואה כלום.
  if (acc.pointIds !== null) {
    where.pointId = pointId ? pointId : { in: acc.pointIds };
    if (acc.pointIds.length === 0) {
      return NextResponse.json({ rows: [], counts: {}, isAgent: true });
    }
  }

  const rows = await prisma.phoneSignupRequest.findMany({
    where,
    orderBy: [{ status: "asc" }, { createdAt: "asc" }],
    include: {
      point: { select: { id: true, name: true, city: true } },
      customer: {
        select: {
          id: true,
          name: true,
          phone: true,
          email: true,
          // מקור האמת להשלמה: אם יש טוקן, הטיפול הסתיים בפועל
          paymentToken: true,
          cardLast4: true,
          createdAt: true,
        },
      },
    },
    take: 300,
  });

  // ספירה לפי סטטוס - למונים במסך
  const counts: Record<string, number> = {};
  for (const r of rows) counts[r.status] = (counts[r.status] || 0) + 1;

  return NextResponse.json({
    isAgent: acc.pointIds !== null,
    counts,
    rows: rows.map((r) => ({
      id: r.id,
      customerId: r.customerId,
      customerName: r.customerName || r.customer?.name || "",
      phone: r.phone,
      email: r.customer?.email ?? null,
      pointId: r.pointId,
      pointName: r.point?.name ?? "",
      pointCity: r.point?.city ?? null,
      assignedAgentId: r.assignedAgentId,
      assignedAt: r.assignedAt?.toISOString() ?? null,
      status: r.status,
      contactedAt: r.contactedAt?.toISOString() ?? null,
      contactedBy: r.contactedBy,
      completedAt: r.completedAt?.toISOString() ?? null,
      failReason: r.failReason,
      note: r.note,
      createdAt: r.createdAt.toISOString(),
      // 🔑 מקור האמת: הטיפול הושלם רק אם ללקוח באמת יש טוקן.
      // הסטטוס בטבלה יכול להיות לא מעודכן אם מישהו שכח ללחוץ.
      hasToken: !!r.customer?.paymentToken,
      cardLast4: r.customer?.cardLast4 ?? null,
      // כמה ימים הבקשה ממתינה
      daysWaiting: Math.floor(
        (Date.now() - r.createdAt.getTime()) / (1000 * 60 * 60 * 24)
      ),
    })),
  });
}

export async function PATCH(req: Request) {
  const acc = await resolveAccess();
  if (!acc.ok) {
    return NextResponse.json({ error: acc.error }, { status: acc.status });
  }

  const body = await req.json().catch(() => ({}));
  const id = String(body.id || "").trim();
  const action = String(body.action || "").trim();
  if (!id || !action) {
    return NextResponse.json({ error: "חסרים פרטים" }, { status: 400 });
  }

  const existing = await prisma.phoneSignupRequest.findUnique({
    where: { id },
    select: { id: true, pointId: true, customerId: true },
  });
  if (!existing) {
    return NextResponse.json({ error: "בקשה לא נמצאה" }, { status: 404 });
  }
  // נציג יכול לטפל רק בבקשות של נקודותיו
  if (acc.pointIds !== null && !acc.pointIds.includes(existing.pointId)) {
    return NextResponse.json(
      { error: "אין הרשאה - הבקשה לא באחת מהנקודות שלך" },
      { status: 403 }
    );
  }

  const who = acc.userId;
  const data: any = {};

  switch (action) {
    case "assign":
      // שיוך נציג ספציפי (עקיפה ידנית של המנהל). ריק = החזרה לשיוך לפי נקודה.
      if (acc.role !== "ADMIN") {
        return NextResponse.json({ error: "רק מנהל יכול לשייך נציג" }, { status: 403 });
      }
      data.assignedAgentId = body.agentId ? String(body.agentId) : null;
      data.assignedAt = body.agentId ? new Date() : null;
      data.status = body.agentId ? "ASSIGNED" : "NEW";
      break;

    case "contacted":
      data.status = "CONTACTED";
      data.contactedAt = new Date();
      data.contactedBy = who;
      break;

    case "fail":
      data.status = "FAILED";
      data.failReason = body.reason ? String(body.reason).slice(0, 300) : null;
      break;

    case "reopen":
      data.status = "NEW";
      data.failReason = null;
      data.completedAt = null;
      break;

    case "note":
      data.note = body.note ? String(body.note).slice(0, 1000) : null;
      break;

    case "point":
      // שינוי נקודה - מעביר את הבקשה לטיפול נציגי נקודה אחרת
      if (acc.role !== "ADMIN") {
        return NextResponse.json({ error: "רק מנהל יכול לשנות נקודה" }, { status: 403 });
      }
      if (!body.pointId) {
        return NextResponse.json({ error: "חסרה נקודה" }, { status: 400 });
      }
      data.pointId = String(body.pointId);
      data.assignedAgentId = null;
      data.assignedAt = null;
      break;

    default:
      return NextResponse.json({ error: "פעולה לא מוכרת" }, { status: 400 });
  }

  const updated = await prisma.phoneSignupRequest.update({
    where: { id },
    data,
    include: { customer: { select: { paymentToken: true } } },
  });

  // סגירה אוטומטית: אם ללקוח כבר יש טוקן, הטיפול הסתיים בפועל -
  // לא ממתינים שמישהו יזכור ללחוץ "הושלם".
  if (updated.customer?.paymentToken && updated.status !== "COMPLETED") {
    await prisma.phoneSignupRequest.update({
      where: { id },
      data: { status: "COMPLETED", completedAt: new Date() },
    });
  }

  return NextResponse.json({ ok: true });
}
