// ═══════════════════════════════════════════════════════════════
// POST /api/admin/customers/[id]/debt/charge — גביית חוב עכשיו
// ═══════════════════════════════════════════════════════════════
// עד היום חוב נגבה רק עם ההזמנה הבאה. כאן: חיוב מיידי של הכרטיס
// השמור בסכום החוב (או חלק ממנו).
//
// Body: { amount?: number }  — ברירת מחדל: כל החוב
//
// ⚠️ מנעול נגד חיוב כפול: קודם מורידים את החוב במסד בתנאי שהוא לא
// השתנה (updateMany עם הערך שנקרא), ורק אז פונים לנדרים. נכשל → מחזירים.
// "לא ידוע אם חויב" (timeout) → החוב נשאר מופחת ונרשמת שורה לבדיקה
// ידנית בנדרים — עדיף מלחייב פעמיים.
//
// הרשאה: מנהל; או נציג עם הרשאת חיוב, ללקוח בנקודה שלו.
// 💸 הגבייה נרשמת בספר החובות לפי בעלי החוב (נציג / מנהל).

import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireAgent } from "@/lib/agent-guard";
import { chargeToken } from "@/lib/nedarim-lib";
import { ownersForBalance, reduceOwners, scaleTo } from "@/lib/debt-owners-lib";

