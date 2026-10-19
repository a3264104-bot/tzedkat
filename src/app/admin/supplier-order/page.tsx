// 🚚 הזמנה לספק — מסך משלו.
//
// עד עכשיו הטבלה (SupplierOrderPlanner, §51) ישבה באמצע "סיכום מכירה",
// אחרי כרטיסים וטבלאות, והמנהל היה צריך לחפש אותה בכל מכירה. זו אותה
// טבלה בדיוק — מה שממלאים כאן נשמר ומופיע גם בסיכום ובאקסל.
import { AdminPageHeader } from "@/components/AdminPageHeader";
import { SalePicker } from "@/components/SalePicker";
import { SupplierOrderPlanner } from "@/components/SupplierOrderPlanner";
import { adminSaleOptions, pickSale } from "@/lib/admin-sales";

export const dynamic = "force-dynamic";

export default async function SupplierOrderPage({
  searchParams,
}: {
  searchParams: Promise<{ pricelistId?: string }>;
}) {
  const { pricelistId } = await searchParams;
  const options = await adminSaleOptions();
  const sale = pickSale(options, pricelistId);

  return (
    <div className="space-y-4">
      <AdminPageHeader
        title="🚚 הזמנה לספק"
        subtitle="כמה קרטונים להזמין מכל מוצר — לפי מה שהלקוחות הזמינו. מה שממלאים כאן נשמר."
        actions={sale ? <SalePicker options={options} value={sale.id} /> : undefined}
      />
      {sale ? (
        <SupplierOrderPlanner pricelistId={sale.id} />
      ) : (
        <div className="card p-8 text-center text-zinc-500">אין מכירה פעילה או סגורה.</div>
      )}
    </div>
  );
}
