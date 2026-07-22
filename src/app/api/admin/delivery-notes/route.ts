// §20: העלאת תעודת משלוח + הפעלת OCR
// POST /api/admin/delivery-notes
// Body: { pricelistId: string, imageBase64: string, mimeType?: string }

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/guard";
import { extractDeliveryNote, matchProductByName } from "@/lib/delivery-note-ocr";

export async function POST(req: Request) {
  const g = await requireAdmin();
  if (!g.ok) return g.res;

  const body = await req.json().catch(() => ({}));
  const pricelistId = String(body.pricelistId || "").trim();
  const imageBase64 = String(body.imageBase64 || "").trim();
  const mimeType = String(body.mimeType || "image/jpeg").trim();

  if (!pricelistId) {
    return NextResponse.json({ error: "pricelistId חובה" }, { status: 400 });
  }
  if (!imageBase64) {
    return NextResponse.json({ error: "יש לצרף תמונה" }, { status: 400 });
  }

  // בדיקה שהמחירון קיים
  const pricelist = await prisma.pricelist.findUnique({
    where: { id: pricelistId },
    select: { id: true },
  });
  if (!pricelist) {
    return NextResponse.json({ error: "מחירון לא נמצא" }, { status: 404 });
  }

  // הפעלת Gemini OCR
  const ocrResult = await extractDeliveryNote(imageBase64, mimeType);

  if (!ocrResult.ok || !ocrResult.data) {
    return NextResponse.json(
      {
        error: ocrResult.error || "OCR נכשל",
        rawResponse: ocrResult.rawResponse,
      },
      { status: 500 }
    );
  }

  // התאמת מוצרים למערכת - שולף מוצרים פעילים ומנסה להתאים כל שורה
  const products = await prisma.product.findMany({
    where: { isActive: true },
    select: { id: true, name: true },
  });

  const itemsWithMatches = ocrResult.data.items.map((item, idx) => {
    const match = matchProductByName(item.productNameOnNote, products);
    return {
      productNameOnNote: item.productNameOnNote,
      productId: match.productId, // NULL אם לא נמצאה התאמה
      quantity: item.quantity,
      weight: item.weight,
      confidence: item.confidence,
      matchConfidence: match.confidence,
      sortOrder: idx,
    };
  });

  // יצירת רשומת DRAFT - מוצג למנהל לאישור
  const deliveryNote = await prisma.deliveryNote.create({
    data: {
      pricelistId,
      supplierName: ocrResult.data.supplierName || null,
      noteNumber: ocrResult.data.noteNumber || null,
      noteDate: ocrResult.data.noteDate ? new Date(ocrResult.data.noteDate) : null,
      ocrRawData: ocrResult.rawResponse || null,
      status: "DRAFT",
      items: {
        create: itemsWithMatches.map((item) => ({
          productNameOnNote: item.productNameOnNote,
          productId: item.productId,
          quantity: item.quantity,
          weight: item.weight,
          confidence: item.confidence,
          sortOrder: item.sortOrder,
        })),
      },
    },
    include: {
      items: {
        orderBy: { sortOrder: "asc" },
        include: {
          product: { select: { id: true, name: true } },
        },
      },
    },
  });

  return NextResponse.json({
    ok: true,
    deliveryNote,
    matchStats: {
      total: itemsWithMatches.length,
      matched: itemsWithMatches.filter((i) => i.productId).length,
      unmatched: itemsWithMatches.filter((i) => !i.productId).length,
    },
  });
}

// GET /api/admin/delivery-notes?pricelistId=X - רשימת תעודות של מחירון
export async function GET(req: Request) {
  const g = await requireAdmin();
  if (!g.ok) return g.res;

  const url = new URL(req.url);
  const pricelistId = url.searchParams.get("pricelistId");

  const notes = await prisma.deliveryNote.findMany({
    where: pricelistId ? { pricelistId } : undefined,
    orderBy: { createdAt: "desc" },
    include: {
      items: {
        orderBy: { sortOrder: "asc" },
        include: {
          product: { select: { id: true, name: true } },
        },
      },
      _count: { select: { items: true } },
    },
    take: 50,
  });

  return NextResponse.json(notes);
}
