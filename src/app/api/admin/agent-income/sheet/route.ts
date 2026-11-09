// ═══════════════════════════════════════════════════════════════
// 📋 "כמו באקסל" — שורה לכל נקודה, בדיוק בעמודות של גיליון המנהל
// ═══════════════════════════════════════════════════════════════
// GET /api/admin/agent-income/sheet?pricelistId=X   (או saleKind=… / בלי)
// GET …&pointIds=a,b   → גם orders: התרומה של כל הזמנה לכל עמודה
//                        (הפירוט שנפתח בלחיצה על תא)
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
//
// ⚠️ שורת נקודה = סכום התרומות של ההזמנות שלה. כך הפירוט בלחיצה תמיד
// מסתכם בדיוק למספר שבתא.

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/guard";
import { classifyOrderMoney, ORDER_MONEY_SELECT, splitPaid } from "@/lib/agent-money-lib";
import { ownersForBalance, ADMIN_OWNER } from "@/lib/debt-owners-lib";
import { parseSaleKind, pricelistKindWhere } from "@/lib/weekly-sales";

const r2 = (n: number) => Math.round(n * 100) / 100;
const r3 = (n: number) => Math.round(n * 1000) / 1000;

/** הערכים המספריים של שורה — גם של נקודה וגם של הזמנה אחת */
type Nums = {
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
  /** חוב של המנהל שנגבה באשראי — יורד מהאשראי לנציג */
  cardAdminDebt: number;
  cardForAgent: number;
};
const NUM_KEYS: (keyof Nums)[] = [
  "orders", "paidOrders", "kgCarton", "kgSingles", "gross", "fees", "commWeight",
  "commSingles", "commTotal", "netGoods", "cardReceived", "cardAdminDebt", "cardForAgent",
];

export type SheetRow = Nums & { pointId: string; pointName: string; agentLabel: string };

export async function GET(req: Request) {
  const g = await requireAdmin();
  if (!g.ok) return g.res;
  const url = new URL(req.url);
  const pricelistId = url.searchParams.get("pricelistId");
  const saleKind = parseSaleKind(url.searchParams.get("saleKind"));
  const detailPoints = (url.searchParams.get("pointIds") || "").split(",").filter(Boolean);

  const where: any = { status: { not: "CANCELLED" } };
  if (pricelistId) where.pricelistId = pricelistId;
  else if (saleKind) where.pricelist = pricelistKindWhere(saleKind);
  if (detailPoints.length > 0) where.pointId = { in: detailPoints };

  const orders = await prisma.order.findMany({
    where,
    select: {
      ...ORDER_MONEY_SELECT,
      appliedDebtOwners: true,
      pointNameSnapshot: true,
      pricelist: { select: { orderFee: true } },
      items: {
        where: { isCancelled: false },
        select: { agentEnteredWeight: true, isSingle: true, agentSetPrice: true, unitPrice: true },
      },
    },
    orderBy: { orderNumber: "asc" },
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

  /** התרומה של הזמנה אחת לכל עמודה */
  const contrib = (o: (typeof orders)[number]): Nums => {
    const rate = ratesOf.get(o.pointId) ?? { carton: 1, singles: 4 };
    const m = classifyOrderMoney(o as any);
    const sp = splitPaid(o as any);
    let kgCarton = 0, kgSingles = 0, commWeight = 0, commSingles = 0;
    for (const it of o.items) {
      const w = it.agentEnteredWeight != null ? Number(it.agentEnteredWeight) : 0;
      if (!(w > 0)) continue;
      if (it.isSingle) kgSingles += w;
      else kgCarton += w;
      // מוצר שהנציג תמחר: הפרש המחיר מעל "רצפת הנציג" — במקום הכלל הרגיל
      if (it.agentSetPrice != null) {
        const perKg = Number(it.agentSetPrice) - (Number(it.unitPrice) - rate.carton);
        if (perKg > 0) {
          commSingles += perKg * w;
          continue;
        }
      }
      commWeight += rate.carton * w;
      if (it.isSingle) commSingles += (rate.singles - rate.carton) * w;
    }
    // חוב קודם שנגבה באשראי — החלק של המנהל לא נזקף לנציג
    let cardAdminDebt = 0;
    const cardDebt = sp.card - m.cardRev;
    if (cardDebt > 0 && m.debtPart > 0) {
      const owners = ownersForBalance(o.appliedDebtOwners, m.debtPart);
      cardAdminDebt = cardDebt * ((owners[ADMIN_OWNER] ?? 0) / m.debtPart);
    }
    const fees = Number(o.pricelist?.orderFee ?? 0);
    const commTotal = commWeight + commSingles;
    return {
      orders: 1,
      paidOrders: sp.paid > 0 ? 1 : 0,
      kgCarton,
      kgSingles,
      gross: m.due,
      fees,
      commWeight,
      commSingles,
      commTotal,
      netGoods: m.due - fees - commTotal,
      cardReceived: sp.card,
      cardAdminDebt,
      cardForAgent: sp.card - fees - cardAdminDebt,
    };
  };
  const round = (n: Nums): Nums => {
    const out: any = {};
    for (const k of NUM_KEYS) out[k] = k === "kgCarton" || k === "kgSingles" ? r3(n[k]) : r2(n[k]);
    return out;
  };

  const rows = new Map<string, SheetRow>();
  const perOrder: (Nums & { orderNumber: number; customerName: string; pointName: string; paymentStatus: string | null })[] = [];
  for (const o of orders) {
    const c = round(contrib(o));
    perOrder.push({
      orderNumber: o.orderNumber,
      customerName: o.customerName,
      pointName: pointName.get(o.pointId) ?? o.pointNameSnapshot ?? "—",
      paymentStatus: o.paymentStatus,
      ...c,
    });
    let r = rows.get(o.pointId);
    if (!r) {
      r = {
        pointId: o.pointId,
        pointName: pointName.get(o.pointId) ?? "—",
        agentLabel: (agentsOf.get(o.pointId) ?? []).sort().join(" + ") || "—",
        ...Object.fromEntries(NUM_KEYS.map((k) => [k, 0])),
      } as SheetRow;
      rows.set(o.pointId, r);
    }
    for (const k of NUM_KEYS) (r as any)[k] += c[k];
  }

  const list = [...rows.values()]
    .map((r) => ({ ...r, ...round(r) }))
    .sort((a, b) => a.agentLabel.localeCompare(b.agentLabel, "he") || a.pointName.localeCompare(b.pointName, "he"));

  return NextResponse.json({ rows: list, ...(detailPoints.length > 0 ? { orders: perOrder } : {}) });
}
