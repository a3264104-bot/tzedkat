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
//   ?status=all           → כל הסטטוסים כולל PAID/PENDING
//   ?status=FAILED        → סינון סטטוס יחיד
//   ?pricelistId=<id>     → 🆕 סינון למכירה מסוימת
//   (בלי) → ברירת המחדל של §19, כל המכירות
//
// ⚠️ אימות admin: משתמש ב-auth() של Auth.js v5.
// §256: 🐛 **PENDING לא היה ברשימה — והוא הסטטוס של כולם.**
//
// הרשימה נבנתה סביב READY_TO_CHARGE, שאמור לסמן "מוכן לחיוב".
// אבל אין בקוד שום מקום שמסמן אותו (§250) - הוא משמש רק
// כ-recovery אחרי כישלון.
//
// התוצאה בשטח: 250 הזמנות ב-PENDING, 4 מהן עם מחיר סופי -
// ואף אחת לא הופיעה במסך התשלומים. המנהל ראה מסך כמעט ריק
// ולא הבין למה.
//
// ⚠️ PENDING הוא ברירת המחדל של כל הזמנה חדשה, ולכן הרשימה
// תכלול גם הזמנות שטרם נשקלו. **וזה בסדר**: המסך מציג אותן
// עם "טרם נקבע מחיר סופי" והכפתור מוסתר, כך שהמנהל רואה את
// התמונה המלאה ולא רק את מה שמוכן.
const DEFAULT_STATUSES = [
  "PENDING",
  "TOKEN_CREATED",
  "AWAITING_WEIGHING",
  "READY_TO_CHARGE",
  "CHARGING",
  "FAILED",
  "CARD_UPDATE_NEEDED",
  // ⚠️ תשלום חלקי — נשאר פתוח עד שהיתרה נגבית.
  "PARTIALLY_PAID",
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

    const url = new URL(req.url);
    const statusParam = url.searchParams.get("status");
    // 🆕 סינון לפי מכירה. אם לא נשלח - כל המכירות (כדי לא להסתיר
    // חיובים שנכשלו במכירות קודמות, שהם בדיוק מה שהמסך אמור לתפוס).
    const pricelistId = url.searchParams.get("pricelistId") || undefined;

    // סינון סטטוס
    const whereClause: {
      paymentStatus?: string | { in: string[] } | { notIn: string[] };
      // §258: לסינון "ניתן לחייב עכשיו"
      finalTotal?: { not: null };
      pricelistId?: string;
    } = {};
    if (statusParam === "all") {
      // בלי סינון סטטוס
    } else if (statusParam && statusParam.length > 0) {
      // §258: "ניתן לחייב עכשיו" = יש מחיר סופי ולא שולם.
      //
      // ⚠️ **לא** סטטוס: READY_TO_CHARGE אינו נכתב בשום מקום
      // (§250), וסינון לפיו החזיר רשימה ריקה תמיד. הקריטריון
      // האמיתי הוא מה שהכפתור בודק - מחיר סופי קיים.
      if (statusParam === "chargeable") {
        whereClause.finalTotal = { not: null };
        whereClause.paymentStatus = {
          notIn: ["PAID", "CHARGING", "PAYMENT_PENDING"],
        };
      } else {
        whereClause.paymentStatus = statusParam;
      }
    } else {
      whereClause.paymentStatus = { in: DEFAULT_STATUSES };
    }
    if (pricelistId) {
      whereClause.pricelistId = pricelistId;
    }

    const orders = await prisma.order.findMany({
      where: whereClause,
      orderBy: [
        // §256: **מה שמוכן לחיוב קודם.**
        //
        // 🐛 אחרי שהוספנו PENDING לרשימה, המסך מציג 250 הזמנות -
        // ו-4 שבאמת אפשר לחייב נקברות ביניהן. מיון לפי updatedAt
        // בלבד היה מציג את מי שנגע בו אחרון, לא את מי שדורש
        // פעולה.
        //
        // §259: 🐛 הנחתי ש-NULL יורד לסוף ב-desc — ובפועל
        // PostgreSQL ממיין אותו **ראשון**, וההזמנות המוכנות
        // נדחקו לתחתית של 250 שורות.
        //
        // ⚠️ nulls: "last" מפורש: זו הדרך היחידה לשלוט בזה,
        // ולא להסתמך על ברירת המחדל של מסד הנתונים.
        { finalTotal: { sort: "desc", nulls: "last" } },
        { updatedAt: "desc" },
      ],
      // ⚠️ תקרה: 250 הזמנות עם כל השדות זה עמוד כבד בנייד.
      // המנהל מסנן לפי מכירה או סטטוס כשהוא צריך משהו ספציפי.
      take: 300,
      select: {
        id: true,
        orderNumber: true,
        customerName: true,
        phone: true,
        paymentStatus: true,
        paymentMethod: true,
        estimatedTotal: true,
        finalTotal: true,
        // §260: מה שהלקוח ביקש באתר - ברירת המחדל בבורר.
        //
        // ⚠️ בלעדיו המנהל צריך לזכור מי ביקש פריסה, וזו בדיוק
        // הבעיה שהבורר בא לפתור.
        requestedInstallments: true,
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

    // ממירים ל-PayOrder[]: חושפים hasToken (bool) כדי לא לחשוף את הטוקן הגולמי לצד לקוח
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
