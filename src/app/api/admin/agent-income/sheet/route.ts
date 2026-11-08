// ═══════════════════════════════════════════════════════════════
// 📋 "כמו באקסל" — שורה לכל נקודה, בדיוק בעמודות של גיליון המנהל
// ═══════════════════════════════════════════════════════════════
// GET /api/admin/agent-income/sheet?pricelistId=X   (או saleKind=… / בלי)
//
// העמודות (לפי הגיליון שהמנהל עובד איתו):
//   הזמנות · שולמו · משקל קרטונים · משקל בודדים
//   סך ברוטו        — הסכום הצפוי מכל ההזמנות (בלי חוב קודם)
//   דמי הזמנה       — ₪3 × **כל** ההזמנות (שייך למערכת)
//   עמלת משקל       — ₪1 לק"ג על כל המשקל (קרטונים + בודדים)
//   עמלת בודדים     — ₪3 לק"ג על הבודדים (+ הפרש מחיר במועדפים)
//   סך נטו (סחורה)  — ברוטו − דמי הזמנה − עמלות
//   אשראי שהתקבל    — כל מה שנכנס באשראי/העברה בנקודה
//   🟨 אשראי לחישוב לנציג — אשראי שהתקבל − דמי הזמנה
//                       (− חוב של המנהל שנגבה באשראי, אם יש: הוא לא של הנציג)
//
// ⚠️ העמלות — אותו כלל של סיכום הנציג (agent-summary-lib): התעריפים של
// הנציג (ברירת מחדל 1 ו-4 לק"ג בבודדים = 1 + 3), ובמוצר שהנציג תמחר —
// הפרש המחיר במקום הכלל הרגיל.

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/guard";
import { classifyOrderMoney, ORDER_MONEY_SELECT, splitPaid } from "@/lib/agent-money-lib";
import { ownersForBalance, ADMIN_OWNER } from "@/lib/debt-owners-lib";
import { parseSaleKind, pricelistKindWhere } from "@/lib/weekly-sales";

const r2 = (n: number) => Math.round(n * 100) / 100;
const r3 = (n: number) => Math.round(n * 1000) / 1000;

export type SheetRow = {
  pointId: string;
  pointName: string;
  agentLabel: string;
  orders: number;
  paidOrders: number;
  kgCarton: number;
  kgSingles: number;
  gross: number;
  fees: number;
  commWeight: number;
  commSingles: number;
  commTotal: number;
  netGoods: number;
  cardReceived: number;
  /** חוב של המנהל שנגבה באשראי בנקודה — יורד מהאשראי לנציג */
  cardAdminDebt: number;
  cardForAgent: number;
};

