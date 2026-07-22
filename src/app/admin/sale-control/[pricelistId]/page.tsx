// §20: מסך בקרת מכירה למנהל - server component
import AdminSaleControlClient from "./AdminSaleControlClient";

export const dynamic = "force-dynamic";

export default async function AdminSaleControlPage({
  params,
}: {
  params: Promise<{ pricelistId: string }>;
}) {
  const { pricelistId } = await params;
  return <AdminSaleControlClient pricelistId={pricelistId} />;
}
