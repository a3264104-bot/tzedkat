// §20: עמוד המנהל לתעודות משלוח - server component
import AdminDeliveryNotesClient from "./AdminDeliveryNotesClient";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export default async function AdminDeliveryNotesPage({
  searchParams,
}: {
  searchParams: Promise<{ pricelistId?: string }>;
}) {
  const sp = await searchParams;

  // רשימת מחירונים לבחירה (רק פעילים או שהם בסטטוס עבודה)
  const pricelists = await prisma.pricelist.findMany({
    where: {
      status: { in: ["ACTIVE", "CLOSED"] },
    },
    orderBy: { deliveryDate: "desc" },
    select: {
      id: true,
      name: true,
      status: true,
      deliveryDate: true,
    },
    take: 20,
  });

  return (
    <AdminDeliveryNotesClient
      pricelists={pricelists.map((p) => ({
        id: p.id,
        name: p.name,
        status: p.status,
        deliveryDate: p.deliveryDate?.toISOString() || null,
      }))}
      initialPricelistId={sp.pricelistId}
    />
  );
}
