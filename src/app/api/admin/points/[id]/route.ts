import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/guard";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const g = await requireAdmin();
  if (!g.ok) return g.res;
  const { id } = await params;
  const b = await req.json();
  const data: any = {};
  for (const k of [
    "name",
    "city",
    "address",
    "contactName",
    "phone",
    "email",
    "deliveryHours",
    "notes",
    "customDeliveryDateText",
    "isActive",
    // §163: 🐛 בלי זה סימון נקודה **קיימת** כסמויה לא נשמר.
    //
    // המסך שלח את השדה, הלולאה כאן דילגה עליו, והצ'קבוקס חזר
    // לא מסומן אחרי השמירה - בלי שום שגיאה. נקודה חדשה עבדה
    // (ה-POST קולט), וזה בדיוק מה שהופך את הבאג למבלבל: חלק
    // מהמקרים עובדים.
    //
    // ⚠️ זהו הדפוס שנתפס כבר כמה פעמים במערכת - שדה שנשלח
    // מהמסך ונזרק בשקט ברשימת שדות מפורשת.
    "isPrivate",
    "sortOrder",
  ]) {
    if (k in b) data[k] = b[k];
  }
  const point = await prisma.deliveryPoint.update({ where: { id }, data });
  return NextResponse.json(point);
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const g = await requireAdmin();
  if (!g.ok) return g.res;
  const { id } = await params;
  const used = await prisma.order.count({ where: { pointId: id } });
  if (used > 0) {
    await prisma.deliveryPoint.update({ where: { id }, data: { isActive: false } });
    return NextResponse.json({ ok: true, hidden: true });
  }
  await prisma.pricelistPoint.deleteMany({ where: { pointId: id } });
  await prisma.deliveryPoint.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
