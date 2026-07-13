import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { chargeToken } from "@/lib/nedarim-lib";
import { sendChargeSucceededEmail, sendCardUpdateNeededEmail } from "@/lib/nedarim-emails";

// ═══════════════════════════════════════════════════════════════════
// POST /api/admin/charge
// ═══════════════════════════════════════════════════════════════════
//
// Body: { orderId: string }
//
// זרימת החיוב (§19) עם כל תיקוני הבטיחות:
//
// Phase A: אימות + טעינה + validation (findUnique, checks)
// Phase B: נעילה אטומית ל-CHARGING (Fix #1 - manעת race condition)
// Phase C: אם chargeAmount = 0 (הלקוח כבר שילם מלא ב-1₪ אימות),
//          מסמנים PAID בלי לפנות לנדרים (Fix #2 - edge case)
// Phase D: קריאה לנדרים (chargeToken)
// Phase E: טיפול בתוצאה:
//   הצלחה + DB update מצליח → PAID + מייל אישור
//   הצלחה + DB update נכשל → CHARGING נשמר + לוג CRITICAL (Fix #4)
//   כישלון + requiresManualVerification → CHARGING נשמר (Fix #3 מ-lib)
//   כישלון + cardProblem → CARD_UPDATE_NEEDED
//   כישלון רגיל → FAILED (מנהל יכול לנסות שוב)
//
// אף אחת מהעדכונים של DB במסלולים לאחר הנעילה לא מוציאה את ההזמנה מ-CHARGING
// אלא ב"מסלולים בטוחים" - כלומר לאחר תשובה חד-משמעית מנדרים.

// סטטוסים שמותר לעבור מהם ל-CHARGING (נעילה)
const CHARGEABLE_STATUSES_FOR_LOCK = {
  notIn: ["PAID", "CHARGING", "CANCELLED", "REFUNDED"],
};

