// §20: מסך פירוט מלא של פעילות נציג במכירה
import AgentSaleDetailClient from "./AgentSaleDetailClient";

export const dynamic = "force-dynamic";

export default async function AgentSaleDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ pricelistId?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  return (
    <AgentSaleDetailClient
      id={id}
      pricelistId={sp.pricelistId || ""}
    />
  );
}
