import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { chargeToken } from "@/lib/nedarim-lib";

// POST /api/customer/save-token
//
// נקרא מהclient אחרי שה-iframe של נדרים מחזיר TransactionResponse
// עם Status=OK ו-Token. במצב CreateToken, נדרים לא שולחים webhook
// (כי אין חיוב) — הטוקן מגיע רק דרך postMessage.
//
// Body: { token: string, lastNum?: string, tokef?: string, customerId?: string }
//
// ═══════════════════════════════════════════════════════════════════
// §46: חיוב אימות של 1₪
// ═══════════════════════════════════════════════════════════════════
// 🐛 הבאג שתוקן: PaymentType=CreateToken ב-iframe *יוצר טוקן בלי
// לחייב* - ה-Amount=1 מוצג ללקוח אך לא נגבה. במקביל charge/route
// קיזז 1₪ מההזמנה הראשונה בהנחה שהוא חויב. התוצאה: כל לקוח חדש
// קיבל שקל הנחה שמעולם לא שילם.
//
// הפתרון: מיד אחרי שהטוקן מתקבל, מחייבים איתו 1₪ בפועל - דרך
// chargeToken, אותו נתיב שכבר עובד בחיוב הזמנות.
//
// למה זה גם משפר את האבטחה: טוקן שנוצר אינו מוכיח שהכרטיס בר-חיוב.
// חיוב של שקל אחד מגלה כרטיס חסום או פג-תוקף *באימות*, ולא אחרי
// שהסחורה כבר חולקה.
//
// אם החיוב נכשל - הלקוח לא מסומן כמאומת (cardVerifiedAt נשאר ריק)
// והטוקן לא נשמר. זו כל מטרת האימות.

