// ═══════════════════════════════════════════════════════════════
// §134: משלוח
// ═══════════════════════════════════════════════════════════════
// POST /api/agent/orders/[id]/delivery
// Body: { requested, fee, address, note }  ·  requested=false מבטל
//
// התרחיש: משלוח אינו שירות רשמי בתפריט. הלקוח מבקש בהערה (§133),
// הנציג רואה ומסמן - והסכום מתווסף לחיוב.
//
// ⚠️ העלות אינה קבועה - היא משתנה לפי עיר ומרחק, ולכן הנציג
// מזין אותה ידנית. טבלת מחירים הייתה דורשת תחזוקה שאיש לא יעשה.

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAgent } from "@/lib/agent-guard";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const g = await requireAgent();
  if (!g.ok) return g.res;

  const { id } = await params;
  const b = await req.json().catch(() => ({}));

  const order = await prisma.order.findUnique({
    where: { id },
    select: {
      id: true,
      orderNumber: true,
      pointId: true,
      paymentStatus: true,
      customerId: true,
      deliveryFee: true,
    },
  });
  if (!order) {
    return NextResponse.json({ error: "הזמנה לא נמצאה" }, { status: 404 });
  }

  // בדיקת שייכות. מערך ריק אצל נציג = אין נקודות, לא "בלי הגבלה".
  if (!g.isAdmin) {
    if (g.agentPointIds.length === 0) {
      return NextResponse.json(
        { error: "אין לך נקודת חלוקה משויכת" },
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

  // ⚠️ הזמנה ששולמה - דמי המשלוח לא ייגבו, כי החיוב כבר יצא.
  //
  // זה בדיוק הפער שיוצר חוב: הנציג מסמן, המערכת מציגה סכום גבוה
  // יותר, ובפועל לא נגבה כלום. עדיף לחסום ולהפנות לגבייה במזומן.
  if (order.paymentStatus === "PAID" || order.paymentStatus === "PARTIALLY_PAID") {
    return NextResponse.json(
      {
        error:
          "ההזמנה כבר שולמה, ולכן דמי משלוח לא ייגבו בכרטיס. יש לגבות במזומן או לפנות למנהל.",
      },
      { status: 400 }
    );
  }

  // ─── ביטול משלוח ───
  if (b.requested === false) {
    await prisma.order.update({
      where: { id },
      data: {
        deliveryRequested: false,
        deliveryFee: null,
        deliveryAddress: null,
        deliveryNote: null,
        deliverySetById: null,
        deliverySetAt: null,
      },
    });
    await recomputeTotal(id);
    return NextResponse.json({ ok: true, cleared: true });
  }

  // ─── ולידציה ───
  // ⚠️ הסכום הזה מתווסף לחיוב של הלקוח. ערך שגוי אינו "תצוגה
  // מכוערת" אלא חיוב שגוי בכרטיס אשראי.
  let fee: number | null = null;
  if (b.fee !== null && b.fee !== undefined && b.fee !== "") {
    const n = Number(b.fee);
    if (!Number.isFinite(n) || n < 0) {
      return NextResponse.json(
        { error: "דמי המשלוח חייבים להיות מספר חיובי" },
        { status: 400 }
      );
    }
    if (n > 500) {
      // תפיסת טעות הקלדה מובהקת
      return NextResponse.json(
        { error: "דמי המשלוח נראים גבוהים מדי. יש לוודא שלא נפלה טעות." },
        { status: 400 }
      );
    }
    fee = n;
  }

  const address = String(b.address ?? "").trim();
  if (!address) {
    return NextResponse.json(
      { error: "יש להזין כתובת למשלוח" },
      { status: 400 }
    );
  }
  if (address.length > 300) {
    return NextResponse.json({ error: "הכתובת ארוכה מדי" }, { status: 400 });
  }

  await prisma.order.update({
    where: { id },
    data: {
      deliveryRequested: true,
      // ⚠️ null נשמר כ-0 ולא כ-null: הנציג שסימן משלוח בלי סכום
      // התכוון "בלי חיוב", ולא "טרם קבעתי". null היה משאיר
      // אי-ודאות שאיש לא יחזור לפתור.
      deliveryFee: fee ?? 0,
      deliveryAddress: address,
      deliveryNote: b.note ? String(b.note).trim().slice(0, 300) : null,
      deliverySetById: g.agent.id,
      deliverySetAt: new Date(),
    },
  });

  const newTotal = await recomputeTotal(id);

  console.log(
    `[delivery] order #${order.orderNumber} fee=${fee ?? 0} by agent=${g.agent.id}`
  );

  return NextResponse.json({
    ok: true,
    deliveryFee: fee ?? 0,
    deliveryAddress: address,
    finalTotal: newTotal,
  });
}

/**
 * §134: חישוב מחדש של המחיר הסופי, כולל דמי משלוח.
 *
 * ⚠️ אותה נוסחה בדיוק כמו בשאר המקומות (§123/§124), עם תוספת
 * המשלוח. שלוש נוסחאות שונות היו מייצרות סכום שתלוי במי נגע
 * בהזמנה אחרון.
 *
 * הסדר: פריטים + דמי טיפול + משלוח − זיכוי − יתרת זכות.
 */
async function recomputeTotal(orderId: string): Promise<number | null> {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: {
      pricelistId: true,
      creditAmount: true,
      extraCharge: true,
      deliveryFee: true,
      deliveryRequested: true,
      customerId: true,
      appliedCreditBalance: true,
      items: { where: { isCancelled: false }, select: { finalPrice: true } },
    },
  });
  if (!order || order.items.length === 0) return null;
  if (!order.items.every((i) => i.finalPrice !== null)) return null;

  const itemsSum = order.items.reduce((s, i) => s + Number(i.finalPrice), 0);
  const pl = order.pricelistId
    ? await prisma.pricelist.findUnique({
        where: { id: order.pricelistId },
        select: { orderFee: true },
      })
    : null;

  const credit = order.creditAmount != null ? Number(order.creditAmount) : 0;
  const delivery =
    order.deliveryRequested && order.deliveryFee != null
      ? Number(order.deliveryFee)
      : 0;
  // §135: חיוב נוסף
  const extra = order.extraCharge != null ? Number(order.extraCharge) : 0;
  const balance =
    order.appliedCreditBalance != null ? Number(order.appliedCreditBalance) : 0;

  const total = Math.max(
    0,
    Math.round(
      (itemsSum + Number(pl?.orderFee ?? 0) + delivery + extra - credit - balance) * 100
    ) / 100
  );

  await prisma.order.update({
    where: { id: orderId },
    data: { finalTotal: total },
  });
  return total;
}

