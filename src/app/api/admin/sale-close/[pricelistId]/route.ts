// ═══════════════════════════════════════════════════════════════
// §385: סגירת מכירה — מה נשאר פתוח, ומה עושים איתו
// ═══════════════════════════════════════════════════════════════
// GET  /api/admin/sale-close/[pricelistId]  → מה תלוי
// POST /api/admin/sale-close/[pricelistId]  → { action, orderIds }
//
// הבעיה: מכירה נסגרת, ואין רשימה של מה לא הסתיים. הזמנות שלא
// חויבו נשארות תקועות במכירה הישנה, ואיש לא רואה אותן. חוב
// שלא נרשם — נעלם.
//
// ⚠️ המסך הזה הוא השער: אי אפשר לסגור עם חורים. כל הזמנה תלויה
// מקבלת אחת משתי דרכים — לחייב, או להעביר את היתרה לחוב אצל
// הלקוח (§263), ואז היא תיגבה במכירה הבאה.

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/guard";

type Hole = {
  id: string;
  orderNumber: number;
  customerId: string;
  customerName: string;
  pointName: string | null;
  finalTotal: number | null;
  amountPaid: number;
  remaining: number;
  reason: string;
  kind: "UNPAID" | "PARTIAL" | "CARD_FAILED" | "MISSING_WEIGHTS";
};

async function collectHoles(pricelistId: string): Promise<Hole[]> {
  const orders = await prisma.order.findMany({
    where: {
      pricelistId,
      status: { not: "CANCELLED" },
    },
    select: {
      id: true,
      orderNumber: true,
      customerId: true,
      customerName: true,
      pointNameSnapshot: true,
      finalTotal: true,
      amountPaid: true,
      paymentStatus: true,
      items: {
        where: { isCancelled: false },
        select: { agentEnteredWeight: true, product: { select: { saleType: true } } },
      },
    },
  });

  const holes: Hole[] = [];
  for (const o of orders) {
    const ft = o.finalTotal != null ? Number(o.finalTotal) : null;
    const paid = Number(o.amountPaid ?? 0);
    const ps = o.paymentStatus;

    // משקלים חסרים — לא ניתן לחייב
    const missing = o.items.filter(
      (it) => it.agentEnteredWeight == null && it.product?.saleType !== "UNIT"
    ).length;
    if (missing > 0 && ps !== "PAID" && ps !== "DEBT_CARRIED") {
      holes.push({
        id: o.id, orderNumber: o.orderNumber, customerId: o.customerId,
        customerName: o.customerName, pointName: o.pointNameSnapshot,
        finalTotal: ft, amountPaid: paid, remaining: ft != null ? ft - paid : 0,
        reason: `${missing} משקלים חסרים`, kind: "MISSING_WEIGHTS",
      });
      continue;
    }

    // ⚠️ DEBT_CARRIED = כבר טופל בסגירה קודמת. לא חור.
    if (ps === "PAID" || ps === "DEBT_CARRIED" || ft == null || ft <= 0) continue;

    const remaining = Math.round((ft - paid) * 100) / 100;
    if (remaining <= 0.01) continue;

    if (ps === "PARTIALLY_PAID") {
      holes.push({
        id: o.id, orderNumber: o.orderNumber, customerId: o.customerId,
        customerName: o.customerName, pointName: o.pointNameSnapshot,
        finalTotal: ft, amountPaid: paid, remaining,
        reason: `שולם ${paid.toFixed(2)} מתוך ${ft.toFixed(2)}`, kind: "PARTIAL",
      });
    } else if (ps === "CARD_UPDATE_NEEDED" || ps === "FAILED") {
      holes.push({
        id: o.id, orderNumber: o.orderNumber, customerId: o.customerId,
        customerName: o.customerName, pointName: o.pointNameSnapshot,
        finalTotal: ft, amountPaid: paid, remaining,
        reason: "כרטיס נכשל", kind: "CARD_FAILED",
      });
    } else {
      holes.push({
        id: o.id, orderNumber: o.orderNumber, customerId: o.customerId,
        customerName: o.customerName, pointName: o.pointNameSnapshot,
        finalTotal: ft, amountPaid: paid, remaining,
        reason: "לא חויב", kind: "UNPAID",
      });
    }
  }
  return holes;
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ pricelistId: string }> }
) {
  const g = await requireAdmin();
  if (!g.ok) return g.res;
  const { pricelistId } = await params;

  const pl = await prisma.pricelist.findUnique({
    where: { id: pricelistId },
    select: { id: true, name: true, status: true },
  });
  if (!pl) return NextResponse.json({ error: "מכירה לא נמצאה" }, { status: 404 });

  const [holes, totals] = await Promise.all([
    collectHoles(pricelistId),
    prisma.order.aggregate({
      where: { pricelistId, status: { not: "CANCELLED" } },
      _count: true,
    }),
  ]);
  const paidCount = await prisma.order.count({
    where: { pricelistId, paymentStatus: "PAID" },
  });

  return NextResponse.json({
    pricelist: pl,
    total: totals._count,
    paid: paidCount,
    holes,
    holesSum: Math.round(holes.reduce((s, h) => s + h.remaining, 0) * 100) / 100,
    canClose: holes.length === 0,
  });
}

