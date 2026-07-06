import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";

// סטטוס אימות כרטיס של הלקוח המחובר.
// זרימת ההזמנה מבצעת polling על הנקודה הזו בזמן שהלקוח מזין
// פרטי אשראי ב-iframe של נדרים - עד שה-webhook שומר את הטוקן.
export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "יש להתחבר" }, { status: 401 });
  }
  const id = (session.user as any).id as string;
  const customer = await prisma.customer.findUnique({
    where: { id },
    select: { paymentToken: true, cardLast4: true },
  });
  return NextResponse.json({
    verified: !!customer?.paymentToken,
    cardLast4: customer?.cardLast4 ?? null,
  });
}
