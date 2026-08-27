// §65: הוספת פריט להזמנה קיימת ע"י נציג (סעיפים 4 ו-7).
//
// POST /api/agent/order-item
// Body: { orderId, productId, quantity, isSingle }
//
// ═══════════════════════════════════════════════════════════════
// למה route חדש
// ═══════════════════════════════════════════════════════════════
// /api/agent/order-item/[id] הוא PATCH על פריט *קיים* בלבד - משקל,
// הערה, ביטול, החלפת מוצר. לא הייתה שום דרך לנציג להוסיף פריט
// חדש להזמנה, בשונה מהמנהל שכן יכול.
//
// ═══════════════════════════════════════════════════════════════
// המחיר מחושב בשרת ולא מתקבל מהקליינט
// ═══════════════════════════════════════════════════════════════
// זה שינוי מכוון לעומת מסלול המנהל. הקליינט שולח רק *מה* להוסיף
// וכמה; unitPrice נגזר כאן מהמחירון. אחרת נציג יכול לשלוח מחיר
// שרירותי ולהוזיל לעצמו את העמלה או את חיוב הלקוח.
//
// המחיר נלקח מ-PricelistProduct (המחיר של המכירה הזו) ולא מ-
// Product.cartonPrice, כדי שהתמחור יהיה זהה למה שהלקוח רואה באתר.

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAgent } from "@/lib/agent-guard";
import { effectiveUnitPrice, smartLineEstimate } from "@/lib/pricing";
// §119: ולידציה של מחיר שהנציג קובע במוצר מועדף
import { validateAgentPrice } from "@/lib/commission-lib";

