import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/guard";

export async function GET() {
  const g = await requireAdmin();
  if (!g.ok) return g.res;
  // ⚠️ findMany בלי select - כל השדות מוחזרים, כולל isPrivate (§163).
  const points = await prisma.deliveryPoint.findMany({ orderBy: { sortOrder: "asc" } });
  return NextResponse.json(points);
}

export async function POST(req: Request) {
  const g = await requireAdmin();
  if (!g.ok) return g.res;
  const b = await req.json();
  const point = await prisma.deliveryPoint.create({
    data: {
      name: b.name,
      city: b.city ?? null,
      address: b.address ?? null,
      contactName: b.contactName ?? null,
      phone: b.phone ?? null,
      email: b.email ?? null,
      deliveryHours: b.deliveryHours ?? null,
      notes: b.notes ?? null,
      customDeliveryDateText: b.customDeliveryDateText || null,
      isActive: b.isActive ?? true,
      // §163: נקודה סמויה - לא מוצגת ללקוחות באתר ובטלפון.
      //
      // לחנויות שלוקחות הזמנות לפתח העסק שלהן: הכתובת שונה
      // מהנקודות הקבועות, אבל היא "נקודת חלוקה" לכל דבר - עם
      // סיכום, נציג, ודף חלוקה משלה.
      //
      // ⚠️ ברירת מחדל false. נקודה שנוצרת בטעות כסמויה לא תופיע
      // ללקוחות, והמנהל היה מחפש שעה למה איש לא מזמין אליה.
      isPrivate: b.isPrivate ?? false,
      sortOrder: b.sortOrder ?? 0,
    },
  });
  return NextResponse.json(point);
}
