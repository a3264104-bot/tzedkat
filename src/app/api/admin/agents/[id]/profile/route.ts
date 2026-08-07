// §20: פרופיל מלא של נציג (בלי מכירה ספציפית)
// GET  /api/admin/agents/[id]/profile - כל הנתונים
// PATCH /api/admin/agents/[id]/profile - עדכון פרטים

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/guard";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const g = await requireAdmin();
  if (!g.ok) return g.res;

  const { id } = await params;

  const agent = await prisma.customer.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      phone: true,
      email: true,
      role: true,
      passwordPlain: true,
      agentPointId: true,
      agentPoint: { select: { id: true, name: true, city: true } },
      // 🆕 כל הנקודות של הנציג (many-to-many דרך AgentPoint)
      agentPoints: {
        select: { point: { select: { id: true, name: true, city: true } } },
      },
      agentCanSetFinalPrice: true,
      agentCanSendPaymentLink: true,
      commissionRateCarton: true,
      commissionRateSingles: true,
      createdAt: true,
    },
  });

  if (!agent) {
    return NextResponse.json({ error: "משתמש לא נמצא" }, { status: 404 });
  }

  // רשימת נקודות (לעריכה)
  const points = await prisma.deliveryPoint.findMany({
    where: { isActive: true },
    select: { id: true, name: true, city: true },
    orderBy: { name: "asc" },
  });

  // סיכומי מכירות של הנציג
  const summaries = await prisma.agentSaleSummary.findMany({
    where: { agentId: id },
    include: {
      pricelist: {
        select: {
          id: true, name: true,
          deliveryDate: true, status: true,
        },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  // תשלומים
  const payments = await prisma.agentPayment.findMany({
    where: { agentId: id },
    include: {
      pricelist: { select: { id: true, name: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  // מזומן שאסף
  const cashAggregate = await prisma.walkinOrder.aggregate({
    where: {
      agentId: id,
      paymentMethod: "CASH",
      paymentReceived: true,
    },
    _sum: { totalAmount: true },
    _count: true,
  });

  // חישוב יתרה כוללת
  const totalCommission = summaries.reduce((s, x) => s + Number(x.totalCommission), 0);
  const totalPaid = payments.filter((p) => p.type === "PAID").reduce((s, p) => s + Number(p.amount), 0);
  const totalCollected = payments.filter((p) => p.type === "COLLECTED").reduce((s, p) => s + Number(p.amount), 0);
  const totalCashCollected = Number(cashAggregate._sum.totalAmount || 0);
  const balance = totalCommission - totalPaid - (totalCashCollected - totalCollected);

  return NextResponse.json({
    agent: {
      id: agent.id,
      name: agent.name,
      phone: agent.phone,
      email: agent.email,
      role: agent.role,
      passwordPlain: agent.passwordPlain,
      point: agent.agentPoint,
      agentPointId: agent.agentPointId,
      // 🆕 כל הנקודות. אם עדיין אין רשומות AgentPoint (נציג ותיק שלא הועבר),
      // נופלים לנקודה הישנה כדי שהטופס יציג את המצב הנוכחי נכון.
      agentPoints:
        agent.agentPoints.length > 0
          ? agent.agentPoints.map((ap) => ap.point)
          : agent.agentPoint
            ? [agent.agentPoint]
            : [],
      canSetFinalPrice: agent.agentCanSetFinalPrice,
      canSendPaymentLink: agent.agentCanSendPaymentLink,
      commissionRateCarton: Number(agent.commissionRateCarton),
      commissionRateSingles: Number(agent.commissionRateSingles),
      createdAt: agent.createdAt.toISOString(),
    },
    points,
    summaries: summaries.map((s) => ({
      id: s.id,
      pricelistId: s.pricelistId,
      pricelistName: s.pricelist.name,
      deliveryDate: s.pricelist.deliveryDate?.toISOString() || null,
      pricelistStatus: s.pricelist.status,
      status: s.status,
      totalCartonWeight: Number(s.totalCartonWeight),
      totalSinglesWeight: Number(s.totalSinglesWeight),
      totalWalkinWeight: Number(s.totalWalkinWeight),
      totalCustomers: s.totalCustomers,
      totalWalkins: s.totalWalkins,
      totalCommission: Number(s.totalCommission),
      remainderNote: s.remainderNote,
      confirmedAt: s.confirmedAt?.toISOString() || null,
    })),
    payments: payments.map((p) => ({
      id: p.id,
      amount: Number(p.amount),
      type: p.type,
      method: p.method,
      note: p.note,
      pricelistName: p.pricelist?.name || null,
      pricelistId: p.pricelistId,
      createdAt: p.createdAt.toISOString(),
    })),
    totals: {
      totalCommission,
      totalPaid,
      totalCollected,
      totalCashCollected,
      balance,
      debtDirection:
        balance > 0.01
          ? "OWED_TO_AGENT"
          : balance < -0.01
          ? "OWED_BY_AGENT"
          : "SETTLED",
      totalSales: summaries.length,
      totalCashCollectedCount: cashAggregate._count,
    },
  });
}

// PATCH - עדכון פרטים
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const g = await requireAdmin();
  if (!g.ok) return g.res;

  const { id } = await params;
  const body = await req.json().catch(() => ({}));

  const existing = await prisma.customer.findUnique({
    where: { id },
    select: { role: true },
  });
  if (!existing) {
    return NextResponse.json({ error: "משתמש לא נמצא" }, { status: 404 });
  }

  const data: any = {};

  if ("name" in body) {
    const n = String(body.name || "").trim();
    if (!n) return NextResponse.json({ error: "שם חובה" }, { status: 400 });
    data.name = n;
  }
  if ("phone" in body) {
    const p = body.phone ? String(body.phone).trim() : null;
    if (!p) return NextResponse.json({ error: "טלפון חובה" }, { status: 400 });
    data.phone = p;
  }
  if ("email" in body) {
    const em = body.email ? String(body.email).trim() : null;
    if (em && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em)) {
      return NextResponse.json({ error: "מייל לא תקין" }, { status: 400 });
    }
    data.email = em;
  }
  // 🆕 שיוך נציג לכמה נקודות חלוקה (many-to-many דרך AgentPoint).
  // ה-UI שולח agentPointIds: string[]. שומרים על agentPointId הישן מסונכרן
  // לנקודה הראשונה, לתאימות אחורה עם קוד שעדיין קורא אותו.
  let newPointIds: string[] | null = null;
  if (Array.isArray(body.agentPointIds)) {
    newPointIds = (body.agentPointIds as unknown[])
      .map((x) => String(x || "").trim())
      .filter((x) => x.length > 0);
    // מסירים כפילויות (ל-AgentPoint יש @@unique([agentId, pointId]))
    newPointIds = Array.from(new Set(newPointIds));
    data.agentPointId = newPointIds[0] ?? null;
  } else if ("agentPointId" in body) {
    // תאימות אחורה: קורא ישן ששולח נקודה יחידה
    data.agentPointId = body.agentPointId || null;
    newPointIds = body.agentPointId ? [String(body.agentPointId)] : [];
  }

  if ("commissionRateCarton" in body) {
    const v = Number(body.commissionRateCarton);
    if (isNaN(v) || v < 0) {
      return NextResponse.json({ error: "עמלת קרטונים לא תקינה" }, { status: 400 });
    }
    data.commissionRateCarton = v;
  }
  if ("commissionRateSingles" in body) {
    const v = Number(body.commissionRateSingles);
    if (isNaN(v) || v < 0) {
      return NextResponse.json({ error: "עמלת בודדים לא תקינה" }, { status: 400 });
    }
    data.commissionRateSingles = v;
  }
  if ("agentCanSetFinalPrice" in body) {
    data.agentCanSetFinalPrice = !!body.agentCanSetFinalPrice;
  }
  if ("agentCanSendPaymentLink" in body) {
    data.agentCanSendPaymentLink = !!body.agentCanSendPaymentLink;
  }

  if (Object.keys(data).length === 0 && newPointIds === null) {
    return NextResponse.json({ error: "אין שדות לעדכון" }, { status: 400 });
  }

  // עדכון הנציג + שיוכי הנקודות בטרנזקציה אחת, כדי שלא ייווצר מצב ביניים
  // שבו הנציג עודכן אבל הנקודות לא (או להפך).
  await prisma.$transaction(async (tx) => {
    if (Object.keys(data).length > 0) {
      await tx.customer.update({ where: { id }, data });
    }
    if (newPointIds !== null) {
      // מוחקים את כל השיוכים הקיימים ויוצרים מחדש - פשוט ובטוח, כי הטבלה
      // מכילה רק את הקשר עצמו (אין בה נתונים שאובדים במחיקה).
      await tx.agentPoint.deleteMany({ where: { agentId: id } });
      if (newPointIds.length > 0) {
        await tx.agentPoint.createMany({
          data: newPointIds.map((pointId) => ({ agentId: id, pointId })),
          skipDuplicates: true,
        });
      }
    }
  });

  return NextResponse.json({ ok: true });
}
