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
          pricelist: { select: { closeDate: true, editDeadline: true } },
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
    where: { status: "ACTIVE" },
    select: { id: true },
  });

  const ordersData = customer.orders.map((o) => ({
    id: o.id,
    orderNumber: o.orderNumber,
    status: o.status,
    paymentStatus: o.paymentStatus,
    paymentMethod: o.paymentMethod,
    paymentLink: o.paymentLink,
    pointName: o.point?.name ?? o.pointNameSnapshot ?? "",
    pointAddress: o.point?.address ?? null,
    pointDeliveryHours: o.point?.deliveryHours ?? null,
    deliveryDate: o.deliveryDateSnapshot,
    estimatedTotal: Number(o.estimatedTotal),
    finalTotal: o.finalTotal != null ? Number(o.finalTotal) : null,
    createdAt: o.createdAt.toISOString(),
    itemCount: o.items.length,
    // §7: רשימת מוצרים עם תמונות
    items: o.items.map((item) => ({
      productName: item.productName,
      unit: item.unit,
      quantity: Number(item.quantity),
      isSingle: item.isSingle,
      imageUrl: (item as any).product?.imageUrl ?? null,
    })),
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
        name: customer.name,
        phone: customer.phone,
        email: customer.email,
        cardLast4: customer.cardLast4,
        defaultPointId: customer.defaultPointId,
        defaultPointName: customer.defaultPoint?.name ?? null,
      }}
      orders={ordersData}
      points={points}
      hasActiveSale={!!activePricelist}
    />
  );
}
