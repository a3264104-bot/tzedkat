// ═══════════════════════════════════════════════════════════════
// GET /api/admin/debts-overview — חובות במסך התשלומים
// ═══════════════════════════════════════════════════════════════
// open:      לקוחות עם חוב פתוח, מפורק לפי בעלים (נציג / מנהל)
// collected: גביות חוב (בהזמנה או מיידית בכרטיס), לפי בעלים
//
// ?pricelistId=<id> — הגביות של מכירה מסוימת בלבד (החובות הפתוחים
// תמיד כולם: חוב פתוח לא שייך למכירה עד שהוא נגבה).

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/guard";
import { ownersForBalance, agentIdOfOwner, ADMIN_OWNER } from "@/lib/debt-owners-lib";

export async function GET(req: Request) {
  const g = await requireAdmin();
  if (!g.ok) return g.res;
  const url = new URL(req.url);
  const pricelistId = url.searchParams.get("pricelistId") || undefined;

  const [customers, ledger, agents] = await Promise.all([
    prisma.customer.findMany({
      where: { debtBalance: { gt: 0 } },
      select: {
        id: true,
        name: true,
        phone: true,
        debtBalance: true,
        debtOwners: true,
        debtNote: true,
        debtUpdatedAt: true,
        paymentToken: true,
        cardLast4: true,
        cardNeedsUpdate: true,
        paymentPreference: true,
        defaultPoint: { select: { name: true } },
      },
      orderBy: { debtBalance: "desc" },
    }),
    prisma.debtLedger.findMany({
      where: { kind: "COLLECT", ...(pricelistId ? { pricelistId } : {}) },
      orderBy: { createdAt: "desc" },
      take: 300,
      select: {
        id: true,
        amount: true,
        ownerKey: true,
        method: true,
        note: true,
        orderId: true,
        createdAt: true,
        customer: { select: { name: true } },
      },
    }),
    prisma.customer.findMany({
      where: { role: { in: ["AGENT", "ADMIN"] } },
      select: { id: true, name: true },
    }),
  ]);
  const names = Object.fromEntries(agents.map((a) => [a.id, a.name]));

  // ⚠️ חוב שנכנס להזמנה נרשם בספר כבר בשקילה — אבל הוא *נגבה* רק
  // כשההזמנה שולמה. מציגים כ"נגבה" רק הזמנות ששולמו (גם חלקית).
  const orderIds = [...new Set(ledger.map((l) => l.orderId).filter((x): x is string => !!x))];
  const paidOrders = new Map(
    (
      await prisma.order.findMany({
        where: { id: { in: orderIds } },
        select: { id: true, orderNumber: true, amountPaid: true, paymentStatus: true, status: true },
      })
    ).map((o) => [o.id, o])
  );
  const isCollected = (l: (typeof ledger)[number]) => {
    if (!l.orderId) return true; // גבייה מיידית
    const o = paidOrders.get(l.orderId);
    return !!o && o.status !== "CANCELLED" && (o.paymentStatus === "PAID" || Number(o.amountPaid ?? 0) > 0);
  };

  return NextResponse.json({
    agents: names,
    open: customers.map((c) => ({
      id: c.id,
      name: c.name,
      phone: c.phone,
      point: c.defaultPoint?.name ?? null,
      debt: Number(c.debtBalance),
      owners: ownersForBalance(c.debtOwners, Number(c.debtBalance)),
      note: c.debtNote,
      updatedAt: c.debtUpdatedAt,
      hasCard: !!c.paymentToken && !c.cardNeedsUpdate && c.paymentPreference !== "CASH",
      cardLast4: c.cardLast4,
      isCash: c.paymentPreference === "CASH",
    })),
    collected: ledger.filter(isCollected).map((l) => ({
      id: l.id,
      customerName: l.customer.name,
      amount: -Number(l.amount),
      // שורות ישנות בלי בעלים — של המנהל (כמו בכל מקום)
      ownerKey: l.ownerKey ?? ADMIN_OWNER,
      agentId: agentIdOfOwner(l.ownerKey ?? ADMIN_OWNER),
      method: l.method ?? (l.orderId ? "ORDER" : null),
      note: l.note,
      orderNumber: l.orderId ? paidOrders.get(l.orderId)?.orderNumber ?? null : null,
      createdAt: l.createdAt,
    })),
  });
}