export async function POST(req: Request) {
  const g = await requireAgent();
  if (!g.ok) return g.res;

  const body = await req.json().catch(() => ({}));
  const orderId = String(body.orderId || "").trim();
  const productId = String(body.productId || "").trim();
  const isSingle = !!body.isSingle;
  const quantity = Number(body.quantity);

  if (!orderId || !productId) {
    return NextResponse.json({ error: "חסרים נתונים" }, { status: 400 });
  }
  if (!Number.isFinite(quantity) || quantity <= 0) {
    return NextResponse.json({ error: "כמות לא תקינה" }, { status: 400 });
  }

  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: {
      id: true,
      pointId: true,
      pricelistId: true,
      status: true,
      finalTotal: true,
      // §300: מצב התשלום — הוא הקובע אם מותר להוסיף, לא finalTotal
      paymentStatus: true,
    },
  });
  if (!order) {
    return NextResponse.json({ error: "הזמנה לא נמצאה" }, { status: 404 });
  }

  // בדיקת שייכות. ⚠️ agentPointIds ריק משמעו "בלי הגבלה" **רק אצל
  // מנהל** - אצל נציג, מערך ריק פירושו שאין לו נקודות בכלל, והוא
  // נחסם. בלי ההבחנה הזו נציג בלי נקודות היה עוקף את הבדיקה כולה
  // ומוסיף פריטים לכל הזמנה במערכת (דפוס ג').
  if (!g.isAdmin) {
    if (g.agentPointIds.length === 0) {
      return NextResponse.json(
        { error: "אין לך נקודת חלוקה משויכת. פנה למנהל." },
        { status: 403 }
      );
    }
    if (!g.agentPointIds.includes(order.pointId)) {
      return NextResponse.json(
        { error: "אין הרשאה - ההזמנה לא באחת מהנקודות שלך" },
        { status: 403 }
      );
    }
  }

  if (order.status === "COMPLETED" || order.status === "CANCELLED") {
    return NextResponse.json(
      { error: "לא ניתן להוסיף פריט להזמנה שהושלמה או בוטלה" },
      { status: 400 }
    );
  }

  // §300: 🐛 **החסימה על finalTotal חסמה בדיוק את מי שצריך.**
  //
  // המצב מהשטח: הנציג בחלוקה, ההזמנה נשקלה (ולכן יש finalTotal),
  // והלקוח מבקש עוד קילו. הוא מוסיף - ונחסם עם "יש לפנות למנהל".
  //
  // ⚠️ החשש המקורי היה נכון: פער בין הסכום שנקבע לפריטים בפועל
  // אומר שהלקוח יחויב על מה שלא קיבל.
  //
  // ⚠️ אבל הפתרון אינו חסימה אלא **חישוב מחדש** - וזה מה שקורה
  // עכשיו בסוף הפונקציה.
  //
  // ⚠️ מה שכן נשאר חסום: הזמנה **ששולמה**. שם הכסף כבר נגבה,
  // והוספה הייתה יוצרת חוב שקט שאיש לא יודע עליו. ההודעה מפנה
  // לפתרון הנכון - חיוב נוסף או זיכוי, שני פאנלים שקיימים במסך.
  if (
    order.paymentStatus === "PAID" ||
    order.paymentStatus === "PARTIALLY_PAID" ||
    order.paymentStatus === "CHARGING"
  ) {
    return NextResponse.json(
      {
        error:
          "ההזמנה כבר חויבה. להוספת פריט יש להשתמש ב\"חיוב נוסף\" או לפנות למנהל.",
      },
      { status: 400 }
    );
  }

  if (!order.pricelistId) {
    return NextResponse.json(
      { error: "ההזמנה אינה משויכת למכירה" },
      { status: 400 }
    );
  }

  // ─── המוצר והמחיר, מהמחירון של ההזמנה ───
  // §7: מוצר לא-פעיל **מותר** להוספה כאן במכוון. הוא מסונן מהאתר
  // כדי שלא יוצג לכל הלקוחות, אבל זו בדיוק המטרה - פרימיום או כמות
  // מוגבלת שהנציג מחליט למי להביא.
  const pp = await prisma.pricelistProduct.findUnique({
    where: {
      pricelistId_productId: { pricelistId: order.pricelistId, productId },
    },
    include: {
      product: {
        select: {
          id: true,
          name: true,
          unit: true,
          cartonPrice: true,
          saleType: true,
          priceType: true,
          allowSingles: true,
          singlesMode: true,
          singleUnitPrice: true,
          avgWeightPerUnit: true,
          isActive: true,
          // §119: רק במוצר מועדף מותר לנציג לקבוע מחיר
          isFavorite: true,
        },
      },
    },
  });

  if (!pp) {
    return NextResponse.json(
      { error: "המוצר אינו נכלל במכירה הזו ולכן אין לו מחיר" },
      { status: 400 }
    );
  }

  const product = pp.product;

  if (isSingle && !product.allowSingles) {
    return NextResponse.json(
      { error: `המוצר "${product.name}" אינו נמכר בבודדים` },
      { status: 400 }
    );
  }

  const pricelist = await prisma.pricelist.findUnique({
    where: { id: order.pricelistId },
    select: { singleSurcharge: true },
  });

  const basePrice = Number(pp.price ?? product.cartonPrice);
  const unitPrice = effectiveUnitPrice(
    basePrice,
    isSingle,
    Number(pricelist?.singleSurcharge ?? 0),
    product.singlesMode || "KG",
    product.singleUnitPrice != null ? Number(product.singleUnitPrice) : null
  );

  // אותה הערכה כמו באתר: מוצר שנשקל מוערך לפי משקל ממוצע, בודדים
  // בק"ג מחושבים ישירות.
  // ═══════════════════════════════════════════════════════════
  // §119: מחיר שהנציג קבע - מוצר מועדף בלבד
  // ═══════════════════════════════════════════════════════════
  // הכלל: הנציג רשאי להעלות את המחיר, וההפרש מ"רצפת הנציג"
  // (המחירון פחות השקל שתמיד שלו) שייך לו במלואו.
  //
  // ⚠️ שתי הגנות שנאכפות **בשרת** ולא רק בממשק:
  //   1. רק מוצר מועדף - אחרת נציג היה מייקר כל מוצר במכירה
  //   2. העלאה בלבד - הורדה פוגעת בהכנסה ומייצרת עמלה שלילית
  let agentSetPrice: number | null = null;
  if (body.agentSetPrice !== null && body.agentSetPrice !== undefined && body.agentSetPrice !== "") {
    if (!product.isFavorite) {
      return NextResponse.json(
        { error: "ניתן לקבוע מחיר מותאם רק במוצר מועדף" },
        { status: 400 }
      );
    }
    const n = Number(body.agentSetPrice);
    const v = validateAgentPrice(n, unitPrice);
    if (!v.ok) return NextResponse.json({ error: v.error }, { status: 400 });
    agentSetPrice = n;
  }

  // ⚠️ הלקוח מחויב לפי המחיר שהנציג קבע, ולא לפי המחירון. זו כל
  // הנקודה: הנציג מכר לו ב-139.90, וזה מה שהוא ישלם.
  const chargedPrice = agentSetPrice ?? unitPrice;

  const estimatedPrice = isSingle
    ? Math.round(chargedPrice * quantity * 100) / 100
    : smartLineEstimate(
        chargedPrice,
        quantity,
        product.saleType,
        product.priceType,
        product.avgWeightPerUnit != null ? Number(product.avgWeightPerUnit) : null
      ) ?? Math.round(chargedPrice * quantity * 100) / 100;

  const estimatedWeight =
    !isSingle && product.avgWeightPerUnit != null
      ? Math.round(Number(product.avgWeightPerUnit) * quantity * 100) / 100
      : null;

  const created = await prisma.orderItem.create({
    data: {
      orderId: order.id,
      productId: product.id,
      productName: product.name,
      // בודדים בק"ג נשמרים ביחידת ק"ג; אחרת יחידת המוצר
      unit: isSingle && product.singlesMode !== "UNITS" ? 'ק"ג' : product.unit,
      isSingle,
      quantity,
      // ⚠️ unitPrice נשאר **מחיר המחירון** - הוא הבסיס לחישוב
      // העמלה. המחיר שנגבה בפועל יושב ב-agentSetPrice, ובלי
      // ההפרדה הזו אי אפשר לחשב כמה מגיע לנציג.
      unitPrice,
      agentSetPrice,
      estimatedPrice,
      estimatedWeight,
      // תיעוד מי הוסיף. agentEnteredById הוא שדה קיים ומשמש גם
      // לשקילה - אין כאן שדה ייעודי, והוספת אחד הייתה גוררת
      // מיגרציה נוספת עבור מידע שכבר נשמר.
      agentEnteredById: g.agent.id,
      // הערת מערכת: פריט שנוסף אחרי יצירת ההזמנה. חשוב שיהיה גלוי -
      // אחרת הלקוח מקבל בחלוקה משהו שלא הזמין, ואיש לא יודע ממי זה בא.
      agentNote:
        `נוסף ע"י ${g.agent.name}` +
        (agentSetPrice != null
          ? ` · מחיר שנקבע: ${agentSetPrice.toFixed(2)} (מחירון ${unitPrice.toFixed(2)})`
          : ""),
    },
    select: { id: true },
  });

  // עדכון הסכום המשוער של ההזמנה.
  const items = await prisma.orderItem.findMany({
    where: { orderId: order.id, isCancelled: false },
    select: { estimatedPrice: true, finalPrice: true },
  });
  const itemsSum = items.reduce((s, i) => s + Number(i.estimatedPrice), 0);
  const plFee = await prisma.pricelist.findUnique({
    where: { id: order.pricelistId },
    select: { orderFee: true },
  });
  const orderFee = Number(plFee?.orderFee ?? 0);
  const estimatedTotal = Math.round((itemsSum + orderFee) * 100) / 100;

  // §300: 🧮 **חישוב מחדש של המחיר הסופי.**
  //
  // ההזמנה כבר נשקלה, ולכן finalTotal קיים. הוספת פריט בלי
  // לעדכן אותו הייתה יוצרת בדיוק את הפער שהחסימה הישנה חששה
  // ממנו: הלקוח מחויב על מה שלא קיבל.
  //
  // ⚠️ רק כשכל הפריטים נשקלו: פריט חדש שטרם נשקל (finalPrice
  // ריק) אומר שהסכום עוד לא סופי, ואיפוס ל-null הוא הנכון -
  // הוא מחזיר את ההזמנה למצב "ממתינה לשקילה", שזה בדיוק מה
  // שהיא.
  const allWeighed =
    items.length > 0 && items.every((i) => i.finalPrice !== null);

  let newFinalTotal: number | null = null;
  if (allWeighed) {
    const finalSum = items.reduce((s, i) => s + Number(i.finalPrice ?? 0), 0);
    // ⚠️ אותם רכיבים של recomputeOrderTotal: משלוח, חיוב נוסף
    // וזיכוי משפיעים על הסכום ואסור לאבד אותם.
    const full = await prisma.order.findUnique({
      where: { id: order.id },
      select: {
        deliveryRequested: true,
        deliveryFee: true,
        extraCharge: true,
        creditAmount: true,
        appliedCreditBalance: true,
      },
    });
    const dlv =
      full?.deliveryRequested && full.deliveryFee != null
        ? Number(full.deliveryFee)
        : 0;
    const extra = full?.extraCharge != null ? Number(full.extraCharge) : 0;
    const credit = full?.creditAmount != null ? Number(full.creditAmount) : 0;
    const bal =
      full?.appliedCreditBalance != null
        ? Number(full.appliedCreditBalance)
        : 0;
    newFinalTotal = Math.max(
      0,
      Math.round((finalSum + orderFee + dlv + extra - credit - bal) * 100) / 100
    );
  }

  await prisma.order.update({
    where: { id: order.id },
    data: {
      estimatedTotal,
      // ⚠️ null כשלא הכל נשקל — ההזמנה חוזרת ל"ממתינה לשקילה",
      // והנציג יראה את הפריט החדש בטבלה עם משבצת ריקה.
      finalTotal: newFinalTotal,
    },
  });

  console.log(
    `[agent-add-item] agent=${g.agent.id} added product=${productId} qty=${quantity} single=${isSingle} to order=${orderId}${product.isActive === false ? " (INACTIVE product)" : ""}`
  );

  return NextResponse.json({
    ok: true,
    itemId: created.id,
    unitPrice,
    estimatedPrice,
    estimatedTotal,
  });
}
