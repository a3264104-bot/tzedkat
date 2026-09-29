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
      agentClosedAt: true,
      creditAmount: true,
      pricelistId: true,
      // §394: לזיכוי על הזמנה ששולמה חלקית
      amountPaid: true,
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
  // §379: V נועל זיכוי — הזיכוי משנה סכום שכבר אושר.
  // §394: נעילת V / מייל — רק להזמנה שטרם שולמה.
  //
  // 🐛 הזמנה ששולמה כמעט תמיד מסומנת V, ואת ה-V אי אפשר להסיר
  // אחרי תשלום (§382). כלומר זיכוי על הזמנה ששולמה היה חסום
  // לגמרי — מבוי סתום. אחרי תשלום הזיכוי לא משנה את הסכום
  // שאושר, אלא הולך ליתרה/להזמנה הפתוחה, ולכן הנעילה לא רלוונטית.
  const paidOrPartial =
    order.paymentStatus === "PAID" || order.paymentStatus === "PARTIALLY_PAID";
  if (!paidOrPartial && (order as any).agentClosedAt) {
    return NextResponse.json(
      { error: "ההזמנה סומנה כטופלה (V). לזיכוי יש להסיר את הסימון תחילה.", code: "ORDER_CLOSED" },
      { status: 400 }
    );
  }

  if (!paidOrPartial && (order as any).weightsLockedAt) {
    return NextResponse.json(
      {
        error: "ההזמנה נעולה — נשלח ללקוח מייל עם הסכום הסופי.",
        code: "WEIGHTS_LOCKED",
      },
      { status: 423 }
    );
  }
  // §394: חיוב באמצע — לא משנים סכום שנשלח עכשיו לסליקה.
  if (order.paymentStatus === "CHARGING") {
    return NextResponse.json(
      { error: "ההזמנה נמצאת כרגע בחיוב. יש לנסות שוב בעוד רגע." },
      { status: 409 }
    );
  }

  // §394: 💸 **זיכוי מתממש עכשיו — לא "בפעם הבאה".**
  //
  // 🐛 מה שהיה: כל זיכוי על הזמנה ששולמה (גם חלקית) נזקף כיתרה
  // "להזמנה הבאה". בפועל: הנציג פתח ללקוח הזמנה נוספת, נתן זיכוי,
  // והחיוב גבה את הסכום המלא — היתרה חיכתה להזמנה שעוד לא קיימת.
  //
  // ✅ עכשיו:
  //   • שולמה חלקית והזיכוי ≤ היתרה → מקוזז מההזמנה עצמה, מיד.
  //   • שולמה (או הזיכוי גדול מהיתרה) → יתרת זכות, **ומיד** מקוזזת
  //     מהזמנה פתוחה של הלקוח אם יש (ראה applyToOpenOrder).
  //   • רק אם אין שום הזמנה פתוחה — היתרה נשארת לפעם הבאה, והנציג
  //     מקבל על כך הודעה מפורשת.
  const paidSoFar = Number((order as any).amountPaid ?? 0);
  const orderFinal = order.finalTotal != null ? Number(order.finalTotal) : null;
  const partialRemaining =
    order.paymentStatus === "PARTIALLY_PAID" && orderFinal != null
      ? Math.round((orderFinal - paidSoFar) * 100) / 100
      : 0;
  const requestedAmount = Number(b.amount);
  const creditFitsPartial =
    order.paymentStatus === "PARTIALLY_PAID" &&
    Number.isFinite(requestedAmount) &&
    requestedAmount > 0 &&
    requestedAmount <= partialRemaining + 0.01;
  const alreadyPaid =
    order.paymentStatus === "PAID" ||
    (order.paymentStatus === "PARTIALLY_PAID" && !creditFitsPartial);

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
    await recomputeTotal(id, g.agent.id);
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

    // §394: ⚠️ **לא** נרשם כ-creditAmount על ההזמנה ששולמה.
    //
    // 🐛 creditAmount יורד מהסכום בכל חישוב מחדש. זיכוי שנרשם גם
    // כיתרה וגם על ההזמנה היה מקוזז **פעמיים** — פעם מהיתרה בהזמנה
    // הפתוחה, ופעם בהזמנה הזו אם היא מחושבת מחדש (ביטול פריט, חיוב
    // נוסף). התיעוד נשמר ב-creditBalanceNote וב-appliedCreditBalance
    // של ההזמנה שממנה קוזז.
    await prisma.customer.update({
      where: { id: order.customerId },
      data: {
        creditBalance: newBalance,
        creditBalanceNote: `${reason} (זיכוי על הזמנה #${order.orderNumber})`,
        creditBalanceAt: new Date(),
      },
    });

    console.log(
      `[credit] order #${order.orderNumber} PAID -> balance ${prev} + ${amount} = ${newBalance}`
    );

    // §394: מקזזים **עכשיו** מהזמנה פתוחה של הלקוח, אם יש.
    const appliedTo = await applyToOpenOrder(order.customerId, id, g.agent.id);

    // מייל ללקוח. לא חוסם - כשל שליחה לא יבטל זיכוי שכבר נרשם.
    //
    // §394: רק כשהזיכוי **נשאר כיתרה**. המייל אומר "תקוזז מההזמנה
    // הבאה" — וכשהוא כבר קוזז מההזמנה הפתוחה זה פשוט לא נכון. שם
    // הלקוח רואה את הקיזוז בפירוט ההזמנה עצמה.
    if (cust?.email && !appliedTo) {
      sendCreditBalanceEmail({
        customerName: cust.name,
        email: cust.email,
        amount,
        reason,
        newBalance,
        orderNumber: order.orderNumber,
      }).catch((e) => console.error("[credit] email failed:", e));
    }

    return NextResponse.json({
      ok: true,
      asBalance: !appliedTo,
      creditAmount: amount,
      creditReason: reason,
      newBalance,
      appliedToOrderId: appliedTo?.id ?? null,
      appliedToOrderNumber: appliedTo?.orderNumber ?? null,
      message: appliedTo
        ? `הזיכוי קוזז מיד מהזמנה #${appliedTo.orderNumber} (סכום חדש לתשלום: ${appliedTo.finalTotal?.toFixed(2) ?? "ייקבע בשקילה"} ש"ח).`
        : `אין ללקוח הזמנה פתוחה — הזיכוי נשמר כיתרת זכות ויקוזז אוטומטית בהזמנה הבאה. החזר לכרטיס על הזמנה ששולמה נעשה ידנית בנדרים.`,
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

  const newTotal = await recomputeTotal(id, g.agent.id);

  console.log(
    `[credit] order #${order.orderNumber} credited ${amount} by agent=${g.agent.id} reason="${reason}"`
  );

  return NextResponse.json({
    ok: true,
    creditAmount: amount,
    creditReason: reason,
    finalTotal: newTotal,
    message:
      newTotal != null
        ? `הזיכוי נכנס להזמנה. סכום לתשלום: ${newTotal.toFixed(2)} ש"ח.`
        : `הזיכוי נשמר בהזמנה ויקוזז ברגע שכל המשקלים יוזנו.`,
  });
}

/**
 * §394: קיזוז יתרת זכות **מיד** בהזמנה פתוחה של הלקוח.
 *
 * "פתוחה" = טרם שולמה, לא בחיוב, לא בוטלה, לא הועברה לחוב.
 * האחרונה שנוצרה — זו שהנציג עובד עליה עכשיו.
 *
 * ⚠️ recomputeTotal קורא ל-applyBalanceToOrder, שמושך את היתרה
 * המעודכנת של הלקוח — זה כל הקיזוז. אם ההזמנה טרם נשקלה במלואה,
 * הקיזוז יקרה אוטומטית בשקילה (כמו תמיד), ומחזירים אותה בכל זאת
 * כדי שהנציג ידע לאן הזיכוי ילך.
 */
async function applyToOpenOrder(
  customerId: string,
  excludeOrderId: string,
  agentId: string
): Promise<{ id: string; orderNumber: number; finalTotal: number | null } | null> {
  const open = await prisma.order.findFirst({
    where: {
      customerId,
      id: { not: excludeOrderId },
      status: { notIn: ["CANCELLED"] },
      paymentStatus: {
        notIn: ["PAID", "PARTIALLY_PAID", "CHARGING", "DEBT_CARRIED"],
      },
    },
    orderBy: { createdAt: "desc" },
    select: { id: true, orderNumber: true },
  });
  if (!open) return null;
  const newTotal = await recomputeTotal(open.id, agentId);
  console.log(
    `[credit] balance applied now to open order #${open.orderNumber} -> ${newTotal}`
  );
  return { id: open.id, orderNumber: open.orderNumber, finalTotal: newTotal };
}

/**
 * §123: חישוב מחדש של המחיר הסופי אחרי שינוי בזיכוי.
 *
 * ⚠️ רק אם **כל** הפריטים כבר נשקלו. לפני כן finalTotal הוא null
 * בכוונה, והזיכוי ייכנס אוטומטית כשהמחיר ייקבע - אותו כלל שכבר
 * קיים בחישוב הראשי.
 */
async function recomputeTotal(
  orderId: string,
  // §368: הנציג — לתנועה בספר החובות
  agentId?: string | null
): Promise<number | null> {
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
      // §394: זיכוי על הזמנה ששולמה חלקית — אולי עכשיו היא מכוסה
      amountPaid: true,
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
    beforeBalance,
    agentId
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
      // §394: שולם חלקית, והזיכוי סגר את הפער → שולם.
      ...(order.paymentStatus === "PARTIALLY_PAID" &&
      Number(order.amountPaid ?? 0) >= payable - 0.01
        ? { paymentStatus: "PAID" }
        : {}),
    },
  });
  return payable;
}
