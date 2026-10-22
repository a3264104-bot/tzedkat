// 🛒 תזכורות לסלים שלא נשלחו.
// POST /api/cron/cart-reminders   (כותרת x-inbound-secret — אותו סוד כמו קליטת המיילים)
//
// מי קורא: ה-Worker של Cloudflare (tzidkat-inbound) כל חצי שעה (cron trigger).
// ⚠️ Vercel במסלול הזה מאפשר cron פעם ביום בלבד — לכן התזמון יושב שם.
//
// מתי נשלחת תזכורת (פעם אחת לסל):
//   • הסל לא השתנה 2 שעות — או 30 דק' אם ההזמנות נסגרות תוך 6 שעות
//   • המכירה עדיין פתוחה ללקוחות, ואין ללקוח הזמנה בה
//   • ללקוח יש מייל, והוא פעיל
//   • בין 08:00 ל-21:00 שעון ישראל (לא מעירים אנשים)
// סלים ישנים משבוע — נמחקים.

import { NextResponse } from "next/server";
import crypto from "crypto";
import { prisma } from "@/lib/prisma";
import { sendCartReminder } from "@/lib/email";

export const maxDuration = 60;

function authorized(req: Request) {
  const secret = (process.env.INBOUND_EMAIL_SECRET || "").trim();
  const given = req.headers.get("x-inbound-secret") || "";
  return !!secret && given.length === secret.length && crypto.timingSafeEqual(Buffer.from(given), Buffer.from(secret));
}

export async function POST(req: Request) {
  if (!authorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const dry = new URL(req.url).searchParams.get("dry") === "1";

  const now = new Date();
  const hourIL = Number(
    now.toLocaleString("en-US", { timeZone: "Asia/Jerusalem", hour: "2-digit", hour12: false })
  );
  const quietHours = hourIL < 8 || hourIL >= 21;

  // ניקוי: סלים שלא נגעו בהם שבוע
  const weekAgo = new Date(now.getTime() - 7 * 24 * 3600 * 1000);
  const cleaned = dry ? 0 : (await prisma.webCart.deleteMany({ where: { updatedAt: { lt: weekAgo } } })).count;

  if (quietHours) return NextResponse.json({ ok: true, quietHours: true, cleaned });

  const halfHourAgo = new Date(now.getTime() - 30 * 60 * 1000);
  const carts = await prisma.webCart.findMany({
    where: { reminderSentAt: null, updatedAt: { lt: halfHourAgo } },
    take: 100,
    orderBy: { updatedAt: "asc" },
  });

  const results: { customerId: string; result: string }[] = [];
  for (const cart of carts) {
    const [sale, customer, order] = await Promise.all([
      prisma.pricelist.findUnique({
        where: { id: cart.pricelistId },
        select: { name: true, status: true, agentOnly: true, closeDate: true },
      }),
      prisma.customer.findUnique({
        where: { id: cart.customerId },
        select: { name: true, email: true, isActive: true },
      }),
      prisma.order.findFirst({
        where: { customerId: cart.customerId, pricelistId: cart.pricelistId, status: { notIn: ["CANCELLED"] } },
        select: { id: true },
      }),
    ]);

    // כבר הזמין / המכירה לא פתוחה / אין לאן לשלוח — מוחקים בלי מייל
    if (order || !sale || sale.status !== "ACTIVE" || sale.agentOnly || (sale.closeDate && sale.closeDate < now)) {
      if (!dry) await prisma.webCart.delete({ where: { id: cart.id } }).catch(() => {});
      results.push({ customerId: cart.customerId, result: order ? "ordered" : "sale-closed" });
      continue;
    }
    if (!customer?.email || customer.isActive === false) {
      if (!dry) await prisma.webCart.update({ where: { id: cart.id }, data: { reminderSentAt: now } });
      results.push({ customerId: cart.customerId, result: "no-email" });
      continue;
    }

    // כמה זמן לחכות: 2 שעות, או חצי שעה כשהסגירה קרובה (6 שעות)
    const closingSoon = !!sale.closeDate && sale.closeDate.getTime() - now.getTime() < 6 * 3600 * 1000;
    const waitMs = closingSoon ? 30 * 60 * 1000 : 2 * 3600 * 1000;
    if (now.getTime() - cart.updatedAt.getTime() < waitMs) {
      results.push({ customerId: cart.customerId, result: "wait" });
      continue;
    }

    let items: { name: string; qty: number; unit: string }[] = [];
    try {
      items = JSON.parse(cart.itemsJson || "[]");
    } catch {}
    if (!items.length) {
      if (!dry) await prisma.webCart.delete({ where: { id: cart.id } }).catch(() => {});
      continue;
    }

    if (dry) {
      results.push({ customerId: cart.customerId, result: "would-send" });
      continue;
    }
    // מסמנים לפני השליחה — כדי שקריאה מקבילה לא תשלח פעמיים
    await prisma.webCart.update({ where: { id: cart.id }, data: { reminderSentAt: now } });
    const closeText = sale.closeDate
      ? sale.closeDate.toLocaleString("he-IL", {
          timeZone: "Asia/Jerusalem",
          weekday: "long",
          day: "numeric",
          month: "long",
          hour: "2-digit",
          minute: "2-digit",
        })
      : null;
    const r = await sendCartReminder({
      to: customer.email,
      customerName: customer.name,
      saleName: sale.name,
      closeText,
      items,
    });
    results.push({ customerId: cart.customerId, result: r.ok ? "sent" : `failed: ${r.error}` });
  }

  const sent = results.filter((r) => r.result === "sent").length;
  if (sent) console.log(`[cart-reminders] sent ${sent} reminder(s)`);
  return NextResponse.json({ ok: true, checked: carts.length, sent, cleaned, results });
}
