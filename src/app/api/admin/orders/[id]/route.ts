import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/guard";
import { STATUSES_REQUIRING_PAYMENT } from "@/lib/pricing";
import { sendFinalPriceEmail } from "@/lib/email";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const g = await requireAdmin();
  if (!g.ok) return g.res;
  const { id } = await params;
  const order = await prisma.order.findUnique({
    where: { id },
    include: { point: true, items: { include: { product: true } }, pricelist: true },
  });
  return NextResponse.json(order);
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

  // status: אסור לקבוע PAID דרך ה-PATCH הכללי הזה (זה נעשה רק ע"י cash-payment endpoint או webhook).
  // גם אסור לעבור לסטטוסים שדורשים תשלום (READY_FOR_PICKUP/COMPLETED) אם ההזמנה לא שולמה.
  if ("status" in b) {
    if (b.status === "PAID") {
      return NextResponse.json(
        { error: "לא ניתן לקבוע סטטוס 'שולמה' ישירות. השתמש בסימון תשלום מזומן או המתן לתשלום אונליין." },
        { status: 400 }
      );
    }
    if (STATUSES_REQUIRING_PAYMENT.includes(b.status) && current.paymentStatus !== "PAID") {
      return NextResponse.json(
        { error: "לא ניתן לעדכן סטטוס זה לפני שההזמנה שולמה" },
        { status: 400 }
      );
    }
    data.status = b.status;
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
          const unitPrice = Number(it.unitPrice ?? product.cartonPrice);
          await prisma.orderItem.create({
            data: {
              orderId: id,
              productId: product.id,
              productName: product.name,
              unit: product.unit,
              isSingle: it.isSingle ?? false,
              quantity: it.quantity ?? 1,
              unitPrice,
              estimatedPrice: Math.round(unitPrice * (it.quantity ?? 1) * 100) / 100,
            },
          });
        }
      }
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
    const chargeAmountNow = Number(current.finalTotal);

    if (customerForLink?.paymentToken) {
      // מסלול חדש: יש טוקן → מסמנים כמוכן לחיוב אוטומטי, בלי לינק
      data.paymentStatus = "READY_TO_CHARGE";
    } else {
      // Fallback: אין טוקן (לקוח ישן?) → לינק תשלום ידני
      data.paymentLink = buildNedarimPaymentLink(id, chargeAmountNow, current.customerName);
      data.paymentStatus = "PAYMENT_PENDING";
    }
    justSetFinalTotal = true; // מפעיל את שליחת מייל המחיר הסופי
  }
  if ("recomputeFinal" in b || Array.isArray(b.items)) {
    const items = await prisma.orderItem.findMany({ where: { orderId: id } });
    const hasFinal = items.some((i) => i.finalPrice !== null);
    if (hasFinal) {
      const total = items.reduce(
        (s, i) => s + Number(i.finalPrice ?? i.estimatedPrice),
        0
      );
      const newFinalTotal = Math.round(total * 100) / 100;
      // אם זו הפעם הראשונה שנקבע finalTotal, נעדכן גם את הסטטוס ל-FINAL_PRICE_SET (אם עדיין PENDING_REVIEW)
      if (current.finalTotal === null && current.status === "PENDING_REVIEW") {
        data.status = data.status ?? "FINAL_PRICE_SET";
        data.finalPriceSetAt = new Date();
        data.finalPriceSetBy = g.session?.user?.email ?? null;
        justSetFinalTotal = true;
        // מסלול חדש: אין יותר קיזוז 1₪ - הלקוח יחויב את הסכום המלא
        const customerForCharge = await prisma.customer.findUnique({ where: { id: current.customerId } });
        if (customerForCharge?.paymentToken) {
          // יש טוקן → מוכן לחיוב אוטומטי דרך /admin/payments
          data.paymentStatus = "READY_TO_CHARGE";
        } else {
          // Fallback: אין טוקן (לקוח ישן?) → לינק תשלום ידני
          data.paymentLink = buildNedarimPaymentLink(id, newFinalTotal, current.customerName);
          data.paymentStatus = "PAYMENT_PENDING";
        }
      }
      data.finalTotal = newFinalTotal;
    }
    const est = items.reduce((s, i) => s + Number(i.estimatedPrice), 0);
    data.estimatedTotal = Math.round(est * 100) / 100;
  }
  if ("finalTotal" in b) data.finalTotal = b.finalTotal;

  // §17: זיהוי שינויים גלויים ללקוח - נשלח מייל עדכון רק אם אלה השתנו,
  // וגם רק אם לא היה justSetFinalTotal (כי אז נשלח sendFinalPriceEmail במקום).
  const contentChanged =
    Array.isArray(b.items) ||
    "pointId" in b ||
    "notes" in b ||
    "customerName" in b ||
    "phone" in b ||
    "phone2" in b;

  const order = await prisma.order.update({
    where: { id },
    data,
    include: { point: true, items: true },
  });
  // אם נקבע מחיר סופי עכשיו - שולחים ללקוח מייל עם קישור תשלום (לא חוסם)
  // אחרת - אם היה שינוי גלוי ללקוח, שולחים מייל עדכון הזמנה (§17)
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
  // הערה: הוסר מייל עדכון כשמנהל עורך - לא צריך להטריח את הלקוח בהודעות
  // על שינויים שהוא לא ביצע. הלקוח יראה את הסטטוס המעודכן באזור אישי.
  // מיילים ללקוח: 1) הזמנה חדשה 2) שינוי שהוא עשה 3) מחיר סופי 4) חיוב

  return NextResponse.json({ ...order, _finalPriceJustSet: justSetFinalTotal });
}

// יוצר לינק תשלום נעול לנדרים פלוס עבור הזמנה ספציפית.
// הסכום נעול (AmountLock=1) - הלקוח לא יכול לשנות אותו.
// ה-webhook של נדרים יפנה ל-/api/webhooks/nedarim עם orderId ב-param1.
// שימוש: נקרא כ-fallback רק כאשר ללקוח אין paymentToken (מסלול ישן).
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
