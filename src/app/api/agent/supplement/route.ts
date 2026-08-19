// ═══════════════════════════════════════════════════════════════
// §120: הזמנת תוספת בחלוקה
// ═══════════════════════════════════════════════════════════════
// POST /api/agent/supplement
// Body: { parentOrderId, productId, quantity, isSingle, agentSetPrice?, payCash? }
//
// התרחיש: ההזמנה נשקלה וכבר חויבה, ובחלוקה הלקוח מבקש עוד משהו -
// למשל ראש. הוספה להזמנה המקורית הייתה יוצרת חוב שלא ייגבה,
// כי החיוב כבר יצא.
//
// כאן נוצרת **הזמנה נפרדת** שנגבית בנפרד, וקשורה למקורית דרך
// parentOrderId - כך שכולם רואים שזו תוספת ולא הזמנה כפולה.
//
// ⚠️ שני מסלולי תשלום:
//   • אשראי - הכרטיס השמור, חיוב רגיל אחרי השקילה
//   • מזומן - הלקוח משלם במקום, והנציג מסמן. אין כרטיס? זו
//     האפשרות היחידה, וחשוב שתהיה - אחרת נוצר בדיוק החוב
//     שהמערכת נבנתה כדי למנוע.

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAgent } from "@/lib/agent-guard";
import { effectiveUnitPrice, smartLineEstimate } from "@/lib/pricing";
import { validateAgentPrice } from "@/lib/commission-lib";

