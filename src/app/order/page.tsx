import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { OrderFlow } from "./OrderFlow";

export const dynamic = "force-dynamic";

export default async function OrderPage() {
  const pricelist = await prisma.pricelist.findFirst({
    where: { status: "ACTIVE" },
    orderBy: { createdAt: "desc" },
    include: {
      points: { include: { point: true } },
      products: {
        include: { product: { include: { category: true } } },
      },
    },
  });

  // מכירה פעילה אך מעבר לשעת הסגירה — סגורה להזמנות
  const closed =
    pricelist?.closeDate != null && new Date() > new Date(pricelist.closeDate);
  const notYetOpen =
    pricelist?.openDate != null && new Date() < new Date(pricelist.openDate);

  if (!pricelist || closed || notYetOpen) {
    const msg = closed
      ? "מועד ההרשמה למכירה הסתיים"
      : notYetOpen
        ? "ההרשמה למכירה טרם נפתחה"
        : "כרגע אין מכירה פעילה";
    return (
      <main className="min-h-screen bg-brand-yellow flex items-center justify-center p-6">
        <div className="card p-8 text-center max-w-sm">
          <p className="text-lg font-bold text-brand-slatedark">{msg}</p>
          <Link href="/" className="btn-ghost mt-4">חזרה</Link>
        </div>
      </main>
    );
  }

  const points = pricelist.points
    .map((pp) => pp.point)
    .filter((p) => p.isActive)
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((p) => ({
      id: p.id,
      name: p.name,
      city: p.city,
      address: p.address,
      contactName: p.contactName,
      phone: p.phone,
      email: p.email,
      deliveryHours: p.deliveryHours,
      notes: p.notes,
    }));

  const products = pricelist.products
    .filter((pp) => pp.product.isActive)
    .map((pp) => ({
      id: pp.product.id,
      name: pp.product.name,
      category: pp.product.category.name,
      categorySort: pp.product.category.sortOrder,
      price: Number(pp.price ?? pp.product.cartonPrice),
      allowSingles: pp.product.allowSingles,
      unit: pp.product.unit,
      saleType: pp.product.saleType,
      packageWeight: pp.product.packageWeight,
      isFrozen: pp.product.isFrozen,
      limitedQty: pp.product.limitedQty,
      sortOrder: pp.product.sortOrder,
    }))
    .sort((a, b) => a.categorySort - b.categorySort || a.sortOrder - b.sortOrder);

  return (
    <OrderFlow
      pricelist={{
        id: pricelist.id,
        name: pricelist.name,
        deliveryDateText: pricelist.deliveryDateText,
        notes: pricelist.notes,
        singleSurcharge: Number(pricelist.singleSurcharge),
      }}
      points={points}
      products={products}
    />
  );
}