export async function POST(req: Request) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "יש להתחבר" }, { status: 401 });
    }
    const sessionUserId = (session.user as any).id as string;
    const role = (session.user as any).role;

    const body = await req.json().catch(() => ({}));

    // 🆕 תמיכה בעדכון עבור לקוח אחר (מנהל/נציג) - לפי customerId ב-body.
    // ברירת מחדל: הלקוח עצמו (session).
    let targetCustomerId = sessionUserId;
    if (body?.customerId && body.customerId !== sessionUserId) {
      if (role !== "ADMIN" && role !== "AGENT") {
        return NextResponse.json({ error: "אין הרשאה" }, { status: 403 });
      }
      // נציג - רק אם יש לו הרשאת עדכון כרטיסים
      if (role === "AGENT") {
        const agent = await prisma.customer.findUnique({
          where: { id: sessionUserId },
          select: { agentCanUpdateCards: true },
        });
        if (!agent?.agentCanUpdateCards) {
          return NextResponse.json(
            { error: "אין לך הרשאה לעדכן כרטיסי לקוחות" },
            { status: 403 }
          );
        }
      }
      targetCustomerId = String(body.customerId);
    }

    const token = String(body?.token || "").trim();
    const lastNum = String(body?.lastNum || "").trim();
    // Tokef בפורמט MMYY - חובה בחיוב עתידי לפי תיעוד DebitCard!
    const tokef = String(body?.tokef || "").trim();

    if (!token) {
      return NextResponse.json({ error: "missing token" }, { status: 400 });
    }

    // אזהרה בלוג אם אין תוקף - החיוב העתידי עלול להיכשל
    if (!tokef) {
      console.warn(
        `[save-token] ⚠️ WARNING: Token saved WITHOUT Tokef for customer=${targetCustomerId}. ` +
          `Per Nedarim DebitCard docs, Tokef is REQUIRED for charging. Future charge may fail!`
      );
    }
    // ולידציה של פורמט תוקף - MMYY, חודש 01-12
    if (tokef && !/^\d{4}$/.test(tokef)) {
      console.warn(`[save-token] ⚠️ Invalid Tokef format: "${tokef}" - expected MMYY`);
    } else if (tokef) {
      const mm = parseInt(tokef.slice(0, 2), 10);
      if (mm < 1 || mm > 12) {
        return NextResponse.json(
          { error: `תוקף לא תקין: חודש ${tokef.slice(0, 2)} אינו קיים (חייב 01-12)` },
          { status: 400 }
        );
      }
    }

    // ═══════════════════════════════════════════════════════════════
    // §46: חיוב אימות של 1₪
    // ═══════════════════════════════════════════════════════════════
    const customer = await prisma.customer.findUnique({
      where: { id: targetCustomerId },
      select: {
        id: true,
        name: true,
        phone: true,
        email: true,
        creditVerificationCharged: true,
        paymentToken: true,
      },
    });
    if (!customer) {
      return NextResponse.json({ error: "לקוח לא נמצא" }, { status: 404 });
    }

    // מחייבים פעם אחת בלבד בחיי הלקוח. החלפת כרטיס אצל לקוח שכבר
    // אומת לא מחייבת שוב - אחרת היו נצברים קיזוזים כפולים.
    const needsVerificationCharge = !customer.creditVerificationCharged;
    let verificationTxnId: string | null = null;

    if (needsVerificationCharge) {
      // בלי תוקף החיוב ייכשל בוודאות - עדיף לחסום כאן עם הודעה ברורה
      if (!tokef) {
        return NextResponse.json(
          {
            error:
              "חסר תוקף כרטיס. יש להזין את התוקף בפורמט MMYY כדי שנוכל לאמת את הכרטיס.",
          },
          { status: 400 }
        );
      }

      console.log(
        `[save-token] Charging 1 ILS verification for customer=${targetCustomerId}`
      );

      const charge = await chargeToken({
        token,
        tokef,
        amount: 1,
        orderRef: `VERIFY-${targetCustomerId.slice(-8)}`,
        avourText: "אימות כרטיס אשראי - נזקף לזכות ההזמנה הראשונה",
        clientName: customer.name,
        phone: customer.phone || undefined,
        email: customer.email || undefined,
        tashloumim: 1,
      });

      if (!charge.ok) {
        // ⚠️ הכרטיס לא בר-חיוב. לא שומרים טוקן ולא מסמנים כמאומת -
        // זו בדיוק המטרה של האימות. עדיף לגלות כאן מאשר אחרי החלוקה.
        console.warn(
          `[save-token] ❌ Verification charge FAILED for customer=${targetCustomerId}: ${charge.error}`
        );
        return NextResponse.json(
          {
            error:
              charge.error ||
              "הכרטיס נדחה באימות. יש לנסות כרטיס אחר או לפנות לחברת האשראי.",
            cardProblem: true,
          },
          { status: 400 }
        );
      }

      verificationTxnId = charge.transactionId ?? null;
      console.log(
        `[save-token] ✅ Verification charged 1 ILS, txn=${verificationTxnId}`
      );
    }

    // שמירת הטוקן + סימון הלקוח כמאומת
    await prisma.customer.update({
      where: { id: targetCustomerId },
      data: {
        paymentToken: token,
        cardLast4: lastNum || null,
        ...(tokef ? { cardExpiry: tokef } : {}),
        cardVerifiedAt: new Date(),
        cardNeedsUpdate: false,
        // §46: creditVerificationCharged נשאר false בכוונה!
        // הוא מסמן שהקיזוז *נוצל*, לא שהחיוב בוצע. charge/route
        // מקזז את השקל בהזמנה הראשונה ורק אז מסמן true.
      },
    });

    // קידום הזמנות שממתינות לטוקן (כולל FAILED - כרטיס חדש = הזדמנות חדשה)
    const pendingOrders = await prisma.order.findMany({
      where: {
        customerId: targetCustomerId,
        paymentStatus: { in: ["PENDING", "PAYMENT_PENDING", "CARD_UPDATE_NEEDED", "FAILED"] },
      },
      select: { id: true, finalTotal: true },
    });

    let promotedCount = 0;
    for (const o of pendingOrders) {
      const nextStatus =
        o.finalTotal !== null && o.finalTotal !== undefined
          ? "READY_TO_CHARGE"
          : "TOKEN_CREATED";
      await prisma.order.update({
        where: { id: o.id },
        data: {
          paymentStatus: nextStatus,
          lastChargeError: null, // מנקים שגיאה ישנה - כרטיס חדש
        },
      });
      promotedCount++;
    }

    // מנקים גם lastChargeError משאר ההזמנות של הלקוח (שלא היו ברשימה למעלה)
    await prisma.order.updateMany({
      where: {
        customerId: targetCustomerId,
        lastChargeError: { not: null },
      },
      data: { lastChargeError: null },
    });

    console.log(
      `[save-token] Token saved for customer=${targetCustomerId} (by ${sessionUserId}) ` +
        `last4=${lastNum || "none"} tokef=${tokef || "MISSING"} ` +
        `verificationCharge=${needsVerificationCharge ? verificationTxnId || "OK" : "skipped"} ` +
        `promotedOrders=${promotedCount}`
    );

    return NextResponse.json({
      ok: true,
      promotedOrders: promotedCount,
      verificationCharged: needsVerificationCharge,
      verificationTransactionId: verificationTxnId,
    });
  } catch (e: any) {
    console.error("POST /api/customer/save-token exception:", e);
    return NextResponse.json({ error: "שגיאת שרת" }, { status: 500 });
  }
}
