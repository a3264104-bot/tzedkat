// §20: מסך בקרת משקלים למנהל - server component
import AdminWeightReviewClient from "./AdminWeightReviewClient";

export const dynamic = "force-dynamic";

export default async function AdminWeightReviewPage({
  params,
}: {
  params: Promise<{ pricelistId: string }>;
}) {
  const { pricelistId } = await params;
  return <AdminWeightReviewClient pricelistId={pricelistId} />;
}
