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
  if (role === "AGENT") {
    const agent = await prisma.customer.findUnique({ where: { id: sessionUserId } });
    canSetFinalPrice = agent?.agentCanSetFinalPrice ?? false;
    canSendPaymentLink = agent?.agentCanSendPaymentLink ?? false;
    if (agent?.agentPointId) {
      const belongs =
        customer.defaultPointId === agent.agentPointId ||
        customer.orders.some((o) => o.pointId === agent.agentPointId);
      if (!belongs) redirect("/agent");
    }
  }

  const orders = customer.orders.map((o) => ({
    id: o.id,
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
      customerName={customer.name}
      customerPhone={customer.phone}
      orders={orders}
      canSetFinalPrice={canSetFinalPrice}
      canSendPaymentLink={canSendPaymentLink}
    />
  );
}
