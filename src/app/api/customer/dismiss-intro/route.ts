// מסמן שהלקוח כבר ראה את מסך "ברוכים הבאים" של ההזמנה
// POST /api/customer/dismiss-intro

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";

export async function POST() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "לא מחובר" }, { status: 401 });
  }
  const userId = (session.user as any).id as string;
  if (!userId) {
    return NextResponse.json({ error: "משתמש לא זוהה" }, { status: 401 });
  }

  await prisma.customer.update({
    where: { id: userId },
    data: { hasSeenOrderIntro: true },
  });

  return NextResponse.json({ ok: true });
}
