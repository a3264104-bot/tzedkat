// ═══════════════════════════════════════════════════════════════
// §309: שליחת מיילים קבוצתית + נעילת משקלים
// ═══════════════════════════════════════════════════════════════
// POST /api/admin/notify-batch
// Body: { orderIds: string[] }  |  { pricelistId: string }
//
// שני צרכים שנפגשים כאן:
//
// 1. **קבוצתי**: עם 244 הזמנות, שליחה אחת-אחת היא 244 לחיצות.
//
// 2. **נעילה**: שליחת המייל היא הרגע שבו הסכום הופך למחייב.
//    הלקוח מחזיק בידו מספר, ושינוי משקל אחריו יוצר פער בין מה
//    שהוא יודע למה שייגבה - בדיוק הבאג שנתפס בהזמנה 616.
//
// ⚠️ הנעילה היא **תוצאה** של השליחה, לא פעולה נפרדת: מנהל
// ששולח ואז שוכח לנעול הוא בדיוק המצב שאנחנו מונעים.

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/guard";
import { sendFinalPriceEmail } from "@/lib/email";

export async function POST(req: Request) {
  const g = await requireAdmin();
  if (!g.ok) return g.res;

  const body = await req.json().catch(() => ({}));
  const orderIds: string[] = Array.isArray(body.orderIds)
    ? body.orderIds
    : [];
  const pricelistId: string | null = body.pricelistId ?? null;

  if (orderIds.length === 0 && !pricelistId) {
    return NextResponse.json(
      { error: "יש לציין הזמנות או מכירה" },
      { status: 400 }
    );
  }

  // ⚠️ רק הזמנות עם מחיר סופי שטרם שולמו. הזמנה בלי finalTotal
  // תשלח סכום משוער שישתנה - וזו הבעיה שהתיקון בא לפתור.
  const orders = await prisma.order.findMany({
    where: {
      ...(orderIds.length > 0 ? { id: { in: orderIds } } : {}),
      ...(pricelistId ? { pricelistId } : {}),
      status: { not: "CANCELLED" },
      finalTotal: { gt: 0 },
      customer: { email: { not: "" } },
    },
    include: { items: true, customer: true },
  });

  if (orders.length === 0) {
    return NextResponse.json({
      ok: true,
      sent: 0,
      failed: 0,
      skipped: 0,
      message: "אין הזמנות מתאימות לשליחה",
    });
  }

  let sent = 0;
  let failed = 0;
  const errors: Array<{ orderNumber: number; error: string }> = [];

  for (const order of orders) {
    // ⚠️ בדיקה נוספת לכל הזמנה: פריט שלא נשקל אומר שהסכום אינו
    // סופי באמת. שליחה כזו הייתה חוזרת על באג 456/420.
    const unweighed = order.items.filter(
      (it) => !it.isCancelled && it.finalPrice == null
    );
    if (unweighed.length > 0) {
      failed++;
      errors.push({
        orderNumber: order.orderNumber,
        error: `${unweighed.length} פריטים טרם נשקלו`,
      });
      continue;
    }

    try {
      const res = await sendFinalPriceEmail(
        order as any,
        order.customer!.email!
      );

      if (res.ok) {
        sent++;
        // §309: 🔒 **השליחה נועלת את המשקלים.**
        //
        // הלקוח מחזיק בידו סכום, ושינוי אחריו יוצר פער בין מה
        // שהוא יודע למה שייגבה.
        //
        // ⚠️ weightsLockedAt הוא הדגל: הנציג והמנהל רואים אותו
        // ומבינים למה השדות נעולים. תאריך ולא boolean, כי
        // "מתי" הוא חלק מהתשובה.
        await prisma.order.update({
          where: { id: order.id },
          data: {
            finalPriceNotifiedAt: new Date(),
            customerNotifyError: null,
            weightsLockedAt: new Date(),
          },
        });
      } else {
        failed++;
        errors.push({
          orderNumber: order.orderNumber,
          error: res.error || "שליחה נכשלה",
        });
        await prisma.order.update({
          where: { id: order.id },
          data: { customerNotifyError: res.error },
        });
      }
    } catch (e: any) {
      failed++;
      errors.push({
        orderNumber: order.orderNumber,
        error: e?.message || "שגיאה",
      });
    }
  }

  console.log(
    `[notify-batch] sent=${sent} failed=${failed} by ${g.session?.user?.email}`
  );

  return NextResponse.json({
    ok: true,
    sent,
    failed,
    // ⚠️ רשימת השגיאות ולא רק מספר: המנהל צריך לדעת **למי** לא
    // נשלח כדי לטפל, ו"3 נכשלו" לא עוזר לו.
    errors: errors.slice(0, 20),
  });
}
