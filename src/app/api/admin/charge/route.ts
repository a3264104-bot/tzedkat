import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { chargeToken } from "@/lib/nedarim-lib";
import { sendChargeSucceededEmail, sendCardUpdateNeededEmail } from "@/lib/nedarim-emails";

// POST /api/admin/charge
// Body: { orderId: string }
//
// זרימה (§19):
//   1. בדיקת admin
//   2. טעינת הזמנה + לקוח, בדיקות שלמות:
//      - ההזמנה לא כבר PAID / לא כבר בתהליך CHARGING
//      - יש finalTotal (אסור לחייב בלי מחיר סופי)
//      - ללקוח יש paymentToken
//      - ללקוח יש cardExpiry (Tokef) - חובה לנדרים
//      - הלקוח לא במצב cardNeedsUpdate
//   3. חישוב סכום החיוב: finalTotal פחות 1₪ אם עדיין לא קוזז אימות ההרשמה
//   4. סימון ההזמנה כ-CHARGING (מונע חיוב כפול במקביל) + הגדלת chargeAttempts
//   5. קריאה ל-chargeToken() של נדרים
//   6. עדכון סופי לפי התוצאה + מיילים ללקוח

export async function POST(req: Request) {
  try {
    // 1. אימות admin
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
    const role = (session.user as { role?: string }).role;
    const email = session.user.email;
    let isAdmin = role === "ADMIN";
    if (!isAdmin && email) {
      const adminRow = await prisma.admin.findUnique({ where: { email } });
      isAdmin = !!adminRow;
    }
    if (!isAdmin) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }

    // 2. טעינת ההזמנה
    const body = await req.json().catch(() => ({}));
    const orderId = String(body?.orderId || "").trim();
    if (!orderId) {
      return NextResponse.json({ error: "missing orderId" }, { status: 400 });
    }

    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: { customer: true },
    });

    if (!order) {
      return NextResponse.json({ error: "order not found" }, { status: 404 });
    }

    // בדיקות שלמות
    if (order.paymentStatus === "PAID") {
      return NextResponse.json({ error: "already paid", paymentStatus: "PAID" }, { status: 409 });
    }
    if (order.paymentStatus === "CHARGING") {
      return NextResponse.json({ error: "charge already in progress", paymentStatus: "CHARGING" }, { status: 409 });
    }
    if (order.finalTotal === null || order.finalTotal === undefined) {
      return NextResponse.json({ error: "final total not set - cannot charge without weighing" }, { status: 400 });
    }
    if (!order.customer.paymentToken) {
      return NextResponse.json({ error: "customer has no saved card" }, { status: 400 });
    }
    if (!order.customer.cardExpiry) {
      return NextResponse.json(
        {
          error:
            "אין תוקף כרטיס שמור (Tokef). יש לבקש מהלקוח להזין כרטיס מחדש כדי לשמור את התוקף.",
        },
        { status: 400 }
      );
    }
    if (order.customer.cardNeedsUpdate) {
      return NextResponse.json({ error: "customer needs to update card first" }, { status: 400 });
    }

    // 3. חישוב סכום החיוב
    const finalTotalNum = Number(order.finalTotal);
    const shouldDeductVerification =
      !order.customer.creditVerificationCharged && finalTotalNum > 1;
    const chargeAmount = shouldDeductVerification ? finalTotalNum - 1 : finalTotalNum;

    if (!(chargeAmount > 0)) {
      return NextResponse.json({ error: "computed charge amount is not positive" }, { status: 400 });
    }

    // 4. סימון ההזמנה כ-CHARGING
    await prisma.order.update({
      where: { id: orderId },
      data: {
        paymentStatus: "CHARGING",
        chargeAttempts: { increment: 1 },
        lastChargeAt: new Date(),
        lastChargeError: null,
      },
    });

    // 5. קריאה בפועל לנדרים - כולל פרטי לקוח לתיעוד אצלם
    const result = await chargeToken({
      token: order.customer.paymentToken,
      tokef: order.customer.cardExpiry,
      amount: chargeAmount,
      orderRef: String(order.orderNumber),
      clientName: order.customer.name || order.customerName,
      phone: order.customer.phone || order.phone,
      email: order.customer.email || undefined,
    });

    // 6. עדכון סופי
    if (result.ok) {
      // הצלחה
      await prisma.$transaction([
        prisma.order.update({
          where: { id: orderId },
          data: {
            paymentStatus: "PAID",
            paymentMethod: "ONLINE",
            paymentProvider: "nedarim_plus",
            paymentTransactionId: result.transactionId,
            amountPaid: chargeAmount,
            paidAt: new Date(),
            lastChargeError: null,
          },
        }),
        ...(shouldDeductVerification
          ? [
              prisma.customer.update({
                where: { id: order.customer.id },
                data: { creditVerificationCharged: true },
              }),
            ]
          : []),
      ]);

      // מייל ללקוח (לא חוסם על כשלון)
      if (order.customer.email) {
        const mailResult = await sendChargeSucceededEmail({
          to: order.customer.email,
          customerName: order.customer.name,
          orderNumber: order.orderNumber,
          amountCharged: chargeAmount,
          transactionId: result.transactionId,
          pointName: order.pointNameSnapshot || undefined,
          deliveryDate: order.deliveryDateSnapshot || undefined,
        });
        if (!mailResult.ok) {
          console.error("sendChargeSucceededEmail failed:", mailResult.error);
        }
      }

      return NextResponse.json({
        ok: true,
        paymentStatus: "PAID",
        transactionId: result.transactionId,
        amountCharged: chargeAmount,
        deductedVerification: shouldDeductVerification,
      });
    }

    // כישלון - שני סוגים
    if (result.cardProblem) {
      // כרטיס פסול/פג-תוקף - נדרש עדכון
      await prisma.$transaction([
        prisma.order.update({
          where: { id: orderId },
          data: {
            paymentStatus: "CARD_UPDATE_NEEDED",
            lastChargeError: result.error,
          },
        }),
        prisma.customer.update({
          where: { id: order.customer.id },
          data: { cardNeedsUpdate: true },
        }),
      ]);

      // מייל ללקוח - לעדכן כרטיס
      if (order.customer.email) {
        const mailResult = await sendCardUpdateNeededEmail({
          to: order.customer.email,
          customerName: order.customer.name,
          orderNumber: order.orderNumber,
          finalTotal: finalTotalNum,
          reason: result.error,
        });
        if (!mailResult.ok) {
          console.error("sendCardUpdateNeededEmail failed:", mailResult.error);
        }
      }

      return NextResponse.json({
        ok: false,
        paymentStatus: "CARD_UPDATE_NEEDED",
        error: result.error,
        cardProblem: true,
      });
    }

    // כישלון "רגיל" - מנהל יכול לנסות שוב
    await prisma.order.update({
      where: { id: orderId },
      data: {
        paymentStatus: "FAILED",
        lastChargeError: result.error,
      },
    });

    return NextResponse.json({
      ok: false,
      paymentStatus: "FAILED",
      error: result.error,
      cardProblem: false,
    });
  } catch (e) {
    console.error("POST /api/admin/charge exception:", e);
    // recovery: אם ההזמנה נשארה תקועה ב-CHARGING בגלל exception, נחזיר ל-READY_TO_CHARGE
    try {
      const body = await req.json().catch(() => ({}));
      const orderId = String(body?.orderId || "").trim();
      if (orderId) {
        const current = await prisma.order.findUnique({
          where: { id: orderId },
          select: { paymentStatus: true },
        });
        if (current?.paymentStatus === "CHARGING") {
          await prisma.order.update({
            where: { id: orderId },
            data: {
              paymentStatus: "READY_TO_CHARGE",
              lastChargeError: "server error during charge attempt",
            },
          });
        }
      }
    } catch {
      // best-effort - מתעלמים משגיאה כאן
    }
    return NextResponse.json({ error: "server error" }, { status: 500 });
  }
}
