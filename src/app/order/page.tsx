import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { OrderFlow } from "./OrderFlow";

export const dynamic = "force-dynamic";

export default async function OrderPage() {
  // התחברות נדרשת לפני כל דבר אחר - אין יותר הזמנת אורח.
  // אם אין session, מפנים ל-login עם callbackUrl כדי שהלקוח יחזור לכאן בדיוק אחרי שהתחבר/נרשם.
  const session = await auth();
  if (!session?.user) {
    redirect("/login?callbackUrl=/order");
  }

  // session.user.id מגיע מה-jwt/session callbacks ב-auth.ts (מוסיפים אותו שם ל-token)
  const customerId = (session.user as any).id as string;
  const customerRecord = await prisma.customer.findUnique({ where: { id: customerId } });
  if (!customerRecord) {
    // מצב קצה: יש session תקין אבל הלקוח נמחק מהמסד בינתיים - מחזירים להתחברות מחדש
    redirect("/login?callbackUrl=/order");
  }

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

  // מכירה פעילה אך מעבר לשעת הסגירה - סגורה להזמנות
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
      priceType: pp.product.priceType,
      avgWeightPerUnit: pp.product.avgWeightPerUnit != null ? Number(pp.product.avgWeightPerUnit) : null,
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
      customer={{
        name: customerRecord.name,
        phone: customerRecord.phone,
        email: customerRecord.email,
        defaultPointId: customerRecord.defaultPointId,
      }}
    />
  );
}