// ═══════════════════════════════════════════════════════════════
// §135: סימון שהמשלוח הגיע ליעד
// ═══════════════════════════════════════════════════════════════
// PATCH /api/agent/orders/[id]/delivery  { delivered, note? }
//
// ⚠️ נפרד מ-deliveredAt של ההזמנה: זה פירושו "הלקוח קיבל בנקודה",
// וכאן "המשלוח הגיע לביתו". בלי ההפרדה אי אפשר לדעת אילו משלוחים
// עוד בדרך - וזו כל המטרה של המעקב.
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const g = await requireAgent();
  if (!g.ok) return g.res;

  const { id } = await params;
  const b = await req.json().catch(() => ({}));

  const order = await prisma.order.findUnique({
    where: { id },
    select: {
      id: true,
      orderNumber: true,
      pointId: true,
      deliveryRequested: true,
    },
  });
  if (!order) {
    return NextResponse.json({ error: "הזמנה לא נמצאה" }, { status: 404 });
  }
  if (!order.deliveryRequested) {
    return NextResponse.json(
      { error: "ההזמנה אינה מסומנת למשלוח" },
      { status: 400 }
    );
  }

  if (!g.isAdmin) {
    if (g.agentPointIds.length === 0) {
      return NextResponse.json(
        { error: "אין לך נקודת חלוקה משויכת" },
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

  const delivered = b.delivered !== false;

  await prisma.order.update({
    where: { id },
    data: delivered
      ? {
          deliveredToCustomerAt: new Date(),
          deliveredById: g.agent.id,
          deliveryProofNote: b.note ? String(b.note).trim().slice(0, 300) : null,
        }
      : {
          // ביטול - טעות סימון קורית, וצריך דרך לתקן
          deliveredToCustomerAt: null,
          deliveredById: null,
          deliveryProofNote: null,
        },
  });

  console.log(
    `[delivery-done] order #${order.orderNumber} ${delivered ? "delivered" : "reopened"} by=${g.agent.id}`
  );

  return NextResponse.json({ ok: true, delivered });
}

// ═══════════════════════════════════════════════════════════════
// §135: חיוב נוסף
// ═══════════════════════════════════════════════════════════════
// PUT /api/agent/orders/[id]/delivery  { amount, reason }
//
// התמונה הראית של הזיכוי: הלקוח קיבל יותר ממה שהזמין, ביקש
// תוספת בחלוקה, או כל סיבה אחרת שמצדיקה חיוב מעבר לפריטים.
//
// ⚠️ למה כאן ולא ב-route נפרד: אותה משפחה של פעולות על הסכום,
// ואותה נוסחת חישוב. פיצול היה מייצר שתי נוסחאות שמתפצלות.
export async function PUT(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const g = await requireAgent();
  if (!g.ok) return g.res;

  const { id } = await params;
  const b = await req.json().catch(() => ({}));

  const order = await prisma.order.findUnique({
    where: { id },
    select: {
      id: true,
      orderNumber: true,
      pointId: true,
      paymentStatus: true,
    },
  });
  if (!order) {
    return NextResponse.json({ error: "הזמנה לא נמצאה" }, { status: 404 });
  }

  if (!g.isAdmin) {
    if (g.agentPointIds.length === 0) {
      return NextResponse.json(
        { error: "אין לך נקודת חלוקה משויכת" },
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

  // ⚠️ הזמנה ששולמה - החיוב לא ייגבה, כי הכרטיס כבר חויב.
  // אותו נימוק כמו במשלוח: עדיף לחסום מאשר להציג סכום שלא נגבה.
  if (order.paymentStatus === "PAID" || order.paymentStatus === "PARTIALLY_PAID") {
    return NextResponse.json(
      {
        error:
          "ההזמנה כבר שולמה. חיוב נוסף לא ייגבה בכרטיס - יש לגבות במזומן או לפנות למנהל.",
      },
      { status: 400 }
    );
  }

  // ─── ביטול ───
  if (b.amount === null || b.amount === undefined || b.amount === "") {
    await prisma.order.update({
      where: { id },
      data: {
        extraCharge: null,
        extraChargeReason: null,
        extraChargeById: null,
        extraChargeAt: null,
      },
    });
    await recomputeTotal(id);
    return NextResponse.json({ ok: true, cleared: true });
  }

  const amount = Number(b.amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    return NextResponse.json(
      { error: "סכום החיוב חייב להיות מספר חיובי" },
      { status: 400 }
    );
  }
  if (amount > 5000) {
    return NextResponse.json(
      { error: "הסכום נראה גבוה מדי. יש לוודא שלא נפלה טעות הקלדה." },
      { status: 400 }
    );
  }

  const reason = String(b.reason || "").trim();
  if (!reason) {
    return NextResponse.json(
      { error: "יש לציין את סיבת החיוב - הלקוח יראה אותה בפירוט" },
      { status: 400 }
    );
  }

  await prisma.order.update({
    where: { id },
    data: {
      extraCharge: amount,
      extraChargeReason: reason.slice(0, 200),
      extraChargeById: g.agent.id,
      extraChargeAt: new Date(),
    },
  });

  const newTotal = await recomputeTotal(id);

  console.log(
    `[extra-charge] order #${order.orderNumber} +${amount} by=${g.agent.id} reason="${reason}"`
  );

  return NextResponse.json({ ok: true, extraCharge: amount, finalTotal: newTotal });
}