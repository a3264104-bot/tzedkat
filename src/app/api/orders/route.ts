import { NextResponse } from "next/server";
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
  // אם נציג מזמין בשם לקוח - מזהה הלקוח שעבורו מזמינים
  onBehalfOfCustomerId: z.string().optional().nullable(),
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
      // אם הנציג מוגבל לנקודה - מוודאים שהלקוח שייך לנקודה הזו
      if (role === "AGENT") {
        const agent = await prisma.customer.findUnique({ where: { id: sessionUserId } });
        if (agent?.agentPointId) {
          const belongs =
            targetCustomer.defaultPointId === agent.agentPointId ||
            (await prisma.order.count({
              where: { customerId: targetCustomer.id, pointId: agent.agentPointId },
            })) > 0;
          if (!belongs) {
            return NextResponse.json(
              { error: "אין לך הרשאה להזמין עבור לקוח זה" },
              { status: 403 }
            );
          }
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

    // אכיפת אימות כרטיס: לקוח שמזמין לעצמו חייב כרטיס מאומת (טוקן שמור)
    // לפני שמירת הזמנה. זה סוגר את האפשרות לעקוף את אימות ה-1 ש"ח.
    // נציג/מנהל שמזמין בשם לקוח - פטור (הוא לוקח אחריות על הגבייה).
    if (!placedByAgentId && role === "CUSTOMER" && !customer.paymentToken) {
      return NextResponse.json(
        {
          error: "נדרש אימות כרטיס אשראי לפני שמירת ההזמנה",
          code: "CARD_VERIFICATION_REQUIRED",
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

    // המכירה חייבת להתקיים ולהיות פעילה
    if (!pricelist || pricelist.status !== "ACTIVE") {
      return NextResponse.json({ error: "המכירה אינה פעילה" }, { status: 400 });
    }

    // אם הוגדרה שעת סגירה ועברה — אי אפשר להזמין
    if (pricelist.closeDate && new Date() > new Date(pricelist.closeDate)) {
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

    // נקודת החלוקה חייבת להשתתף במכירה הזו
    const plPoint = pricelist.points.find((x) => x.pointId === data.pointId);
    if (!plPoint) {
      return NextResponse.json(
        { error: "נקודת החלוקה אינה משתתפת במכירה זו" },
        { status: 400 }
      );
    }

    const surcharge = Number(pricelist.singleSurcharge);

    // build server-side priced items - לא סומכים על מחירים מהלקוח
    const itemsData = [];
    let estimatedTotal = 0;
    for (const item of data.items) {
      const pp = pricelist.products.find((x) => x.productId === item.productId);
      if (!pp) return NextResponse.json({ error: "מוצר לא נמצא במחירון" }, { status: 400 });
      if (!pp.product.isActive)
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
      itemsData.push({
        productId: pp.product.id,
        productName: pp.product.name,
        unit: pp.product.unit,
        isSingle,
        quantity: item.quantity,
        unitPrice,
        estimatedPrice: est ?? 0,
        estimatedWeight,
      });
    }
    estimatedTotal = Math.round(estimatedTotal * 100) / 100;

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
        estimatedTotal,
        status: "PENDING_REVIEW",
        items: { create: itemsData },
      },
      include: { point: true, items: true },
    });

    // שליחת מיילים - לא חוסמת את ההצלחה אפילו אם נכשלת
    // (לוגיקת המייל המלאה תיבנה בנפרד כשיהיה Resend + SystemSettings מחוברים)
    sendOrderNotificationsAsync(order, customer, pricelist).catch((err) => {
      console.error("order notification error (non-blocking):", err);
    });

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
