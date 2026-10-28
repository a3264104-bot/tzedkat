// ═══════════════════════════════════════════════════════════════
// POST /api/orders/[id]/cancel — ביטול הזמנה (נציג + מנהל)
// ═══════════════════════════════════════════════════════════════
// הצורך: הסחורה לא הגיעה ללקוח. עד היום הדרך היחידה הייתה לבטל
// מוצר-מוצר, ואחרי זה הלקוח עוד חויב ₪3 דמי הזמנה.
//
// ✅ ביטול שלם: ההזמנה מסומנת CANCELLED גם במצב ההזמנה וגם במצב
// התשלום, ולא נכנסת לשום חיוב (גם ה-API של החיוב חוסם הזמנה מבוטלת).
//
// ⚠️ גיבוי לפני הכל: צילום מלא של ההזמנה והפריטים נשמר ב-OrderBackup.
// מנהל יכול לשחזר (POST /api/orders/[id]/restore) אם בוטל בטעות.
//
// ⚠️ הזמנה ששולמה (גם חלקית) — נציג לא מבטל; המנהל מבטל, והסכום
// ששולם נזקף ללקוח כיתרת זכות (§272), בלי החזר אוטומטי בנדרים.
//
// ⚠️ חוב/יתרה שקוזזו בהזמנה חוזרים ללקוח (§362), כולל בעלות החוב.
//
// Body: { reason: string, confirm: "CANCEL" }
//   confirm הוא האישור השני — הממשק שולח אותו רק אחרי "בטוח?" ואז
//   "כן, בטל סופית". קריאה בלי זה נדחית.

import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireAgent } from "@/lib/agent-guard";
import { restoreDebtOwners } from "@/lib/debt-restore-lib";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const g = await requireAgent();
  if (!g.ok) return g.res;
  const { id } = await params;
  const b = await req.json().catch(() => ({}));
  const reason = String(b?.reason ?? "").trim().slice(0, 300);
  if (b?.confirm !== "CANCEL") {
    return NextResponse.json({ error: "חסר אישור כפול לביטול" }, { status: 400 });
  }
  if (!reason) {
    return NextResponse.json({ error: "יש לכתוב סיבת ביטול" }, { status: 400 });
  }

  const order = await prisma.order.findUnique({ where: { id }, include: { items: true } });
  if (!order) return NextResponse.json({ error: "הזמנה לא נמצאה" }, { status: 404 });

  if (!g.isAdmin) {
    if (g.agentPointIds.length === 0 || !g.agentPointIds.includes(order.pointId)) {
      return NextResponse.json(
        { error: "אין הרשאה - ההזמנה לא באחת מהנקודות שלך" },
        { status: 403 }
      );
    }
  }
  if (order.status === "CANCELLED") {
    return NextResponse.json({ error: "ההזמנה כבר מבוטלת" }, { status: 400 });
  }
  if (order.paymentStatus === "CHARGING") {
    return NextResponse.json(
      { error: "ההזמנה באמצע חיוב — לא ניתן לבטל עכשיו. יש לבדוק בנדרים קודם." },
      { status: 409 }
    );
  }
  const paid = Number(order.amountPaid ?? 0);
  const isPaid = paid > 0 || order.paymentStatus === "PAID";
  if (isPaid && !g.isAdmin) {
    return NextResponse.json(
      {
        error:
          "ההזמנה כבר שולמה — רק המנהל יכול לבטל אותה (הסכום יחזור ללקוח כזיכוי).",
        code: "PAID",
      },
      { status: 400 }
    );
  }

  const actorEmail = g.session?.user?.email ?? g.agent.name;
  const actorLabel = `${g.isAdmin ? "מנהל" : "נציג"} ${g.agent.name}`;

  // 1) גיבוי מלא — לפני כל שינוי
  const backup = await prisma.orderBackup.create({
    data: {
      orderId: order.id,
      orderNumber: order.orderNumber,
      kind: "CANCEL",
      reason,
      snapshot: JSON.parse(JSON.stringify(order)) as Prisma.InputJsonValue,
      createdBy: actorEmail,
    },
  });

  // 2) החזרת חוב/יתרה שקוזזו (רק כשלא שולם — אחרת הם חלק ממה ששולם)
  const restoreDebt = isPaid ? 0 : Number(order.appliedDebt ?? 0);
  const restoreBal = isPaid ? 0 : Number(order.appliedCreditBalance ?? 0);
  const stamp = new Date().toLocaleString("he-IL", { timeZone: "Asia/Jerusalem" });
  if (restoreDebt > 0 || restoreBal > 0 || (isPaid && paid > 0)) {
    await prisma.customer.update({
      where: { id: order.customerId },
      data: {
        ...(restoreDebt > 0
          ? {
              debtBalance: { increment: restoreDebt },
              debtNote: `הוחזר מביטול הזמנה #${order.orderNumber}`,
            }
          : {}),
        ...(restoreBal > 0 || (isPaid && paid > 0)
          ? {
              creditBalance: { increment: restoreBal + (isPaid ? paid : 0) },
              creditBalanceNote: isPaid
                ? `זיכוי על ביטול הזמנה #${order.orderNumber} ששולמה`
                : `הוחזר מביטול הזמנה #${order.orderNumber}`,
              creditBalanceAt: new Date(),
            }
          : {}),
      },
    });
    if (restoreDebt > 0) {
      await restoreDebtOwners(order.customerId, order.appliedDebtOwners, restoreDebt);
      const c = await prisma.customer.findUnique({
        where: { id: order.customerId },
        select: { debtBalance: true },
      });
      await prisma.debtLedger.create({
        data: {
          customerId: order.customerId,
          kind: "RESTORE",
          amount: restoreDebt,
          balanceAfter: Number(c?.debtBalance ?? restoreDebt),
          note: `הוחזר מביטול הזמנה #${order.orderNumber}`,
          orderId: order.id,
          pricelistId: order.pricelistId,
          createdBy: actorEmail,
        },
      });
    }
  }

  // 3) הביטול עצמו. appliedDebt/appliedCreditBalance מתאפסים (הם חזרו
  // ללקוח; הערכים המקוריים בגיבוי) — כך שחזור לא יקזז פעמיים.
  const line = `[${stamp}] בוטלה ע"י ${actorLabel}: ${reason}`;
  await prisma.order.update({
    where: { id: order.id },
    data: {
      status: "CANCELLED",
      // ⚠️ שולמה: מצב התשלום נשאר כמו שהוא (הכסף נגבה — כמו §272),
      // והזיכוי יושב ביתרת הלקוח.
      ...(isPaid ? {} : { paymentStatus: "CANCELLED" }),
      ...(isPaid
        ? {}
        : { appliedDebt: null, appliedDebtOwners: Prisma.DbNull, appliedCreditBalance: null }),
      internalNotes: order.internalNotes ? `${order.internalNotes}\n${line}` : line,
    },
  });

  console.log(
    `[cancel-order] #${order.orderNumber} by ${actorEmail} backup=${backup.id} paid=${paid} debt=${restoreDebt} bal=${restoreBal}`
  );
  return NextResponse.json({
    ok: true,
    backupId: backup.id,
    creditedAmount: isPaid ? paid : 0,
    restoredDebt: restoreDebt,
    restoredBalance: restoreBal,
  });
}