export async function POST(req: Request) {
  let orderId = "";

  // ═══════════════════════════════════════════════════════════════
  // Phase A: אימות + validation
  // אם משהו נכשל כאן → לא ננעלנו עדיין, בטוח להחזיר שגיאה
  // ═══════════════════════════════════════════════════════════════
  try {
    // 1. אימות admin
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
    const role = (session.user as { role?: string }).role;
    const sessionEmail = session.user.email;
    let isAdmin = role === "ADMIN";
    if (!isAdmin && sessionEmail) {
      const adminRow = await prisma.admin.findUnique({ where: { email: sessionEmail } });
      isAdmin = !!adminRow;
    }
    if (!isAdmin) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }

    // 2. פרסינג ה-body
    const body = await req.json().catch(() => ({}));
    orderId = String(body?.orderId || "").trim();
    if (!orderId) {
      return NextResponse.json({ error: "missing orderId" }, { status: 400 });
    }

    // 3. טעינת ההזמנה לפני נעילה - לצורך validations
    const preOrder = await prisma.order.findUnique({
      where: { id: orderId },
      include: { customer: true },
    });

    if (!preOrder) {
      return NextResponse.json({ error: "order not found" }, { status: 404 });
    }

    // בדיקות שלמות (רק לפני נעילה - הודעות שגיאה ידידותיות)
    if (preOrder.paymentStatus === "PAID") {
      return NextResponse.json({ error: "already paid", paymentStatus: "PAID" }, { status: 409 });
    }
    if (preOrder.paymentStatus === "CHARGING") {
      return NextResponse.json(
        { error: "charge already in progress", paymentStatus: "CHARGING" },
        { status: 409 }
      );
    }
    if (preOrder.finalTotal === null || preOrder.finalTotal === undefined) {
      return NextResponse.json(
        { error: "final total not set - cannot charge without weighing" },
        { status: 400 }
      );
    }
    if (!preOrder.customer.paymentToken) {
      return NextResponse.json({ error: "customer has no saved card" }, { status: 400 });
    }
    if (!preOrder.customer.cardExpiry) {
      return NextResponse.json(
        {
          error:
            "אין תוקף כרטיס שמור (Tokef). יש לבקש מהלקוח להזין כרטיס מחדש כדי לשמור את התוקף.",
        },
        { status: 400 }
      );
    }
    if (preOrder.customer.cardNeedsUpdate) {
      return NextResponse.json({ error: "customer needs to update card first" }, { status: 400 });
    }

    // 4. חישוב סכום החיוב
    // מסלול טוקן חדש: לא מקזזים 1₪ כי לא חייבנו 1₪ באימות (CreateToken לא מחייב)
    // הלקוח משלם את המחיר הסופי המלא של ההזמנה
    const finalTotalNum = Number(preOrder.finalTotal);
    const chargeAmount = finalTotalNum;

    if (chargeAmount <= 0) {
      return NextResponse.json(
        { error: `invalid charge amount ${chargeAmount}` },
        { status: 400 }
      );
    }

    // ═══════════════════════════════════════════════════════════════
    // Phase B: נעילה אטומית ל-CHARGING (Fix #1)
    // ═══════════════════════════════════════════════════════════════
    // updateMany עם WHERE conditions הוא אטומי ב-Postgres.
    // אם count=0 - מישהו אחר תפס את ההזמנה בין ה-findUnique לבין הנעילה.
    // זה מונע מצב של שני טאבים / שני עוגנים ששניהם מחייבים במקביל.
    const lockResult = await prisma.order.updateMany({
      where: {
        id: orderId,
        paymentStatus: CHARGEABLE_STATUSES_FOR_LOCK,
      },
      data: {
        paymentStatus: "CHARGING",
        chargeAttempts: { increment: 1 },
        lastChargeAt: new Date(),
        lastChargeError: null,
      },
    });

    if (lockResult.count === 0) {
      // לא הצלחנו לנעול - כנראה מישהו אחר תפס בין הבדיקה לנעילה
      const fresh = await prisma.order.findUnique({
        where: { id: orderId },
        select: { paymentStatus: true },
      });
      return NextResponse.json(
        {
          error: `cannot charge - order status has changed to ${fresh?.paymentStatus || "unknown"}`,
          paymentStatus: fresh?.paymentStatus,
        },
        { status: 409 }
      );
    }

    // ═══════════════════════════════════════════════════════════════
    // מכאן והלאה: אנחנו במצב CHARGING. חייבים להיזהר במיוחד
    // עם כל השגיאות - לא לחשוף את ההזמנה שוב לחיוב חוזר בטעות.
    // ═══════════════════════════════════════════════════════════════

    // ═══════════════════════════════════════════════════════════════
    // Phase D: קריאה לנדרים
    // ═══════════════════════════════════════════════════════════════
    const result = await chargeToken({
      token: preOrder.customer.paymentToken,
      tokef: preOrder.customer.cardExpiry,
      amount: chargeAmount,
      orderRef: String(preOrder.orderNumber),
      clientName: preOrder.customer.name || preOrder.customerName,
      phone: preOrder.customer.phone || preOrder.phone,
      email: preOrder.customer.email || undefined,
    });

    // ═══════════════════════════════════════════════════════════════
    // Phase E: טיפול בתוצאה
    // ═══════════════════════════════════════════════════════════════

    // ── E1. הצלחה ─────────────────────────────────────────────
    if (result.ok) {
      const successfulTransactionId = result.transactionId;

      // Fix #4: DB update נפרד בtry/catch כדי לא לאבד את הצלחת החיוב
      try {
        await prisma.order.update({
          where: { id: orderId },
          data: {
            paymentStatus: "PAID",
            paymentMethod: "ONLINE",
            paymentProvider: "nedarim_plus",
            paymentTransactionId: successfulTransactionId,
            amountPaid: chargeAmount,
            paidAt: new Date(),
            lastChargeError: null,
          },
        });
      } catch (dbError) {
        // ⚠️ מצב קריטי: נדרים חייבו בהצלחה, אבל ה-DB שלנו לא הצליח להתעדכן
        // חייבים להשאיר את ההזמנה ב-CHARGING - אסור להחזירה ל-READY_TO_CHARGE
        // כי זה יגרום לחיוב כפול!
        console.error("⚠️⚠️⚠️ CRITICAL: Nedarim charged but DB update failed", {
          orderId,
          transactionId: successfulTransactionId,
          chargeAmount,
          error: String(dbError),
        });

        // ניסיון best-effort לרשום לפחות את ה-transactionId
        try {
          await prisma.order.update({
            where: { id: orderId },
            data: {
              // paymentStatus נשאר CHARGING - לא משנים!
              paymentTransactionId: successfulTransactionId,
              lastChargeError: `⚠️ CRITICAL: Nedarim charged (TxnId=${successfulTransactionId}, Amount=${chargeAmount}) at ${new Date().toISOString()} but DB update failed. Manual reconciliation required. DB error: ${String(dbError).substring(0, 200)}`,
            },
          });
        } catch {
          // אפילו זה נכשל - יש לוג ב-console, זה מה שנשאר
        }

        return NextResponse.json(
          {
            ok: false,
            paymentStatus: "CHARGING",
            error:
              "החיוב הצליח אצל נדרים, אבל עדכון ה-DB נכשל. יש לבדוק ידנית באזור הניהול של נדרים ולעדכן את ההזמנה בהתאם.",
            transactionId: successfulTransactionId,
            requiresManualVerification: true,
          },
          { status: 500 }
        );
      }

      // DB update הצליח - שולחים מייל (לא חוסם)
      if (preOrder.customer.email) {
        const mailResult = await sendChargeSucceededEmail({
          to: preOrder.customer.email,
          customerName: preOrder.customer.name,
          orderNumber: preOrder.orderNumber,
          amountCharged: chargeAmount,
          transactionId: successfulTransactionId,
          pointName: preOrder.pointNameSnapshot || undefined,
          deliveryDate: preOrder.deliveryDateSnapshot || undefined,
        });
        if (!mailResult.ok) {
          console.error("sendChargeSucceededEmail failed:", mailResult.error);
        }
      }

      return NextResponse.json({
        ok: true,
        paymentStatus: "PAID",
        transactionId: successfulTransactionId,
        amountCharged: chargeAmount,
      });
    }

    // ── E2. requiresManualVerification (Fix #3): timeout/network ──
    // נדרים אולי כן חייבו - חובה לבדוק ידנית לפני ניסיון חוזר
    if (result.requiresManualVerification) {
      console.error("[charge-route] requiresManualVerification for order", orderId, result.error);
      try {
        await prisma.order.update({
          where: { id: orderId },
          data: {
            // ⚠️ paymentStatus נשאר CHARGING - לא חוזרים ל-READY_TO_CHARGE!
            lastChargeError: `⚠️ ${result.error} - יש לבדוק ידנית באזור הניהול של נדרים לפני ניסיון חוזר`,
          },
        });
      } catch {
        // best effort
      }

      return NextResponse.json(
        {
          ok: false,
          paymentStatus: "CHARGING",
          error: `${result.error} - יש לבדוק ידנית באזור הניהול של נדרים לפני ניסיון חוזר`,
          requiresManualVerification: true,
        },
        { status: 500 }
      );
    }

    // ── E3. כרטיס פסול/פג-תוקף ──
    if (result.cardProblem) {
      try {
        await prisma.$transaction([
          prisma.order.update({
            where: { id: orderId },
            data: {
              paymentStatus: "CARD_UPDATE_NEEDED",
              lastChargeError: result.error,
            },
          }),
          prisma.customer.update({
            where: { id: preOrder.customer.id },
            data: { cardNeedsUpdate: true },
          }),
        ]);
      } catch (dbError) {
        // DB נכשל בסימון CARD_UPDATE_NEEDED - במקרה זה נדרים דחו את החיוב
        // אז אין סכנת חיוב כפול. משאירים ב-CHARGING עם שגיאה.
        console.error("[charge-route] DB write failed for cardProblem:", dbError);
      }

      // מייל ללקוח - לעדכן כרטיס
      if (preOrder.customer.email) {
        const mailResult = await sendCardUpdateNeededEmail({
          to: preOrder.customer.email,
          customerName: preOrder.customer.name,
          orderNumber: preOrder.orderNumber,
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

    // ── E4. כישלון "רגיל" - מנהל יכול לנסות שוב ──
    try {
      await prisma.order.update({
        where: { id: orderId },
        data: {
          paymentStatus: "FAILED",
          lastChargeError: result.error,
        },
      });
    } catch (dbError) {
      console.error("[charge-route] DB write failed for regular failure:", dbError);
    }

    return NextResponse.json({
      ok: false,
      paymentStatus: "FAILED",
      error: result.error,
      cardProblem: false,
    });
  } catch (e) {
    // ═══════════════════════════════════════════════════════════════
    // Outer catch: רק לשגיאות ב-Phase A/B (לפני קריאה לנדרים).
    // בטוח להחזיר ל-READY_TO_CHARGE כי לא היה חיוב בפועל.
    // ═══════════════════════════════════════════════════════════════
    console.error("[charge-route] Phase A/B exception:", e);
    if (orderId) {
      await recoverFromCharging(
        orderId,
        `server error before Nedarim call: ${String(e).substring(0, 200)}`
      ).catch(() => {
        // best effort
      });
    }
    return NextResponse.json({ error: "server error" }, { status: 500 });
  }
}

// ─── recovery helper: מחזיר ל-READY_TO_CHARGE רק אם עדיין CHARGING ────
// שימוש רק לפני קריאה לנדרים או ב-zero-charge (שלא חייבו כלום מעבר לאימות)
async function recoverFromCharging(orderId: string, errorMessage: string): Promise<void> {
  await prisma.order.updateMany({
    where: {
      id: orderId,
      paymentStatus: "CHARGING",
    },
    data: {
      paymentStatus: "READY_TO_CHARGE",
      lastChargeError: errorMessage,
    },
  });
}
