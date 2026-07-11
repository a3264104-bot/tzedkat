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
//      - ההזמנה לא כבר PAID
//      - יש finalTotal (אסור לחייב בלי מחיר סופי)
//      - ללקוח יש paymentToken
//      - הלקוח לא במצב cardNeedsUpdate
//   3. חישוב סכום החיוב: finalTotal פחות 1₪ אם עדיין לא קוזז אימות ההרשמה
//   4. סימון ההזמנה כ-CHARGING (מונע חיוב כפול במקביל) + הגדלת chargeAttempts
//   5. קריאה ל-chargeToken() של נדרים
//   6. עדכון סופי:
//      - הצלחה → PAID + transaction + amountPaid + paidAt + מייל אישור
//      - כישלון "רגיל" → FAILED + lastChargeError (מנהל יכול לנסות שוב)
//      - כישלון כרטיס → CARD_UPDATE_NEEDED + סימון הלקוח + מייל ללקוח
//
// חשוב: לא מסמנים creditVerificationCharged=true אלא אם החיוב הצליח בפועל.
// חשוב: כל שינוי סטטוס נכתב לפני כל דבר אחר, כדי שאם השרת נופל באמצע נוכל לחזור מהמצב.

export async function POST(req: Request) {
  try {
    // 1. אימות admin (אותו pattern כמו admin/payments)
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

    // בדיקות שלמות - כל אחת מחזירה שגיאה ברורה
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
    if (order.customer.cardNeedsUpdate) {
      return NextResponse.json({ error: "customer needs to update card first" }, { status: 400 });
    }

    // 3. חישוב סכום החיוב
    const finalTotalNum = Number(order.finalTotal);
    // אם עדיין לא קיזזנו את 1₪ של האימות ההתחלתי - נקזז עכשיו (רק אם הסכום מספיק גדול)
    const shouldDeductVerification =
      !order.customer.creditVerificationCharged && finalTotalNum > 1;
    const chargeAmount = shouldDeductVerification ? finalTotalNum - 1 : finalTotalNum;

    if (!(chargeAmount > 0)) {
      return NextResponse.json({ error: "computed charge amount is not positive" }, { status: 400 });
    }

    // 4. סימון ההזמנה כ-CHARGING (מנעול אופטימי - מונע חיוב כפול)
    await prisma.order.update({
      where: { id: orderId },
      data: {
        paymentStatus: "CHARGING",
        chargeAttempts: { increment: 1 },
        lastChargeAt: new Date(),
        lastChargeError: null,
      },
    });

    // 5. קריאה בפועל לנדרים (PLACEHOLDER כרגע)
    const orderRef = String(order.orderNumber);
    const result = await chargeToken(order.customer.paymentToken, chargeAmount, orderRef);

    // 6. עדכון סופי לפי התוצאה
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
        // אם קיזזנו את 1₪ בחיוב הזה - מסמנים שהאימות "שולם"
        ...(shouldDeductVerification
          ? [
              prisma.customer.update({
                where: { id: order.customer.id },
                data: { creditVerificationCharged: true },
              }),
            ]
          : []),
      ]);

      // מייל ללקוח (לא חוסם על כשלון - מחזיר {ok, error?})
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
    // במקרה של חריגה בלתי-צפויה, לא משאירים את ההזמנה תקועה ב-CHARGING.
    // במידת האפשר, מנסים להחזיר ל-READY_TO_CHARGE כדי לאפשר ניסיון חוזר.
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
      // מתעלמים - זה recovery best-effort
    }
    return NextResponse.json({ error: "server error" }, { status: 500 });
  }
}
