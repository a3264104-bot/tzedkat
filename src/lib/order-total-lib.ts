// ═══════════════════════════════════════════════════════════════
// §400: 🧮 חישוב הסכום הסופי של הזמנה — מקור אחד
// ═══════════════════════════════════════════════════════════════
// הועבר מ-api/agent/order-item/[id] כדי שגם סימון "טופל" (V) יוכל
// להריץ אותו: V על הזמנה שאין לה סכום סופי הוא בדיוק מה שגרם
// להזמנות לא להיגבות (ראה api/agent/orders/[id]/close).

import { prisma } from "@/lib/prisma";
// §147: מייל מחיר סופי (מושבת בדגל — §303)
import { sendFinalPriceEmail } from "@/lib/email";
// §124: קיזוז יתרת זכות
import { applyBalanceToOrder } from "@/lib/credit-balance-lib";

/**
 * §123: חישוב מחדש של המחיר הסופי, כולל ניכוי זיכוי.
 *
 * זהה בנוסחה לחישוב שבצד המנהל. שתי נוסחאות נפרדות היו נפרדות
 * ביום שמישהו משנה אחת מהן, והלקוח היה מחויב בסכום שתלוי במי
 * נגע בהזמנה אחרון.
 */
export async function recomputeOrderTotal(
  orderId: string,
  // §368: הנציג — לתנועה בספר החובות
  agentId?: string | null
): Promise<void> {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: {
      pricelistId: true,
      creditAmount: true,
      customerId: true,
      // §134: דמי משלוח - חלק מהסכום לחיוב
      deliveryFee: true,
      deliveryRequested: true,
      // §135: חיוב נוסף
      extraCharge: true,
      items: { where: { isCancelled: false }, select: { finalPrice: true } },
    },
  });
  if (!order || order.items.length === 0) return;

  // כל הפריטים חייבים להיות שקולים. אחרת המחיר אינו סופי.
  //
  // §394: 🐛 **finalTotal ישן נשאר אחרי שמשקל נמחק.**
  //
  // הזמנה נשקלה במלואה (finalTotal נקבע), ואז הנציג רוקן משקל —
  // או קרטון אחד מתוך שניים. הפריט חזר ל"חסר", אבל finalTotal
  // נשאר על הסכום הקודם, והחיוב היה גובה אותו.
  //
  // ✅ עכשיו: לא הכל שקול → finalTotal מתאפס, וההזמנה לא ניתנת
  // לחיוב עד שהשקילה תושלם.
  //
  // ⚠️ רק בהזמנה שטרם שולמה. בהזמנה ששולמה/בחיוב לא נוגעים
  // בסכום (ממילא עריכת משקל חסומה שם — רק ביטול פריט עובר).
  if (!order.items.every((i) => i.finalPrice !== null)) {
    await prisma.order.updateMany({
      where: {
        id: orderId,
        finalTotal: { not: null },
        paymentStatus: { notIn: ["PAID", "PARTIALLY_PAID", "CHARGING", "DEBT_CARRIED"] },
      },
      data: { finalTotal: null },
    });
    await prisma.order.updateMany({
      where: { id: orderId, paymentStatus: "READY_TO_CHARGE" },
      data: { paymentStatus: "PENDING" },
    });
    return;
  }

  const itemsSum = order.items.reduce((s, i) => s + Number(i.finalPrice), 0);
  const pl = order.pricelistId
    ? await prisma.pricelist.findUnique({
        where: { id: order.pricelistId },
        select: { orderFee: true },
      })
    : null;
  const credit = order.creditAmount != null ? Number(order.creditAmount) : 0;

  // §134: 🐛 בלי דמי המשלוח כאן, **כל שקילה הייתה מוחקת אותם**.
  // הנציג מסמן משלוח, מזין משקל, והסכום חוזר לבלי משלוח - בלי
  // שאיש ישים לב עד שהלקוח מקבל חיוב נמוך מהמוסכם.
  const delivery =
    order.deliveryRequested && order.deliveryFee != null
      ? Number(order.deliveryFee)
      : 0;
  // §135: חיוב נוסף. בלעדיו כל שקילה הייתה מוחקת אותו - אותו
  // באג בדיוק שהיה עם דמי המשלוח.
  const extra = order.extraCharge != null ? Number(order.extraCharge) : 0;

  const beforeBalance = Math.max(
    0,
    Math.round(
      (itemsSum + Number(pl?.orderFee ?? 0) + delivery + extra - credit) * 100
    ) / 100
  );

  // §124: קיזוז יתרת זכות מהזמנות קודמות.
  //
  // ⚠️ אידמפוטנטי: הפונקציה מחזירה ליתרה את מה שכבר קוזז בהזמנה
  // הזו לפני שהיא מחשבת מחדש. בלי זה, כל שקילה הייתה גוזלת
  // מהיתרה שוב - והלקוח היה מאבד אותה תוך דקות.
  const { payable } = await applyBalanceToOrder(
    prisma,
    orderId,
    order.customerId,
    beforeBalance,
    agentId
  );

  // §147: 🐛 המחיר הסופי נקבע כאן, אבל הלקוח לא ידע.
  //
  // sendFinalPriceEmail נשלח רק ממסלול המנהל. מאז §123 הנציג
  // קובע את המחיר בעצמו בשקילה - והלקוח נשאר בלי שום הודעה.
  //
  // ⚠️ זה קריטי ללקוח **מזומן**: הוא צריך לדעת כמה להביא לחלוקה.
  // לקוח אשראי יגלה כשהכרטיס יחויב, אבל מזומן פשוט יגיע בלי סכום.
  //
  // ⚠️ נשלח **פעם אחת בלבד**. recomputeOrderTotal רץ בכל שקילה,
  // ובלי הבדיקה הזו הלקוח היה מקבל עשרה מיילים באותה דקה.
  const wasSet = await prisma.order.findUnique({
    where: { id: orderId },
    select: {
      finalTotal: true,
      finalPriceNotifiedAt: true,
      // §266: הסטטוס הנוכחי - כדי לא לדרוס PAID או CHARGING
      paymentStatus: true,
      customer: { select: { email: true, paymentPreference: true } },
    },
  });

  // §266: 🚨 **הסטטוס לא עודכן — וזה השורש.**
  //
  // מה שקרה בשטח: נציג שוקל, finalTotal נקבע, ו-paymentStatus
  // נשאר PENDING. המסך הציג "ממתין לשקילה" על הזמנה שכבר נשקלה,
  // והכפתור "חייב עכשיו" לא הופיע.
  //
  // רדפנו אחרי זה שעה - תיוג, סינון, hasToken - וכל אלה היו
  // תסמינים. **המקור היה כאן**: המסלול היחיד שכותב finalTotal
  // בלי לסמן שההזמנה מוכנה.
  //
  // ⚠️ READY_TO_CHARGE **רק** מ-PENDING או AWAITING_WEIGHING:
  // הזמנה ששולמה, נמצאת בחיוב, או שהכרטיס שלה בעייתי - הסטטוס
  // שלה משמעותי ואסור לדרוס אותו.
  const readyStatuses = ["PENDING", "AWAITING_WEIGHING", "TOKEN_CREATED"];
  const shouldMarkReady =
    payable > 0 && readyStatuses.includes(wasSet?.paymentStatus ?? "PENDING");

  await prisma.order.update({
    where: { id: orderId },
    data: {
      finalTotal: payable,
      ...(shouldMarkReady ? { paymentStatus: "READY_TO_CHARGE" } : {}),
    },
  });

  // §303: 🐛 **מייל נשלח בכל הזנת משקל.**
  //
  // המצב מהשטח: הנציג מזין משקל, מתקן, מזין שוב - והלקוח מקבל
  // מייל על כל שינוי. הוא רואה שלושה מיילים עם שלושה סכומים
  // שונים ולא יודע מה נכון.
  //
  // ⚠️ וגרוע מזה: המייל נשלח **לפני** שהמחיר סופי. תיקון אחרי
  // המייל אומר שהלקוח מחזיק בידו סכום שגוי.
  //
  // ⚠️ הפתרון: לא שולחים אוטומטית. המנהל שולח כשהוא מוכן,
  // מכפתור ייעודי - אחרי שכל השקילות הסתיימו.
  //
  // ⚠️ הקוד נשאר כאן ומושבת בדגל: כשתרצה להחזיר את השליחה
  // האוטומטית, זו שורה אחת. מחיקה הייתה מאלצת בנייה מחדש.
  const AUTO_EMAIL_ON_FINAL_PRICE = false;

  if (
    AUTO_EMAIL_ON_FINAL_PRICE &&
    wasSet?.customer?.email &&
    !wasSet.finalPriceNotifiedAt
  ) {
    const full = await prisma.order.findUnique({
      where: { id: orderId },
      include: {
      // §361: product.saleType — להבחנה יחידות/ק"ג במייל
      items: { include: { product: { select: { saleType: true, singlesMode: true } } } },
      customer: true,
    },
    });
    if (full) {
      // לא חוסם: כשל מייל לא יבטל מחיר שכבר נקבע
      sendFinalPriceEmail(full as any, wasSet.customer.email)
        .then((res) =>
          prisma.order.update({
            where: { id: orderId },
            data: res.ok
              ? { finalPriceNotifiedAt: new Date() }
              : { customerNotifyError: res.error },
          }).catch(() => null)
        )
        .catch((e) => console.error("[final-price] email failed:", e));
    }
  }
}
