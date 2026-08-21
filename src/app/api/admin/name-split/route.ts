// ═══════════════════════════════════════════════════════════════
// §174: השלמת פיצול שמות ללקוחות ותיקים
// ═══════════════════════════════════════════════════════════════
// GET  /api/admin/name-split          -> מי חסר פיצול, עם ניחוש
// POST /api/admin/name-split          -> שמירת אישורים
//
// למה מסך ולא SQL:
//
// 🚨 הסדר בנתונים **מעורב**. בדגימה מהמערכת:
//   "וולדמן ישעיה"     -> משפחה, פרטי
//   "טוביה בוקשפן"     -> פרטי, משפחה
//   "רייכמן שלום ברוך" -> משפחה, פרטי (עם שם פרטי כפול)
//
// פיצול אוטומטי לפי מיקום היה שגוי בכ-50% מהמקרים - וזה גרוע
// מהמצב היום: כרגע המנהל **יודע** שהוא לא יודע. אחרי פיצול שגוי
// המערכת תציג "שם פרטי: וולדמן" ותיראה בטוחה.
//
// ⚠️ הניחוש כן מוצג - אבל כהצעה שהמנהל מאשר, לא כעובדה שנשמרת.

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/guard";

export async function GET(req: Request) {
  const g = await requireAdmin();
  if (!g.ok) return g.res;

  const url = new URL(req.url);
  const take = Math.min(Number(url.searchParams.get("take") ?? 100), 300);

  const rows = await prisma.customer.findMany({
    where: {
      // ⚠️ רק לקוחות. נציגים ומנהלים לא צריכים פיצול, והם היו
      // מבלבלים ברשימה.
      role: "CUSTOMER",
      // ⚠️ חסר **אחד** מהשניים. לקוח עם שם פרטי בלי משפחה עדיין
      // דורש טיפול.
      OR: [{ firstName: null }, { lastName: null }],
    },
    orderBy: [{ isActive: "desc" }, { name: "asc" }],
    take,
    select: {
      id: true,
      name: true,
      phone: true,
      firstName: true,
      lastName: true,
      isActive: true,
      defaultPoint: { select: { name: true } },
      _count: { select: { orders: true } },
    },
  });

  const total = await prisma.customer.count({
    where: {
      role: "CUSTOMER",
      OR: [{ firstName: null }, { lastName: null }],
    },
  });

  return NextResponse.json({
    total,
    shown: rows.length,
    rows: rows.map((c) => {
      const parts = String(c.name || "").trim().split(/\s+/).filter(Boolean);
      // ⚠️ הניחוש: מילה ראשונה = פרטי, השאר = משפחה.
      //
      // זו רק **הצעה**. המסך מציג כפתור "⇄ החלף" כי אצל חלק
      // מהלקוחות הסדר הפוך, ואין דרך לדעת מהנתונים לבד.
      const guessFirst = c.firstName ?? parts[0] ?? "";
      const guessLast = c.lastName ?? parts.slice(1).join(" ");
      return {
        id: c.id,
        name: c.name,
        phone: c.phone,
        pointName: c.defaultPoint?.name ?? null,
        orderCount: c._count.orders,
        isActive: c.isActive,
        guessFirst,
        guessLast,
        // ⚠️ שם בודד - אי אפשר לנחש כלל, והמנהל חייב לשאול
        // את הלקוח. מסומן כדי שיוכל לדלג עליו לעכשיו.
        singleWord: parts.length < 2,
      };
    }),
  });
}

// ═══════════════════════════════════════════════════════════════
// POST - שמירת אישורים
// ═══════════════════════════════════════════════════════════════
// Body: { items: [{ id, firstName, lastName }] }
export async function POST(req: Request) {
  const g = await requireAdmin();
  if (!g.ok) return g.res;

  const b = await req.json().catch(() => ({}));
  const items: any[] = Array.isArray(b.items) ? b.items : [];
  if (items.length === 0) {
    return NextResponse.json({ error: "אין מה לשמור" }, { status: 400 });
  }

  let saved = 0;
  const failed: string[] = [];

  for (const it of items) {
    const id = String(it?.id ?? "");
    const first = String(it?.firstName ?? "").trim();
    const last = String(it?.lastName ?? "").trim();
    if (!id || !first) {
      failed.push(id || "?");
      continue;
    }
    try {
      await prisma.customer.update({
        where: { id },
        data: {
          firstName: first,
          lastName: last || null,
          // §174: השם המלא מורכב מחדש **בסדר הנכון**.
          //
          // ⚠️ זו הנקודה: אצל "וולדמן ישעיה" השם נשמר הפוך, ואחרי
          // האישור הוא ייקרא "ישעיה וולדמן" - בדף החלוקה, במיילים
          // ובטלפון. זה מה שהמנהל ביקש.
          //
          // ⚠️ הזמנות קיימות **לא משתנות**: customerName עליהן הוא
          // snapshot מרגע ההזמנה, וזה נכון - הוא מתעד מה היה אז.
          name: last ? `${first} ${last}` : first,
        },
      });
      saved++;
    } catch {
      failed.push(id);
    }
  }

  console.log(`[name-split] saved=${saved} failed=${failed.length}`);
  return NextResponse.json({ ok: true, saved, failed: failed.length });
}
