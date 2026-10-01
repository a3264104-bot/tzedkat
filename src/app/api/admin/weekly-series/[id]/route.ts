// ═══════════════════════════════════════════════════════════════
// §396: 🔁 סדרה שבועית — עריכה ומחיקה
// ═══════════════════════════════════════════════════════════════
// PATCH  /api/admin/weekly-series/[id]  → עדכון (אותו גוף כמו POST)
// DELETE /api/admin/weekly-series/[id]  → מחיקה (רק בלי שבועות)
//
// ⚠️ שינוי בתבנית חל **מהשבוע הבא**. השבוע הפתוח לא משתנה —
// לקוחות כבר הזמינו בו במחירים שראו. לתיקון השבוע הנוכחי עורכים
// אותו במסך המכירות, כמו כל מכירה.
//
// ⚠️ חריג אחד: נקודה שהוסרה מהסדרה **גם יוצאת מהשבוע הפתוח** —
// אחרת לקוחותיה ימשיכו לראות שבוע של סדרה שהם כבר לא בה. נקודה
// שנוספה נכנסת לשבוע הפתוח מיד, מאותה סיבה.
// §398: ...אבל לא נקודה שיש לה הזמנות פתוחות בשבוע — נחסם (409).

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/guard";
import { ensureWeeklySales, UNDELIVERED_WHERE } from "@/lib/weekly-sales";
import { parseSeriesBody } from "@/lib/weekly-series-validate";

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const g = await requireAdmin();
  if (!g.ok) return g.res;
  const { id } = await params;
  const b = await req.json().catch(() => ({}));

  const existing = await prisma.weeklySeries.findUnique({
    where: { id },
    select: { id: true },
  });
  if (!existing) {
    return NextResponse.json({ error: "הסדרה לא נמצאה" }, { status: 404 });
  }

  const parsed = await parseSeriesBody(b, id);
  if ("error" in parsed) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  // §398: 🐛 נקודה שהוסרה יוצאת מהשבוע הפתוח — וההזמנות שכבר נעשו
  // בה היו נשארות "יתומות": הנציג שלה כבר לא רואה את השבוע, "סגור
  // שבוע" נחסם לו, והשבוע לא מתחלף כי הן לא סומנו כנמסרו.
  // ✅ חוסמים הסרה של נקודה עם הזמנות פתוחות בשבוע הנוכחי.
  const openWeek = await prisma.pricelist.findFirst({
    where: { weeklySeriesId: id, status: "ACTIVE" },
    select: { id: true },
  });
  if (openWeek) {
    const blocking = await prisma.order.groupBy({
      by: ["pointId"],
      where: {
        pricelistId: openWeek.id,
        pointId: { notIn: parsed.pointIds },
        ...UNDELIVERED_WHERE,
      },
      _count: { _all: true },
    });
    if (blocking.length > 0) {
      const names = await prisma.deliveryPoint.findMany({
        where: { id: { in: blocking.map((b) => b.pointId) } },
        select: { id: true, name: true },
      });
      const label = blocking
        .map((b) => `${names.find((n) => n.id === b.pointId)?.name ?? "נקודה"} (${b._count._all} הזמנות)`)
        .join(", ");
      return NextResponse.json(
        {
          error: `אי אפשר להוציא מהסדרה נקודה שיש לה הזמנות פתוחות בשבוע הנוכחי: ${label}. אפשר להסיר אותה אחרי שהשבוע ייסגר, או לבטל/למסור את ההזמנות קודם.`,
        },
        { status: 409 }
      );
    }
  }

  await prisma.$transaction(async (tx) => {
    await tx.weeklySeries.update({ where: { id }, data: parsed.fields });

    await tx.weeklySeriesPoint.deleteMany({ where: { seriesId: id } });
    await tx.weeklySeriesPoint.createMany({
      data: parsed.pointIds.map((pointId) => ({ seriesId: id, pointId })),
    });

    await tx.weeklySeriesProduct.deleteMany({ where: { seriesId: id } });
    await tx.weeklySeriesProduct.createMany({
      data: parsed.products.map((p) => ({
        seriesId: id,
        productId: p.productId,
        price: p.price,
      })),
    });

    // ⚠️ הנקודות של השבוע הפתוח מסתנכרנות (ראה הערה למעלה).
    // מוצרים ומחירים — לא.
    const open = await tx.pricelist.findFirst({
      where: { weeklySeriesId: id, status: "ACTIVE" },
      select: { id: true },
    });
    if (open) {
      await tx.pricelistPoint.deleteMany({
        where: { pricelistId: open.id, pointId: { notIn: parsed.pointIds } },
      });
      await tx.pricelistPoint.createMany({
        data: parsed.pointIds.map((pointId) => ({ pricelistId: open.id, pointId })),
        skipDuplicates: true,
      });
    }
  });

  await ensureWeeklySales(true);
  return NextResponse.json({ ok: true });
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const g = await requireAdmin();
  if (!g.ok) return g.res;
  const { id } = await params;

  // ⚠️ סדרה עם שבועות לא נמחקת — השבועות הם היסטוריה של הזמנות
  // ותשלומים, והדוחות מסננים לפיהם. במקום זה: השבתה.
  const weeks = await prisma.pricelist.count({ where: { weeklySeriesId: id } });
  if (weeks > 0) {
    return NextResponse.json(
      {
        error:
          "לסדרה כבר יש שבועות עם היסטוריה, ולכן אי אפשר למחוק אותה. כדי להפסיק את הפתיחה האוטומטית — יש להשבית אותה.",
      },
      { status: 400 }
    );
  }
  await prisma.weeklySeries.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
