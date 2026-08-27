// ═══════════════════════════════════════════════════════════════
// §123: זיכוי ללקוח
// ═══════════════════════════════════════════════════════════════
// POST /api/agent/orders/[id]/credit   { amount, reason }
// amount = null מבטל זיכוי קיים.
//
// התרחיש: מוצר הגיע פגום, חסר חצי קילו, או כל תקלה אחרת בחלוקה.
// הנציג מזכה סכום, והלקוח משלם פחות.
//
// ⚠️ הסיבה חובה. זיכוי בלי הסבר הוא כסף שיצא בלי תיעוד, והלקוח
// שרואה שורה במייל צריך לדעת על מה קיבל אותה.

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAgent } from "@/lib/agent-guard";
// §124: מייל על יתרת זכות
import { sendCreditBalanceEmail } from "@/lib/email";
// §136: קיזוז יתרת זכות - אותה נוסחה בכל נקודות החישוב
import { applyBalanceToOrder } from "@/lib/credit-balance-lib";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const g = await requireAgent();
  if (!g.ok) return g.res;

  const { id } = await params;
  const b = await req.json().catch(() => ({}));

  const order = await prisma.order.findUnique({
    where: { id },
    select: {
      id: true,
      orderNumber: true,
      pointId: true,
      status: true,
      finalTotal: true,
      estimatedTotal: true,
      customerId: true,
      paymentStatus: true,
      // §309: נעילה אחרי שליחת המייל
      weightsLockedAt: true,
      creditAmount: true,
      pricelistId: true,
    },
  });
  if (!order) {
    return NextResponse.json({ error: "הזמנה לא נמצאה" }, { status: 404 });
  }

  // בדיקת שייכות. מערך ריק אצל נציג = אין נקודות, לא "בלי הגבלה".
  if (!g.isAdmin) {
    if (g.agentPointIds.length === 0) {
      return NextResponse.json(
        { error: "אין לך נקודת חלוקה משויכת. פנה למנהל." },
        { status: 403 }
      );
    }
    if (!g.agentPointIds.includes(order.pointId)) {
      return NextResponse.json(
        { error: "אין הרשאה - ההזמנה לא באחת מהנקודות שלך" },
        { status: 403 }
      );
    }
  }

  // §124: הזמנה ששולמה -> יתרת זכות למכירה הבאה.
  //
  // 🐛 מה שהיה: חסימה מוחלטת. הנציג נחסם והופנה למנהל, ולמנהל
  // לא היה מסך לעשות את זה - כלומר מבוי סתום.
  //
  // עכשיו: הזיכוי נשמר כיתרה על הלקוח ומקוזז אוטומטית בהזמנה
  // הבאה. אין החזר כספי, אין התעסקות מול הסליקה, והלקוח מקבל
  // את מה שמגיע לו.

  // §309: 🔒 זיכוי אחרי המייל משנה את הסכום שהלקוח מחזיק.
  if ((order as any).weightsLockedAt) {
    return NextResponse.json(
      {
        error: "ההזמנה נעולה — נשלח ללקוח מייל עם הסכום הסופי.",
        code: "WEIGHTS_LOCKED",
      },
      { status: 423 }
    );
  }
  const alreadyPaid =
    order.paymentStatus === "PAID" || order.paymentStatus === "PARTIALLY_PAID";

  // ─── ביטול זיכוי ───
  if (b.amount === null || b.amount === undefined || b.amount === "") {
    await prisma.order.update({
      where: { id },
      data: {
        creditAmount: null,
        creditReason: null,
        creditById: null,
        creditAt: null,
      },
    });
    await recomputeTotal(id);
    return NextResponse.json({ ok: true, cleared: true });
  }

  // ─── ולידציה ───
  const amount = Number(b.amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    return NextResponse.json(
      { error: "סכום הזיכוי חייב להיות מספר חיובי" },
      { status: 400 }
    );
  }

  const reason = String(b.reason || "").trim();
  if (!reason) {
    return NextResponse.json(
      { error: "יש לציין את סיבת הזיכוי - הלקוח יראה אותה בפירוט" },
      { status: 400 }
    );
  }
  if (reason.length > 200) {
    return NextResponse.json(
      { error: "סיבת הזיכוי ארוכה מדי (מקסימום 200 תווים)" },
      { status: 400 }
    );
  }

  // ⚠️ הזיכוי לא יכול לעלות על סכום ההזמנה - אחרת נוצר סכום שלילי
  // שהמערכת תנסה "לחייב", וזו התנהגות בלתי מוגדרת מול הסליקה.
  const base = Number(order.finalTotal ?? order.estimatedTotal ?? 0);
  if (base > 0 && amount > base) {
    return NextResponse.json(
      {
        error: `הזיכוי (${amount.toFixed(2)}) גבוה מסכום ההזמנה (${base.toFixed(2)}). לא ניתן לזכות מעבר לסכום.`,
      },
      { status: 400 }
    );
  }

  if (alreadyPaid) {
    // ⚠️ היתרה **נצברת** ולא נדרסת. לקוח שקיבל שני זיכויים על
    // שתי הזמנות שונות צריך לקבל את שניהם.
    const cust = await prisma.customer.findUnique({
      where: { id: order.customerId },
      select: { creditBalance: true, name: true, email: true },
    });
    const prev = Number(cust?.creditBalance ?? 0);
    const newBalance = Math.round((prev + amount) * 100) / 100;

    await prisma.$transaction([
      prisma.customer.update({
        where: { id: order.customerId },
        data: {
          creditBalance: newBalance,
          creditBalanceNote: reason,
          creditBalanceAt: new Date(),
        },
      }),
      // נשמר גם על ההזמנה - לתיעוד ולתצוגה בכרטיס
      prisma.order.update({
        where: { id },
        data: {
          creditAmount: amount,
          creditReason: reason,
          creditById: g.agent.id,
          creditAt: new Date(),
        },
      }),
    ]);

    // מייל ללקוח. לא חוסם - כשל שליחה לא יבטל זיכוי שכבר נרשם.
    if (cust?.email) {
      sendCreditBalanceEmail({
        customerName: cust.name,
        email: cust.email,
        amount,
        reason,
        newBalance,
        orderNumber: order.orderNumber,
      }).catch((e) => console.error("[credit] email failed:", e));
    }

    console.log(
      `[credit] order #${order.orderNumber} PAID -> balance ${prev} + ${amount} = ${newBalance}`
    );

    return NextResponse.json({
      ok: true,
      asBalance: true,
      creditAmount: amount,
      creditReason: reason,
      newBalance,
    });
  }

  await prisma.order.update({
    where: { id },
    data: {
      creditAmount: amount,
      creditReason: reason,
      creditById: g.agent.id,
      creditAt: new Date(),
    },
  });

  const newTotal = await recomputeTotal(id);

  console.log(
    `[credit] order #${order.orderNumber} credited ${amount} by agent=${g.agent.id} reason="${reason}"`
  );

  return NextResponse.json({
    ok: true,
    creditAmount: amount,
    creditReason: reason,
    finalTotal: newTotal,
  });
}