export async function GET(req: Request) {
  const g = await requireAdmin();
  if (!g.ok) return g.res;
  const url = new URL(req.url);
  const pricelistId = url.searchParams.get("pricelistId");
  const saleKind = parseSaleKind(url.searchParams.get("saleKind"));

  const where: any = { status: { not: "CANCELLED" } };
  if (pricelistId) where.pricelistId = pricelistId;
  else if (saleKind) where.pricelist = pricelistKindWhere(saleKind);

  const orders = await prisma.order.findMany({
    where,
    select: {
      ...ORDER_MONEY_SELECT,
      appliedDebtOwners: true,
      pricelist: { select: { orderFee: true } },
      items: {
        where: { isCancelled: false },
        select: { agentEnteredWeight: true, isSingle: true, agentSetPrice: true, unitPrice: true },
      },
    },
  });

  const pointIds = [...new Set(orders.map((o) => o.pointId))];
  const [points, aps] = await Promise.all([
    prisma.deliveryPoint.findMany({ where: { id: { in: pointIds } }, select: { id: true, name: true } }),
    // תעריפי העמלה — של נציג הנקודה (הראשון ששויך), כמו בעלות על חוב
    prisma.agentPoint.findMany({
      where: { pointId: { in: pointIds }, agent: { role: "AGENT" } },
      orderBy: { createdAt: "asc" },
      select: {
        pointId: true,
        agent: { select: { name: true, commissionRateCarton: true, commissionRateSingles: true } },
      },
    }),
  ]);
  const pointName = new Map(points.map((p) => [p.id, p.name]));
  const agentsOf = new Map<string, string[]>();
  const ratesOf = new Map<string, { carton: number; singles: number }>();
  for (const a of aps) {
    agentsOf.set(a.pointId, [...new Set([...(agentsOf.get(a.pointId) ?? []), a.agent.name])]);
    if (!ratesOf.has(a.pointId)) {
      ratesOf.set(a.pointId, {
        carton: Number(a.agent.commissionRateCarton),
        singles: Number(a.agent.commissionRateSingles),
      });
    }
  }

  const rows = new Map<string, SheetRow>();
  for (const o of orders) {
    let r = rows.get(o.pointId);
    if (!r) {
      r = {
        pointId: o.pointId,
        pointName: pointName.get(o.pointId) ?? "—",
        agentLabel: (agentsOf.get(o.pointId) ?? []).sort().join(" + ") || "—",
        orders: 0, paidOrders: 0, kgCarton: 0, kgSingles: 0, gross: 0, fees: 0,
        commWeight: 0, commSingles: 0, commTotal: 0, netGoods: 0,
        cardReceived: 0, cardAdminDebt: 0, cardForAgent: 0,
      };
      rows.set(o.pointId, r);
    }
    const rate = ratesOf.get(o.pointId) ?? { carton: 1, singles: 4 };
    const m = classifyOrderMoney(o as any);
    const sp = splitPaid(o as any);

    r.orders++;
    if (sp.paid > 0) r.paidOrders++;
    r.gross += m.due;
    r.fees += Number(o.pricelist?.orderFee ?? 0);

    for (const it of o.items) {
      const w = it.agentEnteredWeight != null ? Number(it.agentEnteredWeight) : 0;
      if (!(w > 0)) continue;
      if (it.isSingle) r.kgSingles += w;
      else r.kgCarton += w;
      // מוצר שהנציג תמחר: הפרש המחיר מעל "רצפת הנציג" — במקום הכלל הרגיל
      if (it.agentSetPrice != null) {
        const perKg = Number(it.agentSetPrice) - (Number(it.unitPrice) - rate.carton);
        if (perKg > 0) {
          r.commSingles += perKg * w;
          continue;
        }
      }
      r.commWeight += rate.carton * w;
      if (it.isSingle) r.commSingles += (rate.singles - rate.carton) * w;
    }

    r.cardReceived += sp.card;
    // חוב קודם שנגבה באשראי — החלק של המנהל לא נזקף לנציג
    const cardDebt = sp.card - m.cardRev;
    if (cardDebt > 0 && m.debtPart > 0) {
      const owners = ownersForBalance(o.appliedDebtOwners, m.debtPart);
      r.cardAdminDebt += cardDebt * ((owners[ADMIN_OWNER] ?? 0) / m.debtPart);
    }
  }

  const list = [...rows.values()]
    .map((r) => {
      const commTotal = r2(r.commWeight + r.commSingles);
      return {
        ...r,
        kgCarton: r3(r.kgCarton),
        kgSingles: r3(r.kgSingles),
        gross: r2(r.gross),
        fees: r2(r.fees),
        commWeight: r2(r.commWeight),
        commSingles: r2(r.commSingles),
        commTotal,
        netGoods: r2(r.gross - r.fees - commTotal),
        cardReceived: r2(r.cardReceived),
        cardAdminDebt: r2(r.cardAdminDebt),
        cardForAgent: r2(r.cardReceived - r.fees - r.cardAdminDebt),
      };
    })
    .sort((a, b) => a.agentLabel.localeCompare(b.agentLabel, "he") || a.pointName.localeCompare(b.pointName, "he"));

  return NextResponse.json({ rows: list });
}
