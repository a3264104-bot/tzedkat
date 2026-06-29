import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";

export async function requireAdmin() {
  const session = await auth();
  if (!session?.user) {
    return { ok: false as const, res: NextResponse.json({ error: "לא מורשה" }, { status: 401 }) };
  }
  return { ok: true as const };
}
