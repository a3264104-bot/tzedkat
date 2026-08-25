import { NextResponse } from "next/server";
// §243: מקור אמת יחיד לסכום הזמנה
import { orderGrandTotal } from "@/lib/pricing";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/guard";

// סיכום מכירה מרוכז למנהל:
// - כמה הוזמן מכל מוצר (לדעת כמה להזמין מהספק)
// - התראות על מוצרים מוגבלים שמתקרבים/עברו את המכסה
// - פירוט לפי נקודת חלוקה (לרשימות איסוף)
// - סיכום תשלומים
export async function GET(req: Request) {
  const g = await requireAdmin();
  if (!g.ok) return g.res;

  const { searchParams } = new URL(req.url);
  const pricelistIdParam = searchParams.get("pricelistId");

  // §252: סינון לפי נקודות חלוקה.
  //
  // התרחיש מהשטח: שתי נקודות טרם שודרו לספק, והשאר כן. המנהל
  // צריך **סיכום מלא** לשתיים ו**תוספות בלבד** לשאר - ואין דרך
  // לקבל את זה בקובץ אחד.
  //
  // ⚠️ הפתרון: מוריד פעמיים, כל פעם עם נקודות אחרות. פשוט יותר
  // מקובץ אחד עם שתי עמודות, והמנהל שולט בדיוק במה שהוא מקבל.
  //
  // ⚠️ ריק = כל הנקודות. ברירת מחדל שמורה על ההתנהגות הקיימת.
  const pointIdsParam = (searchParams.get("pointIds") || "").trim();
  const pointFilter = pointIdsParam
    ? pointIdsParam.split(",").filter(Boolean)
    : null;

  // §214: 🐛 המסך ננעל ברגע שהמכירה נסגרה.
  //
  // ברירת המחדל הייתה `status: "ACTIVE"` בלבד, ולכן דווקא ברגע
  // שסוגרים חשבונות - כשצריך את הסיכום הכספי ואת תכנון ההזמנה
  // לספק - המסך הציג "אין מכירה פעילה".
  //
  // ⚠️ הסדר: פעילה קודם, ואם אין - האחרונה שנסגרה. כך המנהל
  // שנכנס באמצע מכירה רואה אותה, ומי שנכנס אחריה רואה את מה
  // שהוא בא לסכם, בלי לבחור ידנית.
  //
  // ⚠️ DONE נכללת: מכירה שהסתיימה לגמרי עדיין צריכה להיות
  // נגישה לדוחות ולבירורים חודשים אחרי.
  const pricelist = pricelistIdParam
    ? await prisma.pricelist.findUnique({ where: { id: pricelistIdParam } })
    : ((await prisma.pricelist.findFirst({
        where: { status: "ACTIVE" },
        orderBy: { createdAt: "desc" },
      })) ??
      (await prisma.pricelist.findFirst({
        where: { status: { in: ["CLOSED", "DONE"] } },
        orderBy: { createdAt: "desc" },
      })));

  if (!pricelist) {
    return NextResponse.json(
      { error: "לא נמצאה מכירה במערכת" },
      { status: 404 }
    );
  }

  // §214: רשימת המכירות לבורר במסך.
  //
  // ⚠️ נשלחת יחד עם הנתונים ולא בקריאה נפרדת: המסך צריך אותה
  // בכל טעינה, וקריאה שנייה למסד באירלנד היא 2-3 שניות מיותרות.
  const allSales = await prisma.pricelist.findMany({
    where: { status: { in: ["ACTIVE", "CLOSED", "DONE"] } },
    orderBy: { createdAt: "desc" },
    take: 12,
    select: { id: true, name: true, status: true },
  });

  // כל ההזמנות של המכירה (לא מבוטלות), עם פריטים ונקודה
  const orders = await prisma.order.findMany({
    where: {
      pricelistId: pricelist.id,
      status: { not: "CANCELLED" },
      // §252: ⚠️ הסינון **בשליפה** ולא אחריה: הסכומים והכמויות
      // נבנים מהתוצאה, וסינון מאוחר היה מותיר אותם שגויים.
      ...(pointFilter ? { pointId: { in: pointFilter } } : {}),
    },
    include: {
      items: { include: { product: { select: { id: true, limitedQty: true, limitedQtyAmount: true, saleType: true, priceType: true, singlesMode: true, unit: true } } } },
      point: { select: { id: true, name: true, city: true } },
    },
    orderBy: { orderNumber: "asc" },
  });

  // ===== אגרגציה לפי מוצר =====
  type ProductAgg = {
    productId: string;
    productName: string;
    unit: string;
    totalQuantity: number;
    singlesQuantity: number;
    unitsQuantity: number;
    totalEstimatedWeight: number;
    totalActualWeight: number;
    orderCount: number;
    limitedQty: boolean;
    limitedQtyAmount: number | null;
  };
  const byProduct = new Map<string, ProductAgg>();

  // ===== אגרגציה לפי נקודה =====
  type PointAgg = {
    pointId: string;
    pointName: string;
    city: string | null;
    orderCount: number;
    paidCount: number;
    estimatedTotal: number;
    finalTotal: number;
    orders: {
      orderNumber: number;
      customerName: string;
      phone: string;
      status: string;
      paymentStatus: string;
      itemCount: number;
      finalTotal: number | null;
      estimatedTotal: number;
      items: { productName: string; quantity: number; unit: string; isSingle: boolean }[];
    }[];
  };
  const byPoint = new Map<string, PointAgg>();

  // ===== סיכום תשלומים =====
  const paymentSummary = {
    totalOrders: orders.length,
    paid: 0,
    pending: 0,
    estimatedSum: 0,
    finalSum: 0,
    paidSum: 0,
  };

  for (const o of orders) {
    // §243: 🐛 estimatedTotal בלבד — בלי משלוח וחיובים.
    //
    // הוא נשמר ברגע ההזמנה, ומשלוח/חיוב/זיכוי נוספים אחר כך.
    // התוצאה: הסיכום הראה ₪358,684 ובקרת המכירה ₪358,929.
    paymentSummary.estimatedSum += orderGrandTotal(o);
    if (o.finalTotal != null) paymentSummary.finalSum += Number(o.finalTotal);
    if (o.paymentStatus === "PAID") {
      paymentSummary.paid++;
      paymentSummary.paidSum += Number(o.amountPaid ?? o.finalTotal ?? 0);
    } else {
      paymentSummary.pending++;
    }

    // מוצרים
    for (const it of o.items) {
      const key = it.productId;
      let agg = byProduct.get(key);
      if (!agg) {
        agg = {
          productId: it.productId,
          productName: it.productName,
          unit: it.unit,
          totalQuantity: 0,
          singlesQuantity: 0,
          // §53: יחידות ארוזות בנפרד מקרטונים.
          // 🐛 הבאג: cartonsOnly חושב כ-totalQuantity פחות
          // singlesQuantity, ולכן מוצר ארוז שנמכר ביחידות ("בקר טחון
          // 500 ג'") נספר כקרטון והוצג כ"2 קרטונים" בסיכום.
          unitsQuantity: 0,
          totalEstimatedWeight: 0,
          totalActualWeight: 0,
          orderCount: 0,
          limitedQty: it.product?.limitedQty ?? false,
          limitedQtyAmount: it.product?.limitedQtyAmount ?? null,
        };
        byProduct.set(key, agg);
      }
      agg.totalQuantity += Number(it.quantity);
      if (it.isSingle) {
        // בודדים במצב UNITS הם יחידות, לא ק"ג
        if (it.product?.singlesMode === "UNITS") {
          agg.unitsQuantity += Number(it.quantity);
        } else {
          agg.singlesQuantity += Number(it.quantity);
        }
      } else {
        // מוצר ארוז (unit שאינו קרטון/ק"ג) נספר כיחידות ולא כקרטון
        const u = (it.unit || "").trim();
        if (u && u !== "קרטון" && u !== 'ק"ג') {
          agg.unitsQuantity += Number(it.quantity);
        }
      }
      if (it.estimatedWeight != null) agg.totalEstimatedWeight += Number(it.estimatedWeight);
      // 🐛 תוקן: המקור היה finalWeight - שדה תאימות-לאחור שלא תמיד מתעדכן
      // כשהמנהל מתקן משקל בביקורת המשקלים (שם מתעדכן actualWeight).
      // actualWeight הוא המשקל שנמסר בפועל וחויב עליו; finalWeight נשאר
      // כנפילה לרשומות ישנות בלבד.
      const actualW =
        it.actualWeight != null
          ? Number(it.actualWeight)
          : it.finalWeight != null
            ? Number(it.finalWeight)
            : null;
      if (actualW != null) agg.totalActualWeight += actualW;
      agg.orderCount++;
    }

    // נקודות
    const pKey = o.pointId;
    let pAgg = byPoint.get(pKey);
    if (!pAgg) {
      pAgg = {
        pointId: o.pointId,
        pointName: o.point?.name ?? o.pointNameSnapshot ?? "",
        city: o.point?.city ?? null,
        orderCount: 0,
        paidCount: 0,
        estimatedTotal: 0,
        finalTotal: 0,
        orders: [],
      };
      byPoint.set(pKey, pAgg);
    }
    pAgg.orderCount++;
    if (o.paymentStatus === "PAID") pAgg.paidCount++;
    pAgg.estimatedTotal += Number(o.estimatedTotal);
    if (o.finalTotal != null) pAgg.finalTotal += Number(o.finalTotal);
    pAgg.orders.push({
      orderNumber: o.orderNumber,
      customerName: o.customerName,
      phone: o.phone,
      status: o.status,
      paymentStatus: o.paymentStatus,
      itemCount: o.items.length,
      finalTotal: o.finalTotal != null ? Number(o.finalTotal) : null,
      estimatedTotal: Number(o.estimatedTotal),
      items: o.items.map((it) => ({
        productName: it.productName,
        quantity: Number(it.quantity),
        unit: it.unit,
        isSingle: it.isSingle,
      })),
    });
  }

  // עיגולים + התראות מלאי מוגבל
  const products = Array.from(byProduct.values())
    .map((p) => {
      const overLimit =
        p.limitedQty && p.limitedQtyAmount != null && p.totalQuantity >= p.limitedQtyAmount;
      const nearLimit =
        p.limitedQty &&
        p.limitedQtyAmount != null &&
        !overLimit &&
        p.totalQuantity >= p.limitedQtyAmount * 0.8;
      return {
        ...p,
        totalQuantity: Math.round(p.totalQuantity * 1000) / 1000,
        totalEstimatedWeight: Math.round(p.totalEstimatedWeight * 1000) / 1000,
        totalActualWeight: Math.round(p.totalActualWeight * 1000) / 1000,
        overLimit,
        nearLimit,
      };
    })
    .sort((a, b) => b.totalQuantity - a.totalQuantity);

  const points = Array.from(byPoint.values())
    .map((p) => ({
      ...p,
      estimatedTotal: Math.round(p.estimatedTotal * 100) / 100,
      finalTotal: Math.round(p.finalTotal * 100) / 100,
    }))
    .sort((a, b) => a.pointName.localeCompare(b.pointName, "he"));

  paymentSummary.estimatedSum = Math.round(paymentSummary.estimatedSum * 100) / 100;
  paymentSummary.finalSum = Math.round(paymentSummary.finalSum * 100) / 100;
  paymentSummary.paidSum = Math.round(paymentSummary.paidSum * 100) / 100;

  return NextResponse.json({
    // §214: לבורר המכירות במסך
    allSales,
    pricelistStatus: pricelist.status,
    pricelist: {
      id: pricelist.id,
      name: pricelist.name,
      deliveryDateText: pricelist.deliveryDateText,
      status: pricelist.status,
    },
    paymentSummary,
    products,
    points,
  });
}
