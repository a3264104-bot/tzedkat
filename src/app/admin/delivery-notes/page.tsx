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
  // §398: 🐛 שבועות סגורים (§396) נשארים CLOSED, ותאריך החלוקה שלהם
  // הוא תמיד החדש ביותר — אחרי כמה שבועות הם מילאו את 20 השורות,
  // המכירה החודשית נעלמה, והמסך נפתח על שבוע. עכשיו: רגילות קודם
  // (ברירת המחדל = הראשונה), ואחריהן השבועות האחרונים.
  const select = { id: true, name: true, status: true, deliveryDate: true } as const;
  const [regular, weekly] = await Promise.all([
    prisma.pricelist.findMany({
      where: { status: { in: ["ACTIVE", "CLOSED"] }, weeklySeriesId: null },
      orderBy: { deliveryDate: "desc" },
      select,
      take: 20,
    }),
    prisma.pricelist.findMany({
      where: { status: { in: ["ACTIVE", "CLOSED"] }, weeklySeriesId: { not: null } },
      orderBy: { deliveryDate: "desc" },
      select,
      take: 8,
    }),
  ]);
  const pricelists = [...regular, ...weekly];

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