export async function POST(req: Request) {
  const g = await requireAgent();
  if (!g.ok) return g.res;

  const b = await req.json().catch(() => ({}));
  const parentOrderId = String(b.parentOrderId || "").trim();
  const productId = String(b.productId || "").trim();
  const isSingle = !!b.isSingle;
  const quantity = Number(b.quantity);
  const payCash = !!b.payCash;

  if (!parentOrderId || !productId) {
    return NextResponse.json({ error: "חסרים נתונים" }, { status: 400 });
  }
  if (!Number.isFinite(quantity) || quantity <= 0) {
    return NextResponse.json({ error: "כמות לא תקינה" }, { status: 400 });
  }

  const parent = await prisma.order.findUnique({
    where: { id: parentOrderId },
    select: {
      id: true,
      orderNumber: true,
      customerId: true,
      customerName: true,
      phone: true,
      pointId: true,
      pointNameSnapshot: true,
      deliveryDateSnapshot: true,
      pricelistId: true,
      status: true,
      customer: {
        select: {
          paymentToken: true,
          paymentPreference: true,
          isActive: true,
        },
      },
    },
  });
  if (!parent) {
    return NextResponse.json({ error: "ההזמנה המקורית לא נמצאה" }, { status: 404 });
  }
  if (!parent.pricelistId) {
    return NextResponse.json({ error: "ההזמנה אינה משויכת למכירה" }, { status: 400 });
  }

  // בדיקת שייכות. מערך ריק אצל נציג = אין נקודות, לא "בלי הגבלה".
  if (!g.isAdmin) {
    if (g.agentPointIds.length === 0) {
      return NextResponse.json(
        { error: "אין לך נקודת חלוקה משויכת. פנה למנהל." },
        { status: 403 }
      );
    }
    if (!g.agentPointIds.includes(parent.pointId)) {
      return NextResponse.json(
        { error: "אין הרשאה - ההזמנה לא באחת מהנקודות שלך" },
        { status: 403 }
      );
    }
  }

  if (parent.customer?.isActive === false) {
    return NextResponse.json({ error: "הלקוח מושבת" }, { status: 400 });
  }

  // ⚠️ כיסוי: אשראי או מזומן. אין שלישי.
  //
  // זו אותה חסימה של §61, ובדיוק מאותה סיבה. תוספת בלי כיסוי היא
  // חוב - וזה מה שהמערכת כולה נבנתה כדי לסיים.
  const hasCard = !!parent.customer?.paymentToken;
  if (!payCash && !hasCard) {
    return NextResponse.json(
      {
        error:
          "ללקוח אין כרטיס שמור. יש לסמן תשלום במזומן, או להזין כרטיס בכרטיס הלקוח.",
        needsPaymentChoice: true,
      },
      { status: 400 }
    );
  }

  // ─── המוצר והמחיר מהמחירון ───
  const pp = await prisma.pricelistProduct.findUnique({
    where: {
      pricelistId_productId: { pricelistId: parent.pricelistId, productId },
    },
    include: {
      product: {
        select: {
          id: true,
          name: true,
          unit: true,
          cartonPrice: true,
          saleType: true,
          priceType: true,
          allowSingles: true,
          singlesMode: true,
          singleUnitPrice: true,
          avgWeightPerUnit: true,
          isActive: true,
          isFavorite: true,
        },
      },
    },
  });
  if (!pp) {
    return NextResponse.json(
      { error: "המוצר אינו נכלל במכירה הזו ולכן אין לו מחיר" },
      { status: 400 }
    );
  }
  const product = pp.product;

  if (isSingle && !product.allowSingles) {
    return NextResponse.json(
      { error: `המוצר "${product.name}" אינו נמכר בבודדים` },
      { status: 400 }
    );
  }

  const pl = await prisma.pricelist.findUnique({
    where: { id: parent.pricelistId },
    select: { singleSurcharge: true },
  });

  const unitPrice = effectiveUnitPrice(
    Number(pp.price ?? product.cartonPrice),
    isSingle,
    Number(pl?.singleSurcharge ?? 0),
    product.singlesMode || "KG",
    product.singleUnitPrice != null ? Number(product.singleUnitPrice) : null
  );

  // §119: מחיר שהנציג קבע - מוצר מועדף בלבד, העלאה בלבד
  let agentSetPrice: number | null = null;
  if (b.agentSetPrice !== null && b.agentSetPrice !== undefined && b.agentSetPrice !== "") {
    if (!product.isFavorite) {
      return NextResponse.json(
        { error: "ניתן לקבוע מחיר מותאם רק במוצר מועדף" },
        { status: 400 }
      );
    }
    const n = Number(b.agentSetPrice);
    const v = validateAgentPrice(n, unitPrice);
    if (!v.ok) return NextResponse.json({ error: v.error }, { status: 400 });
    agentSetPrice = n;
  }

  const chargedPrice = agentSetPrice ?? unitPrice;

  const estimatedPrice = isSingle
    ? Math.round(chargedPrice * quantity * 100) / 100
    : smartLineEstimate(
        chargedPrice,
        quantity,
        product.saleType,
        product.priceType,
        product.avgWeightPerUnit != null ? Number(product.avgWeightPerUnit) : null
      ) ?? Math.round(chargedPrice * quantity * 100) / 100;

  const estimatedWeight =
    !isSingle && product.avgWeightPerUnit != null
      ? Math.round(Number(product.avgWeightPerUnit) * quantity * 100) / 100
      : null;

  // ─── יצירת הזמנת התוספת ───
  //
  // ⚠️ בלי orderFee: דמי הטיפול נגבו כבר בהזמנה המקורית, וגבייה
  // חוזרת עליהם על תוספת של פריט אחד היא חיוב כפול.
  const supplement = await prisma.order.create({
    data: {
      customerId: parent.customerId,
      customerName: parent.customerName,
      phone: parent.phone,
      pricelistId: parent.pricelistId,
      pointId: parent.pointId,
      pointNameSnapshot: parent.pointNameSnapshot,
      deliveryDateSnapshot: parent.deliveryDateSnapshot,
      parentOrderId: parent.id,
      source: "AGENT",
      status: "PENDING_REVIEW",
      estimatedTotal: estimatedPrice,
      // מזומן מסומן מיד: הלקוח משלם בחלוקה, ואין כרטיס לחייב.
      // ⚠️ paymentStatus נשאר PENDING עד השקילה - הסכום הסופי
      // טרם ידוע, וסימון PAID כאן היה נועל סכום שגוי.
      paymentMethod: payCash ? "CASH" : null,
      internalNotes: `תוספת להזמנה #${parent.orderNumber} · נוסף ע"י ${g.agent.name}${
        payCash ? " · תשלום במזומן" : ""
      }`,
      items: {
        create: {
          productId: product.id,
          productName: product.name,
          unit: isSingle && product.singlesMode !== "UNITS" ? 'ק"ג' : product.unit,
          isSingle,
          quantity,
          unitPrice,
          agentSetPrice,
          estimatedPrice,
          estimatedWeight,
          agentEnteredById: g.agent.id,
          agentNote:
            `תוספת בחלוקה · ${g.agent.name}` +
            (agentSetPrice != null
              ? ` · מחיר שנקבע: ${agentSetPrice.toFixed(2)}`
              : ""),
        },
      },
    },
    select: { id: true, orderNumber: true },
  });

  console.log(
    `[supplement] order #${supplement.orderNumber} created for parent #${parent.orderNumber} ` +
      `product=${productId} qty=${quantity} cash=${payCash} agent=${g.agent.id}`
  );

  return NextResponse.json({
    ok: true,
    orderId: supplement.id,
    orderNumber: supplement.orderNumber,
    parentOrderNumber: parent.orderNumber,
    estimatedTotal: estimatedPrice,
    payCash,
  });
}
