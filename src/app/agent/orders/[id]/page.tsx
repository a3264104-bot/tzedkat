import Link from "next/link";
// §333: כפתור חזרה — צעד אחד אחורה
import BackButton from "@/components/BackButton";
// §315: ביטול פריט — רכיב משותף לשלושת המסכים
import CancelItemButton from "@/components/CancelItemButton";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { fmt, STATUS_LABELS } from "@/lib/pricing";
import { formatItemQty, orderItemBadge } from "@/lib/order-display";
import { payStatusLabel } from "@/lib/pay-status-lib";
import AgentChargeButton from "./AgentChargeButton";
import { AgentAddItemPanel } from "./AgentAddItemPanel";
import { AgentCashPanel } from "./AgentCashPanel";
// §123: זיכוי ללקוח
import { CreditPanel } from "@/components/CreditPanel";
// §298: הגדרת תשלומים — פאנל עצמאי, כמו משלוח וזיכוי
import AgentInstallmentsPanel from "./AgentInstallmentsPanel";
// §133: הערת הלקוח ותשובת הנציג
import { OrderNotePanel } from "@/components/OrderNotePanel";
// §134: סימון משלוח
import { DeliveryPanel } from "@/components/DeliveryPanel";
// §187: עריכת פרטי הלקוח מתוך ההזמנה
import { QuickCustomerEdit } from "@/components/QuickCustomerEdit";
// §120: הוספת תוספת להזמנה שכבר תומחרה
import { AddSupplement } from "@/components/AddSupplement";

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
          // §263: חוב מהעבר — משפיע על הסכום שהנציג אומר ללקוח
          debtBalance: true,
          debtNote: true,
          cardLast4: true,
          cardExpiry: true,
          cardNeedsUpdate: true,
          createdByAgentId: true,
          // §187: נדרשים לעריכת פרטי הלקוח מתוך ההזמנה
          paymentPreference: true,
          firstName: true,
          lastName: true,
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
  // §187: הרשאת סימון לקוח כמזומן (§155). מנהל תמיד רשאי.
  let canSetCash = role === "ADMIN";
  if (role === "AGENT") {
    const agent = await prisma.customer.findUnique({
      where: { id: sessionUserId },
      select: {
        agentCanCharge: true,
        // §187: הרשאת מזומן - נשלפת יחד ולא בשאילתה נוספת
        agentCanCreateCashCustomers: true,
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
    canSetCash = !!agent?.agentCanCreateCashCustomers;
  }

  // §70: מוצרי המכירה, להוספת פריט מהמסך הזה.
  // רק המכירה שההזמנה שייכת אליה, ורק כשטרם נקבע מחיר סופי.
  const canAddItems = order.finalTotal == null && !!order.pricelistId;
  // §120: כשההזמנה כבר תומחרה, ההוספה הרגילה חסומה - אבל התוספת
  // עדיין אפשרית (הזמנה נפרדת). לכן המחירון נשלף בשני המקרים.
  const salePricelist = order.pricelistId
    ? await prisma.pricelist.findUnique({
        where: { id: order.pricelistId },
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
                // §7: מוצרים לא-פעילים נכללים ומסומנים
                isActive: true,
                // §119: מוצר מועדף - לנציגים בלבד, עם תמחור עצמי
                isFavorite: true,
                category: { select: { name: true } },
              },
            },
          },
        })
      : [];

  // §176: 🐛 מוצר מיוחד שאינו במחירון לא הופיע כאן כלל.
  //
  // השליפה למעלה היא על pricelistProduct - כלומר רק מה שנוסף
  // למכירה. מוצר לא-פעיל או מועדף שלא נוסף אליה פשוט לא היה
  // קיים במסך ההוספה, בזמן שבמסך ההזמנה החדשה הוא כן (§169).
  //
  // ⚠️ אותו פער בדיוק שתוקן ב-§169, במסלול השני. הנציג שהוסיף
  // פריט להזמנה קיימת לא ראה את מה שראה בהזמנה חדשה.
  const specialOutside =
    salePricelist && salePricelist.status === "ACTIVE"
      ? await prisma.product.findMany({
          where: {
            OR: [{ isFavorite: true }, { isActive: false }],
            NOT: {
              pricelists: { some: { pricelistId: salePricelist.id } },
            },
          },
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
            isActive: true,
            isFavorite: true,
            category: { select: { name: true } },
          },
        })
      : [];

  // §176: רשימה אחת - מהמחירון + המיוחדים שמחוצה לו.
  //
  // ⚠️ מורכבת כאן ולא בכל שימוש: היא מופיעה בשני מקומות במסך
  // (הוספה רגילה ותוספת בחלוקה), ושתי גרסאות היו מתפצלות.
  const allAddable = [
    ...addableProducts.map((pp) => ({
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
      isFavorite: pp.product.isFavorite,
      categoryName: pp.product.category?.name ?? null,
    })),
    // ⚠️ מוצר מחוץ למחירון: אין לו רשומת מחיר, ולכן cartonPrice
    // של המוצר עצמו הוא הבסיס - בדיוק כמו ב-§169.
    ...specialOutside.map((p) => ({
      id: p.id,
      name: p.name,
      unit: p.unit,
      cartonPrice: Number(p.cartonPrice),
      priceType: p.priceType,
      allowSingles: p.allowSingles,
      singlesMode: p.singlesMode,
      singleUnitPrice:
        p.singleUnitPrice != null ? Number(p.singleUnitPrice) : null,
      avgWeightPerUnit:
        p.avgWeightPerUnit != null ? Number(p.avgWeightPerUnit) : null,
      isActive: p.isActive,
      isFavorite: p.isFavorite,
      categoryName: p.category?.name ?? null,
    })),
  ];

  const hasToken = !!order.customer.paymentToken;
  const finalTotal = order.finalTotal != null ? Number(order.finalTotal) : null;

  // §180: 🐛 המשלוח לא הופיע בסה"כ.
  //
  // estimatedTotal הוא הסכום **מרגע ההזמנה** - פריטים + דמי
  // טיפול. משלוח, חיוב נוסף וזיכוי נוספים אחר כך, והם נכנסים
  // ל-finalTotal **רק בשקילה**.
  //
  // כלומר: הנציג סימן משלוח 35 ₪, ראה את השורה בפירוט, אבל
  // הסה"כ נשאר כפי שהיה - והוא לא ידע אם זה נשמר או לא.
  //
  // ⚠️ החישוב כאן לתצוגה בלבד. מקור האמת נשאר finalTotal
  // שנקבע בשקילה, ולכן אין כאן סיכון לסתירה.
  const rawEstimated = Number(order.estimatedTotal);
  const dlv =
    order.deliveryRequested && order.deliveryFee != null
      ? Number(order.deliveryFee)
      : 0;
  const xtra = order.extraCharge != null ? Number(order.extraCharge) : 0;
  const crd = order.creditAmount != null ? Number(order.creditAmount) : 0;
  const bal =
    order.appliedCreditBalance != null ? Number(order.appliedCreditBalance) : 0;

  // §263: 💸 חוב מהעבר — **מגדיל** את הסכום.
  //
  // 🐛 בלי זה הנציג רואה סכום נמוך ממה שייגבה בפועל, ואומר
  // ללקוח מספר שגוי בחלוקה. זו בדיוק השיחה שאי אפשר לתקן
  // אחרי שהיא קרתה.
  //
  // ⚠️ appliedDebt (מה שנגבה בהזמנה) ולא debtBalance (מה
  // שנשאר): אחרי הגבייה היתרה מתאפסת, והסכום צריך להישאר נכון.
  const debt =
    (order as any).appliedDebt != null
      ? Number((order as any).appliedDebt)
      : Number((order.customer as any)?.debtBalance ?? 0);

  // ⚠️ Math.max(0) - אותה רשת ביטחון כמו בשרת. זיכוי גדול
  // מהסכום לא אמור לקרות (הוולידציה חוסמת), אבל תצוגה של מינוס
  // הייתה מבלבלת יותר מ-0.
  const estimatedTotal = Math.max(
    0,
    Math.round((rawEstimated + dlv + xtra + debt - crd - bal) * 100) / 100
  );
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
          {/* §333: 🔙 צעד אחד אחורה.
              
              הנציג מגיע לכאן מטבלת המשקלים, מהכרטיסים, או
              מרשימת הלקוחות — וקישור קשיח החזיר את כולם
              לדף הבית. */}
          <BackButton />
        </div>
      </div>

      <div className="mx-auto max-w-2xl px-4 pt-4 space-y-4">
        {/* לקוח + סטטוס */}
        <div className="bg-white rounded-2xl border border-zinc-200 shadow-sm p-4">
          <div className="flex items-center justify-between gap-2 flex-wrap mb-3">
            {/* §317: 🧑 קישור לכרטיס הלקוח.
                
                הפער: הנציג בטבלה פתח הזמנה, וכשהתברר שהכרטיס
                פג-תוקף - לא הייתה דרך להגיע למסך שבו מעדכנים
                אותו. הוא חיפש את הלקוח מהתחלה, או פנה למנהל.
                
                ⚠️ קישור ולא שכפול: מסך הלקוח כבר קיים ועושה
                הכל (כרטיס, מזומן, חוב, פרטים). */}
            <div>
              <a
                href={`/agent/customer/${order.customerId}`}
                className="font-extrabold text-brand-slatedark hover:text-brand-rust underline decoration-dotted"
              >
                {order.customerName}
              </a>
              <div className="text-xs text-zinc-500" dir="ltr">{order.phone}</div>
              <a
                href={`/agent/customer/${order.customerId}`}
                className="inline-block mt-1 text-[11px] font-bold text-brand-rust"
              >
                💳 עדכון כרטיס ופרטים ←
              </a>
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

          {/* §187: עריכת פרטי הלקוח - **מתוך ההזמנה**.
              
              🐛 השרת כבר אפשר את זה (§181), אבל לא היה כפתור.
              הנציג פגש את הלקוח בחלוקה, גילה שהטלפון שגוי, ולא
              יכול היה לתקן בלי לפנות למנהל.
              
              ⚠️ מעדכן את **הלקוח עצמו** ולא רק את ההזמנה - זה מה
              שהנציג מצפה לו. Order.customerName נשאר snapshot.
              
              ⚠️ canSetCash לפי ההרשאה (§155): נציג בלי הרשאה
              יראה את השדות אבל לא את בורר התשלום, עם הסבר. */}
          <div className="mt-3 pt-3 border-t border-zinc-100">
            <QuickCustomerEdit
              customerId={order.customer.id}
              name={order.customer.name}
              firstName={(order.customer as any).firstName ?? null}
              lastName={(order.customer as any).lastName ?? null}
              phone={order.phone}
              phone2={order.phone2 ?? null}
              paymentPreference={order.customer.paymentPreference ?? "CREDIT"}
              hasCard={hasToken}
              canSetCash={canSetCash}
            />
          </div>
        </div>

        {/* §133: הערת הלקוח - **מעל** הפריטים.
            
            ⚠️ המיקום מכוון: אם הלקוח ביקש משהו, הנציג צריך לראות
            את זה לפני שהוא מתחיל לשקול - לא אחרי שסיים. */}
        <OrderNotePanel
          orderId={order.id}
          note={order.customerNote}
          noteAt={order.customerNoteAt?.toISOString() ?? null}
          reply={order.agentReply}
          replyAt={order.agentReplyAt?.toISOString() ?? null}
          mode="agent"
        />

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
                  <div
                    className={`font-medium ${
                      it.isCancelled
                        ? "line-through text-zinc-400"
                        : "text-brand-slatedark"
                    }`}
                  >
                    {it.productName}
                    <span className="text-[10px] mr-2 px-1.5 py-0.5 rounded bg-amber-100 text-amber-700">
                      {orderItemBadge(displayItem)}
                    </span>
                  </div>
                  <div className="text-xs text-zinc-500">{formatItemQty(displayItem)}</div>
                </div>
                <div className="text-left flex items-center gap-2">
                  <div>
                    {it.finalPrice != null ? (
                      <div className="font-bold text-emerald-700">{fmt(Number(it.finalPrice))}</div>
                    ) : (
                      <div className="text-zinc-500">~{fmt(Number(it.estimatedPrice))}</div>
                    )}
                  </div>
                  {/* §315: 🗑️ ביטול פריט — גם מכאן.
                      
                      הפער: הכפתור היה רק בתצוגת הכרטיסים. נציג
                      שעבד בטבלה ופתח הזמנה - לא מצא דרך לבטל,
                      והיה צריך לחזור אחורה ולהחליף תצוגה.
                      
                      ⚠️ נעול אחרי המייל (§309): הלקוח מחזיק
                      בידו סכום, וביטול פריט משנה אותו. */}
                  <CancelItemButton
                    itemId={it.id}
                    productName={it.productName}
                    isCancelled={it.isCancelled}
                    locked={!!(order as any).weightsLockedAt}
                  />
                </div>
              </div>
              );
            })}
          </div>
          {/* §123/§124: שורות ההנחה - לפני הסה"כ.
              
              ⚠️ בלעדיהן הנציג רואה סכום סופי שאינו מסתדר עם הפריטים,
              ואין לו שום דרך לדעת למה. זו בדיוק השיחה "למה זה פחות?" */}
          {order.extraCharge != null && Number(order.extraCharge) > 0 && (
            <div className="border-t border-zinc-100 px-4 py-2 text-xs">
              <div className="flex justify-between text-orange-700">
                <span>
                  ➕ חיוב נוסף
                  {order.extraChargeReason && (
                    <span className="text-zinc-500"> · {order.extraChargeReason}</span>
                  )}
                </span>
                <span className="font-bold">+{fmt(Number(order.extraCharge))}</span>
              </div>
            </div>
          )}

          {order.deliveryRequested && order.deliveryFee != null && Number(order.deliveryFee) > 0 && (
            <div className="border-t border-zinc-100 px-4 py-2 text-xs">
              <div className="flex justify-between text-violet-700">
                <span>🚚 משלוח</span>
                <span className="font-bold">+{fmt(Number(order.deliveryFee))}</span>
              </div>
            </div>
          )}

          {(order.creditAmount != null || order.appliedCreditBalance != null) && (
            <div className="border-t border-zinc-100 px-4 py-2 space-y-1 text-xs">
              {order.creditAmount != null && (
                <div className="flex justify-between text-emerald-700">
                  <span>
                    ↩️ זיכוי
                    {order.creditReason && (
                      <span className="text-zinc-500"> · {order.creditReason}</span>
                    )}
                  </span>
                  <span className="font-bold">−{fmt(Number(order.creditAmount))}</span>
                </div>
              )}
              {/* §263: חוב מהעבר — אדום, כי הוא מגדיל. */}
              {debt > 0 && (
                <div className="flex justify-between text-sm">
                  <span className="text-red-800 font-bold">
                    חוב קודם
                    {(order.customer as any)?.debtNote && (
                      <span className="block text-[11px] font-normal text-red-700">
                        {(order.customer as any).debtNote}
                      </span>
                    )}
                  </span>
                  <span className="font-bold text-red-800">
                    +₪{debt.toFixed(2)}
                  </span>
                </div>
              )}
              {order.appliedCreditBalance != null && (
                <div className="flex justify-between text-blue-700">
                  <span>יתרת זכות שקוזזה</span>
                  <span className="font-bold">
                    −{fmt(Number(order.appliedCreditBalance))}
                  </span>
                </div>
              )}
            </div>
          )}

          <div className="bg-brand-cream/50 border-t border-zinc-200 px-4 py-3 flex justify-between items-center">
            <span className="text-sm font-bold text-brand-slatedark">
              {finalTotal !== null ? "סה\"כ סופי" : "סה\"כ משוער"}
              {finalTotal === null && (dlv > 0 || xtra > 0 || crd > 0) && (
                <span className="block text-[10px] font-normal text-zinc-500">
                  כולל משלוח, חיובים וזיכויים
                </span>
              )}
              {/* §180: קיצור לאזור השינויים.
                  
                  ⚠️ ליד הסכום ולא בתפריט: זה הרגע שבו הנציג
                  מסתכל על המספר ומחליט שצריך לשנות אותו. */}
              <a
                href="#money-actions"
                className="block text-[10px] font-normal text-brand-rust hover:underline mt-0.5"
              >
                שינוי סכום ← משלוח · זיכוי · חיוב
              </a>
            </span>
            <span className="text-lg font-extrabold text-brand-rust">
              {fmt(finalTotal ?? estimatedTotal)}
            </span>
          </div>
        </div>

        {/* §70: הוספת מוצר להזמנה - עם בורר בודדים/קרטון וכמות,
            בדיוק כמו באתר. מוצג רק במכירה פעילה ולפני קביעת מחיר
            סופי - אותן חסימות שיש ב-API. */}
        {allAddable.length > 0 && (
          <AgentAddItemPanel
            orderId={order.id}
            singleSurcharge={Number(salePricelist?.singleSurcharge ?? 0)}
            products={allAddable}
          />
        )}

        {/* §185: קיצורים לשינויי סכום - **ליד הוספת המוצר**.
            
            🐛 מה שהיה: הנציג הוסיף מוצר, ואז רצה להוסיף גם משלוח
            או חיוב - וזה היה בתחתית המסך, אחרי התשלום. הוא היה
            צריך לגלול, לחפש, ולהבין שזה שם.
            
            ⚠️ קיצורים ולא פאנלים כפולים: הפאנלים עצמם נשארים
            במקום אחד. שני מקומות לאותה פעולה היו מייצרים בדיוק
            את הבלגן שהמנהל ביקש למנוע.
            
            ⚠️ אותם צבעים של הפאנלים עצמם - סגול למשלוח, אדמדם
            לחיוב, ירוק לזיכוי - כדי שיהיה ברור שזה אותו דבר. */}
        {order.finalTotal == null && (
          <div className="mt-2 grid grid-cols-3 gap-2">
            <a
              href="#money-actions"
              className="flex flex-col items-center gap-0.5 py-2.5 rounded-xl border-2 border-violet-300 bg-violet-50 hover:bg-violet-100 transition-colors"
            >
              <span className="text-lg leading-none">🚚</span>
              <span className="text-[11px] font-bold text-violet-900">
                {order.deliveryRequested ? "ערוך משלוח" : "משלוח"}
              </span>
            </a>
            <a
              href="#money-actions"
              className="flex flex-col items-center gap-0.5 py-2.5 rounded-xl border-2 border-orange-300 bg-orange-50 hover:bg-orange-100 transition-colors"
            >
              <span className="text-lg leading-none">➕</span>
              <span className="text-[11px] font-bold text-orange-900">
                חיוב נוסף
              </span>
            </a>
            <a
              href="#money-actions"
              className="flex flex-col items-center gap-0.5 py-2.5 rounded-xl border-2 border-emerald-300 bg-emerald-50 hover:bg-emerald-100 transition-colors"
            >
              <span className="text-lg leading-none">↩️</span>
              <span className="text-[11px] font-bold text-emerald-900">זיכוי</span>
            </a>
          </div>
        )}

        {/* §120: תוספת בחלוקה - כשההזמנה כבר תומחרה.
            
            ⚠️ מוצג **רק** כשההוספה הרגילה חסומה, כדי שלא יהיו
            שתי דרכים להוסיף פריט באותו רגע. הזמנה שטרם תומחרה
            מקבלת את הפאנל הרגיל למעלה; זו שתומחרה מקבלת את זה. */}
        {!canAddItems &&
          salePricelist?.status === "ACTIVE" &&
          allAddable.length > 0 &&
          order.status !== "CANCELLED" && (
            <AddSupplement
              parentOrderId={order.id}
              parentOrderNumber={order.orderNumber}
              customerName={order.customerName}
              hasCard={hasToken}
              singleSurcharge={Number(salePricelist.singleSurcharge ?? 0)}
              products={allAddable}
            />
          )}

        {/* §120: קישור להזמנה המקורית, אם זו תוספת */}
        {order.parentOrderId && (
          <div className="bg-amber-50 border-2 border-amber-300 rounded-2xl p-3">
            <div className="text-sm font-bold text-amber-900">
              ➕ זו הזמנת תוספת
            </div>
            <Link
              href={`/agent/orders/${order.parentOrderId}`}
              className="text-xs text-amber-800 underline"
            >
              ← מעבר להזמנה המקורית
            </Link>
          </div>
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

          {/* §180: כותרת שמסבירה מה יש כאן.
              
              🐛 שלושת הפאנלים (משלוח, זיכוי, חיוב) ישבו בלי שום
              הקדמה, אחרי רשימת הפריטים והתשלום. הנציג שרצה לזכות
              לקוח היה צריך לגלול ולחפש, ולא ידע שזה בכלל שם.
              
              ⚠️ כותרת אחת לשלושתם ולא כפתור לכל אחד: הם קשורים
              (כולם משנים את הסכום), והפרדה הייתה מייצרת בדיוק את
              הבלגן שהמנהל ביקש למנוע. */}
          <div id="money-actions" className="mt-4 mb-2 flex items-center gap-2 scroll-mt-4">
            <div className="h-px flex-1 bg-zinc-200" />
            <span className="text-xs font-extrabold text-brand-slatedark whitespace-nowrap">
              💰 שינויים בסכום ההזמנה
            </span>
            <div className="h-px flex-1 bg-zinc-200" />
          </div>
          <p className="text-[11px] text-zinc-500 text-center mb-2 leading-relaxed">
            משלוח וחיוב נוסף <b>מוסיפים</b> · זיכוי <b>מוריד</b> · הכל נכנס
            לסכום שהלקוח ישלם
          </p>

          {/* §134: משלוח - לפני הזיכוי והחיוב.
              
              ⚠️ הסדר: משלוח **מוסיף** לסכום, זיכוי **מוריד**, ורק
              אז גובים. סימון משלוח אחרי החיוב לא ייגבה. */}
          <div className="mb-3">
            <DeliveryPanel
              orderId={order.id}
              requested={order.deliveryRequested}
              fee={order.deliveryFee != null ? Number(order.deliveryFee) : null}
              address={order.deliveryAddress}
              note={order.deliveryNote}
              deliveredAt={order.deliveredToCustomerAt?.toISOString() ?? null}
              alreadyPaid={
                order.paymentStatus === "PAID" ||
                order.paymentStatus === "PARTIALLY_PAID"
              }
            />
          </div>

          {/* §123: זיכוי - לפני החיוב ולפני סימון המזומן.
              הסדר מכוון: אם מגיע ללקוח זיכוי, הוא צריך להיכנס
              לפני שנגבה ממנו כסף. */}
          <div className="mb-3">
            <CreditPanel
              orderId={order.id}
              currentAmount={
                order.creditAmount != null ? Number(order.creditAmount) : null
              }
              currentReason={order.creditReason}
              orderTotal={finalTotal ?? estimatedTotal}
              alreadyPaid={
                order.paymentStatus === "PAID" ||
                order.paymentStatus === "PARTIALLY_PAID"
              }
            />
          </div>

          {/* §135: חיוב נוסף - התמונה הראית של הזיכוי.
              אותו רכיב, kind="charge". */}
          <div className="mb-3">
            <CreditPanel
              orderId={order.id}
              currentAmount={
                order.extraCharge != null ? Number(order.extraCharge) : null
              }
              currentReason={order.extraChargeReason}
              orderTotal={finalTotal ?? estimatedTotal}
              alreadyPaid={
                order.paymentStatus === "PAID" ||
                order.paymentStatus === "PARTIALLY_PAID"
              }
              kind="charge"
            />
          </div>

          {/* §298: 💳 הגדרת תשלומים — פאנל בפני עצמו.
              
              🐛 הבורר ישב בתוך מודל החיוב, והכפתור שפותח אותו
              מושבת בלי מחיר סופי - כלומר בדיוק בהזמנות שבהן
              צריך לרשום פריסה מראש.
              
              ⚠️ המקום כאן מכוון: **אחרי** הזיכוי והחיוב הנוסף,
              כי הם משנים את הסכום, ו**לפני** המזומן והחיוב, כי
              הם הפעולות הסופיות. */}
          <div className="mb-3">
            <AgentInstallmentsPanel
              orderId={order.id}
              orderNumber={order.orderNumber}
              customerName={order.customerName}
              current={order.requestedInstallments ?? 1}
              orderTotal={finalTotal ?? estimatedTotal}
              hasCard={!!order.customer.cardLast4}
              alreadyPaid={
                order.paymentStatus === "PAID" ||
                order.paymentStatus === "PARTIALLY_PAID"
              }
              isAdmin={role === "ADMIN"}
            />
          </div>

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
              // §189: מה שהלקוח ביקש - ברירת מחדל בבורר
              requestedInstallments={order.requestedInstallments ?? 1}
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
