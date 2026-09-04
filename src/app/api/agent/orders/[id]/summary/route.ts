// ═══════════════════════════════════════════════════════════════
// §359: פירוט ההזמנה לסיכום — למודל השליחה/הורדה
// ═══════════════════════════════════════════════════════════════
// GET /api/agent/orders/[id]/summary
//
// ⚠️ אותו פירוק של §308 (מייל) ו-§356 (אתר): פריטים, ואז דמי
// הזמנה, משלוח, חיוב נוסף, חוב — פחות זיכוי ויתרת זכות. שלושה
// מסכים, נוסחה אחת.
//
// ⚠️ GET ולא חלק מ-sale: המודל נפתח לפריט אחד, ואין טעם לטעון
// 244 הזמנות בשביל זה.

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAgent } from "@/lib/agent-guard";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const g = await requireAgent();
  if (!g.ok) return g.res;

  const { id } = await params;

  const order = await prisma.order.findUnique({
    where: { id },
    select: {
      id: true,
      orderNumber: true,
      pointId: true,
      agentClosedAt: true,
      finalTotal: true,
      estimatedTotal: true,
      deliveryRequested: true,
      deliveryFee: true,
      extraCharge: true,
      extraChargeReason: true,
      creditAmount: true,
      creditReason: true,
      appliedCreditBalance: true,
      appliedDebt: true,
      customer: { select: { email: true } },
      pricelist: { select: { orderFee: true } },
      items: {
        where: { isCancelled: false },
        select: {
          productName: true,
          quantity: true,
          unit: true,
          isSingle: true,
          actualWeight: true,
          finalPrice: true,
          estimatedPrice: true,
        },
      },
    },
  });
  if (!order) {
    return NextResponse.json({ error: "הזמנה לא נמצאה" }, { status: 404 });
  }

  // בדיקת שייכות — נציג רק בנקודותיו
  if (!g.isAdmin) {
    if (g.agentPointIds.length === 0 || !g.agentPointIds.includes(order.pointId)) {
      return NextResponse.json({ error: "אין הרשאה" }, { status: 403 });
    }
  }

  // §359: ⚠️ רק אחרי V — המסך מסתיר את הכפתור, אבל בקשה ידנית
  // עוקפת אותו. סיכום לפני שקילה הוא הסכום השגוי של 616.
  //
  // ⚠️ המנהל פטור: הוא יכול לשלוח גם לפני, מהמסך שלו (§303).
  if (!g.isAdmin && !order.agentClosedAt) {
    return NextResponse.json(
      { error: "יש לסמן את ההזמנה כטופלה לפני שליחת סיכום" },
      { status: 400 }
    );
  }

  const lines = order.items.map((it) => {
    const w = it.actualWeight != null ? Number(it.actualWeight) : null;
    return {
      label: it.productName + (it.isSingle ? " (בודדים)" : ""),
      qty:
        w != null
          ? `${w.toFixed(2)} ק"ג`
          : `${Number(it.quantity)} ${it.unit || ""}`.trim(),
      price: Number(it.finalPrice ?? it.estimatedPrice ?? 0),
    };
  });

  const itemsSum = lines.reduce((s, l) => s + l.price, 0);
  const dlv =
    order.deliveryRequested && order.deliveryFee != null
      ? Number(order.deliveryFee)
      : 0;
  const extra = order.extraCharge != null ? Number(order.extraCharge) : 0;
  const credit = order.creditAmount != null ? Number(order.creditAmount) : 0;
  const bal =
    order.appliedCreditBalance != null ? Number(order.appliedCreditBalance) : 0;
  const debt = order.appliedDebt != null ? Number(order.appliedDebt) : 0;
  const total = Number(order.finalTotal ?? order.estimatedTotal ?? 0);

  // ⚠️ דמי הטיפול נגזרים מההפרש — לא שדה על ההזמנה
  const fee =
    Math.round((total - (itemsSum + dlv + extra + debt - credit - bal)) * 100) /
    100;

  const extras: Array<{ label: string; amount: number; negative: boolean }> = [];
  if (Math.abs(fee) > 0.01)
    extras.push({ label: "דמי הזמנה", amount: Math.abs(fee), negative: fee < 0 });
  if (dlv > 0) extras.push({ label: "משלוח", amount: dlv, negative: false });
  if (extra > 0)
    extras.push({
      label: order.extraChargeReason
        ? `חיוב נוסף — ${order.extraChargeReason}`
        : "חיוב נוסף",
      amount: extra,
      negative: false,
    });
  if (debt > 0)
    extras.push({ label: "חוב ממכירה קודמת", amount: debt, negative: false });
  if (credit > 0)
    extras.push({
      label: order.creditReason ? `זיכוי — ${order.creditReason}` : "זיכוי",
      amount: credit,
      negative: true,
    });
  if (bal > 0) extras.push({ label: "יתרת זכות", amount: bal, negative: true });

  return NextResponse.json({
    orderNumber: order.orderNumber,
    lines,
    extras,
    total: Math.round(total * 100) / 100,
    email: order.customer?.email || null,
  });
}
