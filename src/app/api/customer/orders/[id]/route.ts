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
      pricelist: { select: { closeDate: true, editDeadline: true } },
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
  // §16: editDeadline קודם, אם ריק — fallback ל-closeDate
  const deadline = order.pricelist?.editDeadline || order.pricelist?.closeDate;
  if (deadline && new Date(deadline) < new Date()) {
    return {
      ok: false as const,
      status: 409,
      error: "המערכת נסגרה לשינויים - לא ניתן יותר לערוך/לבטל",
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

    // §16 פאזה 2: עריכת פריטים בהזמנה
    // Body: items?: [{ productId, isSingle, quantity }]
    // אם עוברים items, מוחקים את כל הפריטים הקיימים ומחליפים בחדשים
    // + מחשבים estimatedTotal מחדש
    let itemsChanged = false;
    if (Array.isArray(body.items) && body.items.length > 0) {
      itemsChanged = true;
    }

    if (Object.keys(data).length === 0 && !itemsChanged) {
      return NextResponse.json({ error: "אין שדות לעדכון" }, { status: 400 });
    }

    // אם יש עדכון פריטים - מעדכנים בטרנזקציה
    if (itemsChanged) {
      // טוענים מחירון + מוצרים כדי לחשב estimatedTotal
      const orderInfo = await prisma.order.findUnique({
        where: { id },
        select: {
          pricelistId: true,
          pricelist: { select: { singleSurcharge: true } },
        },
      });
      if (!orderInfo) {
        return NextResponse.json({ error: "הזמנה לא נמצאה" }, { status: 404 });
      }
      if (!orderInfo.pricelistId) {
        return NextResponse.json({ error: "להזמנה אין מחירון משויך" }, { status: 400 });
      }
      const orderPricelistId: string = orderInfo.pricelistId;

      const productIds = body.items.map((i: any) => String(i.productId));
      const pricelistProducts = await prisma.pricelistProduct.findMany({
        where: { pricelistId: orderPricelistId, productId: { in: productIds } },
        include: { product: true },
      });
      const ppMap = new Map(pricelistProducts.map((pp) => [pp.productId, pp]));

      const surcharge = Number(orderInfo.pricelist?.singleSurcharge ?? 3);
      let estimatedTotal = 0;
      const newItems = [];

      for (const item of body.items) {
        const pp = ppMap.get(String(item.productId));
        if (!pp) continue;
        const base = Number(pp.price ?? pp.product.cartonPrice);
        const isSingle = !!item.isSingle && pp.product.allowSingles;
        const qty = Number(item.quantity);
        if (qty <= 0) continue;

        // חישוב מחיר יחידה
        let unitPrice = base;
        if (isSingle && pp.product.singlesMode === "UNITS" && pp.product.singleUnitPrice) {
          unitPrice = Number(pp.product.singleUnitPrice);
        } else if (isSingle) {
          unitPrice = Math.round((base + surcharge) * 100) / 100;
        }

        // חישוב סה"כ שורה + משקל משוער
        const avgWeight = pp.product.avgWeightPerUnit ? Number(pp.product.avgWeightPerUnit) : null;
        const isSinglesKg = isSingle && pp.product.priceType === "PER_KG" && pp.product.singlesMode !== "UNITS";
        const isSinglesUnits = isSingle && pp.product.singlesMode === "UNITS";

        let estPrice: number;
        let estWeight: number | null = null;
        if (isSinglesKg) {
          estPrice = Math.round(unitPrice * qty * 100) / 100;
          estWeight = qty;
        } else if (isSinglesUnits) {
          estPrice = Math.round(unitPrice * qty * 100) / 100;
        } else if ((pp.product.saleType === "UNIT" || pp.product.saleType === "PACKAGE") && pp.product.priceType === "PER_KG" && avgWeight) {
          estPrice = Math.round(unitPrice * avgWeight * qty * 100) / 100;
          estWeight = Math.round(avgWeight * qty * 1000) / 1000;
        } else {
          estPrice = Math.round(unitPrice * qty * 100) / 100;
        }
        estimatedTotal += estPrice;

        newItems.push({
          productId: pp.product.id,
          productName: pp.product.name,
          unit: pp.product.unit,
          isSingle,
          quantity: qty,
          estimatedWeight: estWeight,
          estimatedPrice: estPrice,
          unitPrice,
        });
      }

      // עדכון בטרנזקציה: מחיקת פריטים ישנים + יצירת חדשים + עדכון סה"כ + שדות בסיס
      data.estimatedTotal = estimatedTotal;
      await prisma.$transaction([
        prisma.orderItem.deleteMany({ where: { orderId: id } }),
        prisma.orderItem.createMany({
          data: newItems.map((it) => ({ orderId: id, ...it })),
        }),
        prisma.order.update({ where: { id }, data }),
      ]);
    } else {
      // רק עדכון שדות בסיס
      await prisma.order.update({ where: { id }, data });
    }

    // טעינה מחודשת לצורך המייל
    const updated = await prisma.order.findUnique({
      where: { id },
      include: { items: true, customer: true, point: true },
    });

    // מייל אישור קצר ללקוח - "השינויים נשמרו"
    // רק כשהלקוח עצמו עדכן (מ-customer route), לא כשמנהל עדכן
    if (updated?.customer?.email) {
      const res = await sendOrderUpdatedEmail(updated as any, updated.customer.email);
      if (!res.ok) {
        console.error("sendOrderUpdatedEmail failed:", res.error);
      }
    }

    return NextResponse.json({ ok: true, id });
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
