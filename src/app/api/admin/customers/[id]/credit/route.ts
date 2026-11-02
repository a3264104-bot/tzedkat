// ═══════════════════════════════════════════════════════════════
// ↩️ יתרת זכות ללקוח — מכרטיס הלקוח (מנהל בלבד)
// ═══════════════════════════════════════════════════════════════
// PATCH /api/admin/customers/[id]/credit
// Body: { amount: number, note?: string }   — קובע את היתרה (0 = מחיקה)
//
// הצד ההפוך של רישום חוב (§263): היתרה נשמרת על הלקוח ומקוזזת
// אוטומטית מההזמנה הבאה (§124, applyBalanceToOrder).
// ⚠️ כמו בחוב (§405): הזמנה פתוחה שכבר נשקלה — מחושבת מחדש מיד,
// כדי שהזיכוי ייכנס לחיוב הקרוב ולא יחכה למכירה הבאה.

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/guard";
import { recomputeOrderTotal } from "@/lib/order-total-lib";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const g = await requireAdmin();
  if (!g.ok) return g.res;
  const { id } = await params;
  const body = await req.json().catch(() => ({}));

  const amount = Math.round(Number(body.amount) * 100) / 100;
  const note = String(body.note ?? "").trim();
  if (!Number.isFinite(amount) || amount < 0) {
    return NextResponse.json({ error: "סכום לא תקין" }, { status: 400 });
  }
  if (amount > 20000) {
    return NextResponse.json({ error: "סכום גבוה מדי — בדוק את ההזנה" }, { status: 400 });
  }
  if (amount > 0 && !note) {
    return NextResponse.json({ error: "יש לציין על מה הזיכוי" }, { status: 400 });
  }

  const customer = await prisma.customer.findUnique({
    where: { id },
    select: { id: true, name: true, creditBalance: true },
  });
  if (!customer) return NextResponse.json({ error: "לקוח לא נמצא" }, { status: 404 });
  const current = Number(customer.creditBalance ?? 0);
  if (amount === current) return NextResponse.json({ ok: true, creditBalance: current, message: null });

  const actor = g.session?.user?.email ?? "admin";
  await prisma.customer.update({
    where: { id },
    data: {
      creditBalance: amount,
      creditBalanceNote: amount > 0 ? `${note} (${actor})` : null,
      creditBalanceAt: amount > 0 ? new Date() : null,
    },
  });
  console.log(`[credit] admin ${actor} set credit for ${customer.name}: ${current} → ${amount} (${note})`);

  // ההזמנה הפתוחה של המכירה הנוכחית — אותו כלל של רישום חוב
  const open = await prisma.order.findFirst({
    where: {
      customerId: id,
      status: { notIn: ["CANCELLED"] },
      paymentStatus: { notIn: ["PAID", "PARTIALLY_PAID", "CHARGING", "DEBT_CARRIED", "REFUNDED"] },
      pricelist: { status: { in: ["ACTIVE", "CLOSED"] } },
    },
    orderBy: { createdAt: "desc" },
    select: { id: true, orderNumber: true, finalTotal: true, weightsLockedAt: true },
  });
  let message: string;
  if (!open) {
    message = amount > 0 ? "אין ללקוח הזמנה פתוחה — הזיכוי יקוזז מההזמנה הבאה שלו." : "הזיכוי בוטל.";
  } else if (open.weightsLockedAt) {
    message = `ההזמנה #${open.orderNumber} נעולה — הזיכוי יקוזז מההזמנה הבאה.`;
  } else if (open.finalTotal == null) {
    message = `הזיכוי יקוזז מהזמנה #${open.orderNumber} ברגע שתישקל.`;
  } else {
    await recomputeOrderTotal(open.id, null);
    const after = await prisma.order.findUnique({ where: { id: open.id }, select: { finalTotal: true } });
    message = `ההזמנה #${open.orderNumber} חושבה מחדש. סכום לחיוב עכשיו: ₪${Number(after?.finalTotal ?? 0).toFixed(2)}.`;
  }
  return NextResponse.json({ ok: true, creditBalance: amount, message });
}
