import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { PersonalOrderClient } from "./PersonalOrderClient";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function PersonalOrderPage() {
  const session = await auth();

  if (!session?.user) {
    redirect("/login?callbackUrl=/personal-order");
  }

  const customerId = (session.user as any).id as string;

  // §9: טעינת מוצרים מהטבלה הרגילה - מקור אמת אחד
  // סינון: isActive + allowPersonalOrder
  const [products, customer, existingRequests] = await Promise.all([
    prisma.product.findMany({
      where: { isActive: true, allowPersonalOrder: true },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      include: {
        category: { select: { name: true } },
        // §73: תמונת הכשרות - כמו בהזמנה הרגילה
        kashrutRef: { select: { name: true, imageUrl: true } },
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
        items: { select: { productName: true, quantity: true, isSingle: true } },
      },
    }),
  ]);

  return (
    <PersonalOrderClient
      products={products.map((p) => ({
        id: p.id,
        name: p.name,
        imageUrl: p.imageUrl,
        category: p.category?.name ?? null,
        // §73: שם הכשרות מהרפרנס (עם נפילה לטקסט החופשי) + תמונה,
        // בדיוק כמו שההזמנה הרגילה מציגה
        kashrut: p.kashrutRef?.name ?? p.kashrut,
        kashrutImageUrl: p.kashrutRef?.imageUrl ?? null,
        // §73: לבורר בודדים/קרטונים
        allowSingles: p.allowSingles,
        singlesMode: p.singlesMode,
        unit: p.unit,
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
