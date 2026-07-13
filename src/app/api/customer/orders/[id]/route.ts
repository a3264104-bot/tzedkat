import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { sendOrderUpdatedEmail, sendOrderCancelledEmail } from "@/lib/order-update-email";

// /api/customer/orders/[id]
//
// PATCH  - עדכון פרטי בסיס בהזמנה (שם, טלפון, נקודה, הערות)
// DELETE - ביטול הזמנה
//
// חוקי-אבטחה (משותפים לשני ה-endpoints):
//   1. המשתמש מחובר
//   2. ההזמנה שייכת ללקוח המחובר
//   3. סטטוס ההזמנה לא CANCELLED / COMPLETED
//   4. finalTotal עדיין null (עוד לא נשקלה)
//   5. closeDate של המחירון עדיין בעתיד (או null)

// בדיקת הרשאה משותפת
async function checkEditable(orderId: string, customerId: string) {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: {
      pricelist: { select: { closeDate: true } },
    },
  });

  if (!order) return { ok: false as const, status: 404, error: "הזמנה לא נמצאה" };
  if (order.customerId !== customerId) {
    return { ok: false as const, status: 403, error: "אין הרשאה" };
  }
  if (order.status === "CANCELLED") {
    return { ok: false as const, status: 409, error: "ההזמנה כבר בוטלה" };
  }
  if (order.status === "COMPLETED") {
    return { ok: false as const, status: 409, error: "הזמנה שהושלמה - לא ניתן לערוך" };
  }
  if (order.finalTotal !== null && order.finalTotal !== undefined) {
    return {
      ok: false as const,
      status: 409,
      error: "ההזמנה כבר נשקלה - לא ניתן לערוך/לבטל. פנה לתמיכה.",
    };
  }
  const closeDate = order.pricelist?.closeDate;
  if (closeDate && new Date(closeDate) < new Date()) {
    return {
      ok: false as const,
      status: 409,
      error: "המכירה נסגרה - לא ניתן יותר לערוך/לבטל",
    };
  }
  return { ok: true as const, order };
}

// ═══════════════════════════════════════════════════════════════════
// PATCH - עדכון פרטי בסיס (שם, טלפונים, נקודת חלוקה, הערות)
// ═══════════════════════════════════════════════════════════════════
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "יש להתחבר" }, { status: 401 });
    }
    const customerId = (session.user as any).id as string;

    const check = await checkEditable(id, customerId);
    if (!check.ok) {
      return NextResponse.json({ error: check.error }, { status: check.status });
    }

    const body = await req.json().catch(() => ({}));

    // שדות מותרים לעריכה על ידי הלקוח
    const data: any = {};
    if (typeof body.customerName === "string" && body.customerName.trim().length > 0) {
      data.customerName = body.customerName.trim();
    }
    if (typeof body.phone === "string" && body.phone.trim().length > 0) {
      data.phone = body.phone.trim();
    }
    if ("phone2" in body) {
      const p2 = String(body.phone2 || "").trim();
      data.phone2 = p2.length > 0 ? p2 : null;
    }
    if (typeof body.pointId === "string" && body.pointId.length > 0) {
      // וידוא שהנקודה קיימת ופעילה
      const point = await prisma.deliveryPoint.findUnique({ where: { id: body.pointId } });
      if (!point) {
        return NextResponse.json({ error: "נקודת חלוקה לא נמצאה" }, { status: 400 });
      }
      data.pointId = body.pointId;
      data.pointNameSnapshot = point.name;
    }
    if ("notes" in body) {
      const n = String(body.notes || "").trim();
      data.notes = n.length > 0 ? n : null;
    }

    if (Object.keys(data).length === 0) {
      return NextResponse.json({ error: "אין שדות לעדכון" }, { status: 400 });
    }

    const updated = await prisma.order.update({
      where: { id },
      data,
      include: { items: true, customer: true, point: true },
    });

    // מייל עדכון ללקוח (§17)
    if (updated.customer?.email) {
      const res = await sendOrderUpdatedEmail(
        updated as any,
        updated.customer.email,
        "עדכנת את פרטי ההזמנה באזור האישי"
      );
      if (!res.ok) {
        console.error("sendOrderUpdatedEmail failed:", res.error);
      }
    }

    return NextResponse.json({ ok: true, id: updated.id });
  } catch (e: any) {
    console.error("PATCH /api/customer/orders/[id] exception:", e);
    return NextResponse.json({ error: "שגיאת שרת" }, { status: 500 });
  }
}

// ═══════════════════════════════════════════════════════════════════
// DELETE - ביטול הזמנה
// ═══════════════════════════════════════════════════════════════════
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "יש להתחבר" }, { status: 401 });
    }
    const customerId = (session.user as any).id as string;

    const check = await checkEditable(id, customerId);
    if (!check.ok) {
      return NextResponse.json({ error: check.error }, { status: check.status });
    }

    const cancelled = await prisma.order.update({
      where: { id },
      data: { status: "CANCELLED" },
      include: { items: true, customer: true, point: true },
    });

    // מייל ביטול ללקוח
    if (cancelled.customer?.email) {
      const res = await sendOrderCancelledEmail(cancelled as any, cancelled.customer.email);
      if (!res.ok) {
        console.error("sendOrderCancelledEmail failed:", res.error);
      }
    }

    return NextResponse.json({ ok: true, cancelled: true });
  } catch (e: any) {
    console.error("DELETE /api/customer/orders/[id] exception:", e);
    return NextResponse.json({ error: "שגיאת שרת" }, { status: 500 });
  }
}
