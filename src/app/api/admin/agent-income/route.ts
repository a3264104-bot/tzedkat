// ═══════════════════════════════════════════════════════════════
// §401: 📥 כמה נכנס — לפי נציג ונקודה, בלי דמי ההזמנה
// ═══════════════════════════════════════════════════════════════
// GET /api/admin/agent-income?pricelistId=X
// GET /api/admin/agent-income?saleKind=REGULAR|WEEKLY   (צבירה)
// GET /api/admin/agent-income                            (כל המכירות)
//
// הצורך: המנהל מנהל אקסל בצד, משבצת לכל נציג. "נגבה" באתר כולל
// את דמי ההזמנה (₪3 לכל הזמנה) — והם לא שייכים לנציג. כאן כל נקודה
// מקבלת: ברוטו, דמי הזמנה, נטו — ופיצול לפי מי שמחזיק בכסף.
//
// ⚠️ אותה פונקציית סיווג של חשבון הנציג (classifyOrderMoney): חוב
// קודם שקוזז בהזמנה **לא** נספר כהכנסה מהמכירה (§325) — הוא מוצג
// בעמודה נפרדת.
//
// ⚠️ דמי ההזמנה לפי המכירה של ההזמנה (orderFee), ורק בהזמנה שנגבה
// בה משהו — ולא יותר ממה שנגבה. הזמנה שלא שולמה לא "מורידה" ₪3.

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/guard";
import { classifyOrderMoney, ORDER_MONEY_SELECT, splitPaid } from "@/lib/agent-money-lib";
import { ownersForBalance, agentIdOfOwner } from "@/lib/debt-owners-lib";
import { parseSaleKind, pricelistKindWhere } from "@/lib/weekly-sales";

const r2 = (n: number) => Math.round(n * 100) / 100;

export type IncomeRow = {
  pointId: string;
  pointName: string;
  city: string | null;
  /** שמות הנציגים של הנקודה ("—" אם אין) */
  agentLabel: string;
  orders: number;
  paidOrders: number;
  /** נגבה מהמכירה (בלי חוב קודם), כולל דמי הזמנה */
  gross: number;
  /** דמי ההזמנה שבתוך הנגבה */
  fees: number;
  /** gross - fees */
  net: number;
  /** הפיצול של הנגבה (ברוטו) */
  card: number;
  agentCash: number;
  adminCash: number;
  /** מזדמנים ישנים (לפני ההמרה) — בלי דמי הזמנה */
  walkins: number;
  walkinCount: number;
  /** חוב קודם שקוזז ונגבה בהזמנות בנקודה — לא חלק מהמכירה */
  debtCollected: number;
  /** 💸 מתוכו (וגם גבייה מיידית): חוב שהנציג רשם — **נספר בנטו שלו** */
  debtAgent: number;
  /** 💸 חוב של המנהל שנגבה — לא נספר אצל הנציג */
  debtAdmin: number;
  pending: number;
  pendingOrders: number;
};

