import { NextResponse } from "next/server";
// §202: תוקף כרטיס האשראי
import { canChargeCard } from "@/lib/card-expiry-lib";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { effectiveUnitPrice, smartLineEstimate } from "@/lib/pricing";
import { sendAdminOrderNotification, sendCustomerOrderConfirmation } from "@/lib/email";

const schema = z.object({
  pricelistId: z.string(),
  pointId: z.string(),
  // customerName ו-phone כבר לא מגיעים מהלקוח - הם נלקחים מהחשבון המחובר
  // phone2/notes הם פר-הזמנה ונשארים כשדות אופציונליים מהלקוח
  phone2: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  // §13: מספר תשלומים (1 או 2)
  requestedInstallments: z.number().min(1).max(2).optional(),
  // אם נציג מזמין בשם לקוח - מזהה הלקוח שעבורו מזמינים
  onBehalfOfCustomerId: z.string().optional().nullable(),
  // §182: משלוח שנקבע כבר ביצירת ההזמנה.
  //
  // הנציג יודע מראש שהלקוח מקבל משלוח - הוא לא צריך לשמור,
  // לצאת, ולהיכנס להזמנה שנוצרה רק כדי לסמן את זה.
  //
  // ⚠️ **רק לנציג/מנהל.** לקוח שישלח את השדה הזה ינסה לקבוע
  // לעצמו דמי משלוח, וזה נבדק למטה.
  delivery: z
    .object({
      address: z.string().min(2),
      fee: z.number().min(0).max(500),
      note: z.string().optional().nullable(),
    })
    .optional()
    .nullable(),
  // §160: מחירים שהנציג קבע למוצרים מועדפים - { productId: price }
  favoritePrices: z.record(z.string(), z.number()).optional(),
  items: z
    .array(
      z.object({
        productId: z.string(),
        isSingle: z.boolean(),
        quantity: z.number().positive(),
      })
    )
    .min(1),
});

