// ═══════════════════════════════════════════════════════════════
// §332: אמצעי תשלום — **להזמנה זו בלבד**
// ═══════════════════════════════════════════════════════════════
// PATCH /api/agent/orders/[id]/payment-method
// Body: { paymentMethod: "CASH" | "CREDIT" }
//
// 🐛 מה שהיה: הבורר בטבלת המשקלים שינה את paymentPreference של
// **הלקוח** - כלומר לתמיד. לקוח שביקש לשלם מזומן פעם אחת נשאר
// מזומן גם בשבוע הבא, והכרטיס שלו הפסיק להיות מחויב.
//
// ⚠️ ההבחנה:
//   paymentPreference (Customer) = ההעדפה הקבועה
//   paymentMethod (Order)        = איך משלמים **הפעם**
//
// ⚠️ ולשינוי קבוע יש מקום משלו: כרטיס הלקוח
// (/api/agent/customer-payment-pref).

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAgent } from "@/lib/agent-guard";

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const g = await requireAgent();
  if (!g.ok) return g.res;

  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const method = String(body.paymentMethod || "").trim();

  if (method !== "CASH" && method !== "CREDIT") {
    return NextResponse.json(
      { error: "אמצעי תשלום לא תקין" },
      { status: 400 }
    );
  }

  const order = await prisma.order.findUnique({
    where: { id },
    select: {
      id: true,
      orderNumber: true,
      pointId: true,
      status: true,
      paymentStatus: true,
      weightsLockedAt: true,
      customer: { select: { paymentToken: true, name: true } },
    },
  });
  if (!order) {
    return NextResponse.json({ error: "הזמנה לא נמצאה" }, { status: 404 });
  }

  // בדיקת שייכות. מערך ריק אצל נציג = אין נקודות, לא "בלי הגבלה".
  if (!g.isAdmin) {
    if (g.agentPointIds.length === 0) {
      return NextResponse.json(
        { error: "אין לך נקודת חלוקה משויכת" },
        { status: 403 }
      );
    }
    if (!g.agentPointIds.includes(order.pointId)) {
      return NextResponse.json(
        { error: "אין הרשאה - ההזמנה לא באחת מהנקודות שלך" },
        { status: 403 }
      );
    }
  }

  // ⚠️ הזמנה ששולמה - הכסף כבר נגבה, ושינוי אמצעי התשלום עכשיו
  // רק יסתיר את מה שקרה בפועל.
  if (
    order.paymentStatus === "PAID" ||
    order.paymentStatus === "PARTIALLY_PAID" ||
    order.paymentStatus === "CHARGING"
  ) {
    return NextResponse.json(
      { error: "ההזמנה כבר חויבה — לא ניתן לשנות את אמצעי התשלום" },
      { status: 400 }
    );
  }

  // §309: הזמנה נעולה אחרי שליחת המייל — הלקוח מחזיק סכום ואופן
  // תשלום, ושינוי אחריו יוצר פער.
  if (order.weightsLockedAt) {
    return NextResponse.json(
      {
        error: "ההזמנה נעולה — נשלח ללקוח מייל עם הסכום הסופי.",
        code: "WEIGHTS_LOCKED",
      },
      { status: 423 }
    );
  }

  // ⚠️ מעבר לאשראי בלי כרטיס - החיוב ייכשל, וההזמנה תיתקע
  // ברשימת הכשלים בלי שאיש יבין למה.
  if (method === "CREDIT" && !order.customer?.paymentToken) {
    return NextResponse.json(
      {
        error: `ל${order.customer?.name ?? "לקוח"} אין כרטיס שמור. יש להזין כרטיס תחילה.`,
        code: "NEEDS_CARD",
      },
      { status: 400 }
    );
  }

  await prisma.order.update({
    where: { id },
    // ⚠️ MANUAL ולא CASH: זהו הערך ש-§130 שומר לסימון ידני של
    // הנציג, וכל החישובים (§239, §293, §325) כבר מכירים אותו.
    // ערך חדש היה דורש עדכון בכל אחד מהם.
    data: { paymentMethod: method === "CASH" ? "MANUAL" : null },
  });

  console.log(
    `[payment-method] order #${order.orderNumber} → ${method} by ${g.agent.id}`
  );

  return NextResponse.json({ ok: true, paymentMethod: method });
}
