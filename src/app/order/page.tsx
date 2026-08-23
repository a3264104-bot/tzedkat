import Link from "next/link";
// §202: בדיקת תוקף כרטיס
import { canChargeCard, expiryMessage } from "@/lib/card-expiry-lib";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { OrderFlow } from "./OrderFlow";

export const dynamic = "force-dynamic";

export default async function OrderPage({
  searchParams,
}: {
  searchParams: Promise<{ editOrderId?: string }>;
}) {
  const sp = await searchParams;
  const editOrderId = sp?.editOrderId || null;

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
    // 🐛 תוקן לולאת הפניה: זה קורה כשמתחברים דרך /admin/login, שמשתמש
    // בטבלת Admin נפרדת מ-Customer. ה-session תקין אבל אין לקוח עם
    // המזהה הזה, ולכן ההפניה ל-login החזירה את המשתמש להתחבר שוב
    // ושוב בלי שום הסבר.
    return (
      <main className="min-h-screen bg-brand-yellow flex items-center justify-center p-6">
        <div className="card p-8 text-center max-w-md">
          <p className="text-lg font-bold text-brand-slatedark">
            מסך ההזמנה מיועד ללקוחות
          </p>
          <p className="text-sm text-brand-slate/70 mt-2">
            התחברת כמנהל המערכת, ולחשבון הזה אין פרופיל לקוח. כדי להזמין
            בשם לקוח יש להשתמש במסך הנציג — כך ההזמנה גם תתועד כהזמנה
            שבוצעה על ידך.
          </p>
          <div className="flex flex-wrap gap-2 justify-center mt-5">
            <Link href="/agent" className="btn-primary">
              למסך הנציג
            </Link>
            <Link href="/admin" className="btn-ghost">
              לניהול
            </Link>
          </div>
          <p className="text-xs text-zinc-500 mt-4">
            לצפייה במסך כפי שהלקוח רואה אותו, יש להתחבר עם חשבון לקוח רגיל.
          </p>
        </div>
      </main>
    );
  }

  const pricelist = await prisma.pricelist.findFirst({
    where: { status: "ACTIVE", agentOnly: false },
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

  // §16 פאזה 2: אם יש editOrderId — טוענים את ההזמנה הקיימת ופריטיה
  let editOrder = null;
  let initialCart: Record<string, { cartonQty: number; singlesQty: number }> = {};
  if (editOrderId) {
    editOrder = await prisma.order.findFirst({
      where: {
        id: editOrderId,
        customerId,
        pricelistId: pricelist.id,
      },
      include: { items: true },
    });
    if (editOrder) {
      // בונים cart מהפריטים הקיימים - איחוד קרטונים/בודדים לאותו מוצר
      for (const it of editOrder.items) {
        if (!initialCart[it.productId]) {
          initialCart[it.productId] = { cartonQty: 0, singlesQty: 0 };
        }
        if (it.isSingle) {
          initialCart[it.productId].singlesQty = Number(it.quantity);
        } else {
          initialCart[it.productId].cartonQty = Number(it.quantity);
        }
      }
    }
  }

  // §12: בדיקה אם ללקוח יש הזמנה קיימת למכירה הזו
  // אם יש - מפנים אוטומטית לעמוד ההצלחה של ההזמנה הקיימת,
  // כדי למנוע יצירת הזמנה כפולה בטעות.
  // הלקוח יכול משם ללחוץ "עריכה" כדי לשנות.
  // (מדלגים על הבדיקה אם אנחנו במצב עריכה מפורש)
  if (!editOrderId) {
    const existingOrder = await prisma.order.findFirst({
      where: {
        customerId,
        pricelistId: pricelist.id,
        status: { notIn: ["CANCELLED"] },
      },
      select: { id: true, orderNumber: true },
    });
    if (existingOrder) {
      // מפנים ישירות לעמוד ההצלחה של ההזמנה הקיימת
      redirect(`/order/success/${existingOrder.id}`);
    }
  }

  const points = pricelist.points
    .map((pp) => pp.point)
    // §163: נקודה סמויה אינה מוצגת ללקוח.
    //
    // ⚠️ הסינון כאן ולא בקליינט: לקוח שיראה את הנקודה בבורר יוכל
    // לבחור בה, וההזמנה שלו תגיע לפתח החנות של מישהו אחר.
    //
    // §196: 🐛 **אבל הנקודה של הלקוח עצמו חייבת להישאר.**
    //
    // מה שקרה: בעל חנות משויך לנקודה סמויה. הסינון הסיר אותה
    // מהרשימה, ה-defaultPointId שלו לא נמצא בבורר, והמסך דרש
    // ממנו לבחור נקודה קבועה - שאינה שלו.
    //
    // אחרי ההזמנה הוא ראה בעריכה שהנקודה כן הסמויה, כי השרת
    // שמר לפי הלקוח - אבל המסך ביקש ממנו לבחור לחינם.
    .filter(
      (p) =>
        p.isActive &&
        (!p.isPrivate || p.id === customerRecord?.defaultPointId)
    )
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
      singleUnitPrice: pp.product.singleUnitPrice != null ? Number(pp.product.singleUnitPrice) : null,
      unit: pp.product.unit,
      saleType: pp.product.saleType,
      priceType: pp.product.priceType,
      avgWeightPerUnit: pp.product.avgWeightPerUnit != null ? Number(pp.product.avgWeightPerUnit) : null,
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
    .sort((a, b) => a.categorySort - b.categorySort || a.sortOrder - b.sortOrder);

  return (
    <OrderFlow
      pricelist={{
        id: pricelist.id,
        name: pricelist.name,
        deliveryDateText: pricelist.deliveryDateText,
        closeDateText: pricelist.closeDate
          ? new Date(pricelist.closeDate).toLocaleDateString("he-IL", {
                    // §200: השרת רץ ב-UTC — בלי זה 3 שעות אחורה
                    timeZone: "Asia/Jerusalem",
              day: "numeric",
              month: "long",
              hour: "2-digit",
              minute: "2-digit",
            })
          : null,
        editDeadlineText: pricelist.editDeadline
          ? new Date(pricelist.editDeadline).toLocaleDateString("he-IL", {
                    // §200: השרת רץ ב-UTC — בלי זה 3 שעות אחורה
                    timeZone: "Asia/Jerusalem",
              day: "2-digit",
              month: "2-digit",
              year: "numeric",
              hour: "2-digit",
              minute: "2-digit",
            })
          : (pricelist.closeDate
              ? new Date(pricelist.closeDate).toLocaleDateString("he-IL", {
                    // §200: השרת רץ ב-UTC — בלי זה 3 שעות אחורה
                    timeZone: "Asia/Jerusalem",
                  day: "2-digit",
                  month: "2-digit",
                  year: "numeric",
                  hour: "2-digit",
                  minute: "2-digit",
                })
              : null),
        notes: pricelist.notes,
        singleSurcharge: Number(pricelist.singleSurcharge),
        orderFee: Number(pricelist.orderFee),
      }}
      points={points}
      products={products}
      customer={{
        name: customerRecord.name,
        phone: customerRecord.phone,
        email: customerRecord.email,
        defaultPointId: customerRecord.defaultPointId,
      }}
      // §143: לקוח מזומן **פטור** מאימות כרטיס.
      //
      // 🐛 מה שהיה (§60): `paymentToken && preference !== "CASH"` -
      // כלומר לקוח מזומן קיבל cardVerified=false והופנה למסך
      // הכרטיס, גם כשהמנהל סימן אותו כמזומן בדיוק כדי שלא יצטרך
      // כרטיס. שתי חסימות מקבילות - כאן ובשרת - וזו נשארה אחרי
      // שהשרת תוקן.
      //
      // ⚠️ הגבייה שלו פיזית בחלוקה, והנציג מסמן אותה בטבלת
      // המשקלים (§130).
      // §202: 🐛 כרטיס שפג תוקפו נחשב "מאומת".
      //
      // הלקוח הזמין כרגיל, והתקלה התגלתה רק ברגע החיוב - אחרי
      // החלוקה, כשהסחורה כבר אצלו. הרגע הנכון להגיד לו הוא
      // עכשיו, כשהוא מזמין ויכול לעדכן בשתי דקות.
      //
      // ⚠️ canChargeCard מחזיר true גם כשאין תוקף שמור: כרטיסים
      // ותיקים נשמרו בלי, וחסימה שלהם הייתה מנתקת לקוחות קיימים.
      cardVerified={
        (!!customerRecord.paymentToken &&
          canChargeCard(customerRecord.cardExpiry)) ||
        customerRecord.paymentPreference === "CASH"
      }
      // §202: הודעת התוקף - מוצגת גם כשעדיין אפשר לחייב
      cardExpiryWarning={expiryMessage(customerRecord.cardExpiry)}
      // §157: לקוח מזומן רואה מסך מותאם - בלי פריסה לתשלומים,
      // ועם "מזומן בחלוקה" במקום "כרטיס אשראי".
      isCashCustomer={customerRecord.paymentPreference === "CASH"}
      customerId={customerRecord.id}
      hasSeenOrderIntro={customerRecord.hasSeenOrderIntro}
      existingOrder={null}
      editMode={
        editOrder
          ? { orderId: editOrder.id, orderNumber: editOrder.orderNumber, initialCart }
          : null
      }
    />
  );
}
