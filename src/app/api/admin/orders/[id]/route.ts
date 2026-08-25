import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
// §124: קיזוז יתרת זכות
import { applyBalanceToOrder } from "@/lib/credit-balance-lib";
import { requireAdmin } from "@/lib/guard";
import { STATUSES_REQUIRING_PAYMENT, smartLineEstimate } from "@/lib/pricing";
import { sendFinalPriceEmail } from "@/lib/email";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const g = await requireAdmin();
  if (!g.ok) return g.res;
  const { id } = await params;
  const order = await prisma.order.findUnique({
    where: { id },
    include: {
      point: true,
      items: { include: { product: true } },
      pricelist: true,
      // 🐛 תוקן: היה חסר customer בכלל! בלעדיו, order.customer?.hasToken
      // תמיד undefined בצד הלקוח, אז כפתור "חייב עכשיו" אף פעם לא הופיע -
      // גם ללקוחות שכן יש להם טוקן שמור. במקום זה הוצג רק לינק התשלום הישן.
      customer: {
        select: {
          // §263: חוב מהעבר - להצגה ולרישום בפאנל
          debtBalance: true,
          debtNote: true,
          id: true,
          name: true,
          email: true,
          phone: true,
          paymentToken: true, // נשלף כדי לחשב hasToken, לא נחשף כמו שהוא
          // §183: אופן התשלום - לעריכה מהירה מתוך ההזמנה
          paymentPreference: true,
          // §184: הפיצול - לעריכה מתוך ההזמנה
          firstName: true,
          lastName: true,
          cardLast4: true,
          cardExpiry: true,
          cardNeedsUpdate: true,
        },
      },
    },
  });
  if (!order) {
    return NextResponse.json({ error: "הזמנה לא נמצאה" }, { status: 404 });
  }
  // לא חושפים את הטוקן הגולמי ללקוח - רק boolean + מטא-דאטה בטוחה
  const { paymentToken, ...safeCustomer } = order.customer ?? {};
  return NextResponse.json({
    ...order,
    customer: order.customer
      ? { ...safeCustomer, hasToken: !!paymentToken }
      : null,
  });
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const g = await requireAdmin();
  if (!g.ok) return g.res;
  const { id } = await params;
  const b = await req.json();

  const current = await prisma.order.findUnique({ where: { id } });
  if (!current) return NextResponse.json({ error: "הזמנה לא נמצאה" }, { status: 404 });

  // update order header fields
  const data: any = {};
  for (const k of ["internalNotes", "notes", "customerName", "phone", "phone2", "pointId"]) {
    if (k in b) data[k] = b[k];
  }

  // ═══════════════════════════════════════════════════════════════
  // §47: סימון מסירה ללקוח
  // ═══════════════════════════════════════════════════════════════
  // deliveredAt הוא מקור האמת למסירה - הוא העובדה בשטח (הלקוח לקח),
  // בעוד status הוא סימון ידני.
  //
  // 🐛 הבאג שתוקן: סימון מסירה (ע"י הנציג) לא עדכן את status, ולכן
  // הדשבורד המשיך לדרוש "סמן מוכן לחלוקה" על הזמנה שכבר נמסרה
  // ללקוח. עכשיו שני השדות מתעדכנים יחד - COMPLETED הוא הסטטוס
  // שאחרי מסירה, ואין יותר שני מסלולי מצב שסותרים זה את זה.
  if ("markDelivered" in b) {
    if (b.markDelivered) {
      // מסירה מחייבת תשלום - אחרת נמסרה סחורה בלי שנגבה עליה
      if (current.paymentStatus !== "PAID") {
        return NextResponse.json(
          {
            error:
              "לא ניתן לסמן מסירה לפני שההזמנה שולמה. אם הלקוח שילם במזומן, יש לסמן זאת תחילה.",
          },
          { status: 400 }
        );
      }
      data.deliveredAt = new Date();
      data.deliveredNote = b.deliveredNote ? String(b.deliveredNote).slice(0, 500) : null;
      // הסטטוס נגזר מהמסירה ולא נקבע בנפרד
      data.status = "COMPLETED";
    } else {
      data.deliveredAt = null;
      data.deliveredNote = null;
      data.deliveredByAgentId = null;
      // חוזרים לשלב שלפני המסירה
      if (current.status === "COMPLETED") data.status = "READY_FOR_PICKUP";
    }
  }

  // §47: ביטול הזמנה. שונה ממחיקה - ההזמנה נשמרת לתיעוד ולדוחות.
  // סיבת הביטול נשמרת בהערות הפנימיות עם חותמת זמן ושם המבטל, כי
  // בלעדיה אי אפשר לדעת בדיעבד למה הזמנה בוטלה.
  if (b.status === "CANCELLED" && b.cancelReason) {
    const stamp = new Date().toLocaleString("he-IL");
    const by = g.session?.user?.email ?? "מנהל";
    const line = `[${stamp}] בוטלה ע"י ${by}: ${String(b.cancelReason).slice(0, 300)}`;
    data.internalNotes = current.internalNotes
      ? `${current.internalNotes}\n${line}`
      : line;
  }

  // §272: 💰 **ביטול הזמנה ששולמה יוצר יתרת זכות.**
  //
  // 🐛 מה שהיה: האזהרה במסך אמרה "יש לטפל בהחזר מול נדרים
  // בנפרד" - כלומר המנהל היה צריך לזכור, ידנית, מחוץ למערכת.
  // בפועל זה לא קורה, והלקוח משלם על סחורה שלא קיבל.
  //
  // ⚠️ המודל העסקי כאן הוא **זיכוי להזמנה הבאה**, לא החזר
  // כספי: הלקוח קונה כל שבוע, והזיכוי מתקזז אוטומטית (§124).
  // זה גם מה שהתנאים באתר צריכים לומר.
  //
  // ⚠️ רק כשבאמת שולם: הזמנה שלא חויבה אין ממה לזכות.
  if (
    b.status === "CANCELLED" &&
    current.status !== "CANCELLED" &&
    current.paymentStatus === "PAID" &&
    current.customerId
  ) {
    // ⚠️ amountPaid ולא finalTotal: מזכים את מה שבאמת נגבה.
    // תשלום חלקי מזכה חלקית.
    const refund = Number(current.amountPaid ?? current.finalTotal ?? 0);

    if (refund > 0) {
      const stamp = new Date().toLocaleDateString("he-IL", {
        timeZone: "Asia/Jerusalem",
      });
      await prisma.customer.update({
        where: { id: current.customerId },
        data: {
          // ⚠️ increment ולא set: ללקוח עשויה להיות יתרה קיימת,
          // ודריסה שלה הייתה מוחקת אותה.
          creditBalance: { increment: refund },
          creditBalanceNote: `זיכוי על ביטול הזמנה #${current.orderNumber} (${stamp})`,
          creditBalanceAt: new Date(),
        },
      });
      console.log(
        `[cancel] order #${current.orderNumber} refunded ₪${refund} as credit`
      );
    }
  }

  // status: אסור לקבוע PAID דרך ה-PATCH הכללי הזה (זה נעשה רק ע"י cash-payment endpoint או webhook).
  // גם אסור לעבור לסטטוסים שדורשים תשלום (READY_FOR_PICKUP/COMPLETED) אם ההזמנה לא שולמה.
  if ("status" in b) {
    if (b.status === "PAID") {
      return NextResponse.json(
        { error: "לא ניתן לקבוע סטטוס 'שולמה' ישירות. השתמש בסימון תשלום מזומן או המתן לתשלום אונליין." },
        { status: 400 }
      );
    }
    // הבדיקה מדלגת כשהסטטוס נגזר מסימון מסירה - שם כבר נבדק שההזמנה שולמה
    if (
      !("markDelivered" in b) &&
      STATUSES_REQUIRING_PAYMENT.includes(b.status) &&
      current.paymentStatus !== "PAID"
    ) {
      return NextResponse.json(
        { error: "לא ניתן לעדכן סטטוס זה לפני שההזמנה שולמה" },
        { status: 400 }
      );
    }
    // markDelivered קובע את הסטטוס בעצמו - לא נותנים ל-body לדרוס אותו
    if (!("markDelivered" in b)) data.status = b.status;
  }

  // update items (final weight / final price / quantity / add / remove)
  if (Array.isArray(b.items)) {
    for (const it of b.items) {
      if (it._delete && it.id) {
        await prisma.orderItem.delete({ where: { id: it.id } });
        continue;
      }
      if (it.id) {
        const idata: any = {};
        // actualWeight הוא השדה הראשי; finalWeight נשמר זהה לתאימות לאחור עם קוד ישן
        for (const k of ["quantity", "actualWeight", "finalWeight", "finalPrice"]) {
          if (k in it) idata[k] = it[k];
        }
        if ("actualWeight" in it && !("finalWeight" in it)) idata.finalWeight = it.actualWeight;
        await prisma.orderItem.update({ where: { id: it.id }, data: idata });
      } else if (it.productId) {
        const product = await prisma.product.findUnique({ where: { id: it.productId } });
        if (product) {
          const qty = Number(it.quantity ?? 1);
          const isSingle = it.isSingle ?? false;
          const unitPrice = Number(it.unitPrice ?? product.cartonPrice);
          const avgWeight =
            product.avgWeightPerUnit != null
              ? Number(product.avgWeightPerUnit)
              : null;

          // 🚨 חישוב נכון לפי סוג המוצר
          // משתמשים ב-smartLineEstimate שכבר מטפל בכל המקרים:
          //   - קרטון עם PER_KG: unitPrice × avgWeight × qty
          //   - יחידה במחיר קבוע: unitPrice × qty
          //   - בודדים בק"ג: unitPrice × qty (qty הוא כבר ק"ג)
          let estPrice: number;
          let estWeight: number | null = null;

          if (isSingle) {
            // בודדים - מחיר לפי quantity
            estPrice = Math.round(unitPrice * qty * 100) / 100;
            // אם בודדים בק"ג, המשקל הוא הכמות
            if (product.singlesMode !== "UNITS") {
              estWeight = qty;
            }
          } else {
            // קרטון - חישוב חכם (משתמש בפונקציה קיימת)
            const smart = smartLineEstimate(
              unitPrice,
              qty,
              product.saleType,
              product.priceType,
              avgWeight
            );
            // אם smartLineEstimate החזיר null (חסר avgWeight ל-PER_KG), נופלים לחישוב פשוט
            estPrice = smart ?? Math.round(unitPrice * qty * 100) / 100;
            // עבור קרטון נשקל - הצמדת estimatedWeight
            if (avgWeight && (product.saleType === "UNIT" || product.saleType === "PACKAGE") && product.priceType === "PER_KG") {
              estWeight = Math.round(avgWeight * qty * 1000) / 1000;
            }
          }

          await prisma.orderItem.create({
            data: {
              orderId: id,
              productId: product.id,
              productName: product.name,
              unit: product.unit,
              isSingle,
              quantity: qty,
              unitPrice,
              estimatedWeight: estWeight,
              estimatedPrice: estPrice,
            },
          });
        }
      }
    }
  }

  // §72: הזמנה שנשארה בלי פריטים - מבוטלת אוטומטית.
  //
  // 🐛 הפער שהתגלה בדשבורד: מחיקת כל הפריטים השאירה הזמנה "פתוחה"
  // עם 0 ש"ח. היא תפסה מספר, הופיעה ברשימה כ"ממתינה לשקילה" לנצח -
  // אבל מסך המשקלים (שסופר *פריטים*) דילג עליה. התוצאה: הדשבורד
  // אמר 2 והרשימה הראתה 3, והמנהל חיפש הזמנה שאין בה מה לעשות.
  //
  // ביטול ולא מחיקה: המספר כבר נתפס, ורשומה מבוטלת משאירה שובל
  // ברור של מה שקרה במקום חור במספור.
  if (Array.isArray(b.items)) {
    const remaining = await prisma.orderItem.count({
      where: { orderId: id, isCancelled: false },
    });
    if (remaining === 0) {
      await prisma.order.update({
        where: { id },
        data: {
          status: "CANCELLED",
          // internalNotes - שדה קיים; אין cancelReason בסכמה
          internalNotes: "בוטלה אוטומטית - נמחקו כל הפריטים",
        },
      });
      const emptied = await prisma.order.findUnique({
        where: { id },
        include: { items: true },
      });
      return NextResponse.json({ ...emptied, _autoCancelled: true });
    }
  }

  // recompute finalTotal from items if any final prices exist
  let justSetFinalTotal = false;

  // פעולה מפורשת: יצירת/שליחת לינק תשלום להזמנה שכבר יש לה מחיר סופי.
  // נדרש כשנציג (ללא הרשאת לינק) קבע מחיר, והמנהל משלים את שליחת הלינק.
  if (b.sendPaymentLink === true) {
    if (current.finalTotal == null) {
      return NextResponse.json(
        { error: "לא ניתן לשלוח לינק — טרם נקבע מחיר סופי" },
        { status: 400 }
      );
    }
    const customerForLink = await prisma.customer.findUnique({
      where: { id: current.customerId },
    });
    const deductOneNow =
      customerForLink && !customerForLink.creditVerificationCharged && Number(current.finalTotal) > 1;
    const chargeAmountNow = deductOneNow
      ? Math.round((Number(current.finalTotal) - 1) * 100) / 100
      : Number(current.finalTotal);

    data.paymentLink = buildNedarimPaymentLink(id, chargeAmountNow, current.customerName);
    data.paymentStatus = "PAYMENT_PENDING";
    justSetFinalTotal = true; // מפעיל את שליחת מייל המחיר הסופי עם הלינק
  }
  if ("recomputeFinal" in b || Array.isArray(b.items)) {
    const items = await prisma.orderItem.findMany({ where: { orderId: id } });
    const hasFinal = items.some((i) => i.finalPrice !== null);
    // 🚨 חשוב: אם יש פריט אחד שאין לו finalPrice - לא לחשב finalTotal!
    // הבאג הישן: היה מחשב total גם עם פריטים לא שקולים (לוקח estimatedPrice)
    // וזה גורם לחיוב שגוי (למשל: מחיר קרטון שלא נשקל).
    // התיקון: רק אם *כל* הפריטים שקולים - יש לנו finalTotal אמיתי.
    const allWeighed = items.length > 0 && items.every((i) => i.finalPrice !== null);
    if (hasFinal && allWeighed) {
      const total = items.reduce((s, i) => s + Number(i.finalPrice), 0);
      // 🆕 הוספת דמי הזמנה (תוספת קבועה) לסה"כ הסופי
      const pricelist = await prisma.pricelist.findUnique({
        where: { id: current.pricelistId! },
        select: { orderFee: true },
      });
      const orderFee = Number(pricelist?.orderFee || 0);
      // §123: ניכוי הזיכוי, אם ניתן.
      //
      // ⚠️ בלי זה, זיכוי שהנציג נתן היה נמחק ברגע שהמנהל מעדכן
      // משקל או לוחץ "חישוב מחדש" - החישוב היה דורס את הסכום
      // ומחזיר אותו למחיר המלא, בלי שאיש ישים לב.
      const credit = current.creditAmount != null ? Number(current.creditAmount) : 0;
      // §134: דמי משלוח. בלעדיהם כל "חישוב מחדש" היה מוחק אותם.
      const delivery =
        current.deliveryRequested && current.deliveryFee != null
          ? Number(current.deliveryFee)
          : 0;
      // §135: חיוב נוסף
      const extra = current.extraCharge != null ? Number(current.extraCharge) : 0;
      const beforeBalance = Math.max(
        0,
        Math.round((total + orderFee + delivery + extra - credit) * 100) / 100
      );
      // §124: קיזוז יתרת זכות. אידמפוטנטי - ראה applyBalanceToOrder.
      const { payable: newFinalTotal } = await applyBalanceToOrder(
        prisma,
        id,
        current.customerId,
        beforeBalance
      );
      // אם זו הפעם הראשונה שנקבע finalTotal, נעדכן גם את הסטטוס ל-FINAL_PRICE_SET (אם עדיין PENDING_REVIEW)
      if (current.finalTotal === null && current.status === "PENDING_REVIEW") {
        data.status = data.status ?? "FINAL_PRICE_SET";
        data.finalPriceSetAt = new Date();
        data.finalPriceSetBy = g.session?.user?.email ?? null;
        justSetFinalTotal = true;
        // קיזוז 1₪ בהזמנה הראשונה (אימות כרטיס שנגבה בהרשמה) - creditVerificationCharged מסמן שכבר קוזז
        const customerForDeduction = await prisma.customer.findUnique({ where: { id: current.customerId } });
        const deductOne = customerForDeduction && !customerForDeduction.creditVerificationCharged && newFinalTotal > 1;
        const chargeAmount = deductOne ? Math.round((newFinalTotal - 1) * 100) / 100 : newFinalTotal;
        data.paymentLink = buildNedarimPaymentLink(id, chargeAmount, current.customerName);
        data.paymentStatus = "PAYMENT_PENDING";
      }
      data.finalTotal = newFinalTotal;
    } else if (hasFinal && !allWeighed) {
      // יש פריטים שקולים חלקית - לא מחשבים finalTotal, אבל כן מסמנים שיש פריטים מחכים לשקילה
      // (הסטטוס נשאר PENDING_REVIEW, finalTotal נשאר null)
    }
    const est = items.reduce((s, i) => s + Number(i.estimatedPrice), 0);
    data.estimatedTotal = Math.round(est * 100) / 100;
  }
  if ("finalTotal" in b) data.finalTotal = b.finalTotal;

  const order = await prisma.order.update({
    where: { id },
    data,
    include: { point: true, items: true },
  });
  // אם נקבע מחיר סופי עכשיו - שולחים ללקוח מייל עם קישור תשלום (לא חוסם)
  if (justSetFinalTotal) {
    const fullOrder = await prisma.order.findUnique({
      where: { id },
      include: { items: true, customer: true },
    });
    if (fullOrder?.customer?.email) {
      const res = await sendFinalPriceEmail(fullOrder as any, fullOrder.customer.email);
      await prisma.order.update({
        where: { id },
        data: res.ok
          ? { customerNotifiedAt: new Date() }
          : { customerNotifyError: res.error },
      }).catch(() => null);
    }
  }

  return NextResponse.json({ ...order, _finalPriceJustSet: justSetFinalTotal });
}

// יוצר לינק תשלום נעול לנדרים פלוס עבור הזמנה ספציפית.
// הסכום נעול (AmountLock=1) - הלקוח לא יכול לשנות אותו.
// ה-webhook של נדרים יפנה ל-/api/webhooks/nedarim עם orderId ב-param1.
// בהזמנה ראשונה מקזזים 1₪ (אימות כרטיס שנגבה בהרשמה) - creditVerificationCharged מסמן זאת.
function buildNedarimPaymentLink(orderId: string, amount: number, customerName: string): string {
  const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://tzidkat.com";
  const params = new URLSearchParams({
    mosad: "7015318",
    ApiValid: "NxhXRWeG5P",
    Amount: String(amount),
    AmountLock: "1",
    CallBack: `${APP_URL}/api/webhooks/nedarim`,
    param1: orderId,
    param2: "order",
    Nota: `הזמנה #${orderId.slice(0, 8)} - צדקת רבותינו`,
    ClientName: customerName,
  });
  return `https://www.matara.pro/nedarimplus/online/?${params.toString()}`;
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const g = await requireAdmin();
  if (!g.ok) return g.res;
  const { id } = await params;
  await prisma.order.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
