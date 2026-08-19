// §103: סימון "טופל" של הנציג על הזמנה.
//
// POST /api/agent/orders/[id]/close   { closed: true | false }
//
// ═══════════════════════════════════════════════════════════════
// למה זה נפרד מ"כל המשקלים מולאו"
// ═══════════════════════════════════════════════════════════════
// "כל המשקלים מולאו" הוא נתון שהמערכת מחשבת. זה הצהרה של אדם
// שעמד מול הלקוח וסיים. הזמנה יכולה להיות מלאה במשקלים בלי
// שהנציג בדק אותה, ולהפך.
//
// המנהל משדר לתשלום רק מה שסומן, ולכן הסימון הוא נקודת האחריות:
// הוא נושא שם ושעה, ולא ניתן לסמן הזמנה עם משקל חסר.

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAgent } from "@/lib/agent-guard";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const g = await requireAgent();
  if (!g.ok) return g.res;

  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const closed = body.closed !== false;

  const order = await prisma.order.findUnique({
    where: { id },
    select: { id: true, pointId: true, status: true, orderNumber: true },
  });
  if (!order) {
    return NextResponse.json({ error: "הזמנה לא נמצאה" }, { status: 404 });
  }

  // אותה בדיקת שייכות כמו בשאר מסלולי הנציג. מערך ריק אצל נציג
  // פירושו "אין נקודות" ולא "בלי הגבלה" - ההבחנה שנשכחה ב-§70.
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

  if (closed) {
    // ⚠️ אי אפשר לסמן "טופל" עם משקל חסר.
    //
    // זו הנקודה שבה הסימון מקבל משמעות: אם היה אפשר לסמן הזמנה
    // חלקית, הוי"ו היה הופך לקישוט. משקל שלא מולא הוא כסף שלא
    // נגבה - קרטון שריר שנשכח הוא כ-1,900 ש"ח.
    //
    // null = לא מולא. 0 = מולא במפורש ("הלקוח לא קיבל") ותקף.
    const missing = await prisma.orderItem.count({
      where: {
        orderId: id,
        isCancelled: false,
        agentEnteredWeight: null,
        // §137: מוצר יחידה אינו נשקל, ולכן אינו נספר כחסר.
        product: { saleType: { not: "UNIT" } },
      },
    });
    if (missing > 0) {
      return NextResponse.json(
        {
          error: `לא ניתן לסמן כטופל: חסרים ${missing} משקלים בהזמנה. לקוח שלא קיבל פריט - יש להזין 0.`,
          code: "MISSING_WEIGHTS",
          missingCount: missing,
        },
        { status: 400 }
      );
    }
  }

  const updated = await prisma.order.update({
    where: { id },
    data: {
      agentClosedAt: closed ? new Date() : null,
      agentClosedById: closed ? g.agent.id : null,
    },
    select: { id: true, agentClosedAt: true },
  });

  console.log(
    `[agent-close] order #${order.orderNumber} ${closed ? "closed" : "reopened"} by agent=${g.agent.id}`
  );

  return NextResponse.json({
    ok: true,
    agentClosedAt: updated.agentClosedAt?.toISOString() ?? null,
  });
}
