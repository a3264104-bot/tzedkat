import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { OrderFlow } from "@/app/order/OrderFlow";
import { AgentPaymentGate } from "@/components/AgentPaymentGate";

export const dynamic = "force-dynamic";

// §55: מסך חסימה עם הסבר.
//
// 🐛 קודם כל חסימה הייתה redirect("/agent") שקט - הנציג נזרק אחורה
// בלי לדעת למה, וחשב שהמערכת תקולה. גרוע מכך: הוא עלול ליצור את
// הלקוח מחדש, וזו כפילות שמפצלת היסטוריה והזמנות.
function Blocked({ title, detail }: { title: string; detail: string }) {
  return (
    <main dir="rtl" className="min-h-screen bg-brand-cream flex items-center justify-center p-6">
      <div className="bg-white rounded-2xl shadow-lg p-8 text-center max-w-md">
        <div className="w-14 h-14 mx-auto mb-4 rounded-full bg-amber-100 flex items-center justify-center">
          <svg className="w-7 h-7 text-amber-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
          </svg>
        </div>
        <h1 className="text-lg font-bold text-brand-slatedark">{title}</h1>
        <p className="text-sm text-zinc-600 mt-2 leading-relaxed">{detail}</p>
        <Link
          href="/agent"
          className="inline-block mt-5 px-6 py-2.5 bg-brand-rust text-white rounded-xl font-bold hover:bg-[#a83a15]"
        >
          חזרה לאזור הנציג
        </Link>
      </div>
    </main>
  );
}

