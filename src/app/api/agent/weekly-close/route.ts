// ═══════════════════════════════════════════════════════════════
// §396: 🔁 "סגור שבוע" — לקוח שלא הגיע לאסוף לא תוקע את הנקודה
// ═══════════════════════════════════════════════════════════════
// POST /api/agent/weekly-close   { pricelistId }
//
// השבוע מוחלף אוטומטית רק כשכל ההזמנות נמסרו. לקוח אחד שלא בא
// לאסוף היה משאיר את השבוע הישן פתוח לנצח. כאן הנציג מאשר:
// "השבוע נגמר, את מה שלא נמסר אני יודע".
//
// ⚠️ ההזמנות שלא נמסרו **לא נמחקות ולא מבוטלות**. הן נשארות בשבוע
// הישן (CLOSED), ומשם ממשיכים לשקול, לחייב או לבטל — כמו כל מכירה.
//
// ⚠️ רק אחרי זמן ההחלפה. לפניו השבוע עדיין פתוח להזמנות.
//
// ⚠️ סדרה עם כמה נקודות של נציגים שונים: נציג סוגר רק אם כל
// ההזמנות שטרם נמסרו הן בנקודות **שלו**. אחרת הוא היה סוגר שבוע
// של נציג אחר שעוד עובד. מנהל — תמיד.

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAgent } from "@/lib/agent-guard";
import { ensureWeeklySales, UNDELIVERED_WHERE } from "@/lib/weekly-sales";

export async function POST(req: Request) {
  const g = await requireAgent();
  if (!g.ok) return g.res;
  const b = await req.json().catch(() => ({}));
  const pricelistId = String(b?.pricelistId ?? "").trim();
  if (!pricelistId) {
    return NextResponse.json({ error: "חסרה מכירה" }, { status: 400 });
  }

  const pl = await prisma.pricelist.findUnique({
    where: { id: pricelistId },
    select: {
      id: true,
      name: true,
      status: true,
      weeklySeriesId: true,
      weekEnd: true,
      weekClosedAt: true,
      points: { select: { pointId: true } },
    },
  });
  if (!pl || !pl.weeklySeriesId) {
    return NextResponse.json({ error: "זו אינה מכירה שבועית" }, { status: 400 });
  }
  if (pl.status !== "ACTIVE" || pl.weekClosedAt) {
    // כבר נסגר — מחזירים הצלחה כדי שלחיצה כפולה לא תציג שגיאה
    await ensureWeeklySales(true);
    return NextResponse.json({ ok: true, alreadyClosed: true });
  }
  if (!pl.weekEnd || Date.now() < pl.weekEnd.getTime()) {
    return NextResponse.json(
      { error: "השבוע עדיין לא הסתיים — אפשר לסגור אותו רק אחרי זמן ההחלפה." },
      { status: 400 }
    );
  }

  if (!g.isAdmin) {
    const mine = new Set(g.agentPointIds);
    if (!pl.points.some((p) => mine.has(p.pointId))) {
      return NextResponse.json(
        { error: "אין הרשאה — המכירה אינה באחת מהנקודות שלך" },
        { status: 403 }
      );
    }
    const othersPending = await prisma.order.count({
      where: {
        pricelistId,
        ...UNDELIVERED_WHERE,
        pointId: { notIn: g.agentPointIds },
      },
    });
    if (othersPending > 0) {
      return NextResponse.json(
        {
          error: `יש ${othersPending} הזמנות שטרם נמסרו בנקודות של נציג אחר. השבוע ייסגר כשהן יסומנו, או על ידי המנהל.`,
        },
        { status: 409 }
      );
    }
  }

  const undelivered = await prisma.order.count({
    where: { pricelistId, ...UNDELIVERED_WHERE },
  });

  await prisma.pricelist.update({
    where: { id: pricelistId },
    data: {
      weekClosedAt: new Date(),
      weekClosedBy: g.agent.name ?? g.userId,
      // §398: נסגר מיד (השבוע כבר הסתיים — נבדק למעלה). בלי זה שבוע
      // שאינו האחרון בסדרה היה נשאר ACTIVE, כי ההחלפה בודקת רק אחרון.
      status: "CLOSED",
    },
  });

  console.log(
    `[weekly-close] ${pl.name} closed by ${g.agent.name ?? g.userId} with ${undelivered} undelivered`
  );

  // ⚠️ force: השבוע החדש נפתח עכשיו, לא בעוד דקה
  await ensureWeeklySales(true);

  return NextResponse.json({ ok: true, undelivered });
}
