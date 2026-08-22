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

// תקרת אורך בטוחה לשדה "עבור" (Avour) שנשלח לנדרים.
// נדרים לא מתעדים מגבלה מדויקת; 250 תו שמרני כדי שהחיוב לא ייכשל/ייחתך.
const AVOUR_MAX_LEN = 250;

// ─────────────────────────────────────────────────────────────
// בונה את טקסט ה-"עבור" (Avour) שנדרים מציגים במייל למנהל כ"הערות".
// כולל: מספר הזמנה, נקודת חלוקה (+עיר), תאריך חלוקה, ומספר הפריטים.
//
// עדיפות קיצוץ: מספר ההזמנה, הנקודה והתאריך תמיד נכנסים (הכי חשובים למנהל).
// אם עדיין חורג מ-AVOUR_MAX_LEN - חותכים בזהירות ומוסיפים "…".
//
// שים לב: לא שולחים פירוט משקלים/מחירים per-item (לבקשת המשתמש) -
// רק ספירת הפריטים הלא-מבוטלים בהזמנה.
// ─────────────────────────────────────────────────────────────
function buildChargeAvour(input: {
  orderNumber: number;
  pointName?: string | null;
  pointCity?: string | null;
  deliveryDate?: string | null;
  itemCount: number;
}): string {
  const { orderNumber, pointName, pointCity, deliveryDate, itemCount } = input;

  const parts: string[] = [`הזמנה #${orderNumber}`];

  // נקודת חלוקה (+ עיר אם שונה/קיימת)
  const point = (pointName || "").trim();
  const city = (pointCity || "").trim();
  if (point && city && !point.includes(city)) {
    parts.push(`נקודה: ${point} (${city})`);
  } else if (point) {
    parts.push(`נקודה: ${point}`);
  } else if (city) {
    parts.push(`עיר: ${city}`);
  }

  // תאריך חלוקה
  const date = (deliveryDate || "").trim();
  if (date) {
    parts.push(`חלוקה: ${date}`);
  }

  // מספר פריטים (ספירה בלבד, לא פירוט)
  if (itemCount > 0) {
    parts.push(`${itemCount} פריטים`);
  }

  let avour = parts.join(" | ");

  // קיצוץ חכם: אם חורג מהתקרה, חותכים ומוסיפים אליפסיס.
  // המבנה מבטיח שמספר ההזמנה + הנקודה (החלקים הראשונים) שורדים.
  if (avour.length > AVOUR_MAX_LEN) {
    avour = avour.substring(0, AVOUR_MAX_LEN - 1).trimEnd() + "…";
  }

  return avour;
}

