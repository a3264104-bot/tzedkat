import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { AccountClient } from "./AccountClient";

export const dynamic = "force-dynamic";

export default async function AccountPage() {
  const session = await auth();
  if (!session?.user) {
    redirect("/login?callbackUrl=/account");
  }

  const customerId = (session.user as any).id as string;
  const role = (session.user as any).role;

  // אם זה מנהל שנכנס - מפנים לאזור הניהול
  if (role === "ADMIN") {
    redirect("/admin");
  }

  const customer = await prisma.customer.findUnique({
    where: { id: customerId },
    include: {
      defaultPoint: { select: { id: true, name: true, city: true } },
      orders: {
        orderBy: { createdAt: "desc" },
        include: {
          point: { select: { name: true, city: true, address: true, deliveryHours: true } },
          items: { include: { product: { select: { imageUrl: true } } } },
          // §59: orderFee נטען מהמחירון לצורך זיהוי שורת "דמי הזמנה"
          // בפירוט החיוב. הוא *לא* snapshot — אם דמי ההזמנה ישתנו אחרי
          // ההזמנה, הערך כאן לא ישקף את מה שנגבה בפועל. לכן הלקוח
          // (AccountClient) משתמש בו רק לזיהוי: ההפרש בין סכום הפריטים
          // לסה"כ ההזמנה נקרא "דמי הזמנה" רק אם הוא שווה לו בדיוק.
          pricelist: { select: { closeDate: true, editDeadline: true, orderFee: true } },
        },
      },
    },
  });

  if (!customer) {
    redirect("/login?callbackUrl=/account");
  }

  // רשימת נקודות לשינוי תחנה שמורה
  const points = await prisma.deliveryPoint.findMany({
    where: { isActive: true },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    select: { id: true, name: true, city: true },
  });

  // בודקים אם יש מכירה פעילה (כדי להציג/להסתיר כפתור הזמנה חדשה)
  const activePricelist = await prisma.pricelist.findFirst({
    // §111: מכירה לנציגים בלבד לא מוצגת ללקוח באזור האישי
    where: { status: "ACTIVE", agentOnly: false },
    select: { id: true },
  });

  const ordersData = customer.orders.map((o) => ({
    id: o.id,
    orderNumber: o.orderNumber,
    status: o.status,
    paymentStatus: o.paymentStatus,
    paymentMethod: o.paymentMethod,
    paymentLink: o.paymentLink,
    // §133: הערת הלקוח ותשובת הנציג
    customerNote: o.customerNote,
    customerNoteAt: o.customerNoteAt?.toISOString() ?? null,
    agentReply: o.agentReply,
    agentReplyAt: o.agentReplyAt?.toISOString() ?? null,
    pointName: o.point?.name ?? o.pointNameSnapshot ?? "",
    pointAddress: o.point?.address ?? null,
    pointDeliveryHours: o.point?.deliveryHours ?? null,
    deliveryDate: o.deliveryDateSnapshot,
    estimatedTotal: Number(o.estimatedTotal),
    finalTotal: o.finalTotal != null ? Number(o.finalTotal) : null,
    // §59: מה ששולם בפועל עשוי להיות שונה מ-finalTotal (תשלום חלקי,
    // עיגול מזומן). מוצג בפירוט החיוב רק אם הוא שונה מהסה"כ.
    amountPaid: o.amountPaid != null ? Number(o.amountPaid) : null,
    createdAt: o.createdAt.toISOString(),
    itemCount: o.items.length,
    // §59: פירוט חיוב מלא — כמו במייל החיוב. כל השדות הם snapshot
    // מרגע ההזמנה/השקילה (unitPrice, estimatedPrice, finalPrice), ולכן
    // התצוגה נכונה גם להזמנות ישנות שהמחירון שלהן השתנה.
    items: o.items.map((item) => ({
      id: item.id,
      productName: item.productName,
      unit: item.unit,
      quantity: Number(item.quantity),
      isSingle: item.isSingle,
      isCancelled: item.isCancelled,
      imageUrl: (item as any).product?.imageUrl ?? null,
      // §49: estimatedWeight הוא הערכה ומוצג עם "כ-", actualWeight הוא
      // עובדה אחרי שקילה. finalWeight הוא שדה תאימות-לאחור זהה
      // ל-actualWeight, ולכן משמש כנפילה עבור הזמנות ישנות.
      estimatedWeight: item.estimatedWeight != null ? Number(item.estimatedWeight) : null,
      actualWeight:
        item.actualWeight != null
          ? Number(item.actualWeight)
          : item.finalWeight != null
            ? Number(item.finalWeight)
            : null,
      unitPrice: Number(item.unitPrice),
      estimatedPrice: Number(item.estimatedPrice),
      finalPrice: item.finalPrice != null ? Number(item.finalPrice) : null,
    })),
    pricelistOrderFee: o.pricelist?.orderFee != null ? Number(o.pricelist.orderFee) : null,
    // שדות ל-§16: עריכה/ביטול הזמנה
    customerName: o.customerName,
    phone: o.phone,
    phone2: o.phone2,
    pointId: o.pointId,
    notes: o.notes,
    pricelistCloseDate: o.pricelist?.closeDate?.toISOString() ?? null,
    pricelistEditDeadline: o.pricelist?.editDeadline?.toISOString() ?? null,
  }));

  return (
    <AccountClient
      customer={{
        id: customer.id,
        name: customer.name,
        phone: customer.phone,
        phone2: customer.phone2,
        email: customer.email,
        cardLast4: customer.cardLast4,
        defaultPointId: customer.defaultPointId,
        defaultPointName: customer.defaultPoint?.name ?? null,
        agreedToEmails: customer.agreedToEmails,
        // §124: יתרת זכות להזמנה הבאה. הלקוח צריך לראות שמגיע לו
        // כסף - אחרת הוא לא יודע, ויפנה לנציג לשאול.
        creditBalance: Number(customer.creditBalance ?? 0),
        // §64: נציג במצב לקוח - מתג חזרה לאזור הנציג (סעיף 5)
        role: customer.role,
        // §64: השלמת הרשמה עצמאית (סעיף 9). לקוח מזומן לא נדרש
        // לכרטיס, ולכן paymentPreference נבדק יחד עם קיום הטוקן.
        hasCard: !!customer.paymentToken,
        paymentPreference: customer.paymentPreference,
      }}
      orders={ordersData}
      points={points}
      hasActiveSale={!!activePricelist}
    />
  );
}
