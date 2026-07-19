import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { PersonalOrderClient } from "./PersonalOrderClient";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function PersonalOrderPage() {
  const session = await auth();

  // הזמנה אישית דורשת התחברות (כדי לתמוך בצ'אט ובקשות קיימות)
  if (!session?.user) {
    redirect("/login?callbackUrl=/personal-order");
  }

  const customerId = (session.user as any).id as string;

  // טעינת נתונים במקביל
  const [products, customer, existingRequests] = await Promise.all([
    prisma.personalProduct.findMany({
      where: { isActive: true },
      orderBy: [{ pointId: "asc" }, { sortOrder: "asc" }, { name: "asc" }],
      include: {
        point: { select: { id: true, name: true, city: true } },
      },
    }),
    prisma.customer.findUnique({
      where: { id: customerId },
      select: { name: true, phone: true, email: true },
    }),
    prisma.personalRequest.findMany({
      where: { customerId, status: { notIn: ["CANCELLED", "DONE"] } },
      orderBy: { createdAt: "desc" },
      take: 10,
      include: {
        items: { select: { productName: true, quantity: true } },
      },
    }),
  ]);

  return (
    <PersonalOrderClient
      products={products.map((p) => ({
        id: p.id,
        name: p.name,
        imageUrl: p.imageUrl,
        description: p.description,
        maxQuantity: p.maxQuantity,
        pointId: p.pointId,
        point: p.point,
      }))}
      customer={customer}
      existingRequests={existingRequests.map((r) => ({
        id: r.id,
        requestNumber: r.requestNumber,
        status: r.status,
        createdAt: r.createdAt.toISOString(),
        hasUnreadForCustomer: r.hasUnreadForCustomer,
        items: r.items,
      }))}
    />
  );
}
