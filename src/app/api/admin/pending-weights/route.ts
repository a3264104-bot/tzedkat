import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";

// GET /api/admin/pending-weights
//
// מחזיר רשימת הזמנות שיש בהן פריטים שממתינים לשקילה.
// "חסר משקל" = פריט שדורש שקילה (קרטון או בודדים) ואין לו actualWeight.
//
// מסננים החוצה:
//   - הזמנות שכבר בוטלו / הוחזרו / הושלמו
//   - פריטים שלא דורשים שקילה (יחידות עם מחיר קבוע)

// אימות admin - אותו pattern כמו שאר admin routes
async function checkAdmin() {
  const session = await auth();
  if (!session?.user) return { ok: false as const, status: 401, error: "unauthorized" };

  const role = (session.user as { role?: string }).role;
  const email = session.user.email;
  let isAdmin = role === "ADMIN";
  if (!isAdmin && email) {
    const adminRow = await prisma.admin.findUnique({ where: { email } });
    isAdmin = !!adminRow;
  }
  if (!isAdmin) return { ok: false as const, status: 403, error: "forbidden" };
  return { ok: true as const };
}

// בדיקה אם פריט דורש שקילה
function needsWeighing(item: { unit: string; isSingle: boolean }): boolean {
  return item.unit === "קרטון" || item.isSingle;
}

export async function GET() {
  try {
    const authCheck = await checkAdmin();
    if (!authCheck.ok) {
      return NextResponse.json({ error: authCheck.error }, { status: authCheck.status });
    }

    // טוענים הזמנות פעילות עם פריטים ללא משקל בפועל
    const orders = await prisma.order.findMany({
      where: {
        status: { notIn: ["CANCELLED", "COMPLETED", "REFUNDED"] },
        finalTotal: null, // הזמנה שעדיין לא נסגר עליה מחיר סופי
      },
      orderBy: [{ createdAt: "desc" }],
      select: {
        id: true,
        orderNumber: true,
        customerName: true,
        phone: true,
        status: true,
        estimatedTotal: true,
        pointNameSnapshot: true,
        deliveryDateSnapshot: true,
        createdAt: true,
        items: {
          where: { actualWeight: null },
          select: {
            id: true,
            productName: true,
            unit: true,
            isSingle: true,
            quantity: true,
            estimatedWeight: true,
          },
        },
      },
    });

    // סינון: משאירים רק הזמנות עם פריטים שבאמת דורשים שקילה
    const pending = orders
      .map((o) => {
        const missingItems = o.items.filter(needsWeighing);
        return {
          id: o.id,
          orderNumber: o.orderNumber,
          customerName: o.customerName,
          phone: o.phone,
          status: o.status,
          estimatedTotal: o.estimatedTotal ? Number(o.estimatedTotal) : null,
          pointName: o.pointNameSnapshot,
          deliveryDate: o.deliveryDateSnapshot,
          createdAt: o.createdAt.toISOString(),
          missingItems: missingItems.map((i) => ({
            id: i.id,
            productName: i.productName,
            unit: i.unit,
            isSingle: i.isSingle,
            quantity: Number(i.quantity),
            estimatedWeight: i.estimatedWeight ? Number(i.estimatedWeight) : null,
          })),
          missingCount: missingItems.length,
        };
      })
      .filter((o) => o.missingCount > 0);

    const totalMissingItems = pending.reduce((sum, o) => sum + o.missingCount, 0);

    return NextResponse.json({
      orders: pending,
      ordersCount: pending.length,
      totalMissingItems,
    });
  } catch (e) {
    console.error("GET /api/admin/pending-weights exception:", e);
    return NextResponse.json({ error: "server error" }, { status: 500 });
  }
}
