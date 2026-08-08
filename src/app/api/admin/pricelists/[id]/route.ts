import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/guard";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const g = await requireAdmin();
  if (!g.ok) return g.res;
  const { id } = await params;
  const list = await prisma.pricelist.findUnique({
    where: { id },
    include: {
      products: { include: { product: true } },
      points: { include: { point: true } },
    },
  });
  return NextResponse.json(list);
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const g = await requireAdmin();
  if (!g.ok) return g.res;
  const { id } = await params;
  const b = await req.json();

  const data: any = {};
  for (const k of ["name", "status", "notes", "deliveryDateText"]) {
    if (k in b) data[k] = b[k];
  }
  if ("singleSurcharge" in b) data.singleSurcharge = b.singleSurcharge;
  if ("openDate" in b) data.openDate = b.openDate ? new Date(b.openDate) : null;
  if ("closeDate" in b) data.closeDate = b.closeDate ? new Date(b.closeDate) : null;
  if ("editDeadline" in b) data.editDeadline = b.editDeadline ? new Date(b.editDeadline) : null;
  if ("deliveryDate" in b) data.deliveryDate = b.deliveryDate ? new Date(b.deliveryDate) : null;
  if ("deliveryDateEnd" in b) data.deliveryDateEnd = b.deliveryDateEnd ? new Date(b.deliveryDateEnd) : null;

  // §23: תאריך חלוקה חובה בהפעלת מכירה.
  // למה: הלקוח לא אמור להזמין בלי לדעת מתי יקבל, ותזכורת החלוקה
  // מחשבת את התאריך העברי מהשדה הזה - בלעדיו היא נשלחת בלי תאריך.
  // לא נאכף על טיוטה (DRAFT), כדי לא לחסום עבודה על מכירה בהכנה.
  if (b.status === "ACTIVE") {
    const existing = await prisma.pricelist.findUnique({
      where: { id },
      select: { deliveryDate: true },
    });
    // התאריך יכול להגיע בגוף הבקשה (נקבע עכשיו) או להיות שמור כבר
    const effectiveDate =
      "deliveryDate" in b ? data.deliveryDate : existing?.deliveryDate ?? null;
    if (!effectiveDate) {
      return NextResponse.json(
        { error: "לא ניתן להפעיל מכירה בלי תאריך חלוקה. יש לקבוע תאריך תחילה." },
        { status: 400 }
      );
    }
  }

  // השבתת מכירות אחרות מתבצעת יחד עם העדכון בטרנזקציה אחת.
  // 🐛 תוקן: קודם ה-updateMany רץ *לפני* העדכון, ואם העדכון נכשל
  // (למשל ולידציה או שגיאת DB) מכירה אחרת כבר נסגרה לחינם.
  const list = await prisma.$transaction(async (tx) => {
    if (b.status === "ACTIVE") {
      await tx.pricelist.updateMany({
        where: { status: "ACTIVE", NOT: { id } },
        data: { status: "CLOSED" },
      });
    }
    return tx.pricelist.update({ where: { id }, data });
  });

  // update product membership / prices
  if (b.products) {
    await prisma.pricelistProduct.deleteMany({ where: { pricelistId: id } });
    await prisma.pricelistProduct.createMany({
      data: b.products.map((p: any) => ({
        pricelistId: id,
        productId: p.productId,
        price: p.price ?? null,
      })),
    });
  }
  // update point membership
  if (b.pointIds) {
    await prisma.pricelistPoint.deleteMany({ where: { pricelistId: id } });
    await prisma.pricelistPoint.createMany({
      data: b.pointIds.map((pid: string) => ({ pricelistId: id, pointId: pid })),
    });
  }

  return NextResponse.json(list);
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const g = await requireAdmin();
  if (!g.ok) return g.res;
  const { id } = await params;
  const used = await prisma.order.count({ where: { pricelistId: id } });
  if (used > 0)
    return NextResponse.json({ error: "לא ניתן למחוק מחירון עם הזמנות" }, { status: 400 });
  await prisma.pricelist.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
