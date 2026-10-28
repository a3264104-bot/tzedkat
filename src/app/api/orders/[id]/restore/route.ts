// ═══════════════════════════════════════════════════════════════
// POST /api/orders/[id]/restore — שחזור הזמנה שבוטלה בטעות (מנהל)
// ═══════════════════════════════════════════════════════════════
// לוקח את הגיבוי האחרון (OrderBackup) ומחזיר את מצב ההזמנה ומצב
// התשלום כפי שהיו. הפריטים לא נגעו בביטול, ולכן לא צריך לשחזר אותם.
// חוב/יתרה מתקזזים מחדש בחישוב הסכום (כמו בשקילה רגילה).
//
// ⚠️ הזמנה ששולמה ובוטלה — לא משוחזרת כאן: הסכום כבר נזקף ללקוח
// כזיכוי, ושחזור היה דורש לבטל את הזיכוי ידנית.

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAgent } from "@/lib/agent-guard";
import { recomputeOrderTotal } from "@/lib/order-total-lib";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const g = await requireAgent();
  if (!g.ok) return g.res;
  if (!g.isAdmin) {
    return NextResponse.json({ error: "רק המנהל יכול לשחזר הזמנה" }, { status: 403 });
  }
  const { id } = await params;
  const order = await prisma.order.findUnique({
    where: { id },
    select: { id: true, orderNumber: true, status: true, internalNotes: true },
  });
  if (!order) return NextResponse.json({ error: "הזמנה לא נמצאה" }, { status: 404 });
  if (order.status !== "CANCELLED") {
    return NextResponse.json({ error: "ההזמנה אינה מבוטלת" }, { status: 400 });
  }
  const backup = await prisma.orderBackup.findFirst({
    where: { orderId: id, kind: "CANCEL", restoredAt: null },
    orderBy: { createdAt: "desc" },
  });
  // ביטול ישן (לפני שהיה גיבוי): חוזרים ל"ממתין" כמו בעבר
  const snap = (backup?.snapshot as any) ?? {
    status: "PENDING_REVIEW",
    paymentStatus: undefined,
  };
  if (Number(snap?.amountPaid ?? 0) > 0 || snap?.paymentStatus === "PAID") {
    return NextResponse.json(
      { error: "ההזמנה שולמה לפני הביטול והסכום הוחזר כזיכוי — שחזור ידני בלבד." },
      { status: 400 }
    );
  }

  const stamp = new Date().toLocaleString("he-IL", { timeZone: "Asia/Jerusalem" });
  const who = g.session?.user?.email ?? g.agent.name;
  const line = `[${stamp}] שוחזרה מביטול ע"י ${who}`;
  await prisma.$transaction([
    prisma.order.update({
      where: { id },
      data: {
        status: String(snap?.status ?? "PENDING_REVIEW"),
        ...(snap?.paymentStatus
          ? { paymentStatus: String(snap.paymentStatus) }
          : {}),
        internalNotes: order.internalNotes ? `${order.internalNotes}\n${line}` : line,
      },
    }),
    ...(backup
      ? [
          prisma.orderBackup.update({
            where: { id: backup.id },
            data: { restoredAt: new Date(), restoredBy: who },
          }),
        ]
      : []),
  ]);
  // ביטול ישן בלי גיבוי שסימן גם את מצב התשלום כמבוטל
  if (!backup) {
    await prisma.order.updateMany({
      where: { id, paymentStatus: "CANCELLED" },
      data: { paymentStatus: "PENDING" },
    });
  }
  // קיזוז חוב/יתרה מחדש — רק אם ההזמנה שקולה במלואה
  await recomputeOrderTotal(id, null);
  return NextResponse.json({ ok: true });
}
