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
    // §241: סכום הפריטים בהזמנה זו - להחלפה ב-finalTotal
    let orderItemsSum = 0;

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
      //
      // §241: נצבר גם ב-orderItemsSum, כדי שנוכל להחליף אותו
      // בסכום המלא של ההזמנה כשיש finalTotal.
      if (it.finalPrice) {
        totalOrderRevenue += Number(it.finalPrice);
        orderItemsSum += Number(it.finalPrice);
      } else if (it.estimatedPrice) {
        totalOrderRevenue += Number(it.estimatedPrice);
        orderItemsSum += Number(it.estimatedPrice);
      }
    }

    // §241: 🐛 סכום הפריטים בלבד — בלי דמי טיפול, משלוח וחיובים.
    //
    // הדשבורד הציג ₪358,684 ובקרת המכירה ₪358,057 — הפרש של
    // ₪627. המנהל רואה שני מספרים לאותה מכירה ולא יודע במי
    // לבטוח.
    //
    // הסיבה: כאן נספרו רק המחירים של הפריטים, בזמן שהדשבורד
    // סוכם את finalTotal/estimatedTotal — שכוללים גם דמי טיפול,
    // משלוח וחיוב נוסף, פחות זיכויים.
    //
    // ⚠️ finalTotal קודם: אחרי שקילה הוא הסכום האמיתי, וכל
    // הרכיבים כבר בתוכו (§134). רק כשאין - מוסיפים ידנית.
    // ⚠️ המשתנה בלולאה הזו נקרא `order`, לא `o` - יש שתי לולאות
    // על orders בקובץ, כל אחת עם שם אחר.
    if (order.finalTotal != null) {
      // ⚠️ המרה: הסכום למעלה נבנה מהפריטים, ועכשיו מחליפים אותו
      // בסכום המלא של ההזמנה. מחסירים את מה שכבר נספר.
      totalOrderRevenue += Number(order.finalTotal) - orderItemsSum;
    } else {
      // §244: 🐛 **ספירה כפולה של דמי הטיפול.**
      //
      // הוספתי כאן `orderFee` בהנחה שהוא חסר - אבל estimatedTotal
      // כבר כולל אותו מרגע יצירת ההזמנה. התוצאה: ₪3 × ~35 הזמנות
      // = ₪104.70 עודף, ובקרת המכירה הציגה יותר מהמסד.
      //
      // ⚠️ הראיה: שאילתה ישירה למסד החזירה 358,824.30, והמסך
      // הציג 358,929. ההפרש היה בדיוק דמי הטיפול הכפולים.
      //
      // ⚠️ עכשיו: מחליפים את סכום הפריטים ב-estimatedTotal (שכולל
      // את הטיפול), ומוסיפים רק את מה שנוסף **אחרי** ההזמנה.
      const dlv =
        order.deliveryRequested && order.deliveryFee != null
          ? Number(order.deliveryFee)
          : 0;
      const extra = order.extraCharge != null ? Number(order.extraCharge) : 0;
      const credit =
        order.creditAmount != null ? Number(order.creditAmount) : 0;
      const bal =
        order.appliedCreditBalance != null
          ? Number(order.appliedCreditBalance)
          : 0;
      // §245: estimatedTotal הוא מקור האמת - הוא כולל את דמי
      // הטיפול כפי שהיו **ברגע ההזמנה**.
      //
      // ⚠️ לא מוסיפים orderFee ידנית: 35 הזמנות נשמרו בלי אחרי
      // עריכה (§245), והוספה כאן הייתה "מתקנת" אותן בדוח בזמן
      // שבמסד הן עדיין חסרות - כלומר הדוח היה מציג יותר ממה
      // שייגבה בפועל.
      totalOrderRevenue +=
        Number(order.estimatedTotal ?? 0) - orderItemsSum + dlv + extra - credit - bal;
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
  // §124: זיכויים ויתרות זכות שקוזזו במכירה הזו.
  //
  // ⚠️ הם **מקטינים את ההכנסה בפועל**. סיכום שמציג מחזור בלי
  // לנכות אותם מציג כסף שלא נכנס לקופה, והמנהל מקבל תמונה
  // אופטימית מהמציאות.
  let totalCredits = 0;
  let totalBalanceApplied = 0;
  for (const o of orders) {
    if (o.creditAmount != null) totalCredits += Number(o.creditAmount);
    if ((o as any).appliedCreditBalance != null) {
      totalBalanceApplied += Number((o as any).appliedCreditBalance);
    }
  }
  totalCredits = Math.round(totalCredits * 100) / 100;
  totalBalanceApplied = Math.round(totalBalanceApplied * 100) / 100;

  const totalRevenue = totalOrderRevenue + walkinRevenue;

  // §239: 💰 **מה שנגבה בפועל** — לא מה שהוזמן.
  //
  // 🐛 המסך הציג "הכנסה ₪358,057" בזמן ש-0 הזמנות שולמו. זה
  // מה ש**הוזמן**, ואין שום מקום שאומר כמה כסף באמת נכנס.
  //
  // ⚠️ שלוש קטגוריות, כי הן מתנהגות שונה:
  //   אשראי  — הכסף כבר אצל נדרים, לא צריך לעשות כלום
  //   מזומן  — הנציג מחזיק אותו, וצריך להעביר
  //   ממתין  — עוד לא נגבה כלל
  //
  // ⚠️ amountPaid ולא finalTotal: תשלום חלקי הוא מצב אמיתי
  // (§7), ושימוש ב-finalTotal היה סופר אותו כמלא.
  let collectedCard = 0;
  let collectedCash = 0;
  let pendingCollection = 0;
  let paidOrdersCount = 0;

  for (const o of orders) {
    const due = Number(o.finalTotal ?? o.estimatedTotal ?? 0);
    const paid = Number(o.amountPaid ?? 0);

    if (o.paymentStatus === "PAID" || paid > 0) {
      // ⚠️ הסכום שבאמת נכנס. אם amountPaid ריק אבל הסטטוס PAID
      // (סימון ידני ישן) - נופלים לסכום שהיה אמור להיגבות.
      const actual = paid > 0 ? paid : due;
      // ⚠️ CASH **או** MANUAL: "סימון תשלום מזומן" של הנציג
      // (§130) שומר MANUAL, וספירה שלו כאשראי הייתה מנפחת את
      // מה שכביכול כבר אצלנו.
      if (o.paymentMethod === "CASH" || o.paymentMethod === "MANUAL") {
        collectedCash += actual;
      } else {
        collectedCard += actual;
      }
      if (o.paymentStatus === "PAID") paidOrdersCount++;
      // ⚠️ יתרה בתשלום חלקי עדיין ממתינה
      if (actual < due) pendingCollection += due - actual;
    } else {
      pendingCollection += due;
    }
  }

  // ⚠️ מזדמנים: אצלם התשלום כבר נגבה בהגדרה (§44), ולכן הם
  // נספרים ישירות לפי אמצעי התשלום.
  collectedCash += walkinCash;
  collectedCard += walkinCardTerminal + walkinOnline;
  // ⚠️ העברה בנקאית שטרם התקבלה היא ממתינה, לא נגבתה.
  pendingCollection += walkinTransferPending;

  // §240: 🐛 "מזומן אצל נציגים" כלל גם את מה שכבר העבירו.
  //
  // הכרטיס אמר "₪4,250 אצל נציגים" - אבל אם נציג כבר העביר
  // ₪3,000, בפועל אצלם רק ₪1,250. המנהל שרואה את המספר הגבוה
  // חושב שיש לו עוד מה לאסוף.
  //
  // ⚠️ הסכום מגיע מ-AgentPayment עם type=COLLECTED, שנרשם
  // במסך חובות נציגים כשהנציג מעביר.
  //
  // ⚠️ החישוב **אחרי** לולאת ההזמנות: agentPayments נשלף
  // למעלה, וזו הנקודה הראשונה שבה שניהם זמינים.
  const cashHandedToAdmin = Object.values(agentCollectedMap).reduce(
    (a, b) => a + b,
    0
  );

  const r2 = (n: number) => Math.round(n * 100) / 100;
  collectedCard = r2(collectedCard);
  collectedCash = r2(collectedCash);
  pendingCollection = r2(pendingCollection);
  const totalCollected = r2(collectedCard + collectedCash);
  // ⚠️ Math.max(0): אם נציג העביר יותר ממה שנרשם שאסף (טעות
  // הזנה), המספר לא הופך שלילי - זה היה נראה כמו באג.
  const cashWithAgents = r2(Math.max(0, collectedCash - cashHandedToAdmin));
  const cashReceivedFromAgents = r2(cashHandedToAdmin);
  const totalCommissions = agentsReport.reduce((s, a) => s + a.totalCommission, 0);
  const netRevenue = totalRevenue - totalCommissions;

  // §116: הרווח האמיתי - אחרי הספק **וגם** אחרי העמלות.
  //
  // netRevenue נשאר כפי שהיה (הכנסות פחות עמלות) כדי לא לשבור
  // תצוגות קיימות, אבל הוא **אינו רווח** ולא ראוי להציגו ככזה.
  const totalSupplierCost = productComparison.reduce((s, p) => s + p.totalCost, 0);
  const grossProfit = totalRevenue - totalSupplierCost;
  // ⚠️ הזיכויים מנוכים מהרווח: totalOrderRevenue מסתמך על
  // finalPrice של הפריטים, שאינו יודע על זיכוי ברמת ההזמנה.
  const netProfit =
    Math.round(
      (grossProfit - totalCommissions - totalCredits - totalBalanceApplied) * 100
    ) / 100;

  // ⚠️ אמין רק אם הוזנה עלות לכל מוצר שהגיע. אחרת הרווח מנופח,
  // והמנהל עלול להסיק מסקנה עסקית שגויה על סמך מספר חלקי.
  // §232: 🐛 costComplete היה true גם כשרוב המוצרים בלי תעודה.
  //
  // הבדיקה הישנה סיננה למוצרים ש**יש להם תעודה** ואז בדקה שלכולם
  // יש עלות. כלומר: 10 מוצרים הוזמנו, 3 קיבלו תעודה, לשלושתם יש
  // עלות → costComplete=true, והרווח הוצג כשלם.
  //
  // בפועל 7 מוצרים ללא עלות ספק כלל, והרווח מנופח בדיוק כמו
  // שהיה לפני שהתחלנו לקלוט תעודות.
  //
  // ⚠️ עכשיו שני תנאים: לכל מוצר שהוזמן יש תעודה, **וגם** לכל
  // אחד מהם יש עלות. אחד בלי השני לא מספיק.
  const withNotes = productComparison.filter((p) => p.receivedWeight > 0);

  // ⚠️ "רלוונטי" = חולק בפועל. מוצר במחירון שאיש לא הזמין אינו
  // עולה כסף, וספירה שלו הייתה חוסמת את הרווח לנצח.
  //
  // ⚠️ distributedWeight ולא orderedWeight: מה שחולק הוא מה
  // שבאמת יצא מהמלאי, וזה מה שהספק חייב לספק. הזמנה שבוטלה
  // אינה עלות.
  const missingNotes = productComparison.filter(
    (p) => p.distributedWeight > 0 && !(p.receivedWeight > 0)
  );

  const costComplete =
    withNotes.length > 0 &&
    missingNotes.length === 0 &&
    withNotes.every((p) => p.costPerKg != null && !p.costPartial);

  // ⚠️ שתי סיבות שונות לחוסר, ולכן שתי רשימות: "אין תעודה" דורש
  // לצלם תעודה, "אין עלות" דורש להזין מספר. הודעה אחת שמערבבת
  // אותן שולחת את המנהל לפעולה הלא נכונה.
  const missingCostProducts = withNotes
    .filter((p) => p.costPerKg == null || p.costPartial)
    .map((p) => p.productName);
  const missingNoteProducts = missingNotes.map((p) => p.productName);

  // §207: כמה הזמנות נוספו אחרי שעת הסגירה.
  //
  // ⚠️ count ולא findMany: המסך צריך רק מספר, כדי להחליט אם
  // להציג את כפתור התוספות. שליפת השורות עצמן היא סיבוב מיותר
  // למסד באירלנד.
  //
  // ⚠️ **אחרי** בדיקת ה-null: pricelist מובטח כאן, וזה מה
  // שהכשיל את ה-build כשהקוד ישב בתוך ה-guard.
  const afterCloseCount = pricelist.closeDate
    ? await prisma.order.count({
        where: {
          pricelistId,
          status: { notIn: ["CANCELLED"] },
          createdAt: { gt: pricelist.closeDate },
        },
      })
    : 0;

  // §282: רשימת הנקודות שיש בהן הזמנות — לבורר ההדפסה.
  //
  // ⚠️ נבנית מההזמנות ולא מטבלת הנקודות: המנהל צריך להדפיס רק
  // איפה שיש מה לחלק, ונקודה ריקה בבורר היא לחיצה מבוזבזת.
  // §293: הפירוק כולל גם **כמה נגבה** מכל נקודה.
  //
  // הבעיה מהשטח: חברת האשראי מעבירה סכום אחד לכל הנקודות, והמנהל
  // לא יודע כמה מזה ברכפלד. הסה״כ בבקרת המכירה (§239) אומר כמה
  // נכנס בסך הכל - ולא איפה.
  //
  // ⚠️ אותו חישוב של /admin/agent-debts (§292), רק שכאן הוא לפי
  // המכירה הנוכחית ולא לפי כל ההיסטוריה.
  const pointsWithOrders = Array.from(
    orders.reduce((map, o) => {
      if (!o.pointId) return map;
      if (!map.has(o.pointId)) {
        map.set(o.pointId, {
          id: o.pointId,
          name: o.point?.name || o.pointNameSnapshot || "נקודה",
          count: 0,
          collected: 0,
          card: 0,
          cash: 0,
          pending: 0,
        });
      }
      const e = map.get(o.pointId)!;
      e.count++;

      const paid = Number(o.amountPaid ?? 0);
      const due = Number(o.finalTotal ?? o.estimatedTotal ?? 0);
      if (o.paymentStatus === "PAID") {
        const actual = paid > 0 ? paid : due;
        e.collected += actual;
        // §293: הפרדה בין אשראי למזומן — כמו ב-§239 וב-§292.
        //
        // ⚠️ למה זה חשוב דווקא כאן: המנהל מסתכל על הנקודה כדי
        // להצליב מול מה שחברת האשראי העבירה. מזומן שנספר יחד
        // מנפח את מה שכביכול הגיע מהבנק, וההצלבה נשברת.
        //
        // ⚠️ CASH **וגם** MANUAL: סימון הנציג (§130) שומר
        // MANUAL, וספירה שלו כאשראי הייתה אותה טעות בדיוק.
        if (o.paymentMethod === "CASH" || o.paymentMethod === "MANUAL") {
          e.cash += actual;
        } else {
          e.card += actual;
        }
      } else {
        e.pending += due;
      }
      return map;
    }, new Map<string, { id: string; name: string; count: number; collected: number; card: number; cash: number; pending: number }>())
      .values()
  )
    .map((p) => ({
      ...p,
      collected: Math.round(p.collected * 100) / 100,
      card: Math.round(p.card * 100) / 100,
      cash: Math.round(p.cash * 100) / 100,
      pending: Math.round(p.pending * 100) / 100,
    }))
    .sort((a, b) => a.name.localeCompare(b.name, "he"));

  return NextResponse.json({
    pricelist: {
      id: pricelist.id,
      name: pricelist.name,
      status: pricelist.status,
      deliveryDate: pricelist.deliveryDate?.toISOString() || null,
      deliveryDateText: pricelist.deliveryDateText,
      closeDate: pricelist.closeDate?.toISOString() || null,
    },
    // §207: לכפתור התוספות אחרי סגירה
    afterCloseCount,
    // §282: לבורר ההדפסה לפי נקודה
    pointsWithOrders,
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
      // §124: זיכויים - כסף שלא נכנס
      totalCredits,
      // §239: מה שנגבה בפועל, לפי אמצעי תשלום
      collectedCard,
      collectedCash,
      totalCollected,
      // §240: פירוט המזומן - אצל הנציגים מול מה שכבר הועבר
      cashWithAgents,
      cashReceivedFromAgents,
      pendingCollection,
      paidOrdersCount,
      totalBalanceApplied,
      // §116: עלות הספק והרווח בפועל
      totalSupplierCost,
      grossProfit,
      netProfit,
      costComplete,
      missingCostProducts,
      // §232: מוצרים שהוזמנו ואין להם תעודת משלוח כלל
      missingNoteProducts,
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
