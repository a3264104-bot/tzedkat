// POST /api/charge
// חיוב הזמנה באמצעות טוקן שמור של הלקוח
//
// הרשאה:
//   - ADMIN: תמיד מותר
//   - AGENT: מותר רק אם agentCanCharge=true (הרשאה שהמנהל מעניק)
//   - LOCAL LOGIC: הנציג יכול לחייב רק לקוחות של נקודת החלוקה שלו
//                 (חוץ ממצב שהוא יצר את הלקוח עצמו)
//
// Body: { orderId }
// Response:
//   הצלחה: { ok: true, amountCharged, transactionId }
//   כשל:   { error, code, ... }

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { chargeToken } from "@/lib/nedarim-lib";

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "לא מורשה" }, { status: 401 });
  }

  const role = (session.user as any).role;
  const userId = (session.user as any).id as string;

  // הרשאת החיוב
  const isAdmin = role === "ADMIN";
  const isAgent = role === "AGENT";
  if (!isAdmin && !isAgent) {
    return NextResponse.json({ error: "אין הרשאה" }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const orderId = String(body.orderId || "");
  if (!orderId) {
    return NextResponse.json({ error: "orderId חובה" }, { status: 400 });
  }

  // אם AGENT - בדיקת הרשאה נפרדת
  if (isAgent) {
    const agent = await prisma.customer.findUnique({
      where: { id: userId },
      select: { agentCanCharge: true, agentPointId: true },
    });
    if (!agent?.agentCanCharge) {
      return NextResponse.json(
        {
          error: "אין לך הרשאת חיוב. פנה למנהל להענקת הרשאה.",
          code: "NO_CHARGE_PERMISSION",
        },
        { status: 403 }
      );
    }

    // בדיקה שההזמנה שייכת לנקודת החלוקה של הנציג
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      select: { pointId: true, customer: { select: { createdByAgentId: true } } },
    });
    if (!order) {
      return NextResponse.json({ error: "הזמנה לא נמצאה" }, { status: 404 });
    }
    const isCreator = order.customer?.createdByAgentId === userId;
    const samePoint = order.pointId === agent.agentPointId;
    if (!isCreator && !samePoint) {
      return NextResponse.json(
        { error: "אין הרשאה להזמנה זו — היא לא בנקודת החלוקה שלך" },
        { status: 403 }
      );
    }
  }

  // טוענים את ההזמנה + הלקוח
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: {
      customer: {
        select: {
          id: true,
          paymentToken: true,
          cardExpiry: true,
          cardLast4: true,
          cardNeedsUpdate: true,
          creditVerificationCharged: true,
        },
      },
    },
  });

  if (!order) {
    return NextResponse.json({ error: "הזמנה לא נמצאה" }, { status: 404 });
  }

  if (order.paymentStatus === "PAID") {
    return NextResponse.json(
      { error: "ההזמנה כבר שולמה", code: "ALREADY_PAID" },
      { status: 400 }
    );
  }

  if (order.finalTotal == null) {
    return NextResponse.json(
      { error: "טרם נקבע מחיר סופי", code: "NO_FINAL_TOTAL" },
      { status: 400 }
    );
  }

  const customer = order.customer;
  if (!customer?.paymentToken) {
    return NextResponse.json(
      {
        error: "אין כרטיס שמור ללקוח - יש לבקש עדכון כרטיס",
        code: "NO_CARD",
      },
      { status: 400 }
    );
  }

  if (customer.cardNeedsUpdate) {
    return NextResponse.json(
      {
        error: "הכרטיס דורש עדכון (נכשל בעבר) - יש לעדכן פרטי כרטיס",
        code: "CARD_NEEDS_UPDATE",
      },
      { status: 400 }
    );
  }

  // חישוב סכום החיוב:
  // אם היה 1 ש"ח אימות ראשוני שטרם קוזז - להוריד עכשיו
  const finalTotal = Number(order.finalTotal);
  const deductOne =
    !customer.creditVerificationCharged && finalTotal > 1;
  const chargeAmount = deductOne
    ? Math.round((finalTotal - 1) * 100) / 100
    : finalTotal;

  console.log(
    `[charge] Order ${order.orderNumber} - amount ${chargeAmount} (finalTotal: ${finalTotal}, deductOne: ${deductOne})`
  );

  // מעדכנים את מספר הניסיונות + תאריך הניסיון האחרון
  await prisma.order.update({
    where: { id: orderId },
    data: {
      chargeAttempts: { increment: 1 },
      lastChargeAt: new Date(),
    },
  });

  // ביצוע החיוב
  try {
    const result = await chargeToken({
      token: customer.paymentToken,
      tokef: customer.cardExpiry || "",
      amount: chargeAmount,
      orderRef: String(order.orderNumber),
    });

    if (result.ok) {
      // ✅ הצלחה
      await prisma.$transaction([
        prisma.order.update({
          where: { id: orderId },
          data: {
            paymentStatus: "PAID",
            paymentMethod: "ONLINE",
            amountPaid: chargeAmount,
            paidAt: new Date(),
            paymentTransactionId: result.transactionId || null,
            paymentProvider: "nedarim_plus",
            lastChargeError: null,
          },
        }),
        // אם הייתה הסטת 1 ש"ח, נסמן שנוצל
        ...(deductOne
          ? [
              prisma.customer.update({
                where: { id: customer.id },
                data: { creditVerificationCharged: true },
              }),
            ]
          : []),
      ]);

      return NextResponse.json({
        ok: true,
        amountCharged: chargeAmount,
        transactionId: result.transactionId,
      });
    } else {
      // ❌ כשל
      const errorMsg = result.error || "חיוב נכשל";
      const needsCardUpdate =
        result.cardProblem || result.requiresManualVerification;

      await prisma.order.update({
        where: { id: orderId },
        data: {
          lastChargeError: errorMsg,
        },
      });

      // אם זו בעיית כרטיס - מסמנים שנדרש עדכון
      if (needsCardUpdate) {
        await prisma.customer.update({
          where: { id: customer.id },
          data: { cardNeedsUpdate: true },
        });
      }

      return NextResponse.json(
        {
          error: errorMsg,
          code: result.cardProblem ? "CARD_PROBLEM" : "CHARGE_FAILED",
          needsCardUpdate,
        },
        { status: 400 }
      );
    }
  } catch (e: any) {
    const errorMsg = String(e?.message || e).slice(0, 300);
    console.error("[charge] Exception:", errorMsg);

    await prisma.order.update({
      where: { id: orderId },
      data: {
        lastChargeError: `Exception: ${errorMsg}`,
      },
    });

    return NextResponse.json(
      { error: "שגיאה לא צפויה בחיוב", details: errorMsg },
      { status: 500 }
    );
  }
}
