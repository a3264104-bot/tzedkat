import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { AgentCustomerClient } from "./AgentCustomerClient";

export const dynamic = "force-dynamic";

export default async function AgentCustomerPage({
  params,
}: {
  params: Promise<{ customerId: string }>;
}) {
  const { customerId } = await params;
  const session = await auth();
  if (!session?.user) redirect("/login?callbackUrl=/agent");

  const role = (session.user as any).role;
  if (role !== "AGENT" && role !== "ADMIN") redirect("/account");
  const sessionUserId = (session.user as any).id as string;

  const customer = await prisma.customer.findUnique({
    where: { id: customerId },
    include: {
      orders: {
        orderBy: { createdAt: "desc" },
        include: { items: true, point: { select: { name: true } } },
      },
    },
  });
  if (!customer || customer.role !== "CUSTOMER") redirect("/agent");

  // הרשאות נציג
  let canSetFinalPrice = role === "ADMIN";
  let canSendPaymentLink = role === "ADMIN";
  let canUpdateCards = role === "ADMIN";
  if (role === "AGENT") {
    const agent = await prisma.customer.findUnique({
      where: { id: sessionUserId },
      include: { agentPoints: { select: { pointId: true } } },
    });
    canSetFinalPrice = agent?.agentCanSetFinalPrice ?? false;
    canSendPaymentLink = agent?.agentCanSendPaymentLink ?? false;
    canUpdateCards = agent?.agentCanUpdateCards ?? false;

    // §60: 🐛 תוקן דפוס ג' + חור מדפוס §55.
    //
    // הבדיקה הקודמת: `if (agent?.agentPointId) { ... }` - נשענה רק על
    // השדה הישן. נציג רב-נקודתי (agentPoints[] מלא, agentPointId ריק)
    // דילג על הבדיקה כולה וראה *כל לקוח במערכת*. עכשיו: כל הנקודות
    // עם נפילה לשדה הישן, נציג בלי נקודות נחסם, והכלל זהה למסך
    // ההזמנה - יוצר הלקוח / נקודת ברירת מחדל / הזמנה קודמת בנקודה.
    const agentPointIds = new Set(agent?.agentPoints.map((ap) => ap.pointId) ?? []);
    if (agent?.agentPointId) agentPointIds.add(agent.agentPointId);
    if (agentPointIds.size === 0) redirect("/agent");

    const isCreator = customer.createdByAgentId === sessionUserId;
    const belongs =
      isCreator ||
      (customer.defaultPointId !== null && agentPointIds.has(customer.defaultPointId)) ||
      customer.orders.some((o) => agentPointIds.has(o.pointId));
    if (!belongs) redirect("/agent");
  }

  // §67: מוצרי המכירה הפעילה, להוספת פריט מכרטיס הלקוח.
  //
  // רק המכירה הפעילה: הוספה להזמנה של מכירה שהסתיימה היא כמעט תמיד
  // טעות, והמחירים שם כבר לא רלוונטיים.
  //
  // אין סינון isActive - המוצרים המיוחדים ("מועדפים") נכללים
  // ומסומנים, בדיוק כמו במסך המכירה.
  // §111: **כל** המכירות הפעילות, כולל "לנציגים בלבד".
  //
  // הנציג רואה כאן את כולן ובוחר באיזו לפתוח הזמנה. הלקוח לא
  // מגיע למסך הזה בכלל, ולכן אין חשש שהוא ייחשף למכירה המהירה.
  const activeSales = await prisma.pricelist.findMany({
    where: { status: "ACTIVE" },
    // רגילות קודם, כדי שברירת המחדל תהיה תמיד המכירה הראשית
    orderBy: [{ agentOnly: "asc" }, { createdAt: "desc" }],
    select: {
      id: true,
      name: true,
      agentOnly: true,
      singleSurcharge: true,
      deliveryDateText: true,
    },
  });

  // המכירה הרגילה היא ברירת המחדל לתצוגה ולהוספת מוצרים
  const activePricelist =
    activeSales.find((p) => !p.agentOnly) ?? activeSales[0] ?? null;

  const availableProducts = activePricelist
    ? await prisma.pricelistProduct.findMany({
        where: { pricelistId: activePricelist.id },
        include: {
          product: {
            select: {
              id: true,
              name: true,
              unit: true,
              cartonPrice: true,
              priceType: true,
              allowSingles: true,
              singlesMode: true,
              singleUnitPrice: true,
              avgWeightPerUnit: true,
              isActive: true,
              category: { select: { name: true } },
            },
          },
        },
      })
    : [];

  const orders = customer.orders.map((o) => ({
    id: o.id,
    // §67: נדרש כדי להציג הוספת מוצר רק בהזמנות של המכירה הפעילה
    pricelistId: o.pricelistId,
    orderNumber: o.orderNumber,
    status: o.status,
    paymentStatus: o.paymentStatus,
    pointName: o.point?.name ?? o.pointNameSnapshot ?? "",
    createdAt: o.createdAt.toISOString(),
    estimatedTotal: Number(o.estimatedTotal),
    finalTotal: o.finalTotal != null ? Number(o.finalTotal) : null,
    items: o.items.map((it) => ({
      id: it.id,
      productName: it.productName,
      unit: it.unit,
      // §128: בלי isSingle הקליינט מניח שהכל קרטונים - בדיוק
      // הבאג שחזר. formatItemQty לא יכול לעבוד בלעדיו.
      isSingle: it.isSingle,
      quantity: Number(it.quantity),
      estimatedPrice: Number(it.estimatedPrice),
      estimatedWeight: it.estimatedWeight != null ? Number(it.estimatedWeight) : null,
      actualWeight: it.actualWeight != null ? Number(it.actualWeight) : null,
      finalWeight: it.finalWeight != null ? Number(it.finalWeight) : null,
      finalPrice: it.finalPrice != null ? Number(it.finalPrice) : null,
      unitPrice: Number(it.unitPrice),
    })),
  }));

  return (
    <AgentCustomerClient
      customerId={customer.id}
      customerName={customer.name}
      customerPhone={customer.phone}
      // §263: חוב מהעבר - להצגה ולרישום
      debtBalance={Number((customer as any).debtBalance ?? 0)}
      debtNote={(customer as any).debtNote}
      // §60: מצב התשלום - לתצוגה ולכפתור ההחלפה מזומן/אשראי
      paymentPreference={customer.paymentPreference}
      hasCard={!!customer.paymentToken}
      cardLast4={customer.cardLast4}
      canUpdateCards={canUpdateCards}
      orders={orders}
      canSetFinalPrice={canSetFinalPrice}
      canSendPaymentLink={canSendPaymentLink}
      activePricelistId={activePricelist?.id ?? null}
      // §111: כל המכירות הפעילות - לבורר ההזמנה החדשה
      activeSales={activeSales.map((sl) => ({
        id: sl.id,
        name: sl.name,
        agentOnly: sl.agentOnly,
        deliveryDateText: sl.deliveryDateText,
      }))}
      singleSurcharge={Number(activePricelist?.singleSurcharge ?? 0)}
      availableProducts={availableProducts.map((pp) => ({
        id: pp.product.id,
        name: pp.product.name,
        unit: pp.product.unit,
        // מחיר המכירה, לא מחיר הבסיס של המוצר
        cartonPrice: Number(pp.price ?? pp.product.cartonPrice),
        priceType: pp.product.priceType,
        allowSingles: pp.product.allowSingles,
        singlesMode: pp.product.singlesMode,
        singleUnitPrice:
          pp.product.singleUnitPrice != null ? Number(pp.product.singleUnitPrice) : null,
        avgWeightPerUnit:
          pp.product.avgWeightPerUnit != null ? Number(pp.product.avgWeightPerUnit) : null,
        isActive: pp.product.isActive,
        categoryName: pp.product.category?.name ?? null,
      }))}
    />
  );
}
