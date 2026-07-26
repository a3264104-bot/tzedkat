// §20: מסך פרופיל נציג מלא
import AgentProfileClient from "./AgentProfileClient";

export const dynamic = "force-dynamic";

export default async function AgentProfilePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <AgentProfileClient agentId={id} />;
}
