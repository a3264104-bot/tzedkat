// ═══════════════════════════════════════════════════════════════
// §303: שליחת מייל מחיר סופי — ידנית
// ═══════════════════════════════════════════════════════════════
// POST /api/admin/orders/[id]/notify
//
// 🐛 מה שהיה: המייל נשלח **אוטומטית** בכל קביעת מחיר סופי -
// כלומר בכל הזנת משקל, ובכל תיקון.
//
// המצב מהשטח: הנציג מזין משקל, מתקן, מזין שוב. הלקוח מקבל
// שלושה מיילים עם שלושה סכומים שונים, ולא יודע מה נכון.
//
// ⚠️ וגרוע מזה: המייל נשלח **לפני** שהמחיר סופי באמת. תיקון
// אחרי המייל אומר שהלקוח מחזיק בידו סכום שגוי, ואם הוא כבר
// שילם לפיו - נוצר פער.
//
// ⚠️ עכשיו המנהל שולח כשהוא מוכן, אחרי שכל השקילות הסתיימו.

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/guard";
import { sendFinalPriceEmail } from "@/lib/email";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const g = await requireAdmin();
  if (!g.ok) return g.res;

  const { id } = await params;

  const order = await prisma.order.findUnique({
    where: { id },
    include: { items: true, customer: true },
  });

  if (!order) {
    return NextResponse.json({ error: "הזמנה לא נמצאה" }, { status: 404 });
  }

  // ⚠️ בלי מחיר סופי אין מה לשלוח: הלקוח יקבל מייל עם סכום
  // משוער שישתנה, וזו בדיוק הבעיה שהתיקון בא לפתור.
  if (order.finalTotal == null) {
    return NextResponse.json(
      { error: "טרם נקבע מחיר סופי להזמנה" },
      { status: 400 }
    );
  }

  if (!order.customer?.email) {
    return NextResponse.json(
      { error: "ללקוח אין כתובת מייל" },
      { status: 400 }
    );
  }

  const res = await sendFinalPriceEmail(
    order as any,
    order.customer.email
  );

  // ⚠️ שתי חותמות נפרדות: customerNotifiedAt היא "נשלח בהצלחה",
  // customerNotifyError היא הסיבה לכישלון. שדה אחד היה מאלץ
  // לנחש מה קרה.
  await prisma.order.update({
    where: { id },
    data: res.ok
      ? {
          customerNotifiedAt: new Date(),
          customerNotifyError: null,
          // §309: 🔒 השליחה נועלת — כמו בשליחה הקבוצתית.
          //
          // ⚠️ בלי זה יש שני מסלולי שליחה עם התנהגות שונה:
          // אחד נועל ואחד לא. המנהל ששלח מהמסך הבודד היה
          // חושב שההזמנה נעולה, והנציג היה ממשיך לשנות.
          weightsLockedAt: new Date(),
        }
      : { customerNotifyError: res.error },
  });

  console.log(
    `[notify] order #${order.orderNumber} email ${res.ok ? "sent" : "failed"} to ${order.customer.email}`
  );

  return res.ok
    ? NextResponse.json({ ok: true })
    : NextResponse.json(
        { error: res.error || "שליחת המייל נכשלה" },
        { status: 500 }
      );
}
