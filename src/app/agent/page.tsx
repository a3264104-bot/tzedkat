import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { AgentClient } from "./AgentClient";

export const dynamic = "force-dynamic";

export default async function AgentPage() {
  const session = await auth();
  if (!session?.user) {
    redirect("/login?callbackUrl=/agent");
  }

  const role = (session.user as any).role;
  // רק נציג או מנהל
  if (role !== "AGENT" && role !== "ADMIN") {
    redirect("/account");
  }

  const id = (session.user as any).id as string;
  const agent = await prisma.customer.findUnique({
    where: { id },
    include: { agentPoint: { select: { name: true } } },
  });

  // מנהל שנכנס - מקבל הרשאות מלאות
  const canSetFinalPrice = role === "ADMIN" ? true : agent?.agentCanSetFinalPrice ?? false;
  const pointName = role === "ADMIN" ? null : agent?.agentPoint?.name ?? null;

  return (
    <AgentClient
      agentName={role === "ADMIN" ? "מנהל" : agent?.name ?? "נציג"}
      canSetFinalPrice={canSetFinalPrice}
      restrictedPointName={pointName}
    />
  );
}
