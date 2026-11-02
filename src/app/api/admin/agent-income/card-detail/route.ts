// ═══════════════════════════════════════════════════════════════
// 💳 פירוט "אשראי/העברה" של נקודה — ממה מורכב הסכום
// ═══════════════════════════════════════════════════════════════
// GET /api/admin/agent-income/card-detail?pointIds=a,b&pricelistId=X
//                                         (או saleKind=… / בלי — כל המכירות)
//
// כל הזמנה ששולמה באשראי/העברה בנקודה, ולכל אחת: מוצרים, דמי הזמנה,
// משלוח, חיוב נוסף, זיכוי, יתרת זכות, חוב קודם → סכום ההזמנה, וכמה
// מזה נכנס באשראי.
//
// ⚠️ אותו חישוב בדיוק של עמודת האשראי במסך (classifyOrderMoney →
// cardRev, וגם מזדמנים ישנים). הסכום בתחתית הפירוט חייב להיות
// המספר שבעמודה — אחרת הפירוט לא שווה כלום.

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/guard";
import { classifyOrderMoney, ORDER_MONEY_SELECT, splitPaid } from "@/lib/agent-money-lib";
import { parseSaleKind, pricelistKindWhere } from "@/lib/weekly-sales";

const r2 = (n: number) => Math.round(n * 100) / 100;

export async function GET(req: Request) {
  const g = await requireAdmin();
  if (!g.ok) return g.res;

  const url = new URL(req.url);
  const pricelistId = url.searchParams.get("pricelistId");
  const saleKind = parseSaleKind(url.searchParams.get("saleKind"));
  const rawIds = (url.searchParams.get("pointIds") || "").split(",").filter(Boolean);
  if (rawIds.length === 0) return NextResponse.json({ error: "חסרה נקודה" }, { status: 400 });
  // "__none__" (מזדמן בלי נקודה) — אין לו פירוט כאן
  const ids = rawIds.filter((x) => x !== "__none__");
  const pointWhere = { pointId: { in: ids } };

  const saleWhere: any = pricelistId
    ? { pricelistId }
    : saleKind
      ? { pricelist: pricelistKindWhere(saleKind) }
      : {};

  const [orders, walkins] = await Promise.all([
    prisma.order.findMany({
      where: {
        AND: [pointWhere, saleWhere, { OR: [{ status: { not: "CANCELLED" } }, { amountPaid: { gt: 0 } }] }],
      },
      select: {
        ...ORDER_MONEY_SELECT,
        pointNameSnapshot: true,
        paymentTransactionId: true,
        creditAmount: true,
        creditReason: true,
        appliedCreditBalance: true,
        deliveryFee: true,
        deliveryRequested: true,
        extraCharge: true,
        extraChargeReason: true,
        pricelist: { select: { orderFee: true, name: true } },
        items: { where: { isCancelled: false }, select: { finalPrice: true } },
      },
      orderBy: { orderNumber: "asc" },
    }),
    prisma.walkinOrder.findMany({
      where: { AND: [{ pointId: { in: ids } }, saleWhere, { paymentReceived: true }] },
      select: { walkinNumber: true, customerName: true, totalAmount: true, paymentMethod: true },
    }),
  ]);

  const rows: Array<Record<string, unknown> & { cardPaid: number; cardDebt: number; cardRev: number }> = [];
  for (const o of orders) {
    const m = classifyOrderMoney(o as any);
    const sp = splitPaid(o as any);
    if (!(sp.card > 0)) continue;
    const items = r2(o.items.reduce((s, i) => s + Number(i.finalPrice ?? 0), 0));
    const delivery = o.deliveryRequested && o.deliveryFee != null ? Number(o.deliveryFee) : 0;
    rows.push({
      orderNumber: o.orderNumber,
      customerName: o.customerName,
      point: o.pointNameSnapshot,
      sale: o.pricelist?.name ?? null,
      paidAt: o.paidAt,
      transactionId: o.paymentTransactionId,
      status: o.status,
      paymentStatus: o.paymentStatus,
      parts: {
        items,
        orderFee: Number(o.pricelist?.orderFee ?? 0),
        delivery: r2(delivery),
        extra: r2(Number(o.extraCharge ?? 0)),
        extraReason: o.extraChargeReason,
        credit: r2(Number(o.creditAmount ?? 0)),
        creditReason: o.creditReason,
        creditBalance: r2(Number(o.appliedCreditBalance ?? 0)),
        debt: r2(Number(o.appliedDebt ?? 0)),
      },
      total: r2(Number(o.finalTotal ?? o.estimatedTotal ?? 0)),
      paid: sp.paid,
      /** מה שנכנס באשראי בהזמנה (כולל חוב קודם) */
      cardPaid: sp.card,
      /** החלק של החוב הקודם שנגבה באשראי — לא בעמודה (מופיע בעמודות החוב) */
      cardDebt: r2(sp.card - m.cardRev),
      /** נספר בעמודת האשראי */
      cardRev: m.cardRev,
    });
  }
  const walk = walkins
    .filter((w) => w.paymentMethod !== "CASH" && Number(w.totalAmount ?? 0) > 0)
    .map((w) => ({ walkinNumber: w.walkinNumber, customerName: w.customerName, amount: r2(Number(w.totalAmount)) }));

  const sum = (k: "cardRev" | "cardDebt" | "cardPaid") => r2(rows.reduce((s, r) => s + r[k], 0));
  const walkSum = r2(walk.reduce((s, w) => s + w.amount, 0));
  return NextResponse.json({
    orders: rows,
    walkins: walk,
    totals: {
      cardPaid: sum("cardPaid"),
      cardDebt: sum("cardDebt"),
      cardRev: sum("cardRev"),
      walkins: walkSum,
      /** = עמודת האשראי במסך */
      column: r2(sum("cardRev") + walkSum),
    },
  });
}
