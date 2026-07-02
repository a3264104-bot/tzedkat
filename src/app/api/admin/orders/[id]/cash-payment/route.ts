import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/guard";
import { resolvePaymentStatusFromAmount } from "@/lib/pricing";

// סימון תשלום מזומן - פעולה נפרדת ומבוקרת (לא דרך ה-PATCH הכללי של ההזמנה).
// כללים (לפי המפרט): חובה finalTotal קיים מראש; חובה receivedBy; אם amountPaid < finalTotal
// מסומן PARTIALLY_PAID; שווה -> PAID; כל מקרה נרשם ב-PaymentAuditLog שלא נמחק לעולם.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const g = await requireAdmin();
  if (!g.ok) return g.res;
  const { id } = await params;

  const b = await req.json();
  const amountPaid = Number(b.amountPaid);
  const note: string | null = b.note ?? null;
  const receivedByUserId = g.session?.user?.email ?? g.session?.user?.name ?? "unknown";

  if (!amountPaid || amountPaid <= 0) {
    return NextResponse.json({ error: "יש להזין סכום תקין שהתקבל" }, { status: 400 });
  }

  const order = await prisma.order.findUnique({ where: { id } });
  if (!order) return NextResponse.json({ error: "הזמנה לא נמצאה" }, { status: 404 });

  // לא ניתן לסמן תשלום מזומן לפני שקיים מחיר סופי
  if (order.finalTotal === null) {
    return NextResponse.json(
      { error: "יש לקבוע מחיר סופי לפני סימון תשלום" },
      { status: 400 }
    );
  }
  if (order.paymentStatus === "PAID") {
    return NextResponse.json({ error: "ההזמנה כבר מסומנת כשולמה" }, { status: 400 });
  }

  const finalTotal = Number(order.finalTotal);
  const resolved = resolvePaymentStatusFromAmount(amountPaid, finalTotal);
  // OVERPAID מטופל כ"שולם" לצורך paymentStatus (האזהרה כבר הוצגה ללקוח בצד הלקוח לפני אישור)
  const paymentStatus = resolved === "PARTIALLY_PAID" ? "PARTIALLY_PAID" : "PAID";

  // חובה הערה אם שולם פחות מהסכום הסופי (גם נאכף כאן, לא רק ב-UI)
  if (resolved === "PARTIALLY_PAID" && !note) {
    return NextResponse.json(
      { error: "סכום נמוך מהמחיר הסופי - חובה להוסיף הערה" },
      { status: 400 }
    );
  }

  const updated = await prisma.order.update({
    where: { id },
    data: {
      paymentStatus,
      paymentMethod: "CASH",
      amountPaid,
      paidAt: new Date(),
      receivedByUserId,
      manualPaymentNote: note,
    },
  });

  await prisma.paymentAuditLog.create({
    data: {
      orderId: id,
      action: "MANUAL_CASH_PAYMENT",
      amountPaid,
      finalTotalAtTime: finalTotal,
      paymentMethod: "CASH",
      receivedByUserId,
      note,
    },
  });

  return NextResponse.json(updated);
}
