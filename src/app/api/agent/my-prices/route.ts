// ═══════════════════════════════════════════════════════════════
// /api/agent/my-prices — המחירים השמורים של הנציג למוצרים נסתרים
// ═══════════════════════════════════════════════════════════════
// GET → כל המוצרים הנסתרים (מועדף / לא פעיל) וכל מוצר שכבר יש לו מחיר
//       שמור, עם מחיר המחירון והמחיר השמור של הנציג המחובר.
// PUT { productId, price } → שמירה. price=null/"" → מחיקה (חוזרים למחירון).
//
// ⚠️ הכל לפי המשתמש המחובר בלבד: נציג לא רואה ולא משנה מחירים של
// נציג אחר. גם מנהל שמזמין בשם לקוח מקבל את המחירים *שלו*.

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAgent } from "@/lib/agent-guard";
import { validateAgentPrice } from "@/lib/commission-lib";

/** מחיר המחירון העדכני: ממכירה פעילה אם יש, אחרת מחיר הקרטון של המוצר */
async function listPrices(productIds: string[]) {
  const pp = await prisma.pricelistProduct.findMany({
    where: { productId: { in: productIds }, pricelist: { status: "ACTIVE" } },
    select: { productId: true, price: true, pricelist: { select: { createdAt: true } } },
    orderBy: { pricelist: { createdAt: "desc" } },
  });
  const m = new Map<string, number>();
  for (const r of pp) {
    if (!m.has(r.productId) && r.price != null) m.set(r.productId, Number(r.price));
  }
  return m;
}

export async function GET() {
  const g = await requireAgent();
  if (!g.ok) return g.res;

  const saved = await prisma.agentProductPrice.findMany({
    where: { agentId: g.userId },
    select: { productId: true, price: true, updatedAt: true },
  });
  const savedIds = saved.map((s) => s.productId);

  // ⚠️ אותם מוצרים שמסך ההזמנה מציע לנציג: כל מועדף או לא-פעיל.
  // הם בדרך כלל *מחוץ* למחירון (§169), ולכן לא מסננים לפי מכירה.
  const products = await prisma.product.findMany({
    where: { OR: [{ isFavorite: true }, { isActive: false }, { id: { in: savedIds } }] },
    select: { id: true, name: true, unit: true, cartonPrice: true, saleType: true },
    orderBy: { name: "asc" },
  });

  const lp = await listPrices(products.map((p) => p.id));
  const sm = new Map(saved.map((s) => [s.productId, s]));
  return NextResponse.json({
    products: products.map((p) => ({
      id: p.id,
      name: p.name,
      unit: p.unit,
      listPrice: lp.get(p.id) ?? Number(p.cartonPrice),
      savedPrice: sm.has(p.id) ? Number(sm.get(p.id)!.price) : null,
      savedAt: sm.get(p.id)?.updatedAt ?? null,
    })),
  });
}

export async function PUT(req: Request) {
  const g = await requireAgent();
  if (!g.ok) return g.res;
  const b = await req.json().catch(() => ({}));
  const productId = String(b?.productId || "");
  if (!productId) return NextResponse.json({ error: "חסר מוצר" }, { status: 400 });

  const product = await prisma.product.findUnique({
    where: { id: productId },
    select: { id: true, name: true, isFavorite: true, isActive: true, cartonPrice: true },
  });
  if (!product) return NextResponse.json({ error: "מוצר לא נמצא" }, { status: 404 });
  if (!product.isFavorite && product.isActive !== false) {
    return NextResponse.json(
      { error: "מחיר שמור אפשר לקבוע רק למוצר נסתר (מועדף / לא באתר)" },
      { status: 400 }
    );
  }

  if (b.price === null || b.price === "" || b.price === undefined) {
    await prisma.agentProductPrice.deleteMany({ where: { agentId: g.userId, productId } });
    return NextResponse.json({ ok: true, savedPrice: null });
  }

  const n = Math.round(Number(b.price) * 100) / 100;
  const list = (await listPrices([productId])).get(productId) ?? Number(product.cartonPrice);
  const v = validateAgentPrice(n, list);
  if (!v.ok) return NextResponse.json({ error: v.error }, { status: 400 });

  await prisma.agentProductPrice.upsert({
    where: { agentId_productId: { agentId: g.userId, productId } },
    create: { agentId: g.userId, productId, price: n },
    update: { price: n },
  });
  return NextResponse.json({ ok: true, savedPrice: n });
}
