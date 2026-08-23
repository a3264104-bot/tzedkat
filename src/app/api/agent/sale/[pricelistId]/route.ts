// §20: מסך הנציג למכירה
// GET /api/agent/sale/[pricelistId] - טעינת כל הנתונים למסך הנציג

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAgent } from "@/lib/agent-guard";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ pricelistId: string }> }
) {
  const g = await requireAgent();
  if (!g.ok) return g.res;

  const { pricelistId } = await params;

  // בדיקה שהמחירון קיים
  const pricelist = await prisma.pricelist.findUnique({
    where: { id: pricelistId },
    select: {
      id: true,
      name: true,
      status: true,
      deliveryDate: true,
      deliveryDateText: true,
      editDeadline: true,
      // §65: נדרש לחישוב מחיר בודדים ב-AddOrderItem, באותה פונקציה
      // של האתר. Pricelist.singleSurcharge הוא זה שקובע (ולא
      // Product.singleSurcharge) - כך זה ב-OrderFlow.
      singleSurcharge: true,
      orderFee: true,
    },
  });
  if (!pricelist) {
    return NextResponse.json({ error: "מחירון לא נמצא" }, { status: 404 });
  }

  // הזמנות: אם הנציג משויך לנקודות - רק ההזמנות שלהן. אם לא (מנהל) - הכל.
  // g.agentPointIds מכיל את *כל* נקודות הנציג (many-to-many), לא רק אחת.
  const whereOrders: any = { pricelistId };
  // §176: 🚨 מערך ריק = **חסימה**, לא "בלי הגבלה".
  //
  // 🐛 `length > 0` דילג על הסינון כשאין נקודות, ואז נציג בלי
  // שיוך ראה את המכירה של **כל הנקודות** - לקוחות של נציגים
  // אחרים, עם שמות, טלפונים וסכומים.
  //
  // ⚠️ המנהל מזוהה ב-isAdmin ולא בהיעדר נקודות - זה בדיוק
  // הבלבול שיצר את הפרצה.
  if (!g.isAdmin) {
    if (g.agentPointIds.length === 0) {
      return NextResponse.json(
        { error: "אין לך נקודת חלוקה משויכת. פנה למנהל." },
        { status: 403 }
      );
    }
    whereOrders.pointId = { in: g.agentPointIds };
  }

  // §45: פרטי כל הנקודות של הנציג.
  // למה זה נדרש: המסך גזר את בורר הנקודות מההזמנות בפועל, ולכן נציג
  // עם שתי נקודות שאין בהן עדיין הזמנות לא ראה בורר כלל - ולא ידע
  // שיש לו יותר מנקודה אחת. עכשיו הבורר נגזר מהרשימה הזו.
  const myPoints =
    g.agentPointIds.length > 0
      ? await prisma.deliveryPoint.findMany({
          where: { id: { in: g.agentPointIds } },
          select: { id: true, name: true, city: true },
          orderBy: { name: "asc" },
        })
      : [];

  const orders = await prisma.order.findMany({
    where: {
      ...whereOrders,
      status: { notIn: ["CANCELLED"] },
    },
    orderBy: [{ createdAt: "asc" }],
    include: {
      point: { select: { id: true, name: true, city: true } },
      customer: {
        select: {
          id: true,
          name: true,
          phone: true,
          // §181: פרטי הלקוח לעריכה מהירה מהמסך.
          //
          // ⚠️ הנציג פוגש את הלקוח בחלוקה ומגלה שהטלפון שגוי או
          // שהוא משלם מזומן. עד היום הוא היה צריך לצאת, לחפש
          // אותו ברשימה, ולחזור - וברוב המקרים פשוט ויתר.
          phone2: true,
          paymentPreference: true,
          paymentToken: true,
        },
      },
      items: {
        include: {
          product: {
            select: {
              id: true,
              name: true,
              unit: true,
              cartonPrice: true,
              singlesMode: true,
              singleUnitPrice: true,
              singleSurcharge: true,
              avgWeightPerUnit: true,
              imageUrl: true,
              // §138: 🐛 saleType לא נשלף, ולכן הבדיקה בטבלה
              // (product?.saleType === "UNIT") הייתה תמיד
              // undefined - והתיקון של §137 לא עשה כלום.
              //
              // ⚠️ הלקח: הוספת בדיקה על שדה מחייבת לוודא שהשדה
              // באמת מגיע. הקוד עבר קומפילציה והתנהג כאילו כל
              // המוצרים נשקלים.
              saleType: true,
              priceType: true,
            },
          },
        },
      },
    },
  });

  // מזדמנים של הנציג הזה במכירה הזאת
  const walkins = await prisma.walkinOrder.findMany({
    where: {
      pricelistId,
      agentId: g.agent.id,
    },
    orderBy: { createdAt: "desc" },
    include: {
      items: {
        include: {
          product: { select: { id: true, name: true, unit: true } },
        },
      },
      // §44: הנקודה שאליה שויך המזדמן - נדרשת לפירוט העמלות לפי נקודה
      point: { select: { id: true, name: true } },
    },
  });

  // תעודות משלוח מאושרות למכירה זו - הנציג רואה כמה יש לו לחלוקה
  const deliveryNotes = await prisma.deliveryNote.findMany({
    where: {
      pricelistId,
      status: "CONFIRMED",
    },
    include: {
      items: {
        include: {
          product: { select: { id: true, name: true } },
        },
      },
    },
  });

  // סיכום ק"ג לפי מוצר מהתעודות (מקור אמת לקרטונים)
  const productWeightsFromNotes: Record<string, number> = {};
  for (const note of deliveryNotes) {
    for (const item of note.items) {
      if (item.productId) {
        productWeightsFromNotes[item.productId] =
          (productWeightsFromNotes[item.productId] || 0) + Number(item.weight);
      }
    }
  }

  // סיכום נציג במכירה זו (אם קיים)
  let summary = await prisma.agentSaleSummary.findUnique({
    where: {
      pricelistId_agentId: {
        pricelistId,
        agentId: g.agent.id,
      },
    },
  });
  // §70: הסיכום נוצר רק לנציג.
  //
  // 🐛 קודם הוא נוצר לכל מי שפתח את המסך - כולל מנהל, שקיבל בכך
  // רשומת AgentSaleSummary ריקה והופיע בדוח התשלומים לנציגים
  // עם עמלה 0 (ואחרי עדכון משקל - עם עמלה על כל המכירה).
  //
  // מנהל מקבל אובייקט סיכום ריק לתצוגה בלבד, בלי כתיבה למסד.
  if (!summary && !g.isAdmin) {
    summary = await prisma.agentSaleSummary.create({
      data: {
        pricelistId,
        agentId: g.agent.id,
        status: "DRAFT",
      },
    });
  }

  // מוצרים זמינים למכירה זו - להחלפת מוצר, הוספת מזדמן, ו-§65
  // הוספת פריט להזמנה קיימת.
  //
  // §7: אין כאן סינון לפי product.isActive **בכוונה**. מוצר לא-פעיל
  // מסונן מהאתר כדי שלא יוצג לכל הלקוחות, אבל הנציג צריך לראות
  // אותו - זה בדיוק התרחיש של פרימיום או כמות מוגבלת שמחליטים
  // למי להביא. הסימון isActive מוחזר כדי שה-UI יציג אותו בנפרד.
  const availableProducts = await prisma.pricelistProduct.findMany({
    where: { pricelistId },
    include: {
      product: {
        select: {
          id: true,
          name: true,
          unit: true,
          categoryId: true,
          category: { select: { name: true } },
          cartonPrice: true,
          singlesMode: true,
          singleUnitPrice: true,
          singleSurcharge: true,
          // §65: נדרשים לבורר קרטון/בודדים ולחישוב ההערכה
          allowSingles: true,
          priceType: true,
          saleType: true,
          avgWeightPerUnit: true,
          isActive: true,
        },
      },
    },
  });

  return NextResponse.json({
    pricelist: {
      ...pricelist,
      singleSurcharge: Number(pricelist.singleSurcharge ?? 0),
      orderFee: Number(pricelist.orderFee ?? 0),
    },
    agent: {
      id: g.agent.id,
      name: g.agent.name,
      // deprecated - נשמר לתאימות אחורה
      point: g.agent.agentPoint,
      // §45: כל הנקודות. מקור האמת לבורר הנקודות במסך.
      points: myPoints,
      commissionRateCarton: Number(g.agent.commissionRateCarton),
      commissionRateSingles: Number(g.agent.commissionRateSingles),
    },
    orders: orders.map((o) => ({
      id: o.id,
      orderNumber: o.orderNumber,
      // §192: השם הנוכחי ולא ה-snapshot. המנהל תיקן שמות, והנציג
      // המשיך לראות את הישנים במסך המכירה ובטבלת המשקלים.
      customerName: o.customer?.name || o.customerName,
      phone: o.phone,
      customer: o.customer,
      point: o.point,
      status: o.status,
      // §21: סימון מסירה - הנציג צריך לראות מה כבר נמסר
      deliveredAt: o.deliveredAt?.toISOString() ?? null,
      deliveredByAgentId: o.deliveredByAgentId,
      // §103: סימון "טופל" של הנציג
      agentClosedAt: o.agentClosedAt?.toISOString() ?? null,
      deliveredNote: o.deliveredNote,
      // §181: הערת הלקוח ותשובת הנציג.
      //
      // 🐛 הן נשמרו ב-§133 אבל לא נשלפו למסך המכירה. הנציג ראה
      // אותן **רק** אם נכנס להזמנה הספציפית - כלומר בפועל לא
      // ראה אותן בכלל, כי אין סיבה להיכנס להזמנה שנראית רגילה.
      //
      // ⚠️ הלקוח כתב "בלי עצם בבקשה", והנציג גילה את זה
      // כשהלקוח כבר קיבל את הסחורה.
      customerNote: o.customerNote,
      customerNoteAt: o.customerNoteAt?.toISOString() ?? null,
      agentReply: o.agentReply,
      agentReplyAt: o.agentReplyAt?.toISOString() ?? null,
      paymentStatus: o.paymentStatus,
      finalTotal: o.finalTotal ? Number(o.finalTotal) : null,
      items: o.items.map((it) => ({
        id: it.id,
        productId: it.productId,
        productName: it.productName,
        unit: it.unit,
        isSingle: it.isSingle,
        quantity: Number(it.quantity),
        unitPrice: Number(it.unitPrice),
        estimatedWeight: it.estimatedWeight ? Number(it.estimatedWeight) : null,
        actualWeight: it.actualWeight ? Number(it.actualWeight) : null,
        agentEnteredWeight: it.agentEnteredWeight ? Number(it.agentEnteredWeight) : null,
        // §119: המחיר שהנציג קבע במוצר מועדף. בלעדיו החישוב
        // בקליינט לעולם לא יופעל, והעמלה תישאר בכלל הרגיל.
        agentSetPrice: it.agentSetPrice != null ? Number(it.agentSetPrice) : null,
        agentNote: it.agentNote,
        isCancelled: it.isCancelled,
        originalProductId: it.originalProductId,
        product: {
          ...it.product,
          cartonPrice: Number(it.product.cartonPrice),
          singleUnitPrice: it.product.singleUnitPrice
            ? Number(it.product.singleUnitPrice)
            : null,
          singleSurcharge: it.product.singleSurcharge
            ? Number(it.product.singleSurcharge)
            : null,
          avgWeightPerUnit: it.product.avgWeightPerUnit
            ? Number(it.product.avgWeightPerUnit)
            : null,
        },
      })),
    })),
    walkins: walkins.map((w) => ({
      id: w.id,
      walkinNumber: w.walkinNumber,
      // §44: שיוך לנקודה
      pointId: w.pointId,
      pointName: w.point?.name ?? null,
      customerName: w.customerName,
      customerPhone: w.customerPhone,
      customerEmail: w.customerEmail,
      paymentMethod: w.paymentMethod,
      paymentReceived: w.paymentReceived,
      paymentNote: w.paymentNote,
      totalAmount: Number(w.totalAmount),
      notes: w.notes,
      summarySentAt: w.summarySentAt?.toISOString() || null,
      summarySentVia: w.summarySentVia,
      items: w.items.map((it) => ({
        id: it.id,
        productId: it.productId,
        productName: it.productName,
        weight: Number(it.weight),
        unitPrice: Number(it.unitPrice),
        isSingle: it.isSingle,
        totalPrice: Number(it.totalPrice),
        product: it.product,
      })),
      createdAt: w.createdAt.toISOString(),
    })),
    deliveryNotes: deliveryNotes.map((n) => ({
      id: n.id,
      supplierName: n.supplierName,
      noteNumber: n.noteNumber,
      confirmedAt: n.confirmedAt?.toISOString(),
      items: n.items.map((it) => ({
        productId: it.productId,
        productName: it.product?.name || it.productNameOnNote,
        quantity: it.quantity,
        weight: Number(it.weight),
      })),
    })),
    productWeightsFromNotes,
    availableProducts: availableProducts.map((pp) => ({
      productId: pp.productId,
      price: Number(pp.price),
      product: {
        ...pp.product,
        cartonPrice: Number(pp.product.cartonPrice),
        singleUnitPrice: pp.product.singleUnitPrice
          ? Number(pp.product.singleUnitPrice)
          : null,
        singleSurcharge: pp.product.singleSurcharge
          ? Number(pp.product.singleSurcharge)
          : null,
        avgWeightPerUnit: pp.product.avgWeightPerUnit
          ? Number(pp.product.avgWeightPerUnit)
          : null,
      },
    })),
    // §70: למנהל אין סיכום - מוחזר אובייקט ריק לתצוגה, והמסך
    // לא ינסה לסגור אותו (ה-PATCH ממילא חוסם מנהל).
    isAdminView: g.isAdmin,
    summary: summary
      ? {
          id: summary.id,
          status: summary.status,
          totalCartonWeight: Number(summary.totalCartonWeight),
          totalSinglesWeight: Number(summary.totalSinglesWeight),
          totalWalkinWeight: Number(summary.totalWalkinWeight),
          totalCustomers: summary.totalCustomers,
          totalWalkins: summary.totalWalkins,
          totalCommission: Number(summary.totalCommission),
          remainderNote: summary.remainderNote,
          confirmedAt: summary.confirmedAt?.toISOString(),
        }
      : {
          id: "",
          status: "DRAFT",
          totalCartonWeight: 0,
          totalSinglesWeight: 0,
          totalWalkinWeight: 0,
          totalCustomers: 0,
          totalWalkins: 0,
          totalCommission: 0,
          remainderNote: null,
          confirmedAt: undefined,
        },
  });
}
