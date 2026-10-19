// 🖨️ דפי חלוקה — מסך משלו.
//
// דף החלוקה ודף המיון היו נגישים רק מתוך "בקרת מכירה" (§204, §279),
// בין עשרות כרטיסים. ביום החלוקה המנהל צריך אותם מהר: כאן בוחרים
// מכירה ונקודה ומורידים — אותם קבצים בדיוק (אותו endpoint של הנציג).
import { prisma } from "@/lib/prisma";
import { AdminPageHeader } from "@/components/AdminPageHeader";
import { SalePicker } from "@/components/SalePicker";
import { adminSaleOptions, pickSale } from "@/lib/admin-sales";
import { DistributionSheetsClient } from "./DistributionSheetsClient";

export const dynamic = "force-dynamic";

export default async function DistributionSheetsPage({
  searchParams,
}: {
  searchParams: Promise<{ pricelistId?: string }>;
}) {
  const { pricelistId } = await searchParams;
  const options = await adminSaleOptions();
  const sale = pickSale(options, pricelistId);

  // נקודות שיש בהן הזמנות במכירה — לבורר "לאיזו נקודה להדפיס"
  let points: { id: string; name: string; count: number }[] = [];
  if (sale) {
    const grouped = await prisma.order.groupBy({
      by: ["pointId"],
      where: { pricelistId: sale.id, status: { notIn: ["CANCELLED"] } },
      _count: { _all: true },
    });
    const ids = grouped.map((g) => g.pointId).filter((x): x is string => !!x);
    const names = await prisma.deliveryPoint.findMany({
      where: { id: { in: ids } },
      select: { id: true, name: true },
    });
    const nameOf = new Map(names.map((n) => [n.id, n.name]));
    points = grouped
      .filter((g) => g.pointId)
      .map((g) => ({ id: g.pointId as string, name: nameOf.get(g.pointId as string) ?? "נקודה", count: g._count._all }))
      .sort((a, b) => a.name.localeCompare(b.name, "he"));
  }

  return (
    <div className="space-y-4">
      <AdminPageHeader
        title="🖨️ דפי חלוקה להדפסה"
        subtitle="דף חלוקה (לפי לקוח) ודף מיון (לפי מוצר) — לכל הנקודות או לנקודה אחת."
        actions={sale ? <SalePicker options={options} value={sale.id} /> : undefined}
      />
      {sale ? (
        <DistributionSheetsClient pricelistId={sale.id} points={points} />
      ) : (
        <div className="card p-8 text-center text-zinc-500">אין מכירה פעילה או סגורה.</div>
      )}
    </div>
  );
}
