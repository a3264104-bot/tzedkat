// §20: מסך פירוט מלא של פעילות נציג במכירה
import AgentSaleDetailClient from "./AgentSaleDetailClient";

export const dynamic = "force-dynamic";

export default async function AgentSaleDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ agentId: string }>;
  searchParams: Promise<{ pricelistId?: string }>;
}) {
  const { agentId } = await params;
  const sp = await searchParams;
  return (
    <AgentSaleDetailClient
      agentId={agentId}
      pricelistId={sp.pricelistId || ""}
    />
  );
}
