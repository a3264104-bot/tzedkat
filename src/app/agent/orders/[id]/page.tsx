import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { fmt, STATUS_LABELS } from "@/lib/pricing";
import { formatItemQty, orderItemBadge } from "@/lib/order-display";
import { payStatusLabel } from "@/lib/pay-status-lib";
import AgentChargeButton from "./AgentChargeButton";
import { AgentAddItemPanel } from "./AgentAddItemPanel";
import { AgentCashPanel } from "./AgentCashPanel";

export const dynamic = "force-dynamic";

// מסך פרטי הזמנה לנציג - צפייה + חיוב (אם יש הרשאה)
// נתיב: /agent/orders/[id]
export default async function AgentOrderDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await auth();
  if (!session?.user) redirect("/login?callbackUrl=/agent");

  const role = (session.user as any).role;
  if (role !== "AGENT" && role !== "ADMIN") redirect("/account");
  const sessionUserId = (session.user as any).id as string;

  const order = await prisma.order.findUnique({
    where: { id },
    include: {
      items: true,
      customer: {
        select: {
          id: true,
          name: true,
          phone: true,
          email: true,
          paymentToken: true,
          cardLast4: true,
          cardExpiry: true,
          cardNeedsUpdate: true,
          createdByAgentId: true,
        },
      },
      point: { select: { id: true, name: true, city: true } },
    },
  });

  if (!order) {
    return (
      <main dir="rtl" className="min-h-screen bg-brand-cream flex items-center justify-center p-6">
        <div className="bg-white rounded-2xl shadow-lg p-8 text-center max-w-sm">
          <p className="text-lg font-bold text-brand-slatedark">הזמנה לא נמצאה</p>
          <Link href="/agent" className="inline-block mt-5 px-6 py-2.5 bg-brand-rust text-white rounded-xl font-bold">
            ← חזרה לאזור הנציג
          </Link>
        </div>
      </main>
    );
  }

  // הרשאת צפייה + חיוב לנציג (מוגבל-נקודה)
  let canCharge = role === "ADMIN";
  if (role === "AGENT") {
    const agent = await prisma.customer.findUnique({
      where: { id: sessionUserId },
      select: {
        agentCanCharge: true,
        agentPointId: true, // deprecated - תאימות אחורה
        agentPoints: { select: { pointId: true } },
      },
    });
    // §70: 🐛 תוקן דפוס ג'. הבדיקה השוותה רק ל-agentPointId הישן,
    // והתנאי `&& agent?.agentPointId` גרם לכך שנציג רב-נקודתי
    // (agentPoints[] מלא, agentPointId ריק) **דילג על החסימה כולה**
    // וראה כל הזמנה במערכת, כולל פרטי כרטיס ואפשרות חיוב.
    const myPoints = new Set(agent?.agentPoints.map((ap) => ap.pointId) ?? []);
    if (agent?.agentPointId) myPoints.add(agent.agentPointId);

    const isCreator = order.customer.createdByAgentId === sessionUserId;
    const samePoint = myPoints.has(order.pointId);
    // נציג בלי נקודות כלל נחסם - לא "עובר בלי בדיקה" כמו קודם
    if (!isCreator && !samePoint) {
      redirect("/agent");
    }
    canCharge = !!agent?.agentCanCharge && (isCreator || samePoint);
  }

  // §70: מוצרי המכירה, להוספת פריט מהמסך הזה.
  // רק המכירה שההזמנה שייכת אליה, ורק כשטרם נקבע מחיר סופי.
  const canAddItems = order.finalTotal == null && !!order.pricelistId;
  const salePricelist = canAddItems
    ? await prisma.pricelist.findUnique({
        where: { id: order.pricelistId! },
        select: { id: true, status: true, singleSurcharge: true },
      })
    : null;
  const addableProducts =
    salePricelist && salePricelist.status === "ACTIVE"
      ? await prisma.pricelistProduct.findMany({
          where: { pricelistId: salePricelist.id },
          include: {
            product: {
              select: {
                id: true,
                name: true,
                unit: true,
                cartonPrice: true,
                priceType: true,
                allowSingles: true,
                singlesMode: true,
                singleUnitPrice: true,
                avgWeightPerUnit: true,
                // §7: מוצרים לא-פעילים ("מועדפים") נכללים ומסומנים
                isActive: true,
                category: { select: { name: true } },
              },
            },
          },
        })
      : [];

  const hasToken = !!order.customer.paymentToken;
  const finalTotal = order.finalTotal != null ? Number(order.finalTotal) : null;
  const estimatedTotal = Number(order.estimatedTotal);
  const canChargeThisOrder =
    canCharge &&
    hasToken &&
    !order.customer.cardNeedsUpdate &&
    finalTotal !== null &&
    order.paymentStatus !== "PAID" &&
    order.paymentStatus !== "CHARGING";

  return (
    <main dir="rtl" className="min-h-screen bg-brand-cream pb-16">
      <div className="bg-gradient-to-l from-brand-slatedark to-zinc-800 text-white sticky top-0 z-30 shadow-lg">
        <div className="mx-auto max-w-2xl px-4 py-3 flex items-center justify-between">
          <div>
            <div className="text-[10px] uppercase tracking-wider text-white/60 font-bold">
              פרטי הזמנה
            </div>
            <div className="font-extrabold text-lg">#{order.orderNumber}</div>
          </div>
          <Link
            href="/agent"
            className="text-xs font-bold text-white/80 hover:text-white bg-white/10 hover:bg-white/20 px-3 py-2 rounded-lg transition-colors"
          >
            ← חזרה
          </Link>
        </div>
      </div>

      <div className="mx-auto max-w-2xl px-4 pt-4 space-y-4">
        {/* לקוח + סטטוס */}
        <div className="bg-white rounded-2xl border border-zinc-200 shadow-sm p-4">
          <div className="flex items-center justify-between gap-2 flex-wrap mb-3">
            <div>
              <div className="font-extrabold text-brand-slatedark">{order.customerName}</div>
              <div className="text-xs text-zinc-500" dir="ltr">{order.phone}</div>
            </div>
            <span className="px-2.5 py-1 rounded-full text-xs font-medium bg-zinc-100 text-zinc-700">
              {STATUS_LABELS[order.status] ?? order.status}
            </span>
          </div>
          {order.point && (
            <div className="text-xs text-zinc-600">
              📍 {order.point.name}{order.point.city ? ` — ${order.point.city}` : ""}
            </div>
          )}
        </div>

        {/* פריטים */}
        <div className="bg-white rounded-2xl border border-zinc-200 shadow-sm overflow-hidden">
          <div className="bg-zinc-50 border-b border-zinc-200 px-4 py-2.5 font-bold text-sm text-brand-slatedark">
            📦 פריטים ({order.items.length})
          </div>
          <div className="divide-y divide-zinc-100">
            {order.items.map((it) => {
              const displayItem = { isSingle: it.isSingle, quantity: Number(it.quantity), unit: it.unit };
              return (
              <div key={it.id} className="p-3 flex items-center justify-between gap-2 text-sm">
                <div>
                  <div className="font-medium text-brand-slatedark">
                    {it.productName}
                    <span className="text-[10px] mr-2 px-1.5 py-0.5 rounded bg-amber-100 text-amber-700">
                      {orderItemBadge(displayItem)}
                    </span>
                  </div>
                  <div className="text-xs text-zinc-500">{formatItemQty(displayItem)}</div>
                </div>
                <div className="text-left">
                  {it.finalPrice != null ? (
                    <div className="font-bold text-emerald-700">{fmt(Number(it.finalPrice))}</div>
                  ) : (
                    <div className="text-zinc-500">~{fmt(Number(it.estimatedPrice))}</div>
                  )}
                </div>
              </div>
              );
            })}
          </div>
          <div className="bg-brand-cream/50 border-t border-zinc-200 px-4 py-3 flex justify-between items-center">
            <span className="text-sm font-bold text-brand-slatedark">
              {finalTotal !== null ? "סה\"כ סופי" : "סה\"כ משוער"}
            </span>
            <span className="text-lg font-extrabold text-brand-rust">
              {fmt(finalTotal ?? estimatedTotal)}
            </span>
          </div>
        </div>

        {/* §70: הוספת מוצר להזמנה - עם בורר בודדים/קרטון וכמות,
            בדיוק כמו באתר. מוצג רק במכירה פעילה ולפני קביעת מחיר
            סופי - אותן חסימות שיש ב-API. */}
        {addableProducts.length > 0 && (
          <AgentAddItemPanel
            orderId={order.id}
            singleSurcharge={Number(salePricelist?.singleSurcharge ?? 0)}
            products={addableProducts.map((pp) => ({
              id: pp.product.id,
              name: pp.product.name,
              unit: pp.product.unit,
              cartonPrice: Number(pp.price ?? pp.product.cartonPrice),
              priceType: pp.product.priceType,
              allowSingles: pp.product.allowSingles,
              singlesMode: pp.product.singlesMode,
              singleUnitPrice:
                pp.product.singleUnitPrice != null
                  ? Number(pp.product.singleUnitPrice)
                  : null,
              avgWeightPerUnit:
                pp.product.avgWeightPerUnit != null
                  ? Number(pp.product.avgWeightPerUnit)
                  : null,
              isActive: pp.product.isActive,
              categoryName: pp.product.category?.name ?? null,
            }))}
          />
        )}

        {/* כרטיס אשראי + חיוב */}
        <div className="bg-white rounded-2xl border border-zinc-200 shadow-sm p-4">
          <div className="text-sm font-bold text-brand-slatedark mb-2">💳 תשלום</div>
          <div className="text-xs text-zinc-600 mb-1">
            סטטוס: <strong>{payStatusLabel(order.paymentStatus)}</strong>
          </div>

          {hasToken ? (
            <div className="text-sm mb-2">
              כרטיס שמור: <strong dir="ltr">****{order.customer.cardLast4 || "----"}</strong>
              {order.customer.cardNeedsUpdate && (
                <span className="mr-2 text-orange-700 text-xs font-bold bg-orange-50 border border-orange-200 rounded px-2 py-0.5">
                  ⚠️ נדרש עדכון כרטיס
                </span>
              )}
            </div>
          ) : (
            <div className="text-sm text-zinc-500 mb-2">אין כרטיס שמור ללקוח</div>
          )}

          {order.lastChargeError && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-2.5 text-xs text-red-800 mb-2">
              <div className="font-medium mb-0.5">שגיאת חיוב אחרונה:</div>
              <div className="font-mono">{order.lastChargeError}</div>
            </div>
          )}

          {/* §91: סימון תשלום מזומן - לכל נציג, לא רק בעל הרשאת חיוב.
              מי שעומד בחלוקה ומקבל את הכסף חייב דרך לסמן, אחרת
              הכרטיס יחויב בערב והלקוח ישלם פעמיים.

              ⚠️ בכוונה **מעל** כפתור החיוב: הנציג שקיבל מזומן צריך
              לפגוש קודם את הפעולה הנכונה. */}
          <div className="mb-3">
            <AgentCashPanel
              orderId={order.id}
              orderNumber={order.orderNumber}
              customerName={order.customerName}
              finalTotal={finalTotal}
              paymentStatus={order.paymentStatus}
            />
          </div>

          {/* כפתור חיוב - רק אם יש הרשאה + תנאים מתקיימים */}
          {canCharge && (
            <AgentChargeButton
              orderId={order.id}
              orderNumber={order.orderNumber}
              customerName={order.customerName}
              amount={finalTotal ?? 0}
              cardLast4={order.customer.cardLast4}
              enabled={canChargeThisOrder}
              disabledReason={
                !hasToken
                  ? "אין כרטיס שמור ללקוח"
                  : order.customer.cardNeedsUpdate
                    ? "הכרטיס דורש עדכון - לא ניתן לחייב"
                    : finalTotal === null
                      ? "יש לקבוע מחיר סופי לפני חיוב"
                      : order.paymentStatus === "PAID"
                        ? "ההזמנה כבר שולמה"
                        : order.paymentStatus === "CHARGING"
                          ? "חיוב כבר בתהליך"
                          : null
              }
            />
          )}
          {!canCharge && role === "AGENT" && (
            <p className="text-xs text-zinc-500 mt-2">
              אין לך הרשאת חיוב להזמנה זו. פנה למנהל.
            </p>
          )}
        </div>
      </div>
    </main>
  );
}
