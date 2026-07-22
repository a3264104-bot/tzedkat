// §20: API לוח בקרת מכירה למנהל
// GET /api/admin/sale-control/[pricelistId]
// מחזיר: סיכום כספי + פערים לפי מוצר + מצב נציגים + התראות

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/guard";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ pricelistId: string }> }
) {
  const g = await requireAdmin();
  if (!g.ok) return g.res;

  const { pricelistId } = await params;

  const pricelist = await prisma.pricelist.findUnique({
    where: { id: pricelistId },
    select: {
      id: true, name: true, status: true,
      deliveryDate: true, deliveryDateText: true,
      closeDate: true,
    },
  });
  if (!pricelist) {
    return NextResponse.json({ error: "מחירון לא נמצא" }, { status: 404 });
  }

  // ─── תעודות משלוח מאושרות ─────────────────
  const deliveryNotes = await prisma.deliveryNote.findMany({
    where: { pricelistId, status: "CONFIRMED" },
    include: {
      items: {
        include: { product: { select: { id: true, name: true } } },
      },
    },
  });

  // סיכום ק"ג לפי מוצר מהתעודות
  const productWeightsFromNotes: Record<string, { name: string; weight: number; cartons: number }> = {};
  for (const note of deliveryNotes) {
    for (const item of note.items) {
      if (!item.productId) continue;
      const name = item.product?.name || item.productNameOnNote;
      if (!productWeightsFromNotes[item.productId]) {
        productWeightsFromNotes[item.productId] = { name, weight: 0, cartons: 0 };
      }
      productWeightsFromNotes[item.productId].weight += Number(item.weight);
      productWeightsFromNotes[item.productId].cartons += item.quantity;
    }
  }

  // ─── הזמנות ─────────────────
  const orders = await prisma.order.findMany({
    where: {
      pricelistId,
      status: { notIn: ["CANCELLED"] },
    },
    include: {
      items: { where: { isCancelled: false } },
      customer: { select: { id: true, name: true } },
      point: { select: { id: true, name: true } },
    },
  });

  // סיכום ק"ג לפי מוצר לפי הזמנות (מה שהנציג הזין)
  const productWeightsUsed: Record<string, { entered: number; ordered: number; missing: number }> = {};
  let totalOrderRevenue = 0;
  let totalOrdersWithData = 0;
  let ordersFullyEntered = 0;
  let itemsTotal = 0;
  let itemsEntered = 0;

  for (const order of orders) {
    const items = order.items;
    itemsTotal += items.length;
    let allEntered = true;
    let hasData = false;

    for (const it of items) {
      if (!productWeightsUsed[it.productId]) {
        productWeightsUsed[it.productId] = { entered: 0, ordered: 0, missing: 0 };
      }
      // ק"ג שהנציג הזין
      const w = it.agentEnteredWeight ? Number(it.agentEnteredWeight) : 0;
      if (w > 0) {
        productWeightsUsed[it.productId].entered += w;
        hasData = true;
      } else {
        allEntered = false;
        productWeightsUsed[it.productId].missing++;
      }
      itemsEntered += w > 0 ? 1 : 0;

      // מחיר סופי (או משוער)
      if (it.finalPrice) {
        totalOrderRevenue += Number(it.finalPrice);
      } else if (it.estimatedPrice) {
        totalOrderRevenue += Number(it.estimatedPrice);
      }
    }

    if (hasData) totalOrdersWithData++;
    if (allEntered && items.length > 0) ordersFullyEntered++;
  }

  // ─── מזדמנים ─────────────────
  const walkins = await prisma.walkinOrder.findMany({
    where: { pricelistId },
    include: {
      items: true,
      agent: { select: { id: true, name: true } },
    },
  });

  let walkinRevenue = 0;
  let walkinCash = 0;
  let walkinCardTerminal = 0;
  let walkinTransferPending = 0;
  let walkinTransferReceived = 0;
  let walkinOnline = 0;

  for (const w of walkins) {
    walkinRevenue += Number(w.totalAmount);
    if (w.paymentMethod === "CASH") walkinCash += Number(w.totalAmount);
    else if (w.paymentMethod === "CARD_TERMINAL") walkinCardTerminal += Number(w.totalAmount);
    else if (w.paymentMethod === "TRANSFER") {
      if (w.paymentReceived) walkinTransferReceived += Number(w.totalAmount);
      else walkinTransferPending += Number(w.totalAmount);
    } else if (w.paymentMethod === "ONLINE") walkinOnline += Number(w.totalAmount);

    for (const it of w.items) {
      if (!productWeightsUsed[it.productId]) {
        productWeightsUsed[it.productId] = { entered: 0, ordered: 0, missing: 0 };
      }
      productWeightsUsed[it.productId].entered += Number(it.weight);
    }
  }

  // ─── חישוב פערים לפי מוצר ─────────────────
  const productComparison: Array<{
    productId: string;
    productName: string;
    receivedWeight: number;   // מהתעודה
    receivedCartons: number;
    distributedWeight: number; // הוזן ע"י נציגים
    difference: number;         // מה שהתקבל - מה שחולק
    differencePercent: number;
    status: "OK" | "OVER" | "UNDER" | "SIGNIFICANT_UNDER" | "NO_NOTE";
  }> = [];

  const allProductIds = new Set([
    ...Object.keys(productWeightsFromNotes),
    ...Object.keys(productWeightsUsed),
  ]);

  for (const productId of allProductIds) {
    const received = productWeightsFromNotes[productId];
    const used = productWeightsUsed[productId];
    const receivedWeight = received?.weight || 0;
    const distributedWeight = used?.entered || 0;
    const productName = received?.name ||
      (await prisma.product.findUnique({
        where: { id: productId },
        select: { name: true },
      }))?.name || "לא ידוע";

    let difference = 0;
    let differencePercent = 0;
    let status: "OK" | "OVER" | "UNDER" | "SIGNIFICANT_UNDER" | "NO_NOTE" = "OK";

    if (receivedWeight === 0) {
      // אין תעודה למוצר הזה
      status = "NO_NOTE";
    } else {
      difference = receivedWeight - distributedWeight;
      differencePercent = (difference / receivedWeight) * 100;

      if (difference < 0) status = "OVER"; // חילקו יותר ממה שקיבלנו!
      else if (differencePercent > 5) status = "SIGNIFICANT_UNDER"; // >5% נשאר = חשוד
      else if (differencePercent > 1) status = "UNDER"; // שיירים סבירים
      else status = "OK";
    }

    productComparison.push({
      productId,
      productName,
      receivedWeight,
      receivedCartons: received?.cartons || 0,
      distributedWeight,
      difference,
      differencePercent,
      status,
    });
  }

  productComparison.sort((a, b) => Math.abs(b.difference) - Math.abs(a.difference));

  // ─── סיכומי נציגים ─────────────────
  const agentSummaries = await prisma.agentSaleSummary.findMany({
    where: { pricelistId },
    include: {
      agent: {
        select: {
          id: true, name: true, phone: true,
          agentPoint: { select: { id: true, name: true } },
          commissionRateCarton: true,
          commissionRateSingles: true,
        },
      },
    },
  });

  // חישוב מזומן ומעברים לפי נציג
  const agentCashCollectedMap: Record<string, number> = {};
  for (const w of walkins) {
    if (w.paymentMethod === "CASH" && w.paymentReceived) {
      agentCashCollectedMap[w.agentId] = (agentCashCollectedMap[w.agentId] || 0) + Number(w.totalAmount);
    }
  }

  const agentPayments = await prisma.agentPayment.findMany({
    where: { pricelistId },
  });
  const agentCollectedMap: Record<string, number> = {};
  const agentPaidMap: Record<string, number> = {};
  for (const p of agentPayments) {
    if (p.type === "COLLECTED") agentCollectedMap[p.agentId] = (agentCollectedMap[p.agentId] || 0) + Number(p.amount);
    if (p.type === "PAID") agentPaidMap[p.agentId] = (agentPaidMap[p.agentId] || 0) + Number(p.amount);
  }

  const agentsReport = agentSummaries.map((s) => {
    const cashCollected = agentCashCollectedMap[s.agentId] || 0;
    const cashHandedIn = agentCollectedMap[s.agentId] || 0;
    const paidToAgent = agentPaidMap[s.agentId] || 0;
    const balance = Number(s.totalCommission) - paidToAgent - (cashCollected - cashHandedIn);
    return {
      agentId: s.agentId,
      agentName: s.agent.name,
      phone: s.agent.phone,
      pointName: s.agent.agentPoint?.name || null,
      status: s.status,
      confirmedAt: s.confirmedAt?.toISOString() || null,
      totalCartonWeight: Number(s.totalCartonWeight),
      totalSinglesWeight: Number(s.totalSinglesWeight),
      totalWalkinWeight: Number(s.totalWalkinWeight),
      totalCustomers: s.totalCustomers,
      totalWalkins: s.totalWalkins,
      totalCommission: Number(s.totalCommission),
      cashCollected,
      cashHandedIn,
      paidToAgent,
      balance,
      remainderNote: s.remainderNote,
    };
  });

  // ─── התראות ─────────────────
  const alerts: Array<{ type: "info" | "warning" | "danger"; message: string }> = [];

  const overAllocated = productComparison.filter((p) => p.status === "OVER");
  if (overAllocated.length > 0) {
    alerts.push({
      type: "danger",
      message: `${overAllocated.length} מוצרים חולקו ביותר מהתעודה: ${overAllocated.map((p) => p.productName).join(", ")}`,
    });
  }

  const significantUnder = productComparison.filter((p) => p.status === "SIGNIFICANT_UNDER");
  if (significantUnder.length > 0) {
    alerts.push({
      type: "warning",
      message: `${significantUnder.length} מוצרים עם פער משמעותי (>5%): ${significantUnder.map((p) => p.productName).join(", ")}`,
    });
  }

  if (walkinTransferPending > 0) {
    alerts.push({
      type: "warning",
      message: `העברות בנקאיות ב-₪${walkinTransferPending.toFixed(2)} טרם אושרו כהתקבלו`,
    });
  }

  const pendingOrders = orders.length - ordersFullyEntered;
  if (pendingOrders > 0 && pricelist.status !== "ACTIVE") {
    alerts.push({
      type: "info",
      message: `${pendingOrders} הזמנות עם משקלים חסרים או חלקיים`,
    });
  }

  const openSummaries = agentsReport.filter((a) => a.status !== "CONFIRMED").length;
  if (openSummaries > 0) {
    alerts.push({
      type: "info",
      message: `${openSummaries} נציגים טרם סגרו את סיכום המכירה`,
    });
  }

  // ─── סיכום כספי ─────────────────
  const totalRevenue = totalOrderRevenue + walkinRevenue;
  const totalCommissions = agentsReport.reduce((s, a) => s + a.totalCommission, 0);
  const netRevenue = totalRevenue - totalCommissions;

  return NextResponse.json({
    pricelist: {
      id: pricelist.id,
      name: pricelist.name,
      status: pricelist.status,
      deliveryDate: pricelist.deliveryDate?.toISOString() || null,
      deliveryDateText: pricelist.deliveryDateText,
      closeDate: pricelist.closeDate?.toISOString() || null,
    },
    financialSummary: {
      totalRevenue,
      orderRevenue: totalOrderRevenue,
      walkinRevenue,
      walkinCash,
      walkinCardTerminal,
      walkinTransferPending,
      walkinTransferReceived,
      walkinOnline,
      totalCommissions,
      netRevenue,
    },
    progress: {
      totalOrders: orders.length,
      ordersFullyEntered,
      ordersWithData: totalOrdersWithData,
      pendingOrders,
      totalItems: itemsTotal,
      itemsEntered,
      completionPercent: itemsTotal > 0 ? Math.round((itemsEntered / itemsTotal) * 100) : 0,
      totalWalkins: walkins.length,
    },
    productComparison,
    agents: agentsReport,
    alerts,
  });
}
