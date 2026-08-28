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
      // §292: כל הנקודות — לחישוב האשראי שנגבה מהן
      agentPoints: { select: { pointId: true, point: { select: { name: true } } } },
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

      // §292: 💳 **כמה נגבה באשראי מהנקודות של הנציג.**
      //
      // הבעיה מהשטח: חברת האשראי מעבירה סכום אחד לכל המכירות
      // ולכל הנקודות. המנהל מקבל ₪40,000 ואין לו שום דרך לדעת
      // כמה מזה ברכפלד, כמה רמות, וכמה טבריה.
      //
      // ⚠️ הבנק לא יודע — **המערכת כן**: כל הזמנה יודעת לאיזו
      // נקודה היא שייכת, וכל חיוב מוצלח יודע כמה נגבה.
      //
      // ⚠️ רק PAID: חיוב שנכשל או שממתין אינו כסף שנכנס.
      //
      // ⚠️ ולא מזומן: הוא נספר בנפרד ב-totalCashCollected, וכפל
      // היה מנפח את מה שכביכול התקבל.
      const myPointIds = agent.agentPoints.map((ap) => ap.pointId);
      if (agent.agentPoint?.id && !myPointIds.includes(agent.agentPoint.id)) {
        myPointIds.push(agent.agentPoint.id);
      }

      let cardCollected = 0;
      let cardOrders = 0;
      let pendingCollection = 0;
      let pendingOrders = 0;
      // §294: מזומן מלקוחות רגילים (בנוסף למזדמנים)
      let cashFromOrders = 0;
      let cashOrders = 0;

      if (myPointIds.length > 0) {
        const pointOrders = await prisma.order.findMany({
          where: {
            pointId: { in: myPointIds },
            status: { not: "CANCELLED" },
          },
          select: {
            paymentStatus: true,
            paymentMethod: true,
            amountPaid: true,
            // §325: חוב קודם — מופרד מהכנסות המכירה
            appliedDebt: true,
            finalTotal: true,
            estimatedTotal: true,
          },
        });

        for (const o of pointOrders) {
          const paid = Number(o.amountPaid ?? 0);
          const due = Number(o.finalTotal ?? o.estimatedTotal ?? 0);
          // §325: 💸 חוב קודם אינו הכנסה מהמכירה.
          //
          // המנהל מצליב את "נגבה באשראי" מול העברת חברת האשראי.
          // חוב שנספר יחד מנפח את הסכום, וההצלבה נשברת - וזה
          // בדיוק מה שהמסך הזה נועד לאפשר.
          const debtPart = Number((o as any).appliedDebt ?? 0);

          if (o.paymentStatus === "PAID") {
            const actual = Math.max(0, (paid > 0 ? paid : due) - debtPart);
            // ⚠️ CASH ו-MANUAL הם מזומן (§239) — לא אשראי.
            if (o.paymentMethod !== "CASH" && o.paymentMethod !== "MANUAL") {
              cardCollected += actual;
              cardOrders++;
            } else {
              // §294: 💵 מזומן מ**לקוחות רגילים** — לא רק ממזדמנים.
              //
              // הפער: totalCashCollected סופר רק walkinOrder. נציג
              // שגבה מזומן מלקוח שהזמין מראש (§130) - הכסף אצלו,
              // ולא הופיע בשום מקום.
              //
              // ⚠️ וזה בדיוק מה ששובר את ההצלבה: המנהל רואה
              // "טרם נגבה ₪3,000" בזמן שהנציג כבר גבה במזומן.
              cashFromOrders += actual;
              cashOrders++;
            }
          } else {
            pendingCollection += Math.max(0, due - debtPart);
            pendingOrders++;
          }
        }
      }

      const r2 = (n: number) => Math.round(n * 100) / 100;

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
        // §292: הנקודות בשמן — המנהל מדבר על "ברכפלד", לא על מזהה.
        points: agent.agentPoints.map((ap) => ap.point.name),
        totals: {
          // §292: האשראי שנגבה מהנקודות של הנציג
          cardCollected: r2(cardCollected),
          cardOrders,
          // §294: מזומן מלקוחות רגילים — משלים את התמונה
          cashFromOrders: r2(cashFromOrders),
          cashOrders,
          pendingCollection: r2(pendingCollection),
          pendingOrders,
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
