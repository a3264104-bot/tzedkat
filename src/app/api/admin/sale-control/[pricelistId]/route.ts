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
  const productWeightsFromNotes: Record<
    string,
    { name: string; weight: number; cartons: number; cost: number; costedWeight: number }
  > = {};
  for (const note of deliveryNotes) {
    for (const item of note.items) {
      if (!item.productId) continue;
      const name = item.product?.name || item.productNameOnNote;
      if (!productWeightsFromNotes[item.productId]) {
        productWeightsFromNotes[item.productId] = {
          name,
          weight: 0,
          cartons: 0,
          cost: 0,
          costedWeight: 0,
        };
      }
      productWeightsFromNotes[item.productId].weight += Number(item.weight);
      productWeightsFromNotes[item.productId].cartons += item.quantity;

      // §116: עלות בפועל מהספק.
      //
      // הפער שנסגר: netRevenue חושב כ"הכנסות פחות עמלות" - וזה
      // **אינו רווח**. מה ששולם לספק, שהוא הרכיב הגדול ביותר
      // בעלות, לא נוכה כלל. המנהל ראה מספר שנראה כרווח והיה
      // גבוה פי כמה מהאמת.
      //
      // ⚠️ סכימה משוקללת: מוצר יכול להגיע בכמה תעודות במחירים
      // שונים. 100 ק"ג ב-30 ו-10 ק"ג ב-50 הם 3,500 ולא ממוצע
      // פשוט של 40 כפול 110.
      const w = Number(item.weight);
      if (item.costPerKg != null) {
        productWeightsFromNotes[item.productId].cost += Number(item.costPerKg) * w;
        productWeightsFromNotes[item.productId].costedWeight += w;
      }
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
      // 🐛 תוקן: "כמה חולק בפועל" נמדד לפי actualWeight - המשקל שבאמת
      // נמסר ללקוח וחויב עליו, כולל תיקונים שהמנהל ביצע בביקורת המשקלים.
      // קודם נמדד רק agentEnteredWeight (שהוא "נעול לעמלה" ולא משתנה
      // כשהמנהל מתקן), ולכן כל תיקון של המנהל יצר פער שקרי מול התעודה -
      // עד כדי הצגת 0 חולק כשהמנהל שקל בעצמו בלי שהנציג הזין.
      // אותה עדיפות שכבר קיימת בייצוא לאקסל (export-sale).
      const distributed = it.actualWeight
        ? Number(it.actualWeight)
        : it.agentEnteredWeight
          ? Number(it.agentEnteredWeight)
          : 0;
      if (distributed > 0) {
        productWeightsUsed[it.productId].entered += distributed;
        hasData = true;
      } else {
        allEntered = false;
        productWeightsUsed[it.productId].missing++;
      }
      itemsEntered += distributed > 0 ? 1 : 0;

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
    distributedWeight: number; // מה שנמסר בפועל (actualWeight, כולל תיקוני מנהל)
    difference: number;         // מה שהתקבל - מה שחולק
    differencePercent: number;
    status: "OK" | "OVER" | "UNDER" | "SIGNIFICANT_UNDER" | "NO_NOTE";
    costPerKg: number | null;   // §116: עלות ממוצעת משוקללת מהספק
    totalCost: number;
    costPartial: boolean;
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

    // §116: עלות ממוצעת משוקללת לק"ג, ועלות כוללת למוצר
    const costPerKg =
      received && received.costedWeight > 0
        ? received.cost / received.costedWeight
        : null;

    productComparison.push({
      productId,
      productName,
      receivedWeight,
      receivedCartons: received?.cartons || 0,
      distributedWeight,
      difference,
      differencePercent,
      status,
      costPerKg,
      totalCost: received?.cost || 0,
      // ⚠️ מסמן שורה שהעלות בה חלקית - חלק מהתעודות בלי מחיר.
      // בלי הסימון הזה המרווח נראה גבוה מהאמת ואי אפשר לדעת למה.
      costPartial: !!received && received.costedWeight < received.weight - 0.001,
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
      // §119: עמלת מוצרים מועדפים - מוצגת בנפרד למנהל, כדי
      // שיראה למה הסכום גבוה מהתעריף הרגיל ולא יחשוד בטעות.
      customCommission: Number((s as any).customCommission ?? 0),
      cashCollected,
      cashHandedIn,
      paidToAgent,
      balance,
      remainderNote: s.remainderNote,
    };
  });

  // ─── התראות ─────────────────
  const alerts: Array<{ type: "info" | "warning" | "danger"; message: string }> = [];

  // §21: הזמנות שנמסרו בפועל אך טרם שולמו - חשיפה כספית שהמנהל חייב לראות.
  // לא חוסמים את הנציג מלסמן מסירה (הוא בשטח), אבל לא מסתירים את הפער.
  const deliveredUnpaid = orders.filter(
    (o) => (o as any).deliveredAt && o.paymentStatus !== "PAID"
  );
  if (deliveredUnpaid.length > 0) {
    const sum = deliveredUnpaid.reduce(
      (s, o) => s + Number(o.finalTotal ?? o.estimatedTotal ?? 0),
      0
    );
    alerts.push({
      type: "danger",
      message: `${deliveredUnpaid.length} הזמנות נמסרו ללקוח אך טרם שולמו (₪${sum.toFixed(2)}): ${deliveredUnpaid
        .map((o) => `#${o.orderNumber}`)
        .join(", ")}`,
    });
  }

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

  // §116: הרווח האמיתי - אחרי הספק **וגם** אחרי העמלות.
  //
  // netRevenue נשאר כפי שהיה (הכנסות פחות עמלות) כדי לא לשבור
  // תצוגות קיימות, אבל הוא **אינו רווח** ולא ראוי להציגו ככזה.
  const totalSupplierCost = productComparison.reduce((s, p) => s + p.totalCost, 0);
  const grossProfit = totalRevenue - totalSupplierCost;
  const netProfit = grossProfit - totalCommissions;

  // ⚠️ אמין רק אם הוזנה עלות לכל מוצר שהגיע. אחרת הרווח מנופח,
  // והמנהל עלול להסיק מסקנה עסקית שגויה על סמך מספר חלקי.
  const withNotes = productComparison.filter((p) => p.receivedWeight > 0);
  const costComplete =
    withNotes.length > 0 && withNotes.every((p) => p.costPerKg != null && !p.costPartial);
  const missingCostProducts = withNotes
    .filter((p) => p.costPerKg == null || p.costPartial)
    .map((p) => p.productName);

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
      // §116: עלות הספק והרווח בפועל
      totalSupplierCost,
      grossProfit,
      netProfit,
      costComplete,
      missingCostProducts,
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

// ═══════════════════════════════════════════════════════════════
// §116: הזנת עלות הספק
// ═══════════════════════════════════════════════════════════════
// POST /api/admin/sale-control/[pricelistId]  { productId, costPerKg }
//
// למה כאן ולא במסך תעודות המשלוח: המנהל מזין את העלות כשהוא
// מסתכל על הפער ועל ההכנסה - זה הרגע שבו המספר מקבל משמעות.
// דרישה לעבור למסך אחר הייתה מבטיחה שזה לא ייעשה.
export async function POST(
  req: Request,
  { params }: { params: Promise<{ pricelistId: string }> }
) {
  const g = await requireAdmin();
  if (!g.ok) return g.res;

  const { pricelistId } = await params;
  const b = await req.json().catch(() => ({}));
  const productId = String(b.productId || "");
  if (!productId) {
    return NextResponse.json({ error: "חסר מזהה מוצר" }, { status: 400 });
  }

  // ⚠️ המספר הזה הופך לבסיס לחישוב רווח. ערך שגוי אינו "תצוגה
  // מכוערת" אלא מסקנה עסקית שגויה - עדיף לדחות מאשר לשמור.
  let costPerKg: number | null = null;
  const raw = b.costPerKg;
  if (raw !== null && raw !== undefined && raw !== "") {
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 0) {
      return NextResponse.json(
        { error: 'העלות לק"ג חייבת להיות מספר חיובי' },
        { status: 400 }
      );
    }
    if (n > 10000) {
      // תפיסת טעות מובהקת: סכום כולל שהוזן במקום מחיר לק"ג
      return NextResponse.json(
        { error: 'העלות נראית שגויה. יש להזין מחיר לקילוגרם, לא סכום כולל.' },
        { status: 400 }
      );
    }
    costPerKg = n;
  }

  // העלות נשמרת על **כל שורות התעודה** של אותו מוצר במכירה.
  // מוצר יכול להגיע בכמה משלוחים, והמחיר מהספק זהה לכולם באותה
  // מכירה. עדכון שורה אחת היה מייצר חישוב חלקי שנראה תקין.
  const result = await prisma.deliveryNoteItem.updateMany({
    where: { productId, deliveryNote: { pricelistId, status: "CONFIRMED" } },
    data: { costPerKg },
  });

  if (result.count === 0) {
    return NextResponse.json(
      {
        error:
          "לא נמצאה שורה מאושרת בתעודות המשלוח עבור המוצר הזה. יש לוודא שהתעודה נקלטה ואושרה.",
      },
      { status: 404 }
    );
  }

  return NextResponse.json({ ok: true, updated: result.count, costPerKg });
}
