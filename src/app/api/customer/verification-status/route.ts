// GET /api/customer/verification-status
// בודק אם ללקוח יש paymentToken (כרטיס אשראי שאומת ונשמר).
// שימושים:
//   1. OrderFlow - polling אחרי iframe אימות ראשוני
//   2. UpdateCardButton - polling אחרי עדכון כרטיס
//
// אם עובר customerId ב-query - בודק את הלקוח הזה (מנהל/נציג)
// אחרת - בודק את הלקוח המחובר (שימוש של הלקוח עצמו)

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "לא מורשה" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const requestedCustomerId = searchParams.get("customerId");
  const sessionUserId = (session.user as any).id as string;
  const role = (session.user as any).role;

  // קובעים מי הלקוח שאנחנו בודקים
  let targetCustomerId = sessionUserId; // ברירת מחדל: המשתמש עצמו
  if (requestedCustomerId && requestedCustomerId !== sessionUserId) {
    // הרשאה: רק מנהל או נציג יכולים לבדוק לקוח אחר
    if (role !== "ADMIN" && role !== "AGENT") {
      return NextResponse.json({ error: "אין הרשאה" }, { status: 403 });
    }
    targetCustomerId = requestedCustomerId;
  }

  const customer = await prisma.customer.findUnique({
    where: { id: targetCustomerId },
    select: {
      paymentToken: true,
      cardLast4: true,
      cardExpiry: true,
      cardVerifiedAt: true,
      cardNeedsUpdate: true,
    },
  });

  if (!customer) {
    return NextResponse.json({ verified: false });
  }

  return NextResponse.json({
    verified: !!customer.paymentToken,
    cardLast4: customer.cardLast4,
    cardExpiry: customer.cardExpiry,
    cardVerifiedAt: customer.cardVerifiedAt,
    cardNeedsUpdate: customer.cardNeedsUpdate,
  });
}
