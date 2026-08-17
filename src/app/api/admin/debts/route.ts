import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/guard";
import { sendFinalPriceEmail } from "@/lib/email";

// דוח חובות: הזמנות שנקבע להן מחיר סופי אך טרם שולמו
export async function GET() {
  const g = await requireAdmin();
  if (!g.ok) return g.res;

  const orders = await prisma.order.findMany({
    where: {
      finalTotal: { not: null },
      paymentStatus: { notIn: ["PAID", "REFUNDED"] },
      status: { not: "CANCELLED" },
    },
    include: {
      // §60: paymentPreference - לקוח מזומן נשאר בדוח (החוב אמיתי,
      // נגבה במזומן בחלוקה) אבל מסומן, כדי שהמנהל לא ישלח לו לינק
      // תשלום או ירדוף אחרי כרטיס.
      customer: { select: { email: true, phone: true, paymentPreference: true } },
      point: { select: { name: true } },
    },
    orderBy: { finalPriceSetAt: "asc" }, // הישנים ביותר קודם
  });

  const now = Date.now();
  return NextResponse.json(
    orders.map((o) => ({
      id: o.id,
      orderNumber: o.orderNumber,
      customerName: o.customerName,
      phone: o.phone || o.customer?.phone || "",
      email: o.customer?.email ?? null,
      pointName: o.point?.name ?? o.pointNameSnapshot ?? "",
      finalTotal: Number(o.finalTotal),
      amountPaid: o.amountPaid != null ? Number(o.amountPaid) : 0,
      paymentStatus: o.paymentStatus,
      paymentLink: o.paymentLink,
      // §60: גבייה במזומן בחלוקה
      isCashCustomer: o.customer?.paymentPreference === "CASH",
      finalPriceSetAt: o.finalPriceSetAt,
      // כמה ימים ההזמנה ממתינה לתשלום
      daysWaiting: o.finalPriceSetAt
        ? Math.floor((now - new Date(o.finalPriceSetAt).getTime()) / (1000 * 60 * 60 * 24))
        : 0,
      customerNotifiedAt: o.customerNotifiedAt,
    }))
  );
}

// שליחת תזכורת תשלום במייל להזמנה מסוימת
export async function POST(req: Request) {
  const g = await requireAdmin();
  if (!g.ok) return g.res;

  const { orderId } = await req.json();
  if (!orderId) return NextResponse.json({ error: "חסר orderId" }, { status: 400 });

  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: { items: true, customer: true },
  });
  if (!order) return NextResponse.json({ error: "הזמנה לא נמצאה" }, { status: 404 });
  if (order.paymentStatus === "PAID") {
    return NextResponse.json({ error: "ההזמנה כבר שולמה" }, { status: 400 });
  }
  // §60: תזכורת המייל מבקשת "להשלים תשלום" עם לינק אונליין - שגוי
  // ומבלבל ללקוח מזומן, שהתשלום שלו מוסדר פיזית בחלוקה.
  if (order.customer?.paymentPreference === "CASH") {
    return NextResponse.json(
      { error: "לקוח מזומן - הגבייה במזומן בחלוקה, אין לשלוח תזכורת תשלום אונליין" },
      { status: 400 }
    );
  }
  if (!order.customer?.email) {
    return NextResponse.json({ error: "ללקוח אין כתובת מייל — נסה וואטסאפ" }, { status: 400 });
  }

  const res = await sendFinalPriceEmail(order as any, order.customer.email);
  if (!res.ok) {
    return NextResponse.json({ error: res.error || "שליחת המייל נכשלה" }, { status: 500 });
  }

  await prisma.order.update({
    where: { id: orderId },
    data: { customerNotifiedAt: new Date() },
  }).catch(() => null);

  return NextResponse.json({ ok: true });
}
