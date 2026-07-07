import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { PersonalOrderClient } from "./PersonalOrderClient";

export const dynamic = "force-dynamic";

export default async function PersonalOrderPage() {
  const session = await auth();
  if (!session?.user) {
    redirect("/login?callbackUrl=/personal-order");
  }
  return <PersonalOrderClient customerName={(session.user as any).name ?? ""} />;
}
