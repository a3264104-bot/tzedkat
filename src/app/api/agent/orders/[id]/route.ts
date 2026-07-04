import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { sendFinalPriceEmail } from "@/lib/email";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://tzidkat.com";

function buildNedarimPaymentLink(orderId: string, amount: number, customerName: string): string {
  const params = new URLSearchParams({
    mosad: "7015318",
    ApiValid: "NxhXRWeG5P",
    Amount: String(amount),
    AmountLock: "1",
    CallBack: `${APP_URL}/api/webhooks/nedarim`,
    param1: orderId,
    param2: "order",
    Nota: `הזמנה #${orderId.slice(0, 8)} - צדקת רבותינו`,
    ClientName: customerName,
  });
  return `https://www.matara.pro/nedarimplus/online/?${params.toString()}`;
}

// נציג מעדכן משקלים (ואופציונלית מחיר סופי) להזמנה
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "יש להתחבר" }, { status: 401 });

  const role = (session.user as any).role;
  if (role !== "AGENT" && role !== "ADMIN") {
    return NextResponse.json({ error: "אין הרשאה" }, { status: 403 });
  }
  const sessionUserId = (session.user as any).id as string;
  const { id } = await params;
  const b = await req.json();

  const order = await prisma.order.findUnique({
    where: { id },
    include: { items: true, customer: true },
  });
  if (!order) return NextResponse.json({ error: "הזמנה לא נמצאה" }, { status: 404 });

  // אימות הרשאת נציג
  let canSetFinalPrice = role === "ADMIN";
  if (role === "AGENT") {
    const agent = await prisma.customer.findUnique({ where: { id: sessionUserId } });
    canSetFinalPrice = agent?.agentCanSetFinalPrice ?? false;
    // הגבלת נקודה
    if (agent?.agentPointId && order.pointId !== agent.agentPointId) {
      return NextResponse.json({ error: "אין לך הרשאה להזמנה זו" }, { status: 403 });
    }
  }

  // עדכון משקלים לפריטים (אופציונלי - רק מה שנשלח)
  if (Array.isArray(b.items)) {
    for (const item of b.items) {
      if (!item.id) continue;
      const data: any = {};
      if (item.actualWeight != null && item.actualWeight !== "") {
        data.actualWeight = Number(item.actualWeight);
        data.finalWeight = Number(item.actualWeight);
      }
      if (Object.keys(data).length > 0) {
        await prisma.orderItem.update({ where: { id: item.id }, data });
      }
    }
  }

  // קביעת מחיר סופי - רק אם הנציג מורשה
  let finalPriceJustSet = false;
  if (b.setFinalPrice === true) {
    if (!canSetFinalPrice) {
      return NextResponse.json(
        { error: "אין לך הרשאה לקבוע מחיר סופי" },
        { status: 403 }
      );
    }

    // מחשבים מחדש את המחיר הסופי מהמשקלים
    const freshItems = await prisma.orderItem.findMany({ where: { orderId: id } });
    let finalTotal = 0;
    for (const it of freshItems) {
      const weight = it.finalWeight != null ? Number(it.finalWeight) : Number(it.quantity);
      const linePrice = Math.round(Number(it.unitPrice) * weight * 100) / 100;
      finalTotal += linePrice;
      await prisma.orderItem.update({
        where: { id: it.id },
        data: { finalPrice: linePrice },
      });
    }
    finalTotal = Math.round(finalTotal * 100) / 100;

    // קיזוז 1₪ בהזמנה ראשונה
    const deductOne = !order.customer.creditVerificationCharged && finalTotal > 1;
    const chargeAmount = deductOne ? Math.round((finalTotal - 1) * 100) / 100 : finalTotal;

    await prisma.order.update({
      where: { id },
      data: {
        finalTotal,
        status: "FINAL_PRICE_SET",
        finalPriceSetAt: new Date(),
        finalPriceSetBy: (session.user as any).email ?? "agent",
        paymentStatus: "PAYMENT_PENDING",
        paymentLink: buildNedarimPaymentLink(id, chargeAmount, order.customerName),
      },
    });
    finalPriceJustSet = true;

    // מייל מחיר סופי ללקוח (לא חוסם)
    if (order.customer.email) {
      const fullOrder = await prisma.order.findUnique({
        where: { id },
        include: { items: true },
      });
      if (fullOrder) {
        await sendFinalPriceEmail(fullOrder as any, order.customer.email).catch(() => null);
      }
    }
  }

  const updated = await prisma.order.findUnique({
    where: { id },
    include: { items: true },
  });
  return NextResponse.json({ ...updated, _finalPriceJustSet: finalPriceJustSet });
}