export default async function AgentOrderPage({
  params,
  searchParams,
}: {
  params: Promise<{ customerId: string }>;
  // §111: ?sale=<id> - באיזו מכירה לפתוח את ההזמנה
  searchParams: Promise<{ sale?: string }>;
}) {
  const { customerId } = await params;
  const { sale: requestedSaleId } = await searchParams;
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
    return (
      <Blocked
        title="הלקוח לא נמצא"
        detail="ייתכן שהלקוח נמחק, או שהקישור שגוי. חזור לאזור הנציג וחפש אותו מחדש."
      />
    );
  }

  // §52: לקוח שהושבת - חסום לכולם, גם למנהל.
  // הוא ביקש להפסיק לקבל שירות, ופתיחת הזמנה עבורו סותרת את זה.
  // הבדיקה כאן ולא רק בחיפוש, כי אפשר להגיע לכתובת ישירות.
  if (targetCustomer.isActive === false) {
    return (
      <Blocked
        title="הלקוח אינו פעיל"
        detail={`${targetCustomer.name} סומן כלא פעיל ולא ניתן לפתוח עבורו הזמנה. אם זו טעות, יש לפנות למנהל להפעלה מחדש.`}
      />
    );
  }

  // ─── אימות הרשאת נציג ───
  // הנציג רשאי להזמין רק עבור:
  //   1. לקוח שהוא עצמו יצר
  //   2. לקוח שנקודת ברירת המחדל שלו היא אחת מנקודותיו
  //   3. לקוח שיש לו לפחות הזמנה אחת באחת מנקודותיו
  if (role === "AGENT") {
    const agent = await prisma.customer.findUnique({
      where: { id: sessionUserId },
      select: {
        agentPointId: true, // deprecated - נשמר לתאימות אחורה
        agentPoints: { select: { pointId: true } },
      },
    });
    const agentPointIds = new Set(agent?.agentPoints.map((ap) => ap.pointId) ?? []);
    if (agent?.agentPointId) agentPointIds.add(agent.agentPointId);

    // §55: 🐛 תוקן חור אבטחה.
    //
    // הקוד הקודם דילג על *כל* הבדיקה כשלנציג אין נקודות משויכות,
    // וההערה שם הודתה בכך במפורש. התוצאה: נציג בלי נקודות יכול היה
    // לפתוח הזמנה עבור *כל לקוח במערכת* - יותר הרשאות מנציג מוגדר
    // כראוי.
    //
    // עכשיו הוא נחסם. זה גם המצב הנכון תפעולית: בלי נקודה אין לו
    // איפה לחלק.
    if (agentPointIds.size === 0) {
      return (
        <Blocked
          title="אין לך נקודת חלוקה משויכת"
          detail="כדי לפתוח הזמנות עבור לקוחות יש להיות משויך לפחות לנקודת חלוקה אחת. יש לפנות למנהל להשלמת השיוך."
        />
      );
    }

    const isCreator = targetCustomer.createdByAgentId === sessionUserId;
    const samePoint =
      targetCustomer.defaultPointId !== null &&
      agentPointIds.has(targetCustomer.defaultPointId);
    const hasOrderAtPoint =
      !isCreator &&
      !samePoint &&
      (await prisma.order.count({
        where: {
          customerId: targetCustomer.id,
          pointId: { in: Array.from(agentPointIds) },
        },
      })) > 0;

    if (!isCreator && !samePoint && !hasOrderAtPoint) {
      // §55: הודעה מפורשת עם שם הנקודה והנציג האחראי
      let responsible = "";
      if (targetCustomer.defaultPointId) {
        const links = await prisma.agentPoint.findMany({
          where: { pointId: targetCustomer.defaultPointId },
          select: { agent: { select: { name: true } } },
        });
        const names = links.map((l) => l.agent.name);
        if (names.length === 0) {
          const legacy = await prisma.customer.findMany({
            where: { agentPointId: targetCustomer.defaultPointId, role: "AGENT" },
            select: { name: true },
          });
          names.push(...legacy.map((a) => a.name));
        }
        if (names.length > 0) responsible = ` הנציג האחראי: ${names.join(", ")}.`;
      }
      const pointName = targetCustomer.defaultPoint?.name;
      return (
        <Blocked
          title="הלקוח משויך לנקודה אחרת"
          detail={
            pointName
              ? `${targetCustomer.name} משויך לנקודת החלוקה "${pointName}", שאינה מהנקודות שלך.${responsible} לא ניתן לפתוח עבורו הזמנה מכאן.`
              : `ל-${targetCustomer.name} לא הוגדרה נקודת חלוקה. יש לפנות למנהל להשלמת השיוך.`
          }
        />
      );
    }
  }

  // §111: הנציג רשאי להזמין גם במכירה שסומנה "לנציגים בלבד".
  //
  // בלי ?sale= נבחרת המכירה הרגילה (agentOnly: false) - כדי
  // שהתנהגות ברירת המחדל לא תשתנה למי שלא משתמש בתכונה.
  //
  // עם ?sale=<id> נפתחת המכירה שנבחרה, בין רגילה ובין מהירה.
  // אין כאן חור: המכירה חייבת להיות ACTIVE, והרשאת הנקודה
  // נבדקת בהמשך כרגיל.
  const pricelist = await prisma.pricelist.findFirst({
    where: requestedSaleId
      ? { id: requestedSaleId, status: "ACTIVE" }
      : { status: "ACTIVE", agentOnly: false },
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

  // §169: 🐛 מוצר מועדף שאינו במחירון פשוט לא היה קיים.
  //
  // המוצרים נלקחים כולם מ-pricelist.products, ולכן מוצר שסומן
  // כמועדף (ראש, בננה) אך לא נוסף למכירה - לא הופיע בשום מקום.
  //
  // התוצאה: הלקוח מבקש ראש, פונה לנציג, **וגם הנציג לא רואה**.
  // התכונה שבנינו ב-§119 הייתה נגישה רק אם המנהל זכר להוסיף את
  // המוצר לכל מחירון מחדש.
  //
  // ⚠️ נשלפים בנפרד ומצורפים לרשימה: מוצר מועדף הוא מטבעו "מחוץ
  // למכירה" - הוא נמכר לפי בקשה ובמחיר שהנציג קובע.
  const favoritesOutside = await prisma.product.findMany({
    where: {
      isFavorite: true,
      // ⚠️ רק מה שלא כבר במחירון - אחרת הוא היה מופיע פעמיים
      NOT: {
        pricelists: { some: { pricelistId: pricelist?.id ?? "" } },
      },
    },
    include: { category: true, kashrutRef: true },
  });

  const now = new Date();
  const closed = pricelist?.closeDate != null && now > new Date(pricelist.closeDate);
  const notYetOpen = pricelist?.openDate != null && now < new Date(pricelist.openDate);

  if (!pricelist || closed || notYetOpen) {
    return (
      <main dir="rtl" className="min-h-screen bg-brand-yellow flex items-center justify-center p-6">
        <div className="bg-white rounded-2xl shadow-lg p-8 text-center max-w-sm">
          <div className="text-4xl mb-3">😴</div>
          <p className="text-lg font-bold text-brand-slatedark">אין כרגע מכירה פעילה</p>
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
            חזרה לאזור הנציג
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

  // §67: 🐛 הפער האחרון במוצרים המיוחדים.
  //
  // כאן היה `.filter((pp) => pp.product.isActive)` - בדיוק כמו באתר.
  // התוצאה: הנציג ראה את המוצרים הלא-פעילים כשהוסיף אותם להזמנה
  // *קיימת* (§65), אבל לא כשפתח הזמנה **חדשה** - הרגע שבו הוא הכי
  // צריך אותם, כי אז הוא יושב מול הלקוח.
  //
  // עכשיו הם נכללים ומסומנים ב-isInactive, וה-flow מציג אותם
  // בנפרד. מסלול הלקוח (/order/page.tsx) לא נגע - שם הסינון נשאר.
  const products = pricelist.products
    .map((pp) => ({
      id: pp.product.id,
      name: pp.product.name,
      category: pp.product.category.name,
      categorySort: pp.product.category.sortOrder,
      price: Number(pp.price ?? pp.product.cartonPrice),
      allowSingles: pp.product.allowSingles,
      singlesMode: pp.product.singlesMode || "KG",
      singleUnitPrice:
        pp.product.singleUnitPrice != null ? Number(pp.product.singleUnitPrice) : null,
      unit: pp.product.unit,
      saleType: pp.product.saleType,
      priceType: pp.product.priceType,
      avgWeightPerUnit:
        pp.product.avgWeightPerUnit != null ? Number(pp.product.avgWeightPerUnit) : null,
      imageUrl: pp.product.imageUrl,
      kashrut: pp.product.kashrut,
      kashrutName: pp.product.kashrutRef?.name || null,
      kashrutImageUrl: pp.product.kashrutRef?.imageUrl || null,
      isFeatured: pp.product.isFeatured,
      highlightNote: pp.product.highlightNote,
      // §67: מוצר שאינו מוצג ללקוחות - מסומן כדי שה-flow יציג אותו
      // בקטגוריה נפרדת ולא יערבב אותו במכירה הרגילה.
      isInactive: pp.product.isActive === false,
      // §160: 🐛 מוצר מועדף לא הגיע למסך ההזמנה בכלל.
      //
      // §119 בנה את התמחור העצמי רק במסלול "הוספת פריט להזמנה
      // קיימת". הנציג שרצה למכור ראש היה צריך: לפתוח הזמנה,
      // לשמור, לצאת, לחזור לכרטיס הלקוח, ולהוסיף משם.
      //
      // ⚠️ ובלי המחיר - גם אחרי כל זה הוא לא יכול היה לתמחר
      // במסך ההזמנה, כי השדה לא היה קיים שם.
      isFavorite: !!pp.product.isFavorite,
      packageWeight: pp.product.packageWeight,
      isFrozen: pp.product.isFrozen,
      limitedQty: pp.product.limitedQty,
      sortOrder: pp.product.sortOrder,
    }))
    .sort((a, b) => a.categorySort - b.categorySort || a.sortOrder - b.sortOrder);

  // §169: מוצרים מועדפים שאינם במחירון - מצורפים לסוף.
  //
  // ⚠️ המחיר הוא cartonPrice של המוצר, כי אין לו רשומת מחירון.
  // זה גם הבסיס לחישוב העמלה (§119): הנציג קובע מחיר גבוה יותר,
  // וההפרש מ"רצפת הנציג" שלו.
  //
  // ⚠️ isFavorite=true גורם ל-OrderFlow להציג אותם בקטגוריה
  // "⭐ מוצרים מיוחדים" עם שדה תמחור - בדיוק כמו מועדף שכן
  // נמצא במחירון.
  for (const p of favoritesOutside) {
    if (!p.isActive) continue;
    products.push({
      id: p.id,
      name: p.name,
      category: p.category?.name || "מיוחדים",
      categorySort: 999,
      price: Number(p.cartonPrice),
      allowSingles: p.allowSingles,
      singlesMode: p.singlesMode || "KG",
      singleUnitPrice:
        p.singleUnitPrice != null ? Number(p.singleUnitPrice) : null,
      unit: p.unit,
      saleType: p.saleType,
      priceType: p.priceType,
      avgWeightPerUnit:
        p.avgWeightPerUnit != null ? Number(p.avgWeightPerUnit) : null,
      imageUrl: p.imageUrl,
      kashrut: p.kashrut,
      kashrutName: p.kashrutRef?.name || null,
      kashrutImageUrl: p.kashrutRef?.imageUrl || null,
      isFeatured: false,
      highlightNote: p.highlightNote,
      isInactive: false,
      isFavorite: true,
      packageWeight: p.packageWeight,
      isFrozen: p.isFrozen,
      limitedQty: p.limitedQty,
      sortOrder: p.sortOrder,
    });
  }

  // האם יש לו כבר כרטיס?
  // - יש token → cardVerified=true → מדלגים על אימות
  // - אין token → cardVerified=false → הflow יבקש להזין כרטיס (הנציג יעביר את המכשיר ללקוח)
  const hasPaymentToken = !!targetCustomer.paymentToken;

  // §60: לקוח מזומן. לא נדרש כרטיס בהזמנה דרך נציג - הגבייה במזומן
  // בחלוקה. לכן cardVerified מקבל true גם בלי טוקן, וה-flow לא יעצור
  // את הנציג במסך הזנת כרטיס. זה תקף *רק* להזמנת נציג: באתר עצמו
  // לקוח מזומן בלי טוקן חסום (אכיפה ב-API יצירת ההזמנה).
  const isCashCustomer = targetCustomer.paymentPreference === "CASH";

  // §61: לקוח בלי אמצעי תשלום כלל - חוסם לפני ההזמנה.
  //
  // 🐛 הפער: לקוח שנרשם ב-IVR נוצר בלי כרטיס ועם CREDIT כברירת מחדל.
  // הנציג פתח לו הזמנה, ו-/api/orders פוטר הזמנות נציג מדרישת כרטיס -
  // כך נוצרה הזמנה בלי שום מסלול גבייה, שנתקעת בזמן החיוב על
  // "אין כרטיס שמור". עכשיו הנציג מכריע פעם אחת: כרטיס או מזומן.
  if (!hasPaymentToken && !isCashCustomer) {
    let canUpdateCards = role === "ADMIN";
    if (role === "AGENT") {
      const me = await prisma.customer.findUnique({
        where: { id: sessionUserId },
        select: { agentCanUpdateCards: true },
      });
      canUpdateCards = me?.agentCanUpdateCards ?? false;
    }
    return (
      <AgentPaymentGate
        customerId={targetCustomer.id}
        customerName={targetCustomer.name}
        canUpdateCards={canUpdateCards}
      />
    );
  }

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
                  {isCashCustomer ? (
                    <span className="text-[10px] bg-lime-300 text-lime-950 px-1.5 py-0.5 rounded font-bold">
                      💵 מזומן
                    </span>
                  ) : hasPaymentToken ? (
                    <span className="text-[10px] bg-emerald-400 text-emerald-950 px-1.5 py-0.5 rounded font-bold">
                      יש כרטיס
                    </span>
                  ) : null}
                </div>
                <div className="text-xs text-white/80 flex items-center gap-2 flex-wrap">
                  {targetCustomer.phone && (
                    <span className="font-mono" dir="ltr">
                      {targetCustomer.phone}
                    </span>
                  )}
                  {/* §55: הנקודה של הלקוח בבאנר - הנציג רואה מיד לאן
                      הסחורה הולכת, ולא מגלה רק בסיכום */}
                  {targetCustomer.defaultPoint?.name && (
                    <span>📍 {targetCustomer.defaultPoint.name}</span>
                  )}
                </div>
              </div>
            </div>
            <Link
              href="/agent"
              className="shrink-0 text-xs font-bold text-white/80 hover:text-white bg-white/10 hover:bg-white/20 px-3 py-2 rounded-lg transition-colors"
            >
              חזרה לנציג
            </Link>
          </div>

          {/* §60: לקוח מזומן - אין דרישת כרטיס, הגבייה בחלוקה */}
          {isCashCustomer ? (
            <div className="mt-2 text-[11px] bg-lime-500/20 border border-lime-400/40 rounded-lg px-3 py-1.5 text-lime-100">
              💵 <strong>לקוח מזומן:</strong> לא יידרש כרטיס אשראי. הגבייה תתבצע
              במזומן בעת החלוקה, לאחר קביעת המחיר הסופי.
            </div>
          ) : (
            /* התראת אזהרה אם אין כרטיס - רק ללקוח אשראי */
            !hasPaymentToken && (
              <div className="mt-2 text-[11px] bg-amber-500/20 border border-amber-400/40 rounded-lg px-3 py-1.5 text-amber-100">
                💳 <strong>שים לב:</strong> אין ללקוח כרטיס אשראי במערכת. בסוף ההזמנה
                תתבקש להעביר את המכשיר ללקוח לאימות כרטיס (חיוב 1 ש&quot;ח שיקוזז
                מההזמנה הראשונה).
              </div>
            )
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
          orderFee: Number(pricelist.orderFee),
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
        // §60: לקוח מזומן לא נדרש לכרטיס בהזמנת נציג
        cardVerified={hasPaymentToken || isCashCustomer}
        hasSeenOrderIntro={true}
      />
    </div>
  );
}