export async function POST(req: Request) {
  let orderId = "";

  // ═══════════════════════════════════════════════════════════════
  // Phase A: אימות + validation
  // אם משהו נכשל כאן → לא ננעלנו עדיין, בטוח להחזיר שגיאה
  // ═══════════════════════════════════════════════════════════════
  try {
    // 1. אימות admin/agent
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
    const role = (session.user as { role?: string }).role;
    const sessionEmail = session.user.email;
    const sessionUserId = (session.user as any).id as string;
    let isAdmin = role === "ADMIN";
    if (!isAdmin && sessionEmail) {
      const adminRow = await prisma.admin.findUnique({ where: { email: sessionEmail } });
      isAdmin = !!adminRow;
    }
    // 🆕 נציג יכול לחייב רק אם יש לו הרשאה מפורשת (agentCanCharge) מהמנהל.
    // בדיקת ההרשאה המלאה (כולל שייכות לנקודה) מתבצעת בהמשך, אחרי טעינת ההזמנה,
    // כי אנחנו צריכים לדעת ל-pointId של ההזמנה קודם.
    const isAgent = !isAdmin && role === "AGENT";
    if (!isAdmin && !isAgent) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }

    // 2. פרסינג ה-body
    const body = await req.json().catch(() => ({}));
    orderId = String(body?.orderId || "").trim();
    if (!orderId) {
      return NextResponse.json({ error: "missing orderId" }, { status: 400 });
    }

    // §189: מספר תשלומים שנקבע **ברגע החיוב**.
    //
    // 🐛 מה שהיה: המערכת השתמשה ב-requestedInstallments מההזמנה
    // בלבד - כלומר מה שהלקוח ביקש באתר, ורק כשהסכום עלה על 800.
    // הנציג שעמד מול הלקוח ושמע "אפשר לפרוס?" לא יכול היה לעשות
    // כלום, והלקוח נאלץ לוותר או לשלם במזומן.
    //
    // ⚠️ 1-12: זה הטווח שנדרים תומכים בו. מעבר לזה החיוב נדחה
    // אצלם עם שגיאה גנרית שקשה לאבחן.
    //
    // ⚠️ אם לא נשלח - נופלים למה שההזמנה ביקשה, כדי שקריאות
    // קיימות ימשיכו לעבוד בדיוק כמו קודם.
    const rawInst = body?.installments;
    let overrideInstallments: number | null = null;
    if (rawInst != null && rawInst !== "") {
      const n = Number(rawInst);
      if (!Number.isInteger(n) || n < 1 || n > 12) {
        return NextResponse.json(
          { error: "מספר תשלומים חייב להיות בין 1 ל-12" },
          { status: 400 }
        );
      }
      overrideInstallments = n;
    }

    // 3. טעינת ההזמנה לפני נעילה - לצורך validations
    const preOrder = await prisma.order.findUnique({
      where: { id: orderId },
      include: {
        customer: true,
        // point + items נטענים כדי לבנות את טקסט ה-"עבור" (Avour) העשיר
        // שנדרים מציגים למנהל במייל: נקודת חלוקה + עיר + תאריך + מס' פריטים.
        point: true,
        items: true,
      },
    });

    if (!preOrder) {
      return NextResponse.json({ error: "order not found" }, { status: 404 });
    }

    // 🆕 הרשאת AGENT מלאה - רק עכשיו שיש לנו preOrder עם pointId+customer.
    // מותר לנציג לחייב רק אם:
    //   א. יש לו agentCanCharge=true (המנהל העניק הרשאה)
    //   ב. וגם: הוא יצר את הלקוח, או שההזמנה בנקודת החלוקה שלו
    if (isAgent) {
      const agent = await prisma.customer.findUnique({
        where: { id: sessionUserId },
        select: {
          agentCanCharge: true,
          agentPointId: true, // deprecated - תאימות אחורה
          agentPoints: { select: { pointId: true } },
        },
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
      // §60: 🐛 תוקן דפוס ג'. הבדיקה השוותה רק ל-agentPointId הישן,
      // ולכן נציג רב-נקודתי (agentPoints[] מלא, agentPointId ריק) קיבל
      // "אין הרשאה" על הזמנות בנקודות שלו עצמו.
      const agentPointIds = new Set(agent.agentPoints.map((ap) => ap.pointId));
      if (agent.agentPointId) agentPointIds.add(agent.agentPointId);
      const isCreator = preOrder.customer.createdByAgentId === sessionUserId;
      const samePoint = agentPointIds.has(preOrder.pointId);
      if (!isCreator && !samePoint) {
        return NextResponse.json(
          { error: "אין הרשאה להזמנה זו - היא לא בנקודת החלוקה שלך" },
          { status: 403 }
        );
      }
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
    // §60: לקוח מזומן - אין חיוב כרטיס בכלל, גם אם נשאר לו טוקן
    // (למשל נציג העביר אותו למזומן והטוקן נשמר לחזרה עתידית לאשראי).
    // בלי הבדיקה הזו לקוח מזומן בלי טוקן היה נופל על "customer has no
    // saved card" - הודעה שגויה שגורמת למנהל לרדוף אחרי כרטיס שלא
    // אמור להיות. הגבייה: מזומן בחלוקה, דרך "סימון תשלום מזומן"
    // במסך ההזמנה.
    if (preOrder.customer.paymentPreference === "CASH") {
      return NextResponse.json(
        {
          error:
            "לקוח מזומן - אין לחייב כרטיס. הגבייה מתבצעת במזומן בחלוקה, ומסומנת דרך 'תשלום מזומן' במסך ההזמנה.",
          code: "CASH_CUSTOMER",
        },
        { status: 400 }
      );
    }
    if (!preOrder.customer.paymentToken) {
      return NextResponse.json({ error: "customer has no saved card" }, { status: 400 });
    }
    // Tokef חובה לפי תיעוד DebitCard הרשמי של נדרים.
    // בלי תוקף - החיוב ייכשל בוודאות. עדיף לחסום כאן עם הודעה ברורה.
    if (!preOrder.customer.cardExpiry) {
      return NextResponse.json(
        {
          error:
            "חסר תוקף כרטיס (Tokef) - לא ניתן לחייב. הלקוח צריך לעדכן את הכרטיס מחדש כדי שהתוקף יישמר.",
        },
        { status: 400 }
      );
    }
    if (preOrder.customer.cardNeedsUpdate) {
      return NextResponse.json({ error: "customer needs to update card first" }, { status: 400 });
    }

    // 4. חישוב סכום החיוב
    // §19: ה-1₪ שחויב באימות הכרטיס (יצירת הטוקן) הוא מקדמה, לא עמלה!
    // הוא מקוזז מההזמנה הראשונה בלבד של הלקוח - creditVerificationCharged
    // מסמן אם הקיזוז כבר נוצל (אם true - אין יותר קיזוז, ההזמנה משלמת מלא).
    const finalTotalNum = Number(preOrder.finalTotal);
    const shouldDeductVerification =
      !preOrder.customer.creditVerificationCharged && finalTotalNum > 1;
    const chargeAmount = shouldDeductVerification
      ? Math.round((finalTotalNum - 1) * 100) / 100
      : finalTotalNum;

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
    console.log(
      `[charge-route] Charge initiated by ${isAdmin ? "ADMIN" : "AGENT"} (${sessionEmail || sessionUserId}) for order ${orderId}`
    );
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
    // בניית טקסט "עבור" עשיר למייל שנדרים שולחים למנהל.
    // נקודת החלוקה: מעדיפים את ה-snapshot (מה שהלקוח ראה בזמן ההזמנה),
    // ונופלים לנקודה החיה אם ה-snapshot ריק.
    // ספירת הפריטים: רק פריטים שלא בוטלו (isCancelled=false).
    const itemCount = (preOrder.items || []).filter(
      (it: { isCancelled: boolean }) => !it.isCancelled
    ).length;
    const avourText = buildChargeAvour({
      orderNumber: preOrder.orderNumber,
      pointName: preOrder.pointNameSnapshot || preOrder.point?.name || null,
      pointCity: preOrder.point?.city || null,
      deliveryDate: preOrder.deliveryDateSnapshot || null,
      itemCount,
    });

    const result = await chargeToken({
      token: preOrder.customer.paymentToken,
      tokef: preOrder.customer.cardExpiry || undefined,
      amount: chargeAmount,
      orderRef: String(preOrder.orderNumber),
      avourText,
      clientName: preOrder.customer.name || preOrder.customerName,
      phone: preOrder.customer.phone || preOrder.phone,
      email: preOrder.customer.email || undefined,
      // §189: מספר התשלומים.
      //
      // ⚠️ סדר העדיפות: מה שהנציג בחר עכשיו > מה שהלקוח ביקש
      // בהזמנה > תשלום אחד. הנציג עומד מול הלקוח וזה הרגע שבו
      // ההחלטה נכונה ביותר.
      tashloumim:
        overrideInstallments ?? (preOrder as any).requestedInstallments ?? 1,
    });

    // ═══════════════════════════════════════════════════════════════
    // Phase E: טיפול בתוצאה
    // ═══════════════════════════════════════════════════════════════

    // ── E1. הצלחה ─────────────────────────────────────────────
    if (result.ok) {
      const successfulTransactionId = result.transactionId;

      // Fix #4: DB update נפרד בtry/catch כדי לא לאבד את הצלחת החיוב
      try {
        // $transaction אטומי: מסמנים PAID + (אם קוזז) מסמנים creditVerificationCharged=true
        // כדי שההזמנה הבאה לא תקבל קיזוז נוסף. שני העדכונים חייבים לקרות יחד -
        // אחרת עלול להיווצר מצב שבו הקיזוז נוצל בפועל אבל הסימון לא נשמר.
        await prisma.$transaction([
          prisma.order.update({
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
          }),
          ...(shouldDeductVerification
            ? [
                prisma.customer.update({
                  where: { id: preOrder.customer.id },
                  data: { creditVerificationCharged: true },
                }),
              ]
            : []),
        ]);
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