const r2 = (n: number) => Math.round(n * 100) / 100;

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const g = await requireAgent();
  if (!g.ok) return g.res;
  const { id } = await params;
  const b = await req.json().catch(() => ({}));

  const c = await prisma.customer.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      phone: true,
      email: true,
      defaultPointId: true,
      createdByAgentId: true,
      debtBalance: true,
      debtOwners: true,
      debtNote: true,
      paymentToken: true,
      cardExpiry: true,
      cardNeedsUpdate: true,
      paymentPreference: true,
    },
  });
  if (!c) return NextResponse.json({ error: "לקוח לא נמצא" }, { status: 404 });

  if (!g.isAdmin) {
    const me = await prisma.customer.findUnique({
      where: { id: g.userId },
      select: { agentCanCharge: true },
    });
    if (!me?.agentCanCharge) {
      return NextResponse.json({ error: "אין לך הרשאת חיוב. פנה למנהל." }, { status: 403 });
    }
    const mine =
      c.createdByAgentId === g.userId ||
      (!!c.defaultPointId && g.agentPointIds.includes(c.defaultPointId));
    if (!mine) {
      return NextResponse.json({ error: "הלקוח לא בנקודה שלך" }, { status: 403 });
    }
  }

  const balance = r2(Number(c.debtBalance ?? 0));
  if (balance <= 0) {
    return NextResponse.json({ error: "אין ללקוח חוב פתוח" }, { status: 400 });
  }
  let amount = balance;
  if (b?.amount != null && b.amount !== "") {
    const n = r2(Number(b.amount));
    if (!Number.isFinite(n) || n <= 0) {
      return NextResponse.json({ error: "סכום לא תקין" }, { status: 400 });
    }
    if (n > balance + 0.009) {
      return NextResponse.json(
        { error: `הסכום גבוה מהחוב (₪${balance.toFixed(2)})` },
        { status: 400 }
      );
    }
    amount = n;
  }
  if (c.paymentPreference === "CASH") {
    return NextResponse.json(
      { error: "לקוח מזומן — אין כרטיס לחייב. את החוב גובים במזומן." },
      { status: 400 }
    );
  }
  if (!c.paymentToken || !c.cardExpiry) {
    return NextResponse.json({ error: "אין ללקוח כרטיס שמור תקין" }, { status: 400 });
  }
  if (c.cardNeedsUpdate) {
    return NextResponse.json({ error: "הלקוח צריך לעדכן כרטיס קודם" }, { status: 400 });
  }

  // מה נגבה מכל בעלים: כל החוב → הכל; חלק → יחסי
  const ownersAll = ownersForBalance(c.debtOwners, balance);
  const collectedOwners = amount >= balance ? ownersAll : scaleTo(ownersAll, amount);
  const remainingOwners = amount >= balance ? {} : reduceOwners(ownersAll, r2(balance - amount));
  const after = r2(balance - amount);

  // מנעול: מורידים את החוב רק אם לא השתנה מאז שנקרא
  const lock = await prisma.customer.updateMany({
    where: { id, debtBalance: c.debtBalance },
    data: {
      debtBalance: after,
      debtOwners: after > 0 ? remainingOwners : Prisma.DbNull,
      ...(after > 0 ? {} : { debtNote: null }),
      debtUpdatedAt: new Date(),
      debtUpdatedBy: g.session?.user?.email ?? g.agent.name,
    },
  });
  if (lock.count === 0) {
    return NextResponse.json(
      { error: "החוב השתנה בינתיים — רענן ונסה שוב" },
      { status: 409 }
    );
  }

  const result = await chargeToken({
    token: c.paymentToken,
    tokef: c.cardExpiry,
    amount,
    orderRef: `debt-${c.id.slice(-6)}`,
    avourText: `גביית חוב${c.debtNote ? `: ${c.debtNote}`.slice(0, 200) : ""}`,
    clientName: c.name,
    phone: c.phone ?? undefined,
    email: c.email ?? undefined,
  });

  const who = g.session?.user?.email ?? g.agent.name;
  // לשיוך הגבייה למכירה בדוחות: המכירה הפעילה האחרונה בנקודה של הלקוח
  const pricelistId =
    (
      await prisma.pricelist
        .findFirst({
          where: {
            status: "ACTIVE",
            ...(c.defaultPointId ? { points: { some: { pointId: c.defaultPointId } } } : {}),
          },
          orderBy: { createdAt: "desc" },
          select: { id: true },
        })
        .catch(() => null)
    )?.id ?? null;

  if (result.ok) {
    await prisma.debtLedger.createMany({
      data: Object.entries(collectedOwners).map(([ownerKey, amt]) => ({
        customerId: c.id,
        kind: "COLLECT",
        amount: -amt,
        balanceAfter: after,
        note: `נגבה מיידית בכרטיס (אסמכתא ${result.transactionId})`,
        pricelistId: pricelistId ?? null,
        agentId: g.isAdmin ? null : g.userId,
        ownerKey,
        method: "CARD",
        transactionId: result.transactionId,
        createdBy: who,
      })),
    });
    return NextResponse.json({ ok: true, charged: amount, debtBalance: after, transactionId: result.transactionId });
  }

  if (result.requiresManualVerification) {
    // ⚠️ לא ידוע אם חויב — החוב נשאר מופחת (לא מסכנים חיוב כפול)
    await prisma.debtLedger.create({
      data: {
        customerId: c.id,
        kind: "COLLECT",
        amount: -amount,
        balanceAfter: after,
        note: `⚠️ לא ידוע אם חויב (${result.error}) — לבדוק בנדרים. אם לא חויב: להחזיר את החוב ידנית.`,
        pricelistId: pricelistId ?? null,
        ownerKey: Object.keys(collectedOwners)[0] ?? null,
        method: "CARD_UNKNOWN",
        createdBy: who,
      },
    });
    return NextResponse.json(
      { ok: false, requiresManualVerification: true, error: `${result.error} — לבדוק בנדרים לפני ניסיון נוסף` },
      { status: 500 }
    );
  }

  // נכשל בבירור — מחזירים את החוב בדיוק כפי שהיה
  await prisma.customer.update({
    where: { id },
    data: {
      debtBalance: balance,
      debtOwners: ownersAll,
      debtNote: c.debtNote,
      ...(result.cardProblem ? { cardNeedsUpdate: true } : {}),
    },
  });
  return NextResponse.json({ ok: false, error: result.error, cardProblem: result.cardProblem });
}
