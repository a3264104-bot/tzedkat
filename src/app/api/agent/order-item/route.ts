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

  // הזמנה שכבר נקבע לה מחיר סופי - הוספה כאן תיצור פער בין הסכום
  // שנקבע לבין הפריטים בפועל, והלקוח יחויב בסכום שאינו תואם את
  // מה שקיבל. חוסמים במפורש במקום להשאיר סתירה שקטה.
  if (order.finalTotal != null) {
    return NextResponse.json(
      {
        error:
          "להזמנה כבר נקבע מחיר סופי. יש לפנות למנהל להוספת פריט ולחישוב מחדש.",
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
  const estimatedPrice = isSingle
    ? Math.round(unitPrice * quantity * 100) / 100
    : smartLineEstimate(
        unitPrice,
        quantity,
        product.saleType,
        product.priceType,
        product.avgWeightPerUnit != null ? Number(product.avgWeightPerUnit) : null
      ) ?? Math.round(unitPrice * quantity * 100) / 100;

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
      unitPrice,
      estimatedPrice,
      estimatedWeight,
      // תיעוד מי הוסיף. agentEnteredById הוא שדה קיים ומשמש גם
      // לשקילה - אין כאן שדה ייעודי, והוספת אחד הייתה גוררת
      // מיגרציה נוספת עבור מידע שכבר נשמר.
      agentEnteredById: g.agent.id,
      // הערת מערכת: פריט שנוסף אחרי יצירת ההזמנה. חשוב שיהיה גלוי -
      // אחרת הלקוח מקבל בחלוקה משהו שלא הזמין, ואיש לא יודע ממי זה בא.
      agentNote: `נוסף ע"י ${g.agent.name}`,
    },
    select: { id: true },
  });

  // עדכון הסכום המשוער של ההזמנה. finalTotal לא נוגעים - הוא null
  // כאן בהכרח (נחסם למעלה), וייקבע בשקילה.
  const items = await prisma.orderItem.findMany({
    where: { orderId: order.id, isCancelled: false },
    select: { estimatedPrice: true },
  });
  const itemsSum = items.reduce((s, i) => s + Number(i.estimatedPrice), 0);
  const plFee = await prisma.pricelist.findUnique({
    where: { id: order.pricelistId },
    select: { orderFee: true },
  });
  const estimatedTotal =
    Math.round((itemsSum + Number(plFee?.orderFee ?? 0)) * 100) / 100;

  await prisma.order.update({
    where: { id: order.id },
    data: { estimatedTotal },
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
