// §48: סימון מרוכז של הזמנות.
// POST /api/admin/orders/bulk-status
//
// Body: { orderIds: string[], action: "READY" | "DELIVERED" | "UNDO_READY" }
//
// למה endpoint נפרד ולא לולאה של PATCH מהלקוח: סימון של 40 הזמנות
// בנקודה היה מייצר 40 קריאות רשת, וכל אחת עלולה להיכשל בנפרד -
// המנהל היה נשאר עם מצב חלקי בלי לדעת מה עבר ומה לא.
//
// כאן זו פעולה אחת, עם דיווח מפורש על מה נכשל ולמה.

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/guard";

export async function POST(req: Request) {
  const g = await requireAdmin();
  if (!g.ok) return g.res;

  const b = await req.json().catch(() => ({}));
  const orderIds: string[] = Array.isArray(b.orderIds) ? b.orderIds : [];
  const action = String(b.action || "");

  if (orderIds.length === 0) {
    return NextResponse.json({ error: "לא נבחרו הזמנות" }, { status: 400 });
  }
  if (!["READY", "DELIVERED", "UNDO_READY"].includes(action)) {
    return NextResponse.json({ error: "פעולה לא מוכרת" }, { status: 400 });
  }
  // הגנת שפיות - סימון של אלפי הזמנות בבת אחת הוא כמעט תמיד טעות
  if (orderIds.length > 500) {
    return NextResponse.json(
      { error: `יותר מדי הזמנות (${orderIds.length}). מקסימום 500 בפעולה.` },
      { status: 400 }
    );
  }

  const orders = await prisma.order.findMany({
    where: { id: { in: orderIds } },
    select: {
      id: true,
      orderNumber: true,
      status: true,
      paymentStatus: true,
      deliveredAt: true,
    },
  });

  const skipped: { orderNumber: number; reason: string }[] = [];
  const eligible: string[] = [];

  for (const o of orders) {
    if (o.status === "CANCELLED") {
      skipped.push({ orderNumber: o.orderNumber, reason: "מבוטלת" });
      continue;
    }

    if (action === "READY") {
      // סימון מוכן דורש תשלום - אחרת נמסרת סחורה בלי שנגבה
      if (o.paymentStatus !== "PAID") {
        skipped.push({ orderNumber: o.orderNumber, reason: "טרם שולמה" });
        continue;
      }
      if (o.deliveredAt) {
        skipped.push({ orderNumber: o.orderNumber, reason: "כבר נמסרה" });
        continue;
      }
      if (o.status === "READY_FOR_PICKUP") continue; // כבר במצב הזה, לא שגיאה
      eligible.push(o.id);
    } else if (action === "DELIVERED") {
      if (o.paymentStatus !== "PAID") {
        skipped.push({ orderNumber: o.orderNumber, reason: "טרם שולמה" });
        continue;
      }
      if (o.deliveredAt) continue; // כבר נמסרה
      eligible.push(o.id);
    } else if (action === "UNDO_READY") {
      if (o.deliveredAt) {
        skipped.push({ orderNumber: o.orderNumber, reason: "כבר נמסרה" });
        continue;
      }
      if (o.status !== "READY_FOR_PICKUP") continue;
      eligible.push(o.id);
    }
  }

  let updated = 0;
  if (eligible.length > 0) {
    if (action === "READY") {
      const r = await prisma.order.updateMany({
        where: { id: { in: eligible } },
        data: { status: "READY_FOR_PICKUP" },
      });
      updated = r.count;
    } else if (action === "DELIVERED") {
      // deliveredAt ו-status מתעדכנים יחד. שני מסלולי מצב נפרדים היו
      // המקור לכך שהדשבורד המשיך לדרוש "סמן מוכן" על הזמנה שנמסרה.
      const r = await prisma.order.updateMany({
        where: { id: { in: eligible } },
        data: {
          deliveredAt: new Date(),
          status: "COMPLETED",
        },
      });
      updated = r.count;
    } else if (action === "UNDO_READY") {
      const r = await prisma.order.updateMany({
        where: { id: { in: eligible } },
        data: { status: "FINAL_PRICE_SET" },
      });
      updated = r.count;
    }
  }

  console.log(
    `[bulk-status] ${g.session?.user?.email} action=${action} requested=${orderIds.length} updated=${updated} skipped=${skipped.length}`
  );

  return NextResponse.json({ ok: true, updated, skipped });
}
