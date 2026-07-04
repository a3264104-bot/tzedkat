import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { OrderFlow } from "@/app/order/OrderFlow";

export const dynamic = "force-dynamic";

export default async function AgentOrderPage({
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

  // הלקוח שעבורו מזמינים
  const targetCustomer = await prisma.customer.findUnique({
    where: { id: customerId },
    include: { defaultPoint: true },
  });
  if (!targetCustomer || targetCustomer.role !== "CUSTOMER") {
    redirect("/agent");
  }

  // אימות הרשאת נציג מוגבל-נקודה
  if (role === "AGENT") {
    const agent = await prisma.customer.findUnique({ where: { id: sessionUserId } });
    if (agent?.agentPointId) {
      const belongs =
        targetCustomer.defaultPointId === agent.agentPointId ||
        (await prisma.order.count({
          where: { customerId: targetCustomer.id, pointId: agent.agentPointId },
        })) > 0;
      if (!belongs) redirect("/agent");
    }
  }

  const pricelist = await prisma.pricelist.findFirst({
    where: { status: "ACTIVE" },
    orderBy: { createdAt: "desc" },
    include: {
      points: { include: { point: true } },
      products: { include: { product: { include: { category: true } } } },
    },
  });

  const now = new Date();
  const closed = pricelist?.closeDate != null && now > new Date(pricelist.closeDate);
  const notYetOpen = pricelist?.openDate != null && now < new Date(pricelist.openDate);

  if (!pricelist || closed || notYetOpen) {
    return (
      <main dir="rtl" className="min-h-screen bg-brand-yellow flex items-center justify-center p-6">
        <div className="card p-8 text-center max-w-sm">
          <p className="text-lg font-bold text-brand-slatedark">אין כרגע מכירה פעילה</p>
          <Link href="/agent" className="btn-ghost mt-4">
            חזרה לאזור הנציג
          </Link>
        </div>
      </main>
    );
  }

  const points = pricelist.points
    .map((pp) => pp.point)
    .filter((p) => p.isActive)
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((p) => ({
      id: p.id,
      name: p.name,
      city: p.city,
      address: p.address,
      contactName: p.contactName,
      phone: p.phone,
      email: p.email,
      deliveryHours: p.deliveryHours,
      notes: p.notes,
    }));

  const products = pricelist.products
    .filter((pp) => pp.product.isActive)
    .map((pp) => ({
      id: pp.product.id,
      name: pp.product.name,
      category: pp.product.category.name,
      categorySort: pp.product.category.sortOrder,
      price: Number(pp.price ?? pp.product.cartonPrice),
      allowSingles: pp.product.allowSingles,
      unit: pp.product.unit,
      saleType: pp.product.saleType,
      priceType: pp.product.priceType,
      packageWeight: pp.product.packageWeight,
      isFrozen: pp.product.isFrozen,
      limitedQty: pp.product.limitedQty,
      sortOrder: pp.product.sortOrder,
    }))
    .sort((a, b) => a.categorySort - b.categorySort || a.sortOrder - b.sortOrder);

  return (
    <div>
      {/* באנר שמבהיר שזו הזמנה בשם לקoot */}
      <div className="bg-brand-slatedark text-white text-center py-2 text-sm font-medium">
        הזמנה בשם: {targetCustomer.name}
        {targetCustomer.phone ? ` · ${targetCustomer.phone}` : ""}
      </div>
      <OrderFlow
        pricelist={{
          id: pricelist.id,
          name: pricelist.name,
          deliveryDateText: pricelist.deliveryDateText,
          notes: pricelist.notes,
          singleSurcharge: Number(pricelist.singleSurcharge),
        }}
        points={points}
        products={products}
        customer={{
          name: targetCustomer.name,
          phone: targetCustomer.phone,
          email: targetCustomer.email,
          defaultPointId: targetCustomer.defaultPointId,
        }}
        onBehalfOfCustomerId={targetCustomer.id}
      />
    </div>
  );
}
