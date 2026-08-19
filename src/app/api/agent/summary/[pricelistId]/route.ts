// §20: סגירת / הערה על סיכום נציג
// PATCH /api/agent/summary/[pricelistId]
// Body: { remainderNote?: string, confirm?: boolean }

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAgent } from "@/lib/agent-guard";

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ pricelistId: string }> }
) {
  const g = await requireAgent();
  if (!g.ok) return g.res;

  const { pricelistId } = await params;
  const body = await req.json().catch(() => ({}));

  // §70: מנהל אינו נציג לצורך עמלות.
  //
  // ה-route הזה *יוצר* סיכום אם אין - ולכן מנהל שנכנס למסך המכירה
  // וכתב הערה היה מייצר לעצמו רשומת AgentSaleSummary, מופיע בדוח
  // התשלומים לנציגים, ומקבל שורה לתשלום. הוא רואה את המסך לצורכי
  // פיקוח; הסגירה והעמלה שייכות לנציג בשטח.
  if (g.isAdmin) {
    return NextResponse.json(
      {
        error: "סיכום ועמלות הם של הנציג בשטח. מנהל אינו סוגר סיכום מכירה.",
        code: "ADMIN_NO_SUMMARY",
      },
      { status: 403 }
    );
  }

  // חיפוש/יצירה של הסיכום
  let summary = await prisma.agentSaleSummary.findUnique({
    where: {
      pricelistId_agentId: {
        pricelistId,
        agentId: g.agent.id,
      },
    },
  });

  if (!summary) {
    summary = await prisma.agentSaleSummary.create({
      data: {
        pricelistId,
        agentId: g.agent.id,
        status: "DRAFT",
      },
    });
  }

  // ═══════════════════════════════════════════════════════════
  // §81: אין סגירת מכירה עם משקלים חסרים
  // ═══════════════════════════════════════════════════════════
  // משקל שלא מולא אינו שדה ריק אלא כסף שלא נגבה: קרטון שריר
  // שנשכח הוא הפסד של כ-1,900 ש"ח בשורה אחת, והוא מתגלה רק
  // בסוף החודש כשאין למי לפנות.
  //
  // ⚠️ הבדיקה כאן ולא רק בממשק: חסימה בקליינט נעקפת ברענון, בטאב
  // ישן, או בבקשה ישירה - וכאן העקיפה עולה כסף אמיתי.
  //
  // null = לא מולא. 0 = מולא במפורש ("הלקוח לא קיבל"), וזה ערך
  // תקף לגמרי. בלי ההבחנה הזו אי אפשר היה לחסום שכחה בלי לחסום
  // גם את המקרה הלגיטימי.
  if (body.confirm === true) {
    const missing = await prisma.orderItem.count({
      where: {
        agentEnteredWeight: null,
        isCancelled: false,
        // §137: מוצר שנמכר ביחידות אינו נשקל - המשקל מודפס על
        // האריזה. בלי הסינון הזה סגירת המכירה נחסמה על פריטים
        // שאין מה למלא בהם, והנציג נתקע בלי דרך להתקדם.
        product: { saleType: { not: "UNIT" } },
        order: {
          pricelistId,
          status: { notIn: ["CANCELLED"] },
          // רק הזמנות בנקודות של הנציג הזה - לא של כל המכירה
          ...(g.agentPointIds.length > 0
            ? { pointId: { in: g.agentPointIds } }
            : {}),
        },
      },
    });

    if (missing > 0) {
      return NextResponse.json(
        {
          error: `לא ניתן לסגור את המכירה: חסרים ${missing} משקלים. לקוח שלא קיבל סחורה - יש להזין 0 במפורש.`,
          code: "MISSING_WEIGHTS",
          missingCount: missing,
        },
        { status: 400 }
      );
    }
  }

  const data: any = {};
  if ("remainderNote" in body) {
    data.remainderNote = body.remainderNote ? String(body.remainderNote).trim() : null;
  }
  if (body.confirm === true) {
    data.status = "CONFIRMED";
    data.confirmedAt = new Date();
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "אין שדות לעדכון" }, { status: 400 });
  }

  const updated = await prisma.agentSaleSummary.update({
    where: { id: summary.id },
    data,
  });

  return NextResponse.json({
    ok: true,
    summary: {
      id: updated.id,
      status: updated.status,
      totalCartonWeight: Number(updated.totalCartonWeight),
      totalSinglesWeight: Number(updated.totalSinglesWeight),
      totalWalkinWeight: Number(updated.totalWalkinWeight),
      totalCustomers: updated.totalCustomers,
      totalWalkins: updated.totalWalkins,
      totalCommission: Number(updated.totalCommission),
      remainderNote: updated.remainderNote,
      confirmedAt: updated.confirmedAt?.toISOString(),
    },
  });
}
