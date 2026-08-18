import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/guard";

export async function GET() {
  const g = await requireAdmin();
  if (!g.ok) return g.res;
  const products = await prisma.product.findMany({
    include: {
      category: true,
      kashrutRef: true,
    },
    orderBy: [{ category: { sortOrder: "asc" } }, { sortOrder: "asc" }],
  });
  // מוסיפים flat fields של כשרות לנוחות הclient
  return NextResponse.json(
    products.map((p) => ({
      ...p,
      kashrutName: p.kashrutRef?.name || null,
      kashrutImageUrl: p.kashrutRef?.imageUrl || null,
    }))
  );
}

export async function POST(req: Request) {
  const g = await requireAdmin();
  if (!g.ok) return g.res;
  const b = await req.json();
  const product = await prisma.product.create({
    data: {
      name: b.name,
      categoryId: b.categoryId,
      cartonPrice: b.cartonPrice,
      allowSingles: b.allowSingles ?? false,
      singleSurcharge: b.singleSurcharge ?? null,
      unit: b.unit ?? 'ק"ג',
      saleType: b.saleType ?? "WEIGHT",
      priceType: b.priceType ?? "REGULAR",
      packageWeight: b.packageWeight ?? null,
      avgWeightPerUnit: b.avgWeightPerUnit ?? null,
      imageUrl: b.imageUrl ?? null,
      kashrut: b.kashrut ?? null,
      kashrutId: b.kashrutId ?? null,
      isFeatured: !!b.isFeatured,
      highlightNote: b.highlightNote ?? null,
      isFrozen: b.isFrozen ?? false,
      limitedQty: b.limitedQty ?? false,
      limitedQtyAmount: b.limitedQtyAmount ?? null,
      isActive: b.isActive ?? true,
      sortOrder: b.sortOrder ?? 0,
      // §24: תפריט טלפוני
      phoneEnabled: b.phoneEnabled ?? true,
      phoneKey: b.phoneKey ?? null,
      // §69: מק"ט טלפוני להזמנה מהמודעה + כתיב פונטי להקראה.
      // המק"ט מנורמל לספרות בלבד בלי אפסים מובילים - כך "0101"
      // ו-"101" הם אותו קוד, בדיוק כמו שה-IVR מנרמל את ההקשה.
      phoneCode: normalizePhoneCode(b.phoneCode),
      phoneName: b.phoneName?.trim() || null,
    },
  });
  return NextResponse.json(product);
}

// §69: נירמול מק"ט - ספרות בלבד, בלי אפסים מובילים, ריק -> null
function normalizePhoneCode(raw: unknown): string | null {
  const digits = String(raw ?? "").replace(/\D/g, "");
  if (!digits) return null;
  const n = parseInt(digits, 10);
  return n > 0 ? String(n) : null;
}
