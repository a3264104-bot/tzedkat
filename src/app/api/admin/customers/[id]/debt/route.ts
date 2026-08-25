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
import { prisma } from "@/lib/prisma";
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
    select: { id: true, name: true, debtBalance: true },
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

  await prisma.customer.update({
    where: { id },
    data: {
      debtBalance: next,
      // ⚠️ חוב שאופס - מנקים גם את ההערה. "חוב ₪0 על מכירת פסח"
      // מבלבל יותר משום דבר.
      debtNote: next > 0 ? note : null,
      debtUpdatedAt: new Date(),
      debtUpdatedBy: session?.user?.email ?? role,
    },
  });

  console.log(
    `[debt] ${role} set debt for ${customer.name}: ${current} → ${next} (${note})`
  );

  return NextResponse.json({
    ok: true,
    debtBalance: next,
    debtNote: next > 0 ? note : null,
  });
}
