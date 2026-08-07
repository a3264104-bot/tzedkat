// §21: סימון מסירה של הזמנה ע"י הנציג בנקודת החלוקה.
// PATCH /api/agent/orders/[id]/deliver
// Body: { delivered: boolean, note?: string }
//
// למה זה קיים: המערכת לא יודעת לבד מי קיבל את ההזמנה. הנציג הוא היחיד
// שנמצא בנקודה ורואה את הלקוח, ולכן הוא זה שמסמן.
//
// החלטה מודעת: אנחנו *לא* חוסמים סימון מסירה לפני תשלום.
// הסיבה: לקוחות רגילים כבר מאומתים עם טוקן והחיוב מתבצע אוטומטית אחרי
// השקילה, כך שהמסירה קודמת לחיוב מטבע התהליך. במקום לחסום את הנציג
// בשטח, אנחנו מתעדים מי מסר ומתי, ומתריעים למנהל בבקרת המכירה על
// הזמנות שנמסרו וטרם שולמו.

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
  const delivered = !!body.delivered;
  const note = body.note ? String(body.note).trim().slice(0, 500) : null;

  const order = await prisma.order.findUnique({
    where: { id },
    select: {
      id: true,
      pointId: true,
      status: true,
      paymentStatus: true,
      deliveredAt: true,
    },
  });
  if (!order) {
    return NextResponse.json({ error: "הזמנה לא נמצאה" }, { status: 404 });
  }

  // הרשאה: ההזמנה חייבת להיות באחת מנקודות הנציג.
  // g.agentPointIds ריק = מנהל, בלי הגבלה.
  if (g.agentPointIds.length > 0 && !g.agentPointIds.includes(order.pointId)) {
    return NextResponse.json(
      { error: "אין הרשאה - ההזמנה לא באחת מהנקודות שלך" },
      { status: 403 }
    );
  }

  if (order.status === "CANCELLED") {
    return NextResponse.json(
      { error: "לא ניתן לסמן מסירה בהזמנה שבוטלה" },
      { status: 400 }
    );
  }

  const data: any = delivered
    ? {
        deliveredAt: new Date(),
        deliveredByAgentId: g.agent.id,
        deliveredNote: note,
        status: "COMPLETED",
      }
    : {
        // ביטול סימון - הנציג טעה. מחזירים לסטטוס הקודם ההגיוני:
        // אם ההזמנה שולמה היא מוכנה לחלוקה, אחרת חוזרת למחיר סופי שנקבע.
        deliveredAt: null,
        deliveredByAgentId: null,
        deliveredNote: null,
        status: order.paymentStatus === "PAID" ? "READY_FOR_PICKUP" : "FINAL_PRICE_SET",
      };

  const updated = await prisma.order.update({
    where: { id },
    data,
    select: {
      id: true,
      status: true,
      paymentStatus: true,
      deliveredAt: true,
      deliveredByAgentId: true,
      deliveredNote: true,
    },
  });

  return NextResponse.json({
    ok: true,
    order: {
      id: updated.id,
      status: updated.status,
      paymentStatus: updated.paymentStatus,
      deliveredAt: updated.deliveredAt?.toISOString() ?? null,
      deliveredByAgentId: updated.deliveredByAgentId,
      deliveredNote: updated.deliveredNote,
    },
    // דגל למסך הנציג: נמסר אבל עדיין לא שולם
    deliveredUnpaid: delivered && updated.paymentStatus !== "PAID",
  });
}
