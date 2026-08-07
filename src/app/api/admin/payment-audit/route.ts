// יומן ביקורת תשלומים - קריאה בלבד.
// GET /api/admin/payment-audit?pricelistId=<id>&q=<search>
//
// הטבלה PaymentAuditLog נכתבת בכל סימון תשלום מזומן (cash-payment) ונשמרת
// לצמיתות, אבל עד עכשיו לא הייתה שום דרך לקרוא אותה מהממשק. המסך הזה
// חושף אותה למנהל - למחלוקות עם לקוחות, התחשבנות מול נציגים, וביקורת.
//
// שים לב: ל-PaymentAuditLog אין relation ל-Order (orderId הוא שדה חופשי),
// בכוונה - כדי שהרישום ישרוד גם מחיקת הזמנה. לכן שולפים את ההזמנות
// בנפרד וממזגים כאן.

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/guard";

export async function GET(req: Request) {
  const g = await requireAdmin();
  if (!g.ok) return g.res;

  const { searchParams } = new URL(req.url);
  const pricelistId = searchParams.get("pricelistId") || undefined;
  const q = (searchParams.get("q") || "").trim();

  // כל הרישומים, החדשים ראשונים
  const logs = await prisma.paymentAuditLog.findMany({
    orderBy: { createdAt: "desc" },
    take: 500,
  });

  // שליפת ההזמנות המשויכות (ייתכן שחלקן נמחקו - אז לא יימצאו)
  const orderIds = Array.from(new Set(logs.map((l) => l.orderId)));
  const orders = orderIds.length
    ? await prisma.order.findMany({
        where: { id: { in: orderIds } },
        select: {
          id: true,
          orderNumber: true,
          customerName: true,
          phone: true,
          pricelistId: true,
          pointNameSnapshot: true,
          pricelistNameSnapshot: true,
        },
      })
    : [];
  const orderMap = new Map(orders.map((o) => [o.id, o]));

  let rows = logs.map((l) => {
    const o = orderMap.get(l.orderId) || null;
    const amountPaid = Number(l.amountPaid);
    const finalTotalAtTime = Number(l.finalTotalAtTime);
    return {
      id: l.id,
      orderId: l.orderId,
      // ההזמנה עשויה להיות מחוקה - הרישום שורד בכל מקרה
      orderNumber: o?.orderNumber ?? null,
      customerName: o?.customerName ?? null,
      phone: o?.phone ?? null,
      pricelistId: o?.pricelistId ?? null,
      pricelistName: o?.pricelistNameSnapshot ?? null,
      pointName: o?.pointNameSnapshot ?? null,
      orderDeleted: !o,
      action: l.action,
      amountPaid,
      finalTotalAtTime,
      // פער בין מה ששולם למחיר הסופי באותו רגע (שלילי = שולם פחות)
      difference: Math.round((amountPaid - finalTotalAtTime) * 100) / 100,
      paymentMethod: l.paymentMethod,
      receivedByUserId: l.receivedByUserId,
      note: l.note,
      createdAt: l.createdAt.toISOString(),
    };
  });

  // סינון לפי מכירה (רק רישומים שההזמנה שלהם שייכת למכירה)
  if (pricelistId) {
    rows = rows.filter((r) => r.pricelistId === pricelistId);
  }

  // חיפוש חופשי: שם לקוח / טלפון / מס' הזמנה / מי קיבל
  if (q) {
    const lower = q.toLowerCase();
    rows = rows.filter(
      (r) =>
        (r.customerName || "").toLowerCase().includes(lower) ||
        (r.phone || "").includes(q) ||
        String(r.orderNumber ?? "").includes(q) ||
        (r.receivedByUserId || "").toLowerCase().includes(lower)
    );
  }

  const totalAmount = rows.reduce((s, r) => s + r.amountPaid, 0);
  const partialCount = rows.filter((r) => r.difference < -0.01).length;

  return NextResponse.json({
    rows,
    count: rows.length,
    totalAmount: Math.round(totalAmount * 100) / 100,
    partialCount,
  });
}