export async function POST(req: Request) {
  // חובה להיות מחובר כלקוח. אין יותר הזמנת אורח.
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "יש להתחבר לפני ביצוע הזמנה" }, { status: 401 });
  }

  const role = (session.user as any).role;
  const sessionUserId = (session.user as any).id as string;

  try {
    const body = await req.json();
    const data = schema.parse(body);

    // קביעת הלקוח שעבורו ההזמנה:
    // - נציג/מנהל עם onBehalfOfCustomerId: מזמינים בשם אותו לקוח
    // - לקוח רגיל: מזמין לעצמו
    let customerId = sessionUserId;
    let placedByAgentId: string | null = null;

    if (data.onBehalfOfCustomerId && (role === "AGENT" || role === "ADMIN")) {
      // נציג מזמין בשם לקוח - מאמתים הרשאה
      const targetCustomer = await prisma.customer.findUnique({
        where: { id: data.onBehalfOfCustomerId },
      });
      if (!targetCustomer || targetCustomer.role !== "CUSTOMER") {
        return NextResponse.json({ error: "לקוח לא נמצא" }, { status: 404 });
      }
      // אכיפת נקודות הנציג (many-to-many). נציג יכול:
      //   1. להזמין רק בשם לקוח המשויך לאחת מנקודותיו
      //   2. לשייך את ההזמנה רק לאחת מנקודותיו (pointId היעד)
      // ADMIN פטור משתי הבדיקות. נציג ללא נקודות כלל - נחסם.
      if (role === "AGENT") {
        const agent = await prisma.customer.findUnique({
          where: { id: sessionUserId },
          select: {
            agentPointId: true,
            agentPoints: { select: { pointId: true } },
          },
        });
        // רשימת כל נקודות הנציג (עם נפילה ל-agentPointId הישן)
        const agentPointIds =
          agent && agent.agentPoints.length > 0
            ? agent.agentPoints.map((ap) => ap.pointId)
            : agent?.agentPointId
              ? [agent.agentPointId]
              : [];

        if (agentPointIds.length === 0) {
          return NextResponse.json(
            { error: "אין לך נקודת חלוקה משויכת. פנה למנהל." },
            { status: 403 }
          );
        }

        // (1) נקודת היעד חייבת להיות אחת מנקודות הנציג
        if (!agentPointIds.includes(data.pointId)) {
          return NextResponse.json(
            { error: "לא ניתן לשייך הזמנה לנקודה שאינה שלך" },
            { status: 403 }
          );
        }

        // (2) הלקוח חייב להיות משויך לאחת מנקודות הנציג -
        //     או שנקודת ברירת המחדל שלו היא אחת מהן, או שיש לו הזמנה קודמת באחת מהן.
        const belongs =
          (targetCustomer.defaultPointId != null &&
            agentPointIds.includes(targetCustomer.defaultPointId)) ||
          (await prisma.order.count({
            where: { customerId: targetCustomer.id, pointId: { in: agentPointIds } },
          })) > 0;
        if (!belongs) {
          return NextResponse.json(
            { error: "אין לך הרשאה להזמין עבור לקוח זה - הוא אינו משויך לנקודות שלך" },
            { status: 403 }
          );
        }
      }
      customerId = data.onBehalfOfCustomerId;
      placedByAgentId = sessionUserId;
    }

    // שולפים את פרטי הלקוח מהמסד - לא סומכים על מה שנשלח מהלקוח
    const customer = await prisma.customer.findUnique({ where: { id: customerId } });
    if (!customer) {
      return NextResponse.json({ error: "לקוח לא נמצא" }, { status: 401 });
    }

    // §52: לקוח שהושבת לא יכול להזמין.
    // הבדיקה בשרת ולא רק ב-UI, כי היא הגנה אמיתית: לקוח שהושבת
    // עשוי להגיע דרך קישור ישן או דרך ה-API.
    if (customer.isActive === false) {
      return NextResponse.json(
        {
          error:
            "החשבון אינו פעיל. לחידוש ההזמנות יש לפנות למוקד.",
          code: "CUSTOMER_INACTIVE",
        },
        { status: 403 }
      );
    }

    // 🚨 חסימת הזמנה כפולה - לא ניתן ליצור 2 הזמנות באותה מכירה
    // אם יש כבר הזמנה פעילה של הלקוח במכירה זו, מחזירים 409
    // הלקוח יכול לערוך את הקיימת אבל לא ליצור חדשה
    const existingOrder = await prisma.order.findFirst({
      where: {
        customerId,
        pricelistId: data.pricelistId,
        status: { notIn: ["CANCELLED"] },
      },
      select: {
        id: true,
        orderNumber: true,
      },
    });
    if (existingOrder) {
      return NextResponse.json(
        {
          error: `יש לך כבר הזמנה במכירה זו (הזמנה #${existingOrder.orderNumber}). ניתן לערוך אותה במקום ליצור חדשה.`,
          code: "DUPLICATE_ORDER",
          existingOrderId: existingOrder.id,
          existingOrderNumber: existingOrder.orderNumber,
        },
        { status: 409 }
      );
    }

    // §143: לקוח מזומן **כן** מזמין באתר בעצמו.
    //
    // 🐛 מה שהיה: §60 חסם לקוח מזומן מהזמנה עצמאית, בהנחה שאין
    // למערכת דרך לגבות ממנו. התוצאה בפועל הפוכה מהכוונה - המנהל
    // סימן לקוח כמזומן **בדיוק כדי שיוכל להזמין בלי כרטיס**,
    // והמערכת חסמה אותו והפנתה אותו להוסיף כרטיס.
    //
    // ⚠️ מה שהשתנה מאז §60: הנציג מסמן תשלום מזומן ישירות בטבלת
    // המשקלים (§130), וההזמנה עוברת ל-PAID לפני שהחיוב האוטומטי
    // רץ. כלומר יש היום מנגנון גבייה מסודר, ואין סיבה לחסום.

    // אכיפת אימות כרטיס: לקוח שמזמין לעצמו חייב כרטיס מאומת (טוקן
    // שמור) לפני שמירת הזמנה. זה סוגר את האפשרות לעקוף את אימות
    // ה-1 ש"ח.
    //
    // פטורים:
    //   • נציג/מנהל שמזמין בשם לקוח - הוא לוקח אחריות על הגבייה
    //   • §143: לקוח מזומן - הגבייה שלו פיזית בחלוקה, וזו בדיוק
    //     הסיבה שהמנהל סימן אותו ככזה
    //
    // ⚠️ אין כאן פרצה: מזומן דורש סימון מפורש של מנהל או נציג,
    // ולקוח רגיל בלי כרטיס עדיין נחסם.
    if (
      !placedByAgentId &&
      role === "CUSTOMER" &&
      !customer.paymentToken &&
      customer.paymentPreference !== "CASH"
    ) {
      return NextResponse.json(
        {
          error: "נדרש אימות כרטיס אשראי לפני שמירת ההזמנה",
          code: "CARD_VERIFICATION_REQUIRED",
        },
        { status: 403 }
      );
    }

    // §202: כרטיס שפג תוקפו - **חסימה בשרת**.
    //
    // ⚠️ המסכים כבר חוסמים, אבל בקשה ישירה עוקפת אותם. וזו
    // הנקודה האחרונה לפני שההזמנה נשמרת, ולכן היא חייבת לתפוס
    // גם את מה שהמסכים פספסו.
    //
    // ⚠️ **לא חל על נציג/מנהל**: הם רואים את האזהרה ויכולים
    // להחליט להזמין בכל זאת ולעדכן כרטיס בחלוקה. חסימה כאן
    // הייתה מונעת מהם לעבוד מול לקוח שעומד מולם.
    if (
      !placedByAgentId &&
      role === "CUSTOMER" &&
      customer.paymentPreference !== "CASH" &&
      !canChargeCard((customer as any).cardExpiry)
    ) {
      return NextResponse.json(
        {
          error:
            "תוקף כרטיס האשראי שלך פג. יש להזין כרטיס חדש לפני ביצוע ההזמנה.",
          code: "CARD_EXPIRED",
        },
        { status: 403 }
      );
    }
    if (!customer.phone && !customer.email) {
      return NextResponse.json({ error: "חשבון לא תקין — חסר פרטי קשר" }, { status: 400 });
    }

    const pricelist = await prisma.pricelist.findUnique({
      where: { id: data.pricelistId },
      include: {
        products: { include: { product: true } },
        points: { include: { point: true } },
      },
    });

    // §206: המנהל רשאי להזין הזמנות **אחרי** הסגירה.
    //
    // התרחיש מהשטח: המכירה נסגרה, המנהל שידר לספק, ואז מגיעות
    // עוד בקשות בטלפון. הוא רוצה להוסיף אותן - אבל **בשליטה
    // מלאה**: אם הוא יפתח את המכירה מחדש, לקוחות אחרים יזרמו
    // פנימה בלי שיידע, והוא יאבד את הספירה מול הספק.
    //
    // ⚠️ **רק role === ADMIN.** נציג נחסם כמו לקוח: הוא לא רואה
    // את התמונה המלאה מול הספק, והזמנה שלו אחרי הסגירה תיפול
    // בין הכיסאות.
    //
    // ⚠️ המכירה עדיין חייבת להיות ACTIVE. מכירה שהסתיימה (DONE)
    // או טיוטה נשארות חסומות לכולם - אחרת אפשר בטעות להזמין
    // למכירה של לפני חודש.
    const isAdminOverride = role === "ADMIN";

    if (!pricelist || pricelist.status !== "ACTIVE") {
      return NextResponse.json({ error: "המכירה אינה פעילה" }, { status: 400 });
    }

    // §221: 🚨 **מחירון נציגים אינו פתוח ללקוחות.**
    //
    // 🐛 הפרצה: pricelistId מגיע מהלקוח, והשרת בדק רק שהמחירון
    // פעיל - לא **למי** הוא מיועד. לקוח שהיה שולח מזהה של
    // מחירון נציגים (agentOnly) היה מזמין ממנו במחירי סיטונאות.
    //
    // ⚠️ המסך אף פעם לא הציג לו את המזהה הזה, אבל בקשה ידנית
    // עוקפת מסך. זו בדיוק הסיבה שכל חסימה צריכה להיות גם בשרת.
    //
    // ⚠️ נציג ומנהל **כן** רשאים: זו כל מטרת המחירון הזה.
    if (pricelist.agentOnly && !placedByAgentId) {
      return NextResponse.json(
        { error: "המכירה אינה פעילה" },
        { status: 400 }
      );
    }

    // אם הוגדרה שעת סגירה ועברה — אי אפשר להזמין
    //
    // §206: המנהל עובר. הוא זה שקבע את שעת הסגירה, והוא זה
    // שמחזיק את הספירה מול הספק.
    if (
      !isAdminOverride &&
      pricelist.closeDate &&
      new Date() > new Date(pricelist.closeDate)
    ) {
      return NextResponse.json(
        { error: "מועד ההרשמה למכירה זו הסתיים" },
        { status: 400 }
      );
    }

    // אם הוגדרה שעת פתיחה ועדיין לא הגיעה — אי אפשר להזמין
    if (pricelist.openDate && new Date() < new Date(pricelist.openDate)) {
      return NextResponse.json(
        { error: "ההרשמה למכירה זו טרם נפתחה" },
        { status: 400 }
      );
    }

    // §182: המשלוח - נבדק כאן, לפני היצירה.
    //
    // ⚠️ הבדיקה **בשרת** ולא רק במסך: הסתרת הכפתור נעקפת בבקשה
    // ישירה, ודמי משלוח הם כסף.
    const deliveryInput =
      placedByAgentId && data.delivery && data.delivery.fee >= 0
        ? {
            fee: Math.round(Number(data.delivery.fee) * 100) / 100,
            address: String(data.delivery.address).trim().slice(0, 300),
            note: data.delivery.note
              ? String(data.delivery.note).trim().slice(0, 300)
              : null,
          }
        : null;

    // נקודת החלוקה חייבת להשתתף במכירה הזו
    const plPoint = pricelist.points.find((x) => x.pointId === data.pointId);
    if (!plPoint) {
      return NextResponse.json(
        { error: "נקודת החלוקה אינה משתתפת במכירה זו" },
        { status: 400 }
      );
    }

    // §163: 🚨 נקודה סמויה - אימות בשרת, לא רק בתצוגה.
    //
    // הסינון במסך ההזמנה מסתיר את הנקודה מהבורר, אבל בקשה ישירה
    // עם ה-pointId הייתה עוברת. לקוח שראה את המזהה פעם אחת היה
    // יכול לשלוח את ההזמנה שלו לפתח החנות של מישהו אחר.
    //
    // ⚠️ בעל החנות **כן** רשאי: זו הנקודה שהמנהל שייך לו, וזו כל
    // המטרה. הבדיקה היא שהיא הנקודה **שלו**, ולא סתם סמויה כלשהי.
    //
    // ⚠️ נציג/מנהל שמזמין בשם לקוח - פטור. הוא ממילא מורשה לבחור
    // נקודות שהלקוח לא רואה.
    if (!placedByAgentId && plPoint.point.isPrivate) {
      if (customer.defaultPointId !== data.pointId) {
        return NextResponse.json(
          { error: "נקודת החלוקה אינה זמינה עבורך" },
          { status: 403 }
        );
      }
    }

    const surcharge = Number(pricelist.singleSurcharge);

    // build server-side priced items - לא סומכים על מחירים מהלקוח
    const itemsData = [];
    let estimatedTotal = 0;
    for (const item of data.items) {
      let pp = pricelist.products.find((x) => x.productId === item.productId);

      // §169: מוצר מועדף שאינו במחירון.
      //
      // 🐛 השרת דחה אותו עם "מוצר לא נמצא במחירון" - כלומר גם
      // אחרי שהוא הופיע במסך, השליחה נכשלה. מוצר מועדף הוא מטבעו
      // מחוץ למכירה: הוא נמכר לפי בקשה ובמחיר שהנציג קובע.
      //
      // ⚠️ **רק לנציג/מנהל.** לקוח לא רואה אותם ולא אמור להזמין
      // אותם ישירות, ובקשה כזו ממנו היא ניסיון עקיפה.
      if (!pp && placedByAgentId) {
        // §170: מוצר מועדף **או** לא-פעיל, מחוץ למחירון.
        //
        // ⚠️ isActive לא נבדק כאן: מוצר לא-פעיל הוא בדיוק המקרה
        // שאנחנו רוצים לאפשר. הבדיקה היא שהוא "מיוחד" - מועדף
        // או מוסתר מהלקוחות.
        const fav = await prisma.product.findFirst({
          where: {
            id: item.productId,
            OR: [{ isFavorite: true }, { isActive: false }],
          },
        });
        if (fav) {
          // מבנה תואם ל-PricelistProduct כדי שהחישוב שלמטה יעבוד
          // בלי הסתעפות נוספת. price=null -> נופל ל-cartonPrice.
          pp = { productId: fav.id, price: null, product: fav } as any;
        }
      }

      if (!pp) return NextResponse.json({ error: "מוצר לא נמצא במחירון" }, { status: 400 });
      // §170: מוצר לא-פעיל **מותר לנציג**. זו כל הנקודה - הוא
      // מוסתר מהלקוחות, והנציג מוכר אותו לפי בקשה.
      if (!pp.product.isActive && !placedByAgentId)
        return NextResponse.json(
          { error: `המוצר "${pp.product.name}" אינו זמין להזמנה` },
          { status: 400 }
        );
      const base = Number(pp.price ?? pp.product.cartonPrice);
      const isSingle = item.isSingle && pp.product.allowSingles;
      const unitPrice = effectiveUnitPrice(
        base,
        isSingle,
        surcharge,
        pp.product.singlesMode,
        pp.product.singleUnitPrice != null ? Number(pp.product.singleUnitPrice) : null
      );
      const avgWeight =
        pp.product.avgWeightPerUnit != null ? Number(pp.product.avgWeightPerUnit) : null;
      // חישוב חכם - זהה לצד הלקוח: מוצר נשקל (PER_KG) מוכפל במשקל המשוער.
      // בודדים במוצר נשקל: 2 מצבים:
      //   UNITS (סלומון): מחיר קבוע ליחידה, הכמות היא יחידות → הערכה = unitPrice × qty
      //   KG (בשר): הכמות היא ק"ג ישירות → הערכה = unitPrice × qty
      const isSinglesKg = isSingle && pp.product.priceType === "PER_KG";
      const isSinglesUnits = isSingle && pp.product.singlesMode === "UNITS";
      const est = isSinglesKg
        ? Math.round(unitPrice * item.quantity * 100) / 100
        : smartLineEstimate(
            unitPrice,
            item.quantity,
            pp.product.saleType,
            pp.product.priceType,
            avgWeight
          );
      estimatedTotal += est ?? 0;
      // משקל משוער לשורה:
      //   בודדים UNITS (סלומון): null (אין משקל רלוונטי - מחיר קבוע ליחידה)
      //   בודדים KG: הכמות עצמה (ק"ג)
      //   קרטונים: כמות × משקל קרטון
      const estimatedWeight = isSinglesUnits
        ? null
        : isSinglesKg
          ? Math.round(item.quantity * 1000) / 1000
          : (pp.product.saleType === "UNIT" || pp.product.saleType === "PACKAGE") &&
              pp.product.priceType === "PER_KG" &&
              avgWeight
            ? Math.round(avgWeight * item.quantity * 1000) / 1000
            : null;
      // §160: מחיר שהנציג קבע במוצר מועדף.
      //
      // ⚠️ שלוש הגנות, כולן בשרת:
      //   1. רק נציג/מנהל (placedByAgentId) - לקוח לא יכול לתמחר
      //   2. רק מוצר שמסומן isFavorite
      //   3. רק כלפי מעלה - מחיר נמוך פוגע בהכנסה ומייצר עמלה שלילית
      //
      // ⚠️ unitPrice נשאר **מחיר המחירון** - הוא הבסיס לחישוב
      // העמלה. מה שנגבה בפועל יושב ב-agentSetPrice.
      let agentSetPrice: number | null = null;
      const wanted = data.favoritePrices?.[pp.product.id];
      // §170: תמחור עצמי - מועדף **או** מוצר שאינו פעיל באתר.
      // שניהם "מוצר שהלקוח לא רואה והנציג מוכר לפי בקשה".
      if (
        wanted != null &&
        placedByAgentId &&
        (pp.product.isFavorite || !pp.product.isActive)
      ) {
        const n = Number(wanted);

        // §179: 🐛 דחייה שקטה. הבדיקה הישנה פשוט לא שמרה מחיר
        // לא תקין, וההזמנה נוצרה במחיר המחירון - בלי שאיש ידע.
        //
        // הנציג הזין מחיר, שלח, וקיבל סכום אחר. הוא לא ידע אם
        // טעה, אם המערכת התעלמה, או אם החישוב שגוי.
        //
        // ⚠️ הטעות השכיחה: הזנת **הסכום הכולל** במקום מחיר לק"ג.
        // 96.90 לק"ג בקרטון של 22 ק"ג = 2131 ₪, והנציג כותב 2131
        // בשדה. השגיאה אומרת לו בדיוק את זה.
        if (!Number.isFinite(n) || n <= 0) {
          return NextResponse.json(
            { error: `מחיר לא תקין עבור "${pp.product.name}"` },
            { status: 400 }
          );
        }
        if (n < unitPrice) {
          return NextResponse.json(
            {
              error:
                `המחיר שהוזן עבור "${pp.product.name}" (${n.toFixed(2)} ₪) נמוך ` +
                `מהמחירון (${unitPrice.toFixed(2)} ₪). לא ניתן לרדת מתחת למחירון.`,
            },
            { status: 400 }
          );
        }
        if (n > unitPrice * 5) {
          const hint = avgWeight
            ? ` יש להזין מחיר לקילו ולא את הסכום הכולל — הקרטון שוקל כ-${avgWeight} ק"ג והמערכת מכפילה לבד.`
            : "";
          return NextResponse.json(
            {
              error:
                `המחיר שהוזן עבור "${pp.product.name}" (${n.toFixed(2)} ₪) גבוה פי ` +
                `${(n / unitPrice).toFixed(1)} מהמחירון (${unitPrice.toFixed(2)} ₪).${hint}`,
            },
            { status: 400 }
          );
        }
        agentSetPrice = n;
      }

      // הלקוח מחויב לפי המחיר שנקבע, לא לפי המחירון
      // §178: 🐛 המחיר המותאם חושב **בלי המשקל**.
      //
      // הקוד היה `chargedPrice * quantity` - כלומר ראש בקרטון
      // של 8 קג במחיר 110₪/קג חויב ב-110 ₪ במקום 880.
      //
      // ⚠️ הבאג נוצר דווקא בתמחור עצמי: בלעדיו smartLineEstimate
      // מכפילה נכון במשקל הממוצע. כלומר קביעת מחיר הפכה חישוב
      // תקין לשגוי, וההפרש גדל ככל שהקרטון כבד יותר.
      //
      // ⚠️ אותה פונקציה בדיוק - היא כבר יודעת מתי להכפיל במשקל
      // ומתי לא. חישוב מקביל היה מתפצל ממנה שוב ביום שמישהו
      // ישנה אחת מהן.
      const chargedPrice = agentSetPrice ?? unitPrice;
      const finalEst =
        agentSetPrice != null
          ? smartLineEstimate(
              chargedPrice,
              item.quantity,
              pp.product.saleType,
              pp.product.priceType,
              pp.product.avgWeightPerUnit != null
                ? Number(pp.product.avgWeightPerUnit)
                : null
            ) ?? Math.round(chargedPrice * item.quantity * 100) / 100
          : est ?? 0;
      if (agentSetPrice != null) {
        estimatedTotal += finalEst - (est ?? 0);
      }

      itemsData.push({
        productId: pp.product.id,
        productName: pp.product.name,
        unit: pp.product.unit,
        isSingle,
        quantity: item.quantity,
        unitPrice,
        agentSetPrice,
        estimatedPrice: finalEst,
        estimatedWeight,
      });
    }
     estimatedTotal = Math.round(estimatedTotal * 100) / 100;

    // 🆕 הוספת דמי הזמנה (תוספת קבועה לכל הזמנה)
    const orderFee = Number(pricelist.orderFee || 0);
    estimatedTotal = Math.round((estimatedTotal + orderFee) * 100) / 100;

    // הזמנה נוצרת עם:
    // - customerId מה-session (לא מהלקוח)
    // - customerName/phone snapshot מהחשבון (לא מהלקוח)
    // - status: PENDING_REVIEW (במקום הישן NEW)
    const order = await prisma.order.create({
      data: {
        pricelistId: data.pricelistId,
        pointId: data.pointId,
        customerId,
        placedByAgentId,
        // §24: מקור ההזמנה. נקבע בשרת לפי מי שמחובר בפועל ולא לפי מה
        // שנשלח מהלקוח, כדי שהתיעוד יהיה אמין.
        // הזמנה טלפונית נוצרת דרך endpoint נפרד ומסמנת PHONE שם.
        source: placedByAgentId ? (role === "ADMIN" ? "ADMIN" : "AGENT") : "WEB",
        // snapshot של מה שהלקוח ראה בזמן ההזמנה
        pointNameSnapshot: plPoint.point.name,
        // §6: תאריך חלוקה חריג של הנקודה עדיף על תאריך המחירון
        deliveryDateSnapshot:
          plPoint.point.customDeliveryDateText || pricelist.deliveryDateText || null,
        pricelistNameSnapshot: pricelist.name,
        // snapshot של פרטי הלקוח מהחשבון
        customerName: customer.name,
        phone: customer.phone ?? "",
        phone2: data.phone2 || null,
        notes: data.notes || null,
        requestedInstallments: data.requestedInstallments ?? 1,
        estimatedTotal,
        // §182: משלוח שנקבע ביצירה.
        //
        // ⚠️ **רק לנציג/מנהל** - placedByAgentId. לקוח ששולח את
        // השדה מנסה לקבוע לעצמו דמי משלוח, וזה מתעלם בשקט ולא
        // נכשל: המסך שלו לא מציע את זה בכלל, ובקשה כזו היא
        // ניסיון עקיפה ולא טעות תמימה.
        //
        // ⚠️ estimatedTotal **אינו** כולל את דמי המשלוח: הוא
        // סכום הפריטים ודמי הטיפול בלבד, בדיוק כמו בכל הזמנה
        // אחרת. המשלוח נוסף בחישוב הסופי (§134), ובתצוגה
        // המשוערת (§180). ערבוב כאן היה מייצר ספירה כפולה.
        ...(deliveryInput
          ? {
              deliveryRequested: true,
              deliveryFee: deliveryInput.fee,
              deliveryAddress: deliveryInput.address,
              deliveryNote: deliveryInput.note || null,
              deliverySetById: placedByAgentId,
              deliverySetAt: new Date(),
            }
          : {}),
        status: "PENDING_REVIEW",
        items: { create: itemsData },
      },
      include: { point: true, items: true },
    });

    // 🐛 תוקן באג סביבתי: הקריאה הייתה ללא await ("fire and forget").
    // ב-Vercel זה *לא עובד* - ברגע שה-route מחזיר תשובה הפונקציה
    // מסתיימת, וכל עבודה שרצה ברקע נקטעת באמצע. התוצאה: המיילים לא
    // נשלחו כלל, ובלי שום שגיאה בלוגים כי הקוד לא הספיק לרוץ.
    //
    // עכשיו ממתינים לשליחה. ה-try/catch הפנימי מבטיח שכישלון במייל
    // לא יפיל את ההזמנה - היא כבר נשמרה ב-DB.
    try {
      await sendOrderNotificationsAsync(order, customer, pricelist);
    } catch (err) {
      console.error("[orders] email send failed (order was saved):", err);
    }

    return NextResponse.json({ ok: true, orderNumber: order.orderNumber, id: order.id });
  } catch (e: any) {
    if (e?.issues) return NextResponse.json({ error: "נתונים שגויים" }, { status: 400 });
    console.error(e);
    return NextResponse.json({ error: "שגיאת שרת" }, { status: 500 });
  }
}