// POST { action: "TO_DEBT", orderIds: [...] }
//      { action: "CLOSE" }
export async function POST(
  req: Request,
  { params }: { params: Promise<{ pricelistId: string }> }
) {
  const g = await requireAdmin();
  if (!g.ok) return g.res;
  const { pricelistId } = await params;
  const body = await req.json().catch(() => ({}));
  const actor = g.session?.user?.email ?? "admin";

  // ─── העברה לחוב ───
  if (body.action === "TO_DEBT") {
    const ids: string[] = Array.isArray(body.orderIds) ? body.orderIds : [];
    if (ids.length === 0) {
      return NextResponse.json({ error: "לא נבחרו הזמנות" }, { status: 400 });
    }

    const holes = (await collectHoles(pricelistId)).filter((h) => ids.includes(h.id));
    let moved = 0;
    let sum = 0;

    for (const h of holes) {
      // ⚠️ משקלים חסרים — אין סכום להעביר. חייב לשקול קודם.
      if (h.kind === "MISSING_WEIGHTS" || h.remaining <= 0) continue;

      await prisma.$transaction(async (tx) => {
        const cust = await tx.customer.update({
          where: { id: h.customerId },
          data: {
            debtBalance: { increment: h.remaining },
            debtNote: `יתרה מהזמנה #${h.orderNumber} (${h.reason})`,
            debtUpdatedAt: new Date(),
            debtUpdatedBy: actor,
          },
          select: { debtBalance: true },
        });
        // ⚠️ סטטוס משלו — לא PAID. PAID היה מציג "✓ שולם" ללקוח
        // באתר ולמנהל בכל מסך, על כסף שלא עבר. DEBT_CARRIED אומר
        // בדיוק מה קרה: היתרה עברה לחוב, תיגבה בהבאה.
        await tx.order.update({
          where: { id: h.id },
          data: {
            paymentStatus: "DEBT_CARRIED",
            paymentMethod: "DEBT_CARRIED",
            manualPaymentNote: `היתרה (${h.remaining.toFixed(2)}) הועברה לחוב הלקוח בסגירת המכירה`,
          },
        });
        // §368: תנועה בספר
        await tx.debtLedger.create({
          data: {
            customerId: h.customerId,
            kind: "ADD",
            amount: h.remaining,
            balanceAfter: Number(cust.debtBalance),
            note: `יתרה מהזמנה #${h.orderNumber} — ${h.reason}`,
            orderId: h.id,
            pricelistId,
            createdBy: actor,
          },
        });
      });
      moved++;
      sum += h.remaining;
    }

    console.log(`[sale-close] ${pricelistId}: ${moved} orders → debt, ₪${sum.toFixed(2)}`);
    return NextResponse.json({ ok: true, moved, sum: Math.round(sum * 100) / 100 });
  }

  // ─── סגירה ───
  if (body.action === "CLOSE") {
    const holes = await collectHoles(pricelistId);
    if (holes.length > 0) {
      return NextResponse.json(
        {
          error: `לא ניתן לסגור — ${holes.length} הזמנות עדיין פתוחות. יש לחייב או להעביר לחוב.`,
          holes: holes.length,
        },
        { status: 400 }
      );
    }
    await prisma.pricelist.update({
      where: { id: pricelistId },
      data: { status: "DONE" },
    });
    console.log(`[sale-close] ${pricelistId} → DONE by ${actor}`);
    return NextResponse.json({ ok: true, status: "DONE" });
  }

  return NextResponse.json({ error: "פעולה לא מוכרת" }, { status: 400 });
}
