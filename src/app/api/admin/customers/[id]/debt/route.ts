// ═══════════════════════════════════════════════════════════════
// §263: ניהול חוב ללקוח
// ═══════════════════════════════════════════════════════════════
// PATCH /api/admin/customers/[id]/debt
// Body: { amount: number, note?: string, mode?: "set" | "add" }
//
// התרחיש: לקוחות עם חובות מלפני שהאתר היה קיים - "חוב ממכירת
// פסח", "לא שילם על 2 קרטונים". המנהל או הנציג רושמים, והחוב
// נגבה יחד עם ההזמנה הבאה.
//
// ⚠️ הפוך מיתרת זכות (§124), ולכן אותה מכניקה: נשמר על הלקוח,
// מקוזז בחיוב, ונרשם בהזמנה כמה נגבה ממנו.
//
// ⚠️ **חוב מגדיל את החיוב**, זכות מקטינה. הכיוון היחיד ששונה.

import { NextResponse } from "next/server";
// §405: החוב נכנס מיד להזמנה הפתוחה של המכירה הנוכחית
import { recomputeOrderTotal } from "@/lib/order-total-lib";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { ownerKeyForActor, ownersForBalance, addOwners, reduceOwners } from "@/lib/debt-owners-lib";
// ⚠️ @/lib/auth ולא @/auth — זה הנתיב בפרויקט הזה.
import { auth } from "@/lib/auth";

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  const role = (session?.user as any)?.role;

  // ⚠️ נציג **וגם** מנהל: הנציג בשטח הוא זה שיודע מי חייב מה
  // מהמכירה הקודמת, והוא זה שהלקוח מדבר איתו.
  if (role !== "ADMIN" && role !== "AGENT") {
    return NextResponse.json({ error: "אין הרשאה" }, { status: 403 });
  }

  const { id } = await params;
  const body = await req.json().catch(() => ({}));

  const amount = Number(body.amount);
  const note = String(body.note ?? "").trim();
  // ⚠️ "set" קובע סכום, "add" מוסיף לקיים. ברירת המחדל set,
  // כי זו הפעולה הצפויה - המנהל יודע כמה הלקוח חייב.
  const mode = body.mode === "add" ? "add" : "set";

  if (!Number.isFinite(amount) || amount < 0) {
    return NextResponse.json(
      { error: "סכום לא תקין" },
      { status: 400 }
    );
  }
  // ⚠️ תקרה: חוב של מיליון הוא טעות הקלדה, לא מציאות.
  if (amount > 100000) {
    return NextResponse.json(
      { error: "סכום גבוה מדי — בדוק את ההזנה" },
      { status: 400 }
    );
  }

  const customer = await prisma.customer.findUnique({
    where: { id },
    select: { id: true, name: true, debtBalance: true, debtOwners: true },
  });
  if (!customer) {
    return NextResponse.json({ error: "לקוח לא נמצא" }, { status: 404 });
  }

  const current = Number(customer.debtBalance ?? 0);
  const next =
    mode === "add"
      ? Math.round((current + amount) * 100) / 100
      : Math.round(amount * 100) / 100;

  // ⚠️ הערה **חובה** כשיש חוב: לקוח שרואה "חוב ₪120" בלי הסבר
  // מתקשר לברר, וזו שיחה שאפשר למנוע.
  if (next > 0 && !note) {
    return NextResponse.json(
      { error: "יש לציין על מה החוב" },
      { status: 400 }
    );
  }

  // §368: 📒 תנועה בספר — לפני העדכון, באותה טרנזקציה.
  //
  // ⚠️ ADD כשמוסיפים, ADJUST כשקובעים. ההבדל חשוב לדוח: ADD
  // הוא חוב ממכירה, ADJUST הוא תיקון של המנהל.
  const delta = Math.round((next - current) * 100) / 100;
  const actor = session?.user?.email ?? role;
  // 💸 של מי החוב: נציג שרושם — החוב שלו (נספר בהכנסה שלו כשייגבה);
  // מנהל שרושם — של המנהל. הפחתה יורדת קודם מהחוב של מי שמפחית.
  const ownerKey = ownerKeyForActor(role, (session?.user as any)?.id ?? null);
  const before = ownersForBalance(customer.debtOwners, current);
  const owners =
    delta > 0
      ? addOwners(before, { [ownerKey]: delta })
      : delta < 0
        ? reduceOwners(before, next, ownerKey)
        : before;
  await prisma.$transaction([
    prisma.customer.update({
      where: { id },
      data: {
        debtBalance: next,
        // ⚠️ חוב שאופס - מנקים גם את ההערה. "חוב ₪0 על מכירת פסח"
        // מבלבל יותר משום דבר.
        debtNote: next > 0 ? note : null,
        debtUpdatedAt: new Date(),
        debtUpdatedBy: actor,
        debtOwners: next > 0 ? owners : Prisma.DbNull,
      },
    }),
    ...(delta !== 0
      ? [
          prisma.debtLedger.create({
            data: {
              customerId: id,
              kind: mode === "add" ? "ADD" : "ADJUST",
              amount: delta,
              balanceAfter: next,
              note: note || null,
              pricelistId: (body as any).pricelistId ?? null,
              ownerKey,
              agentId: role === "AGENT" ? ((session?.user as any)?.id ?? null) : null,
              createdBy: actor,
            },
          }),
        ]
      : []),
  ]);

  console.log(
    `[debt] ${role} set debt for ${customer.name}: ${current} → ${next} (${note})`
  );

  // §405: 💸 **החוב נכנס להזמנה של המכירה הנוכחית — עכשיו.**
  //
  // 🐛 מה שהיה: החוב נשמר על הלקוח ונגבה רק "בחישוב הבא" של הזמנה.
  // לקוח שההזמנה שלו כבר נשקלה (יש סכום סופי) — אף אחד לא נגע בה
  // יותר, החיוב גבה בלי החוב, והחוב חיכה למכירה הבאה.
  //
  // ✅ עכשיו: הזמנה פתוחה במכירה פעילה/סגורה (לא שולמה):
  //   • נשקלה → מחושבת מחדש מיד, והחוב בתוכה
  //   • טרם נשקלה → החוב ייכנס אוטומטית בשקילה
  //   • נעולה (נשלח ללקוח מייל עם סכום) → לא משנים; ייגבה בהבאה
  // ⚠️ רק כשהחוב **עלה**. הקטנת חוב שכבר נכנס להזמנה — ראה הודעה.
  let message: string | null = null;
  let appliedOrder: { orderNumber: number; finalTotal: number | null } | null = null;
  // 💳 "לגבות עכשיו": החוב נשאר על הלקוח (לא נכנס להזמנה פתוחה), והממשק
  // מחייב מיד את הכרטיס דרך /debt/charge. אם החיוב ייכשל — ייגבה בהבאה.
  const collectNow = (body as any).collectNow === true && next > 0;
  if (delta !== 0 && !collectNow) {
    const open = await prisma.order.findFirst({
      where: {
        customerId: id,
        status: { notIn: ["CANCELLED"] },
        paymentStatus: {
          notIn: ["PAID", "PARTIALLY_PAID", "CHARGING", "DEBT_CARRIED", "REFUNDED"],
        },
        pricelist: { status: { in: ["ACTIVE", "CLOSED"] } },
      },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        orderNumber: true,
        finalTotal: true,
        weightsLockedAt: true,
        appliedDebt: true,
      },
    });
    if (!open) {
      message =
        next > 0
          ? "אין ללקוח הזמנה פתוחה במכירה הנוכחית — החוב ייגבה בהזמנה הבאה שלו."
          : null;
    } else if (open.weightsLockedAt) {
      message = `ההזמנה #${open.orderNumber} נעולה (נשלח ללקוח הסכום הסופי) — החוב לא נוסף אליה, וייגבה בהזמנה הבאה.`;
    } else if (open.finalTotal == null) {
      message = `החוב ייכנס להזמנה #${open.orderNumber} של המכירה הנוכחית ברגע שתישקל.`;
    } else {
      const agentId =
        role === "AGENT" ? ((session?.user as any)?.id as string | undefined) ?? null : null;
      await recomputeOrderTotal(open.id, agentId);
      const after = await prisma.order.findUnique({
        where: { id: open.id },
        select: { finalTotal: true, appliedDebt: true },
      });
      appliedOrder = {
        orderNumber: open.orderNumber,
        finalTotal: after?.finalTotal != null ? Number(after.finalTotal) : null,
      };
      message =
        Number(after?.appliedDebt ?? 0) > 0
          ? `החוב נוסף להזמנה #${open.orderNumber} של המכירה הנוכחית. סכום לחיוב עכשיו: ₪${appliedOrder.finalTotal?.toFixed(2) ?? "—"}.`
          : `ההזמנה #${open.orderNumber} חושבה מחדש. סכום לחיוב: ₪${appliedOrder.finalTotal?.toFixed(2) ?? "—"}.`;
    }
  }

  return NextResponse.json({
    ok: true,
    debtBalance: next,
    debtNote: next > 0 ? note : null,
    appliedOrder,
    message,
  });
}
