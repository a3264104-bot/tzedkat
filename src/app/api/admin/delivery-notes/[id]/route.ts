// §20: אישור/עריכה/מחיקה של תעודת משלוח
// PATCH /api/admin/delivery-notes/[id] - אישור סופי או עדכון נתונים
// DELETE /api/admin/delivery-notes/[id] - מחיקה

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/guard";

// Body for PATCH:
// { status: "CONFIRMED" }  - אישור סופי (משמש לחישוב עמלה)
// or
// {
//   items: [{ id?: string, productNameOnNote, productId, quantity, weight, addedManually? }]
// } - עדכון פריטים (הוספה/שינוי/מחיקה)

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const g = await requireAdmin();
  if (!g.ok) return g.res;

  const { id } = await params;
  const body = await req.json().catch(() => ({}));

  const existing = await prisma.deliveryNote.findUnique({
    where: { id },
    include: { items: true },
  });
  if (!existing) {
    return NextResponse.json({ error: "תעודה לא נמצאה" }, { status: 404 });
  }

  // אישור סופי בלבד
  if (body.status === "CONFIRMED") {
    if (existing.status === "CONFIRMED") {
      return NextResponse.json({ error: "התעודה כבר מאושרת" }, { status: 400 });
    }
    // בדיקה שכל השורות הותאמו למוצר במערכת
    const unmatched = existing.items.filter((i) => !i.productId);
    if (unmatched.length > 0) {
      return NextResponse.json(
        {
          error: `${unmatched.length} שורות לא הותאמו למוצר במערכת. יש להתאים או להסיר אותן לפני אישור.`,
          unmatchedRows: unmatched.map((i) => i.productNameOnNote),
        },
        { status: 400 }
      );
    }
    const updated = await prisma.deliveryNote.update({
      where: { id },
      data: {
        status: "CONFIRMED",
        confirmedAt: new Date(),
        confirmedById: g.session?.user?.email || null,
      },
      include: {
        items: {
          orderBy: { sortOrder: "asc" },
          include: { product: { select: { id: true, name: true } } },
        },
      },
    });
    return NextResponse.json(updated);
  }

  // עדכון פריטים (רק ב-DRAFT)
  if (Array.isArray(body.items)) {
    if (existing.status === "CONFIRMED") {
      return NextResponse.json(
        { error: "לא ניתן לערוך תעודה מאושרת" },
        { status: 400 }
      );
    }

    // מחיקת פריטים ישנים ויצירה מחדש (פשוט ובטוח)
    await prisma.$transaction([
      prisma.deliveryNoteItem.deleteMany({ where: { deliveryNoteId: id } }),
      prisma.deliveryNoteItem.createMany({
        data: body.items.map((item: any, idx: number) => ({
          deliveryNoteId: id,
          productNameOnNote: String(item.productNameOnNote || "").trim(),
          productId: item.productId || null,
          quantity: Math.max(0, Math.round(Number(item.quantity) || 0)),
          weight: Math.max(0, Number(item.weight) || 0),
          confidence: item.confidence ? Number(item.confidence) : null,
          addedManually: !!item.addedManually,
          note: item.note || null,
          sortOrder: idx,
        })),
      }),
    ]);
  }

  // עדכון שדות ראשיים
  const data: any = {};
  if ("supplierName" in body) data.supplierName = body.supplierName || null;
  if ("noteNumber" in body) data.noteNumber = body.noteNumber || null;
  if ("noteDate" in body) data.noteDate = body.noteDate ? new Date(body.noteDate) : null;

  if (Object.keys(data).length > 0) {
    await prisma.deliveryNote.update({ where: { id }, data });
  }

  const result = await prisma.deliveryNote.findUnique({
    where: { id },
    include: {
      items: {
        orderBy: { sortOrder: "asc" },
        include: { product: { select: { id: true, name: true } } },
      },
    },
  });

  return NextResponse.json(result);
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const g = await requireAdmin();
  if (!g.ok) return g.res;

  const { id } = await params;
  const existing = await prisma.deliveryNote.findUnique({
    where: { id },
    select: { status: true },
  });
  if (!existing) {
    return NextResponse.json({ error: "תעודה לא נמצאה" }, { status: 404 });
  }
  if (existing.status === "CONFIRMED") {
    return NextResponse.json(
      { error: "לא ניתן למחוק תעודה מאושרת" },
      { status: 400 }
    );
  }
  await prisma.deliveryNote.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
