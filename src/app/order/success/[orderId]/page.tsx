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
import OrderHeader from "./OrderHeader";
import WhatsappShareButton from "./WhatsappShareButton";
import { CustomerOrderActions } from "@/components/CustomerOrderActions";

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
          closeDate: true,
        },
      },
      items: {
        include: {
          product: {
            select: {
              imageUrl: true,
              kashrutRef: { select: { name: true, imageUrl: true } },
            },
          },
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

  // רשימת נקודות פעילות - לתפריט בחירת נקודה בעריכה (CustomerOrderActions)
  const points = await prisma.deliveryPoint.findMany({
    where: { isActive: true },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    select: { id: true, name: true, city: true },
  });

  const activeItems = order.items.filter((it) => !it.isCancelled);
  const itemsCount = activeItems.length;
  const cartonsCount = activeItems.filter((it) => !it.isSingle).length;
  const singlesCount = activeItems.filter((it) => it.isSingle).length;

  const finalTotal = order.finalTotal ? Number(order.finalTotal) : null;
  const estimatedTotal = Number(order.estimatedTotal);
  const displayTotal = finalTotal ?? estimatedTotal;

  // ניתן לערוך/לבטל רק אם: לא בוטל/הושלם, טרם נשקל (finalTotal=null), ובתוך המועד
  const deadline = order.pricelist?.editDeadline || order.pricelist?.closeDate;
  const withinDeadline = !deadline || new Date() < new Date(deadline);
  const canEdit =
    order.status !== "CANCELLED" &&
    order.status !== "COMPLETED" &&
    finalTotal === null &&
    withinDeadline;

  return (
    <main dir="rtl" className="min-h-screen bg-brand-cream pb-20">
      {/* אנימציית check ירוק - Client Component */}
      <SuccessAnimation />

      <div className="mx-auto max-w-md md:max-w-lg px-4 pt-8">
        {/* כותרת ראשית - דינמית: "הזמנה חדשה" או "צפייה בהזמנה" */}
        <OrderHeader
          orderNumber={order.orderNumber}
          pricelistName={order.pricelist?.name ?? null}
        />

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

        {/* ═════ פירוט פריטים ═════ */}
        <div className="bg-white rounded-2xl shadow-lg border border-zinc-200 overflow-hidden mb-4">
          <div className="bg-zinc-50 border-b border-zinc-200 px-5 py-3 flex items-center justify-between">
            <h3 className="font-extrabold text-brand-slatedark">
              📦 פירוט ההזמנה
            </h3>
            <span className="text-xs bg-brand-rust text-white px-2.5 py-1 rounded-full font-bold">
              {itemsCount} פריטים
            </span>
          </div>

          <div className="divide-y divide-zinc-100">
            {activeItems.map((item) => {
              const isCarton = !item.isSingle;
              const finalWeight = item.finalWeight
                ? Number(item.finalWeight)
                : item.actualWeight
                ? Number(item.actualWeight)
                : null;
              const itemFinalPrice = item.finalPrice
                ? Number(item.finalPrice)
                : null;
              const estWeight = item.estimatedWeight
                ? Number(item.estimatedWeight)
                : null;
              const unitPrice = Number(item.unitPrice);
              const qty = Number(item.quantity);
              const estPrice = Number(item.estimatedPrice);

              return (
                <div key={item.id} className="p-4">
                  <div className="flex items-start gap-3">
                    {/* תמונה */}
                    {item.product?.imageUrl && (
                      <div className="w-14 h-14 shrink-0 rounded-lg bg-zinc-50 overflow-hidden">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={item.product.imageUrl}
                          alt={item.productName}
                          className="w-full h-full object-cover"
                        />
                      </div>
                    )}

                    <div className="flex-1 min-w-0">
                      {/* שם + הכשר */}
                      <div className="flex items-start justify-between gap-2 flex-wrap">
                        <div className="flex items-center gap-2 flex-wrap min-w-0">
                          <span className="font-bold text-brand-slatedark">
                            {item.productName}
                          </span>
                          {isCarton ? (
                            <span className="text-[10px] bg-orange-100 text-orange-700 px-1.5 py-0.5 rounded font-bold">
                              קרטון
                            </span>
                          ) : (
                            <span className="text-[10px] bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded font-bold">
                              בודדים
                            </span>
                          )}
                          {item.product?.kashrutRef?.imageUrl && (
                            <span className="inline-flex items-center gap-1 text-[10px] bg-sky-50 border border-sky-200 rounded px-1 py-0.5">
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img
                                src={item.product.kashrutRef.imageUrl}
                                alt={item.product.kashrutRef.name}
                                className="w-3 h-3 object-contain"
                              />
                              <span className="text-sky-800 font-bold">
                                {item.product.kashrutRef.name}
                              </span>
                            </span>
                          )}
                        </div>
                      </div>

                      {/* כמות + משקל + מחיר */}
                      <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                        {/* הוזמן */}
                        <div>
                          <span className="text-zinc-500">הוזמן: </span>
                          <span className="font-bold text-brand-slatedark">
                            {isCarton
                              ? `${qty} קרטון${qty > 1 ? "ים" : ""}`
                              : `${qty} ק"ג`}
                          </span>
                        </div>

                        {/* מחיר יחידה */}
                        <div>
                          <span className="text-zinc-500">מחיר: </span>
                          <span className="font-bold text-brand-slatedark">
                            ₪{unitPrice.toFixed(2)}
                            <span className="font-normal text-zinc-500">
                              {" "}
                              / ק"ג
                            </span>
                          </span>
                        </div>

                        {/* משקל סופי (אם קיים) או משוער */}
                        {finalWeight ? (
                          <div className="col-span-2 bg-emerald-50 border border-emerald-200 rounded-md px-2 py-1 mt-1">
                            <div className="flex items-center justify-between">
                              <span className="text-[10px] text-emerald-700 font-bold">
                                ✓ משקל סופי לחיוב
                              </span>
                              <span className="font-extrabold text-emerald-800">
                                {finalWeight.toFixed(2)} ק"ג
                              </span>
                            </div>
                            {itemFinalPrice && (
                              <div className="flex items-center justify-between mt-0.5">
                                <span className="text-[10px] text-emerald-700 font-bold">
                                  מחיר סופי
                                </span>
                                <span className="font-extrabold text-emerald-800">
                                  ₪{itemFinalPrice.toFixed(2)}
                                </span>
                              </div>
                            )}
                          </div>
                        ) : (
                          <>
                            {estWeight && (
                              <div>
                                <span className="text-zinc-500">
                                  משקל משוער:{" "}
                                </span>
                                <span className="text-brand-slatedark">
                                  {estWeight.toFixed(1)} ק"ג
                                </span>
                              </div>
                            )}
                            <div>
                              <span className="text-zinc-500">
                                מחיר משוער:{" "}
                              </span>
                              <span className="font-bold text-brand-rust">
                                ₪{estPrice.toFixed(2)}
                              </span>
                            </div>
                          </>
                        )}

                        {/* הערת נציג אם יש */}
                        {item.agentNote && (
                          <div className="col-span-2 mt-1 text-[11px] bg-yellow-50 border border-yellow-200 rounded px-2 py-1 text-yellow-900">
                            💬 {item.agentNote}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* סה"כ תחתון */}
          <div className="bg-brand-cream/50 border-t border-zinc-200 px-5 py-3">
            <div className="flex items-center justify-between">
              <span className="text-sm font-bold text-brand-slatedark">
                סה"כ הזמנה
              </span>
              <div className="text-left">
                {finalTotal ? (
                  <>
                    <div className="text-xs text-zinc-500">סופי</div>
                    <div className="text-xl font-extrabold text-emerald-700">
                      ₪{finalTotal.toFixed(2)}
                    </div>
                  </>
                ) : (
                  <>
                    <div className="text-xs text-zinc-500">משוער</div>
                    <div className="text-xl font-extrabold text-brand-rust">
                      ₪{estimatedTotal.toFixed(2)}
                    </div>
                  </>
                )}
              </div>
            </div>
            {!finalTotal && (
              <p className="text-[10px] text-zinc-500 mt-1 text-center">
                💡 המחיר הסופי ייקבע לפי המשקל בפועל שיישקל בזמן החלוקה
              </p>
            )}
          </div>
        </div>

        {/* הודעה על מייל / וואטסאפ */}
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 mb-4 flex items-start gap-3">
          <div className="text-xl">📧</div>
          <div className="text-xs text-blue-900 flex-1">
            <div className="font-bold mb-0.5">מה קורה עכשיו?</div>
            <div>
              נשלח לך אישור למייל עם פרטי ההזמנה. יום לפני החלוקה תקבל תזכורת
              עם שעת החלוקה במיקום שבחרת.
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

          {/* עריכה + ביטול הזמנה - רק לבעל ההזמנה, ורק אם עדיין ניתן */}
          {isOwner && (
            <CustomerOrderActions
              orderId={order.id}
              orderNumber={order.orderNumber}
              isEditable={canEdit}
              editableUntil={
                order.pricelist?.editDeadline
                  ? fmtDate(order.pricelist.editDeadline)
                  : order.pricelist?.closeDate
                    ? fmtDate(order.pricelist.closeDate)
                    : null
              }
              currentValues={{
                customerName: order.customerName,
                phone: order.phone,
                phone2: order.phone2,
                pointId: order.pointId ?? "",
                notes: order.notes,
              }}
              points={points}
            />
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
