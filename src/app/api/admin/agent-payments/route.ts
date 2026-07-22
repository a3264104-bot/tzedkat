// §20: תשלומים לנציגים - ניהול חובות ותשלומים בפועל
// GET  /api/admin/agent-payments - היסטוריה + יתרות
// POST /api/admin/agent-payments - הוספת תשלום/גבייה

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/guard";

// GET - החזרת מצב כל הנציגים: עמלה שהצטברה, תשלומים שקיבלו, יתרה חייבת
export async function GET(req: Request) {
  const g = await requireAdmin();
  if (!g.ok) return g.res;

  const url = new URL(req.url);
  const agentId = url.searchParams.get("agentId");

  // רק נציגים פעילים
  const agents = await prisma.customer.findMany({
    where: {
      role: "AGENT",
      ...(agentId ? { id: agentId } : {}),
    },
    select: {
      id: true,
      name: true,
      phone: true,
      email: true,
      agentPoint: { select: { id: true, name: true } },
      commissionRateCarton: true,
      commissionRateSingles: true,
    },
    orderBy: { name: "asc" },
  });

  // עבור כל נציג - סיכומי מכירות + היסטוריית תשלומים
  const result = await Promise.all(
    agents.map(async (agent) => {
      // סיכומים ממכירות (רק מאושרים או שיש בהם עבודה)
      const summaries = await prisma.agentSaleSummary.findMany({
        where: { agentId: agent.id },
        include: {
          pricelist: {
            select: {
              id: true,
              name: true,
              deliveryDate: true,
              status: true,
            },
          },
        },
        orderBy: { createdAt: "desc" },
      });

      // תשלומים / גבייות
      const payments = await prisma.agentPayment.findMany({
        where: { agentId: agent.id },
        include: {
          pricelist: { select: { id: true, name: true } },
        },
        orderBy: { createdAt: "desc" },
      });

      // חישוב יתרה כוללת
      const totalCommission = summaries.reduce(
        (s, x) => s + Number(x.totalCommission),
        0
      );
      // PAID = המנהל שילם לנציג (חיובי)
      // COLLECTED = הנציג העביר מזומן למנהל (מקטין את החוב של המנהל)
      const totalPaid = payments
        .filter((p) => p.type === "PAID")
        .reduce((s, p) => s + Number(p.amount), 0);
      const totalCollected = payments
        .filter((p) => p.type === "COLLECTED")
        .reduce((s, p) => s + Number(p.amount), 0);

      // מזומן שאסף הנציג ממזדמנים - חייב להעביר למנהל
      const cashFromWalkins = summaries.reduce(async (accP, x) => {
        const acc = await accP;
        const walkinCash = await prisma.walkinOrder.aggregate({
          where: {
            pricelistId: x.pricelistId,
            agentId: agent.id,
            paymentMethod: "CASH",
            paymentReceived: true,
          },
          _sum: { totalAmount: true },
        });
        return acc + Number(walkinCash._sum.totalAmount || 0);
      }, Promise.resolve(0));
      const totalCashCollected = await cashFromWalkins;

      // יתרה: (עמלה - תשלומים ששולמו לו) - (מזומן שאסף - העברות שהעביר למנהל)
      const balance =
        totalCommission - totalPaid - (totalCashCollected - totalCollected);

      return {
        agent: {
          id: agent.id,
          name: agent.name,
          phone: agent.phone,
          email: agent.email,
          point: agent.agentPoint,
          commissionRateCarton: Number(agent.commissionRateCarton),
          commissionRateSingles: Number(agent.commissionRateSingles),
        },
        summaries: summaries.map((s) => ({
          id: s.id,
          pricelistId: s.pricelistId,
          pricelistName: s.pricelist.name,
          deliveryDate: s.pricelist.deliveryDate?.toISOString(),
          pricelistStatus: s.pricelist.status,
          status: s.status,
          totalCartonWeight: Number(s.totalCartonWeight),
          totalSinglesWeight: Number(s.totalSinglesWeight),
          totalWalkinWeight: Number(s.totalWalkinWeight),
          totalCustomers: s.totalCustomers,
          totalWalkins: s.totalWalkins,
          totalCommission: Number(s.totalCommission),
          remainderNote: s.remainderNote,
          confirmedAt: s.confirmedAt?.toISOString(),
        })),
        payments: payments.map((p) => ({
          id: p.id,
          amount: Number(p.amount),
          type: p.type,
          method: p.method,
          note: p.note,
          pricelistId: p.pricelistId,
          pricelistName: p.pricelist?.name,
          createdAt: p.createdAt.toISOString(),
          createdById: p.createdById,
        })),
        totals: {
          totalCommission,
          totalPaid,
          totalCollected,
          totalCashCollected,
          balance,
          // balance > 0 => המנהל חייב לנציג
          // balance < 0 => הנציג חייב למנהל
          debtDirection: balance > 0 ? "OWED_TO_AGENT" : balance < 0 ? "OWED_BY_AGENT" : "SETTLED",
        },
      };
    })
  );

  return NextResponse.json(result);
}

// POST - הוספת רשומת תשלום או גבייה
// Body: {
//   agentId: string,
//   amount: number,
//   type: "PAID" | "COLLECTED",
//   method?: "BANK_TRANSFER" | "CASH" | "CHECK" | "OTHER",
//   note?: string,
//   pricelistId?: string,
// }
export async function POST(req: Request) {
  const g = await requireAdmin();
  if (!g.ok) return g.res;

  const body = await req.json().catch(() => ({}));
  const agentId = String(body.agentId || "").trim();
  const amount = Number(body.amount);
  const type = String(body.type || "").trim();

  if (!agentId) {
    return NextResponse.json({ error: "agentId חובה" }, { status: 400 });
  }
  if (isNaN(amount) || amount <= 0) {
    return NextResponse.json({ error: "סכום לא תקין" }, { status: 400 });
  }
  if (!["PAID", "COLLECTED"].includes(type)) {
    return NextResponse.json(
      { error: "type חייב להיות PAID או COLLECTED" },
      { status: 400 }
    );
  }

  const agent = await prisma.customer.findUnique({
    where: { id: agentId },
    select: { id: true, role: true },
  });
  if (!agent || agent.role !== "AGENT") {
    return NextResponse.json({ error: "נציג לא נמצא" }, { status: 404 });
  }

  const payment = await prisma.agentPayment.create({
    data: {
      agentId,
      amount,
      type,
      method: body.method || null,
      note: body.note ? String(body.note).trim() : null,
      pricelistId: body.pricelistId || null,
      createdById: g.session?.user?.email || null,
    },
  });

  return NextResponse.json({ ok: true, payment: { id: payment.id } });
}
