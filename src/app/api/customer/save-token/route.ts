import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";

// POST /api/customer/save-token
//
// נקרא מהclient אחרי שה-iframe של נדרים מחזיר TransactionResponse
// עם Status=OK ו-Token. במצב CreateToken, נדרים לא שולחים webhook
// (כי אין חיוב) — הטוקן מגיע רק דרך postMessage.
//
// Body: { token: string, lastNum?: string, tokef?: string }
//
// אבטחה:
//   - רק משתמש מחובר
//   - הטוקן חייב להיות מחרוזת לא ריקה
//   - לא שומרים מזהים שאינם טוקן (TransactionId, UID וכד') — רק מה שנדרים
//     מציינים במפורש כ-Token בתשובת CreateToken

export async function POST(req: Request) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "יש להתחבר" }, { status: 401 });
    }
    const customerId = (session.user as any).id as string;

    const body = await req.json().catch(() => ({}));
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
        `[save-token] ⚠️ WARNING: Token saved WITHOUT Tokef for customer=${customerId}. ` +
          `Per Nedarim DebitCard docs, Tokef is REQUIRED for charging. Future charge may fail!`
      );
    }

    // שמירת הטוקן + סימון הלקוח כמאומת
    await prisma.customer.update({
      where: { id: customerId },
      data: {
        paymentToken: token,
        cardLast4: lastNum || null,
        ...(tokef ? { cardExpiry: tokef } : {}),
        cardVerifiedAt: new Date(),
        cardNeedsUpdate: false,
      },
    });

    // קידום הזמנות שממתינות לטוקן
    const pendingOrders = await prisma.order.findMany({
      where: {
        customerId,
        paymentStatus: { in: ["PENDING", "PAYMENT_PENDING", "CARD_UPDATE_NEEDED"] },
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
        data: { paymentStatus: nextStatus },
      });
      promotedCount++;
    }

    console.log(
      `[save-token] Token saved for customer=${customerId} last4=${lastNum || "none"} promotedOrders=${promotedCount}`
    );

    return NextResponse.json({ ok: true, promotedOrders: promotedCount });
  } catch (e: any) {
    console.error("POST /api/customer/save-token exception:", e);
    return NextResponse.json({ error: "שגיאת שרת" }, { status: 500 });
  }
}