export async function GET(req: Request) {
  const g = await requireAdmin();
  if (!g.ok) return g.res;

  const url = new URL(req.url);
  const pricelistId = url.searchParams.get("pricelistId");
  const saleKind = parseSaleKind(url.searchParams.get("saleKind"));

  const orderWhere: any = {
    // ⚠️ מבוטלת נכללת רק אם נגבה בה כסף — הכסף נכנס בפועל
    OR: [{ status: { not: "CANCELLED" } }, { amountPaid: { gt: 0 } }],
  };
  const walkinWhere: any = { paymentReceived: true };
  if (pricelistId) {
    orderWhere.pricelistId = pricelistId;
    walkinWhere.pricelistId = pricelistId;
  } else if (saleKind) {
    orderWhere.pricelist = pricelistKindWhere(saleKind);
    walkinWhere.pricelist = pricelistKindWhere(saleKind);
  }

  const [orders, walkins] = await Promise.all([
    prisma.order.findMany({
      where: orderWhere,
      select: {
        ...ORDER_MONEY_SELECT,
        appliedDebtOwners: true,
        pricelist: { select: { orderFee: true } },
      },
    }),
    prisma.walkinOrder.findMany({
      where: walkinWhere,
      select: { pointId: true, totalAmount: true, paymentMethod: true },
    }),
  ]);

  const pointIds = new Set<string>();
  for (const o of orders) pointIds.add(o.pointId);
  for (const w of walkins) if (w.pointId) pointIds.add(w.pointId);

  const points = await prisma.deliveryPoint.findMany({
    where: { id: { in: [...pointIds] } },
    select: {
      id: true,
      name: true,
      city: true,
      agentPoints: { select: { agent: { select: { name: true } } } },
      agents: { select: { name: true } },
    },
  });
  const pointById = new Map(points.map((p) => [p.id, p]));

  const rows = new Map<string, IncomeRow>();
  const rowFor = (pointId: string | null): IncomeRow => {
    const key = pointId ?? "__none__";
    let r = rows.get(key);
    if (!r) {
      const p = pointId ? pointById.get(pointId) : null;
      const names = new Set<string>();
      for (const ap of p?.agentPoints ?? []) names.add(ap.agent.name);
      for (const a of p?.agents ?? []) names.add(a.name);
      r = {
        pointId: key,
        pointName: p?.name ?? "ללא נקודה",
        city: p?.city ?? null,
        agentLabel: names.size > 0 ? [...names].sort().join(" + ") : "—",
        orders: 0,
        paidOrders: 0,
        gross: 0,
        fees: 0,
        net: 0,
        card: 0,
        agentCash: 0,
        adminCash: 0,
        walkins: 0,
        walkinCount: 0,
        debtCollected: 0,
        debtAgent: 0,
        debtAdmin: 0,
        pending: 0,
        pendingOrders: 0,
      };
      rows.set(key, r);
    }
    return r;
  };

  // 💸 חוב שנציג רשם נזקף לשורה שלו: הנקודה של ההזמנה אם הוא משויך
  // אליה, אחרת הנקודה הראשונה שלו.
  const agentPointRows = await prisma.agentPoint.findMany({
    select: { agentId: true, pointId: true },
  });
  const pointsOfAgent = new Map<string, string[]>();
  for (const ap of agentPointRows) {
    pointsOfAgent.set(ap.agentId, [...(pointsOfAgent.get(ap.agentId) ?? []), ap.pointId]);
  }
  const missingPoints = [...new Set(agentPointRows.map((x) => x.pointId))].filter(
    (id) => !pointById.has(id)
  );
  if (missingPoints.length > 0) {
    const more = await prisma.deliveryPoint.findMany({
      where: { id: { in: missingPoints } },
      select: {
        id: true,
        name: true,
        city: true,
        agentPoints: { select: { agent: { select: { name: true } } } },
        agents: { select: { name: true } },
      },
    });
    for (const p of more) pointById.set(p.id, p);
  }
  const rowForAgent = (agentId: string, orderPointId: string | null): IncomeRow => {
    const pts = pointsOfAgent.get(agentId) ?? [];
    if (orderPointId && pts.includes(orderPointId)) return rowFor(orderPointId);
    return rowFor(pts[0] ?? orderPointId);
  };

  for (const o of orders) {
    const r = rowFor(o.pointId);
    const m = classifyOrderMoney(o as any);
    if (o.status !== "CANCELLED") r.orders++;
    if (m.collected > 0) {
      r.paidOrders++;
      const fee = Math.min(Number(o.pricelist?.orderFee ?? 0), m.collected);
      r.gross += m.collected;
      r.fees += fee;
      r.card += m.cardRev;
      r.adminCash += m.adminCashRev;
      r.agentCash += m.agentCashRev;
    }
    // חוב קודם שנגבה בפועל בהזמנה הזו — אותו כלל של classifyOrderMoney:
    // החוב יורד ראשון מהתשלום
    if (m.debtPart > 0) {
      const got = Math.min(m.debtPart, splitPaid(o as any).paid);
      r.debtCollected += got;
      // 💸 של מי החוב שנגבה: חלק הנציג נספר בנטו של הנציג שרשם אותו
      if (got > 0) {
        const owners = ownersForBalance((o as any).appliedDebtOwners, m.debtPart);
        const share = got / m.debtPart;
        for (const [k, v] of Object.entries(owners)) {
          const amt = r2(v * share);
          const aid = agentIdOfOwner(k);
          if (aid) rowForAgent(aid, o.pointId).debtAgent += amt;
          else r.debtAdmin += amt;
        }
      }
    }
    if (m.pending > 0 && o.status !== "CANCELLED") {
      r.pending += m.pending;
      r.pendingOrders++;
    }
  }

  for (const w of walkins) {
    const r = rowFor(w.pointId);
    const amt = Number(w.totalAmount ?? 0);
    if (amt <= 0) continue;
    r.walkins += amt;
    r.walkinCount++;
    r.gross += amt;
    if (w.paymentMethod === "CASH") r.agentCash += amt;
    else r.card += amt;
  }

  // 💳 חוב שנגבה מיידית בכרטיס (בלי הזמנה) — לפי בעלים
  let ledgerPricelistIds: string[] | null = null;
  if (pricelistId) ledgerPricelistIds = [pricelistId];
  else if (saleKind) {
    const pls = await prisma.pricelist.findMany({
      where: pricelistKindWhere(saleKind),
      select: { id: true },
    });
    ledgerPricelistIds = pls.map((p) => p.id);
  }
  const instant = await prisma.debtLedger.findMany({
    where: {
      kind: "COLLECT",
      method: "CARD",
      ...(ledgerPricelistIds ? { pricelistId: { in: ledgerPricelistIds } } : {}),
    },
    select: { amount: true, ownerKey: true, customer: { select: { defaultPointId: true } } },
  });
  for (const l of instant) {
    const amt = -Number(l.amount);
    if (!(amt > 0)) continue;
    const aid = agentIdOfOwner(l.ownerKey ?? "admin");
    if (aid) rowForAgent(aid, l.customer.defaultPointId).debtAgent += amt;
    else rowFor(l.customer.defaultPointId).debtAdmin += amt;
  }

  const list = [...rows.values()].map((r) => ({
    ...r,
    gross: r2(r.gross),
    fees: r2(r.fees),
    // 💸 חוב שהנציג רשם ונגבה — חלק מהנטו שלו (₪3 דמי ההזמנה לא)
    net: r2(r.gross - r.fees + r.debtAgent),
    card: r2(r.card),
    agentCash: r2(r.agentCash),
    adminCash: r2(r.adminCash),
    walkins: r2(r.walkins),
    debtCollected: r2(r.debtCollected),
    debtAgent: r2(r.debtAgent),
    debtAdmin: r2(r.debtAdmin),
    pending: r2(r.pending),
  }));
  list.sort(
    (a, b) =>
      a.agentLabel.localeCompare(b.agentLabel, "he") ||
      a.pointName.localeCompare(b.pointName, "he")
  );

  const sum = (k: keyof IncomeRow) =>
    r2(list.reduce((s, r) => s + (Number(r[k]) || 0), 0));
  const totals = {
    orders: sum("orders"),
    paidOrders: sum("paidOrders"),
    gross: sum("gross"),
    fees: sum("fees"),
    net: sum("net"),
    card: sum("card"),
    agentCash: sum("agentCash"),
    adminCash: sum("adminCash"),
    walkins: sum("walkins"),
    debtCollected: sum("debtCollected"),
    debtAgent: sum("debtAgent"),
    debtAdmin: sum("debtAdmin"),
    pending: sum("pending"),
    pendingOrders: sum("pendingOrders"),
  };

  return NextResponse.json({ rows: list, totals });
}
