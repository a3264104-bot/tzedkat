import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";

// GET /api/admin/payments
//
// מחזיר רשימת PayOrder[] למסך ניהול התשלומים (§19).
// ברירת מחדל: מציג הזמנות שרלוונטיות לפעולה של המנהל -
// טוקן נוצר, ממתין לשקילה, מוכן לחיוב, חיוב בתהליך, נכשל, נדרש עדכון כרטיס.
// לא מציג PAID (הסתיים) או PENDING (עדיין אין טוקן, אין מה לחייב).
//
// Query params:
//   ?status=all    → כל הסטטוסים כולל PAID/PENDING
//   ?status=FAILED → סינון סטטוס יחיד
//   (בלי) → ברירת המחדל של §19
//
// ⚠️ אימות admin: משתמש ב-auth() של Auth.js v5. אם המבנה שונה בפרויקט
// (למשל role נשמר במקום אחר), עדכן את הבדיקה בהתאם - הלוגיקה של השאילתה
// נכונה בכל מקרה.
const DEFAULT_STATUSES = [
  "TOKEN_CREATED",
  "AWAITING_WEIGHING",
  "READY_TO_CHARGE",
  "CHARGING",
  "FAILED",
  "CARD_UPDATE_NEEDED",
];

export async function GET(req: NextRequest) {
  try {
    // אימות admin
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
    // תמיכה בשני מבני role אפשריים: session.user.role, או Admin table lookup לפי email
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

    // סינון סטטוס
    const url = new URL(req.url);
    const statusParam = url.searchParams.get("status");

    let whereClause: { paymentStatus?: string | { in: string[] } } = {};
    if (statusParam === "all") {
      // בלי סינון
    } else if (statusParam && statusParam.length > 0) {
      whereClause = { paymentStatus: statusParam };
    } else {
      whereClause = { paymentStatus: { in: DEFAULT_STATUSES } };
    }

    const orders = await prisma.order.findMany({
      where: whereClause,
      orderBy: [
        // מציגים קודם את הדורש-פעולה: FAILED / CARD_UPDATE_NEEDED / READY_TO_CHARGE
        // הכי חדשים ראשונים
        { updatedAt: "desc" },
      ],
      select: {
        id: true,
        orderNumber: true,
        customerName: true,
        phone: true,
        paymentStatus: true,
        paymentMethod: true,
        estimatedTotal: true,
        finalTotal: true,
        amountPaid: true,
        paidAt: true,
        paymentTransactionId: true,
        chargeAttempts: true,
        lastChargeError: true,
        lastChargeAt: true,
        createdAt: true,
        updatedAt: true,
        pointNameSnapshot: true,
        deliveryDateSnapshot: true,
        customer: {
          select: {
            id: true,
            name: true,
            email: true,
            phone: true,
            paymentToken: true,
            cardLast4: true,
            cardExpiry: true,
            cardVerifiedAt: true,
            cardNeedsUpdate: true,
            creditVerificationCharged: true,
          },
        },
      },
    });

    // ממירים ל-PayOrder[]: מסיפים hasToken (bool) כדי לא לחשוף את הטוקן הגולמי לצד לקוח
    const payOrders = orders.map((o) => ({
      id: o.id,
      orderNumber: o.orderNumber,
      customerName: o.customerName,
      phone: o.phone,
      paymentStatus: o.paymentStatus,
      paymentMethod: o.paymentMethod,
      estimatedTotal: o.estimatedTotal ? Number(o.estimatedTotal) : null,
      finalTotal: o.finalTotal ? Number(o.finalTotal) : null,
      amountPaid: o.amountPaid ? Number(o.amountPaid) : null,
      paidAt: o.paidAt ? o.paidAt.toISOString() : null,
      paymentTransactionId: o.paymentTransactionId,
      chargeAttempts: o.chargeAttempts,
      lastChargeError: o.lastChargeError,
      lastChargeAt: o.lastChargeAt ? o.lastChargeAt.toISOString() : null,
      createdAt: o.createdAt.toISOString(),
      updatedAt: o.updatedAt.toISOString(),
      pointNameSnapshot: o.pointNameSnapshot,
      deliveryDateSnapshot: o.deliveryDateSnapshot,
      customer: {
        id: o.customer.id,
        name: o.customer.name,
        email: o.customer.email,
        phone: o.customer.phone,
        hasToken: !!o.customer.paymentToken,
        cardLast4: o.customer.cardLast4,
        cardExpiry: o.customer.cardExpiry,
        cardVerifiedAt: o.customer.cardVerifiedAt ? o.customer.cardVerifiedAt.toISOString() : null,
        cardNeedsUpdate: o.customer.cardNeedsUpdate,
        creditVerificationCharged: o.customer.creditVerificationCharged,
      },
    }));

    return NextResponse.json({ orders: payOrders, count: payOrders.length });
  } catch (e) {
    console.error("GET /api/admin/payments exception:", e);
    return NextResponse.json({ error: "server error" }, { status: 500 });
  }
}
