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
  let canSendPaymentLink = role === "ADMIN";
  if (role === "AGENT") {
    const agent = await prisma.customer.findUnique({ where: { id: sessionUserId } });
    canSetFinalPrice = agent?.agentCanSetFinalPrice ?? false;
    canSendPaymentLink = agent?.agentCanSendPaymentLink ?? false;
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

    // מחשבים מחדש את המחיר הסופי מהמשקלים.
    // כולל את המוצר כדי לדעת את בסיס התמחור (PER_KG = חייב משקל בפועל)
    const freshItems = await prisma.orderItem.findMany({
      where: { orderId: id },
      include: { product: { select: { saleType: true, priceType: true } } },
    });

    // בדיקת בטיחות: מוצר שנשקל (PER_KG) חייב משקל בפועל לפני קביעת מחיר סופי.
    // בלי הבדיקה: 2 מגשים × מחיר-לק"ג היה מחושב כאילו 2 ק"ג - חיוב שגוי ללקוח!
    const missingWeight = freshItems.filter(
      (it) =>
        (it.product.saleType === "UNIT" || it.product.saleType === "PACKAGE") &&
        it.product.priceType === "PER_KG" &&
        it.finalWeight == null
    );
    if (missingWeight.length > 0) {
      return NextResponse.json(
        {
          error: `לא ניתן לקבוע מחיר סופי — חסר משקל בפועל עבור: ${missingWeight
            .map((it) => it.productName)
            .join(", ")}. יש להזין משקל לכל פריט שנשקל.`,
        },
        { status: 400 }
      );
    }

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

    // בסיס העדכון: מחיר סופי נקבע
    const updateData: any = {
      finalTotal,
      status: "FINAL_PRICE_SET",
      finalPriceSetAt: new Date(),
      finalPriceSetBy: (session.user as any).email ?? "agent",
    };
    // לינק תשלום נוצר רק אם לנציג יש הרשאה נפרדת לכך.
    // בלי ההרשאה: המחיר נקבע, אך שליחת הלינק נשארת למנהל (או לנציג מורשה).
    if (canSendPaymentLink) {
      updateData.paymentStatus = "PAYMENT_PENDING";
      updateData.paymentLink = buildNedarimPaymentLink(id, chargeAmount, order.customerName);
    }
    await prisma.order.update({ where: { id }, data: updateData });
    finalPriceJustSet = true;

    // מייל מחיר סופי ללקוח (לא חוסם) - רק אם נוצר לינק תשלום,
    // אחרת המייל היה יוצא בלי כפתור תשלום ומבלבל את הלקוח
    if (canSendPaymentLink && order.customer.email) {
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