// שליחת התראות אסינכרונית - לא חוסמת את התשובה ללקוח
// הלוגיקה המלאה (Resend + SystemSettings + וואטסאפ) תיכנס לכאן בהמשך
async function sendOrderNotificationsAsync(order: any, customer: any, pricelist: any) {
  try {
    // מייל למנהל
    const adminResult = await sendAdminOrderNotification(order, customer.email);
    if (adminResult.ok) {
      await prisma.order.update({
        where: { id: order.id },
        data: { adminNotifiedAt: new Date() },
      }).catch(() => null);
    } else {
      await prisma.order.update({
        where: { id: order.id },
        data: { adminNotifyError: adminResult.error },
      }).catch(() => null);
    }

    // מייל ללקוח - רק אם יש לו מייל
    if (customer.email) {
      const custResult = await sendCustomerOrderConfirmation(order, customer.email);
      if (custResult.ok) {
        await prisma.order.update({
          where: { id: order.id },
          data: { customerNotifiedAt: new Date() },
        }).catch(() => null);
      } else {
        await prisma.order.update({
          where: { id: order.id },
          data: { customerNotifyError: custResult.error },
        }).catch(() => null);
      }
    }
  } catch (err) {
    console.error("sendOrderNotificationsAsync outer error:", err);
  }
}

// list orders (admin only) - מוגן ב-role בנוסף ל-session
export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user || (session.user as any).role !== "ADMIN") {
    return NextResponse.json({ error: "לא מורשה" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const pointId = searchParams.get("pointId");
  const status = searchParams.get("status");
  const pricelistId = searchParams.get("pricelistId");

  const orders = await prisma.order.findMany({
    where: {
      ...(pointId ? { pointId } : {}),
      ...(status ? { status } : {}),
      ...(pricelistId ? { pricelistId } : {}),
    },
    include: { point: true, items: true },
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json(orders);
}
