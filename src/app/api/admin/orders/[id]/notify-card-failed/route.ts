// ═══════════════════════════════════════════════════════════════
// §387: שליחה מחדש — "הכרטיס נדחה, עדכן"
// ═══════════════════════════════════════════════════════════════
// POST /api/admin/orders/[id]/notify-card-failed
//
// המייל נשלח אוטומטית בכישלון (§19). אבל: הלקוח לא ראה, המייל
// הלך לספאם, או שעברו יומיים ורוצים להזכיר. המנהל צריך כפתור.
//
// ⚠️ רק לסטטוסים של כישלון: על הזמנה ששולמה או שטרם נוסתה,
// המייל הזה היה מבלבל.

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/guard";
import { sendCardUpdateNeededEmail } from "@/lib/nedarim-emails";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const g = await requireAdmin();
  if (!g.ok) return g.res;
  const { id } = await params;

  const order = await prisma.order.findUnique({
    where: { id },
    select: {
      orderNumber: true,
      paymentStatus: true,
      finalTotal: true,
      lastChargeError: true,
      customer: { select: { name: true, email: true } },
    },
  });
  if (!order) {
    return NextResponse.json({ error: "הזמנה לא נמצאה" }, { status: 404 });
  }

  const failed = ["FAILED", "CARD_UPDATE_NEEDED"].includes(order.paymentStatus);
  if (!failed) {
    return NextResponse.json(
      { error: `ההזמנה במצב "${order.paymentStatus}" — המייל הזה מיועד רק לחיוב שנכשל.` },
      { status: 400 }
    );
  }
  if (!order.customer?.email) {
    return NextResponse.json(
      { error: "ללקוח אין כתובת מייל" },
      { status: 400 }
    );
  }

  const r = await sendCardUpdateNeededEmail({
    to: order.customer.email,
    customerName: order.customer.name,
    orderNumber: order.orderNumber,
    finalTotal: Number(order.finalTotal ?? 0),
    reason: order.lastChargeError ?? undefined,
  });

  if (!r.ok) {
    return NextResponse.json({ error: r.error || "השליחה נכשלה" }, { status: 500 });
  }

  console.log(`[notify-card-failed] #${order.orderNumber} → ${order.customer.email} by ${g.session?.user?.email}`);
  return NextResponse.json({ ok: true, email: order.customer.email });
}
