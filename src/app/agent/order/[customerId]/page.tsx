import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { OrderFlow } from "@/app/order/OrderFlow";

export const dynamic = "force-dynamic";

export default async function AgentOrderPage({
  params,
}: {
  params: Promise<{ customerId: string }>;
}) {
  const { customerId } = await params;
  const session = await auth();
  if (!session?.user) redirect("/login?callbackUrl=/agent");

  const role = (session.user as any).role;
  if (role !== "AGENT" && role !== "ADMIN") redirect("/account");

  const sessionUserId = (session.user as any).id as string;

  // הלקוח שעבורו מזמינים
  const targetCustomer = await prisma.customer.findUnique({
    where: { id: customerId },
    include: { defaultPoint: true },
  });
  if (!targetCustomer || targetCustomer.role !== "CUSTOMER") {
    redirect("/agent");
  }

  // אימות הרשאת נציג מוגבל-נקודה:
  // הנציג רשאי להזמין רק עבור:
  // 1. לקוח שהנציג עצמו יצר (createdByAgentId === agentId)
  // 2. לקוח שהנקודה שלו זהה לנקודת הנציג
  // 3. לקוח שיש לו לפחות הזמנה אחת בנקודת הנציג
  if (role === "AGENT") {
    const agent = await prisma.customer.findUnique({
      where: { id: sessionUserId },
      select: { agentPointId: true },
    });
    if (agent?.agentPointId) {
      const isCreator = targetCustomer.createdByAgentId === sessionUserId;
      const samePoint = targetCustomer.defaultPointId === agent.agentPointId;
      const hasOrderAtPoint = !isCreator && !samePoint &&
        (await prisma.order.count({
          where: { customerId: targetCustomer.id, pointId: agent.agentPointId },
        })) > 0;
      if (!isCreator && !samePoint && !hasOrderAtPoint) redirect("/agent");
    }
  }

  const pricelist = await prisma.pricelist.findFirst({
    where: { status: "ACTIVE" },
    orderBy: { createdAt: "desc" },
    include: {
      points: { include: { point: true } },
      products: {
        include: {
          product: {
            include: {
              category: true,
              kashrutRef: true,
            },
          },
        },
      },
    },
  });

  const now = new Date();
  const closed = pricelist?.closeDate != null && now > new Date(pricelist.closeDate);
  const notYetOpen = pricelist?.openDate != null && now < new Date(pricelist.openDate);

  if (!pricelist || closed || notYetOpen) {
    return (
      <main
        dir="rtl"
        className="min-h-screen bg-brand-yellow flex items-center justify-center p-6"
      >
        <div className="bg-white rounded-2xl shadow-lg p-8 text-center max-w-sm">
          <div className="text-4xl mb-3">😴</div>
          <p className="text-lg font-bold text-brand-slatedark">
            אין כרגע מכירה פעילה
          </p>
          <p className="text-xs text-zinc-500 mt-1">
            {closed
              ? "המכירה נסגרה. הזמנות ייפתחו במכירה הבאה."
              : notYetOpen
              ? "המכירה עוד לא נפתחה."
              : "לא מוגדרת מכירה פעילה במערכת."}
          </p>
          <Link
            href="/agent"
            className="inline-block mt-5 px-6 py-2.5 bg-brand-rust text-white rounded-xl font-bold hover:bg-[#a83a15]"
          >
            ← חזרה לאזור הנציג
          </Link>
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
      customDeliveryDateText: p.customDeliveryDateText,
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
      singlesMode: pp.product.singlesMode || "KG",
      singleUnitPrice:
        pp.product.singleUnitPrice != null
          ? Number(pp.product.singleUnitPrice)
          : null,
      unit: pp.product.unit,
      saleType: pp.product.saleType,
      priceType: pp.product.priceType,
      avgWeightPerUnit:
        pp.product.avgWeightPerUnit != null
          ? Number(pp.product.avgWeightPerUnit)
          : null,
      imageUrl: pp.product.imageUrl,
      kashrut: pp.product.kashrut,
      kashrutName: pp.product.kashrutRef?.name || null,
      kashrutImageUrl: pp.product.kashrutRef?.imageUrl || null,
      isFeatured: pp.product.isFeatured,
      highlightNote: pp.product.highlightNote,
      packageWeight: pp.product.packageWeight,
      isFrozen: pp.product.isFrozen,
      limitedQty: pp.product.limitedQty,
      sortOrder: pp.product.sortOrder,
    }))
    .sort(
      (a, b) => a.categorySort - b.categorySort || a.sortOrder - b.sortOrder
    );

  // האם יש לו כבר כרטיס?
  // - יש token → cardVerified=true → מדלגים על אימות
  // - אין token → cardVerified=false → הflow יבקש להזין כרטיס (הנציג יעביר את המכשיר ללקוח)
  const hasPaymentToken = !!targetCustomer.paymentToken;

  return (
    <div dir="rtl">
      {/* ═════ באנר עליון - הזמנה בשם לקוח ═════ */}
      <div className="bg-gradient-to-l from-brand-slatedark to-zinc-800 text-white sticky top-0 z-50 shadow-lg">
        <div className="mx-auto max-w-6xl px-4 py-3">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-10 h-10 rounded-full bg-brand-yellow text-brand-slatedark flex items-center justify-center font-extrabold text-lg shrink-0">
                {targetCustomer.name.charAt(0)}
              </div>
              <div className="min-w-0">
                <div className="text-[10px] uppercase tracking-wider text-white/60 font-bold">
                  הזמנה בשם לקוח
                </div>
                <div className="font-extrabold truncate flex items-center gap-2">
                  {targetCustomer.name}
                  {!targetCustomer.isActivated && (
                    <span className="text-[10px] bg-amber-400 text-amber-950 px-1.5 py-0.5 rounded font-bold">
                      לא הופעל
                    </span>
                  )}
                  {hasPaymentToken && (
                    <span className="text-[10px] bg-emerald-400 text-emerald-950 px-1.5 py-0.5 rounded font-bold">
                      💳 יש כרטיס
                    </span>
                  )}
                </div>
                {targetCustomer.phone && (
                  <div className="text-xs text-white/80 font-mono" dir="ltr">
                    {targetCustomer.phone}
                  </div>
                )}
              </div>
            </div>
            <Link
              href="/agent"
              className="shrink-0 text-xs font-bold text-white/80 hover:text-white bg-white/10 hover:bg-white/20 px-3 py-2 rounded-lg transition-colors"
            >
              ← חזרה לנציג
            </Link>
          </div>

          {/* התראת אזהרה אם אין כרטיס */}
          {!hasPaymentToken && (
            <div className="mt-2 text-[11px] bg-amber-500/20 border border-amber-400/40 rounded-lg px-3 py-1.5 text-amber-100">
              💳 <strong>שים לב:</strong> אין ללקוח כרטיס אשראי במערכת. בסוף ההזמנה
              תתבקש להעביר את המכשיר ללקוח לאימות כרטיס (חיוב 1 ש"ח).
            </div>
          )}
        </div>
      </div>

      <OrderFlow
        pricelist={{
          id: pricelist.id,
          name: pricelist.name,
          deliveryDateText: pricelist.deliveryDateText,
          closeDateText: pricelist.closeDate
            ? new Date(pricelist.closeDate).toLocaleDateString("he-IL", {
                day: "numeric",
                month: "long",
                hour: "2-digit",
                minute: "2-digit",
              })
            : null,
          notes: pricelist.notes,
          singleSurcharge: Number(pricelist.singleSurcharge),
        }}
        points={points}
        products={products}
        customer={{
          name: targetCustomer.name,
          phone: targetCustomer.phone,
          email: targetCustomer.email,
          defaultPointId: targetCustomer.defaultPointId,
        }}
        customerId={targetCustomer.id}
        onBehalfOfCustomerId={targetCustomer.id}
        cardVerified={hasPaymentToken}
        hasSeenOrderIntro={true}
      />
    </div>
  );
}
