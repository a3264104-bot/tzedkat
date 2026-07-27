// עמוד הצלחת הזמנה עצמאי - עמיד ל-refresh, ניתן לשיתוף
// /order/success/[orderId]
//
// לפני העדכון: מסך הצלחה חי רק ב-state של OrderFlow.
// אחרי refresh - המשתמש מאבד את המסך. עכשיו יש URL קבוע.

import { redirect } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import SuccessAnimation from "./SuccessAnimation";
import WhatsappShareButton from "./WhatsappShareButton";

export const dynamic = "force-dynamic";

// דוגמת פורמט תאריך עברי
function fmtDate(d: Date | string | null): string {
  if (!d) return "";
  try {
    return new Date(d).toLocaleDateString("he-IL", {
      weekday: "long",
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    });
  } catch {
    return "";
  }
}

export default async function OrderSuccessPage({
  params,
}: {
  params: Promise<{ orderId: string }>;
}) {
  const { orderId } = await params;

  const session = await auth();
  if (!session?.user) {
    redirect(`/login?callbackUrl=/order/success/${orderId}`);
  }

  const userId = (session.user as any).id as string;
  const role = (session.user as any).role;

  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: {
      point: {
        select: {
          name: true,
          city: true,
          address: true,
          deliveryHours: true,
        },
      },
      pricelist: {
        select: {
          name: true,
          deliveryDate: true,
          deliveryDateText: true,
          editDeadline: true,
        },
      },
      items: {
        include: {
          product: { select: { imageUrl: true } },
        },
      },
    },
  });

  if (!order) {
    return (
      <main
        dir="rtl"
        className="min-h-screen bg-brand-cream flex items-center justify-center p-6"
      >
        <div className="bg-white rounded-2xl shadow-lg p-8 text-center max-w-sm">
          <div className="text-5xl mb-3">🔍</div>
          <p className="text-lg font-bold text-brand-slatedark">
            הזמנה לא נמצאה
          </p>
          <Link
            href="/"
            className="inline-block mt-5 px-6 py-2.5 bg-brand-rust text-white rounded-xl font-bold"
          >
            לדף הבית
          </Link>
        </div>
      </main>
    );
  }

  // הגנת אבטחה: רק בעל ההזמנה, מנהל, או הנציג שביצע יכולים לראות
  const isOwner = order.customerId === userId;
  const isAdmin = role === "ADMIN";
  const isAgent = role === "AGENT";
  if (!isOwner && !isAdmin && !isAgent) {
    redirect("/");
  }

  const activeItems = order.items.filter((it) => !it.isCancelled);
  const itemsCount = activeItems.length;
  const cartonsCount = activeItems.filter((it) => !it.isSingle).length;
  const singlesCount = activeItems.filter((it) => it.isSingle).length;

  const finalTotal = order.finalTotal ? Number(order.finalTotal) : null;
  const estimatedTotal = Number(order.estimatedTotal);
  const displayTotal = finalTotal ?? estimatedTotal;

  const canEdit =
    order.pricelist?.editDeadline &&
    new Date() < new Date(order.pricelist.editDeadline);

  return (
    <main dir="rtl" className="min-h-screen bg-brand-cream pb-20">
      {/* אנימציית check ירוק - Client Component */}
      <SuccessAnimation />

      <div className="mx-auto max-w-md md:max-w-lg px-4 pt-8">
        {/* כותרת ראשית */}
        <div className="text-center mb-6">
          <h1 className="text-2xl md:text-3xl font-extrabold text-brand-slatedark">
            ההזמנה התקבלה בהצלחה!
          </h1>
          <p className="text-brand-slate mt-2 text-sm">
            נעים לראותך במכירה של{" "}
            <span className="font-bold">{order.pricelist?.name}</span>
          </p>
        </div>

        {/* כרטיס פרטי הזמנה */}
        <div className="bg-white rounded-2xl shadow-lg border border-emerald-200 overflow-hidden mb-4">
          {/* Header ירוק */}
          <div className="bg-gradient-to-l from-emerald-500 to-emerald-600 text-white px-5 py-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-xs opacity-80 font-bold">מספר הזמנה</div>
                <div className="text-3xl font-extrabold">#{order.orderNumber}</div>
              </div>
              <div className="text-left">
                <div className="text-xs opacity-80 font-bold">סכום משוער</div>
                <div className="text-2xl font-extrabold">
                  ₪{displayTotal.toFixed(2)}
                </div>
              </div>
            </div>
          </div>

          {/* פרטים */}
          <div className="p-5 space-y-3 text-sm">
            {/* פריטים */}
            <div className="flex items-start gap-3">
              <div className="text-xl">📦</div>
              <div className="flex-1">
                <div className="font-bold text-brand-slatedark">
                  {itemsCount} פריטים
                </div>
                <div className="text-xs text-zinc-500">
                  {cartonsCount > 0 && `${cartonsCount} קרטונים`}
                  {cartonsCount > 0 && singlesCount > 0 && " · "}
                  {singlesCount > 0 && `${singlesCount} בודדים`}
                </div>
              </div>
            </div>

            {/* נקודה */}
            {order.point && (
              <div className="flex items-start gap-3">
                <div className="text-xl">📍</div>
                <div className="flex-1">
                  <div className="font-bold text-brand-slatedark">
                    {order.point.name}
                  </div>
                  {order.point.city && (
                    <div className="text-xs text-zinc-500">
                      {order.point.city}
                      {order.point.address && ` · ${order.point.address}`}
                    </div>
                  )}
                  {order.point.deliveryHours && (
                    <div className="text-xs text-brand-rust font-bold mt-0.5">
                      🕐 {order.point.deliveryHours}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* תאריך חלוקה */}
            {order.pricelist?.deliveryDate && (
              <div className="flex items-start gap-3">
                <div className="text-xl">📅</div>
                <div className="flex-1">
                  <div className="text-xs text-zinc-500 font-bold">
                    תאריך חלוקה
                  </div>
                  <div className="font-bold text-brand-slatedark">
                    {order.pricelist.deliveryDateText ||
                      fmtDate(order.pricelist.deliveryDate)}
                  </div>
                </div>
              </div>
            )}

            {/* לקוח */}
            <div className="flex items-start gap-3">
              <div className="text-xl">👤</div>
              <div className="flex-1">
                <div className="font-bold text-brand-slatedark">
                  {order.customerName}
                </div>
                <div className="text-xs text-zinc-500" dir="ltr">
                  {order.phone}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* הודעה על מייל / וואטסאפ */}
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 mb-4 flex items-start gap-3">
          <div className="text-xl">📧</div>
          <div className="text-xs text-blue-900 flex-1">
            <div className="font-bold mb-0.5">מה קורה עכשיו?</div>
            <div>
              נשלח לך אישור למייל עם פרטי ההזמנה. יום לפני החלוקה תקבל תזכורת
              עם כתובת מדויקת של הנקודה.
            </div>
          </div>
        </div>

        {/* פעולות */}
        <div className="space-y-2">
          <WhatsappShareButton
            orderNumber={order.orderNumber}
            total={displayTotal}
            deliveryText={
              order.pricelist?.deliveryDateText ||
              (order.pricelist?.deliveryDate
                ? fmtDate(order.pricelist.deliveryDate)
                : "")
            }
            pointName={order.point?.name || ""}
          />

          {isOwner && (
            <Link
              href="/account"
              className="block w-full py-3 rounded-xl border-2 border-brand-rust text-brand-rust text-center font-bold hover:bg-brand-rust hover:text-white transition-colors"
            >
              👤 לאזור האישי
            </Link>
          )}

          {canEdit && isOwner && (
            <Link
              href={`/order?editOrderId=${order.id}`}
              className="block w-full py-3 rounded-xl bg-white border border-zinc-300 text-brand-slatedark text-center font-bold hover:bg-zinc-50 transition-colors"
            >
              ✏️ עריכת ההזמנה
            </Link>
          )}

          <Link
            href="/"
            className="block w-full py-2.5 text-brand-slate text-center text-sm hover:text-brand-rust transition-colors"
          >
            ← לדף הבית
          </Link>
        </div>

        {/* Empty space - נראה טוב במובייל */}
        <div className="h-8"></div>
      </div>
    </main>
  );
}