/**
 * §123: חישוב מחדש של המחיר הסופי אחרי שינוי בזיכוי.
 *
 * ⚠️ רק אם **כל** הפריטים כבר נשקלו. לפני כן finalTotal הוא null
 * בכוונה, והזיכוי ייכנס אוטומטית כשהמחיר ייקבע - אותו כלל שכבר
 * קיים בחישוב הראשי.
 */
async function recomputeTotal(orderId: string): Promise<number | null> {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: {
      pricelistId: true,
      creditAmount: true,
      // §136: 🐛 חסרו כאן. נציג שסימן משלוח ואז נתן זיכוי - דמי
      // המשלוח והחיוב הנוסף **נמחקו**, כי הנוסחה כאן לא הכירה
      // אותם. הלקוח היה מחויב פחות מהמוסכם.
      deliveryFee: true,
      deliveryRequested: true,
      extraCharge: true,
      customerId: true,
      appliedCreditBalance: true,
      // §266: מצב התשלום — לסימון READY_TO_CHARGE אחרי הזיכוי.
      //
      // ⚠️ זו השליפה השנייה בקובץ. הראשונה (שורה 33) כן כוללת
      // אותו, וההנחה שהשדה קיים גם כאן היא בדיוק סוג הטעות
      // שחוזרת: שתי שליפות לאותו אובייקט עם select שונה.
      paymentStatus: true,
      items: { where: { isCancelled: false }, select: { finalPrice: true } },
    },
  });
  if (!order || order.items.length === 0) return null;

  const allWeighed = order.items.every((i) => i.finalPrice !== null);
  if (!allWeighed) return null;

  const itemsSum = order.items.reduce((s, i) => s + Number(i.finalPrice), 0);
  const pl = order.pricelistId
    ? await prisma.pricelist.findUnique({
        where: { id: order.pricelistId },
        select: { orderFee: true },
      })
    : null;
  const credit = order.creditAmount != null ? Number(order.creditAmount) : 0;
  // §136: אותה נוסחה כמו בשאר שלוש הנקודות. חוסר עקביות כאן
  // פירושו שהסכום תלוי במי נגע בהזמנה אחרון.
  const delivery =
    order.deliveryRequested && order.deliveryFee != null
      ? Number(order.deliveryFee)
      : 0;
  const extra = order.extraCharge != null ? Number(order.extraCharge) : 0;

  // ⚠️ Math.max(0, ...) - רשת ביטחון. הוולידציה חוסמת זיכוי גדול
  // מהסכום, אבל פריט שבוטל אחרי הזיכוי יכול להקטין את הבסיס.
  // סכום שלילי מול הסליקה הוא התנהגות בלתי מוגדרת.
  const beforeBalance = Math.max(
    0,
    Math.round(
      (itemsSum + Number(pl?.orderFee ?? 0) + delivery + extra - credit) * 100
    ) / 100
  );

  // §136: קיזוז יתרת זכות - היה חסר כאן לגמרי, ולכן זיכוי אחרי
  // קיזוז היה מבטל אותו. applyBalanceToOrder אידמפוטנטי.
  const { payable } = await applyBalanceToOrder(
    prisma,
    orderId,
    order.customerId,
    beforeBalance
  );

  await prisma.order.update({
    where: { id: orderId },
    // §266: מסמנים מוכן לחיוב, כמו בהזנת משקל.
    //
    // ⚠️ אותו תנאי: לא דורסים PAID / CHARGING / FAILED.
    data: {
      finalTotal: payable,
      ...(payable > 0 &&
      ["PENDING", "AWAITING_WEIGHING", "TOKEN_CREATED"].includes(
        order.paymentStatus ?? "PENDING"
      )
        ? { paymentStatus: "READY_TO_CHARGE" }
        : {}),
    },
  });
  return payable;
}
