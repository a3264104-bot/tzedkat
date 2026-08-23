// §115: הזמנה דרך אקסל.
//
// GET  ?customerId=&pricelistId=   -> מפיק קובץ להורדה
// POST (multipart: file, customerId) -> מפענח ומחזיר תצוגה מקדימה
// PUT  { customerId, pricelistId, rows } -> יוצר את ההזמנה
//
// ⚠️ הפיצול לשלושה שלבים מכוון: הפענוח **אינו** יוצר הזמנה. המנהל
// רואה בדיוק מה ייווצר, כולל מה נדחה ולמה, ורק אז מאשר. קובץ
// שחזר עם שורה פגומה הוא מקרה שכיח (הלקוח מחק שורה, שינה מחיר,
// שמר בפורמט אחר), ויצירה אוטומטית הייתה קוברת את זה.

import { NextResponse } from "next/server";
// §202: תוקף כרטיס האשראי
import { canChargeCard, expiryMessage } from "@/lib/card-expiry-lib";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/guard";
import { buildOrderExcel, parseOrderExcel, type ExcelRowSpec } from "@/lib/excel-order-lib";

// ═══════════════════════════════════════════════════════════════
// GET — הפקת הקובץ
// ═══════════════════════════════════════════════════════════════
export async function GET(req: Request) {
  const g = await requireAdmin();
  if (!g.ok) return g.res;

  const url = new URL(req.url);
  const customerId = url.searchParams.get("customerId") || "";
  const pricelistId = url.searchParams.get("pricelistId") || "";
  if (!customerId || !pricelistId) {
    return NextResponse.json({ error: "חסר לקוח או מכירה" }, { status: 400 });
  }

  const [customer, pricelist] = await Promise.all([
    prisma.customer.findUnique({
      where: { id: customerId },
      select: {
        id: true,
        name: true,
        phone: true,
        isActive: true,
        defaultPoint: { select: { id: true, name: true } },
      },
    }),
    prisma.pricelist.findUnique({
      where: { id: pricelistId },
      select: {
        id: true,
        name: true,
        status: true,
        deliveryDateText: true,
        singleSurcharge: true,
        products: {
          include: {
            product: {
              select: {
                id: true,
                name: true,
                unit: true,
                cartonPrice: true,
                priceType: true,
                isActive: true,
                allowSingles: true,
                singlesMode: true,
                singleUnitPrice: true,
                kashrut: true,
                kashrutRef: { select: { name: true } },
                category: { select: { name: true } },
              },
            },
          },
        },
      },
    }),
  ]);

  if (!customer) return NextResponse.json({ error: "לקוח לא נמצא" }, { status: 404 });
  if (!pricelist) return NextResponse.json({ error: "מכירה לא נמצאה" }, { status: 404 });
  if (customer.isActive === false) {
    return NextResponse.json({ error: "הלקוח מושבת" }, { status: 400 });
  }
  if (!customer.defaultPoint) {
    return NextResponse.json(
      { error: "ללקוח לא הוגדרה נקודת חלוקה. יש להגדיר לפני הפקת הקובץ." },
      { status: 400 }
    );
  }

  // כמויות מהזמנה קיימת - הקובץ משמש גם לעדכון, והלקוח רואה מה
  // כבר הזמין במקום למלא הכל מחדש
  const existing = await prisma.order.findFirst({
    where: { customerId, pricelistId, status: { notIn: ["CANCELLED"] } },
    select: { items: { where: { isCancelled: false }, select: { productId: true, isSingle: true, quantity: true } } },
  });
  const existingMap = new Map<string, number>();
  for (const it of existing?.items ?? []) {
    existingMap.set(`${it.productId}|${it.isSingle}`, Number(it.quantity));
  }

  const surcharge = Number(pricelist.singleSurcharge ?? 0);
  const rows: ExcelRowSpec[] = [];

  for (const pp of pricelist.products) {
    const p = pp.product;
    if (!p.isActive) continue;
    const base = Number(pp.price ?? p.cartonPrice);
    const kashrut = p.kashrutRef?.name || p.kashrut || "";
    const category = p.category?.name || "כללי";

    rows.push({
      productId: p.id,
      isSingle: false,
      categoryName: category,
      productName: p.name,
      kashrut,
      unit: p.priceType === "PER_KG" ? 'קרטון (מחיר לק"ג)' : p.unit || "יחידה",
      unitPrice: base,
      existingQty: existingMap.get(`${p.id}|false`),
    });

    // ⚠️ שורה נפרדת לבודדים. היחידה והמחיר שונים לגמרי, ומיזוג
    // לשורה אחת היה גורם ללקוח להזמין 12 קרטונים במקום 12 ק"ג.
    if (p.allowSingles) {
      const singlePrice =
        p.singleUnitPrice != null ? Number(p.singleUnitPrice) : base + surcharge;
      rows.push({
        productId: p.id,
        isSingle: true,
        categoryName: category,
        productName: p.name,
        kashrut,
        unit: p.singlesMode === "UNITS" ? "יחידות" : 'ק"ג',
        unitPrice: singlePrice,
        existingQty: existingMap.get(`${p.id}|true`),
      });
    }
  }

  rows.sort(
    (a, b) =>
      a.categoryName.localeCompare(b.categoryName, "he") ||
      a.productName.localeCompare(b.productName, "he") ||
      Number(a.isSingle) - Number(b.isSingle)
  );

  const buf = await buildOrderExcel(
    {
      customerName: customer.name,
      customerPhone: customer.phone || "",
      pointName: customer.defaultPoint.name,
      saleName: pricelist.name,
      pricelistId: pricelist.id,
      deliveryDateText: pricelist.deliveryDateText,
      singleSurcharge: surcharge,
    },
    rows
  );

  const safeName = customer.name.replace(/[^\u0590-\u05FF\w\s-]/g, "").trim() || "customer";
  return new NextResponse(buf as any, {
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(
        `הזמנה-${safeName}.xlsx`
      )}`,
    },
  });
}

// ═══════════════════════════════════════════════════════════════
// POST — פענוח ותצוגה מקדימה
// ═══════════════════════════════════════════════════════════════
export async function POST(req: Request) {
  const g = await requireAdmin();
  if (!g.ok) return g.res;

  const form = await req.formData().catch(() => null);
  const file = form?.get("file") as File | null;
  const customerId = String(form?.get("customerId") || "");
  if (!file) return NextResponse.json({ error: "לא נבחר קובץ" }, { status: 400 });
  if (!customerId) return NextResponse.json({ error: "חסר לקוח" }, { status: 400 });

  let parsed;
  try {
    parsed = await parseOrderExcel(Buffer.from(await file.arrayBuffer()));
  } catch {
    return NextResponse.json(
      { error: "לא ניתן לקרוא את הקובץ. יש לוודא שזהו קובץ אקסל תקין (xlsx)." },
      { status: 400 }
    );
  }

  if (!parsed.pricelistId) {
    return NextResponse.json(
      { error: "הקובץ אינו מכיל שורות מזוהות. ייתכן שהוא לא הופק מהמערכת." },
      { status: 400 }
    );
  }

  const [customer, pricelist] = await Promise.all([
    prisma.customer.findUnique({
      where: { id: customerId },
      select: {
        id: true,
        name: true,
        phone: true,
        isActive: true,
        paymentToken: true,
        paymentPreference: true,
        defaultPoint: { select: { id: true, name: true } },
      },
    }),
    prisma.pricelist.findUnique({
      where: { id: parsed.pricelistId },
      select: {
        id: true,
        name: true,
        status: true,
        closeDate: true,
        orderFee: true,
        singleSurcharge: true,
        deliveryDateText: true,
        products: {
          include: {
            product: {
              select: {
                id: true,
                name: true,
                unit: true,
                cartonPrice: true,
                priceType: true,
                isActive: true,
                allowSingles: true,
                singlesMode: true,
                singleUnitPrice: true,
                avgWeightPerUnit: true,
              },
            },
          },
        },
      },
    }),
  ]);

  if (!customer) return NextResponse.json({ error: "לקוח לא נמצא" }, { status: 404 });
  if (!pricelist) return NextResponse.json({ error: "המכירה בקובץ לא נמצאה" }, { status: 404 });

  // ─── חסימות. אותן חסימות בדיוק כמו בכל ערוץ אחר. ───
  const blockers: string[] = [];
  // §207: אזהרות שאינן חוסמות - המנהל רואה אותן ומחליט.
  const warnings: string[] = [];
  if (customer.isActive === false) blockers.push("הלקוח מושבת");
  if (!customer.defaultPoint) blockers.push("ללקוח לא הוגדרה נקודת חלוקה");
  // §61: אין הזמנה בלי אמצעי תשלום - גם כאן. ערוץ חדש אינו פרצה.
  if (!customer.paymentToken && customer.paymentPreference !== "CASH") {
    blockers.push("ללקוח אין אמצעי תשלום — יש להזין כרטיס או לסמן כלקוח מזומן");
  }
  // §202: כרטיס שפג תוקפו - גם כאן.
  //
  // ⚠️ הערוץ הזה שקט: הלקוח שולח אקסל ומקבל אישור במייל. אם
  // הכרטיס פג, החיוב ייכשל אחרי החלוקה ואיש לא ידע בזמן.
  else if (
    customer.paymentPreference !== "CASH" &&
    !canChargeCard((customer as any).cardExpiry)
  ) {
    blockers.push(
      expiryMessage((customer as any).cardExpiry) ??
        "תוקף כרטיס האשראי של הלקוח פג"
    );
  }
  if (pricelist.status !== "ACTIVE") blockers.push("המכירה אינה פעילה");
  // §207: 🐛 המנהל נחסם במסלול שרק הוא משתמש בו.
  //
  // הערוץ הזה נגיש **רק דרך /admin/excel-order** (requireAdmin
  // בראש הקובץ), ולכן חסימת שעת הסגירה כאן חסמה בדיוק את מי
  // שאמור לעבור אותה - בניגוד ל-§206 שפתח את זה במסלול הרגיל.
  //
  // ⚠️ אזהרה ולא חסימה: המנהל צריך **לדעת** שההזמנה מחוץ לספירה,
  // בדיוק כמו הבאנר האדום במסך ההזמנה.
  const afterClose =
    pricelist.closeDate != null && new Date() > pricelist.closeDate;
  if (afterClose) {
    warnings.push(
      "⚠️ המכירה כבר נסגרה — הזמנה זו לא נכללת בהזמנה ששודרה לספק"
    );
  }

  // ─── תמחור בשרת ───
  // ⚠️ המחיר **נשלף מחדש מהמחירון** ולא נלקח מהקובץ. החתימה מגלה
  // שינוי, אבל מקור האמת הוא תמיד המסד. גם קובץ ישן שהמחיר בו
  // השתנה מאז יתומחר נכון.
  const byId = new Map(pricelist.products.map((pp) => [pp.product.id, pp]));
  const surcharge = Number(pricelist.singleSurcharge ?? 0);
  const issues = [...parsed.issues];
  const items: any[] = [];

  for (const r of parsed.rows) {
    const pp = byId.get(r.productId);
    if (!pp || !pp.product.isActive) {
      issues.push({
        rowNumber: 0,
        productName: r.productName,
        reason: "המוצר אינו קיים או אינו פעיל במכירה",
      });
      continue;
    }
    if (r.isSingle && !pp.product.allowSingles) {
      issues.push({
        rowNumber: 0,
        productName: r.productName,
        reason: "המוצר אינו נמכר בבודדים",
      });
      continue;
    }

    const base = Number(pp.price ?? pp.product.cartonPrice);
    const unitPrice = r.isSingle
      ? pp.product.singleUnitPrice != null
        ? Number(pp.product.singleUnitPrice)
        : base + surcharge
      : base;

    const avgW =
      pp.product.avgWeightPerUnit != null ? Number(pp.product.avgWeightPerUnit) : null;
    const estimatedWeight = r.isSingle
      ? r.quantity
      : avgW
        ? avgW * r.quantity
        : null;

    // מוצר שנמכר לפי משקל: המחיר הוא לק"ג, והסכום המשוער נגזר
    // מהמשקל המשוער. אחרת: מחיר × כמות.
    const estimatedPrice =
      !r.isSingle && pp.product.priceType === "PER_KG" && avgW
        ? unitPrice * avgW * r.quantity
        : unitPrice * r.quantity;

    items.push({
      productId: r.productId,
      productName: pp.product.name,
      unit: r.isSingle
        ? pp.product.singlesMode === "UNITS"
          ? "יחידות"
          : 'ק"ג'
        : pp.product.unit || "יחידה",
      isSingle: r.isSingle,
      quantity: r.quantity,
      unitPrice,
      estimatedWeight,
      estimatedPrice: Math.round(estimatedPrice * 100) / 100,
      priceInFile: r.priceInFile,
      priceChanged: Math.abs(r.priceInFile - unitPrice) > 0.01,
    });
  }

  const itemsTotal = items.reduce((s, i) => s + i.estimatedPrice, 0);
  const orderFee = Number(pricelist.orderFee ?? 0);

  return NextResponse.json({
    customer: {
      id: customer.id,
      name: customer.name,
      phone: customer.phone,
      pointName: customer.defaultPoint?.name ?? null,
    },
    pricelist: {
      id: pricelist.id,
      name: pricelist.name,
      deliveryDateText: pricelist.deliveryDateText,
    },
    blockers,
    // §207: אזהרות שאינן חוסמות (למשל: אחרי שעת הסגירה)
    warnings,
    signatureChecked: parsed.signatureChecked,
    items,
    issues,
    totals: {
      itemsTotal: Math.round(itemsTotal * 100) / 100,
      orderFee,
      estimatedTotal: Math.round((itemsTotal + orderFee) * 100) / 100,
    },
  });
}

// ═══════════════════════════════════════════════════════════════
// PUT — יצירת ההזמנה
// ═══════════════════════════════════════════════════════════════
export async function PUT(req: Request) {
  const g = await requireAdmin();
  if (!g.ok) return g.res;

  const b = await req.json().catch(() => ({}));
  const customerId = String(b.customerId || "");
  const pricelistId = String(b.pricelistId || "");
  const rows: { productId: string; isSingle: boolean; quantity: number }[] = Array.isArray(
    b.rows
  )
    ? b.rows
    : [];

  if (!customerId || !pricelistId || rows.length === 0) {
    return NextResponse.json({ error: "חסרים נתונים ליצירת ההזמנה" }, { status: 400 });
  }

  const [customer, pricelist] = await Promise.all([
    prisma.customer.findUnique({
      where: { id: customerId },
      select: {
        id: true,
        // §115: name ו-phone הם שדות **חובה** ב-Order - צילום מצב
        // של פרטי הלקוח בזמן ההזמנה, כדי שדוח ישן יישאר נכון גם
        // אחרי ששם או טלפון עודכנו.
        name: true,
        phone: true,
        isActive: true,
        paymentToken: true,
        paymentPreference: true,
        defaultPointId: true,
        defaultPoint: { select: { id: true, name: true } },
      },
    }),
    prisma.pricelist.findUnique({
      where: { id: pricelistId },
      select: {
        id: true,
        status: true,
        closeDate: true,
        orderFee: true,
        singleSurcharge: true,
        deliveryDateText: true,
        products: {
          include: {
            product: {
              select: {
                id: true,
                name: true,
                unit: true,
                cartonPrice: true,
                priceType: true,
                isActive: true,
                allowSingles: true,
                singlesMode: true,
                singleUnitPrice: true,
                avgWeightPerUnit: true,
              },
            },
          },
        },
      },
    }),
  ]);

  // ⚠️ **כל החסימות נבדקות שוב כאן.** התצוגה המקדימה היא ממשק,
  // וממשק אפשר לעקוף. מנהל שהשאיר את המסך פתוח בזמן שהמכירה
  // נסגרה, או שלקוח הושבת בינתיים, לא ייצור הזמנה שגויה.
  if (!customer) return NextResponse.json({ error: "לקוח לא נמצא" }, { status: 404 });
  if (!pricelist) return NextResponse.json({ error: "מכירה לא נמצאה" }, { status: 404 });
  if (customer.isActive === false) {
    return NextResponse.json({ error: "הלקוח מושבת" }, { status: 400 });
  }
  if (!customer.defaultPointId || !customer.defaultPoint) {
    return NextResponse.json({ error: "ללקוח לא הוגדרה נקודת חלוקה" }, { status: 400 });
  }
  if (!customer.paymentToken && customer.paymentPreference !== "CASH") {
    return NextResponse.json(
      { error: "ללקוח אין אמצעי תשלום. יש להזין כרטיס או לסמן כלקוח מזומן." },
      { status: 400 }
    );
  }
  // §202: כרטיס שפג - חסימה גם באישור ההזמנה, ולא רק בתצוגה
  // המקדימה. שתי נקודות בדיקה, כי אפשר להגיע לכאן ישירות.
  if (
    customer.paymentPreference !== "CASH" &&
    !canChargeCard((customer as any).cardExpiry)
  ) {
    return NextResponse.json(
      {
        error:
          expiryMessage((customer as any).cardExpiry) ??
          "תוקף כרטיס האשראי של הלקוח פג",
      },
      { status: 400 }
    );
  }
  if (pricelist.status !== "ACTIVE") {
    return NextResponse.json({ error: "המכירה אינה פעילה" }, { status: 400 });
  }
  // §207: החסימה הוסרה - זהו מסלול מנהל בלבד (requireAdmin), והוא
  // רשאי להזין אחרי הסגירה בדיוק כמו במסך ההזמנה (§206).
  //
  // ⚠️ המכירה עדיין חייבת להיות ACTIVE - הבדיקה שמעל נשארת.
  // מה שהוסר הוא **רק** מגבלת השעה.

  const byId = new Map(pricelist.products.map((pp) => [pp.product.id, pp]));
  const surcharge = Number(pricelist.singleSurcharge ?? 0);
  const itemsData: any[] = [];

  for (const r of rows) {
    const pp = byId.get(r.productId);
    if (!pp || !pp.product.isActive) continue;
    if (r.isSingle && !pp.product.allowSingles) continue;
    const qty = Number(r.quantity);
    if (!Number.isFinite(qty) || qty <= 0) continue;

    const base = Number(pp.price ?? pp.product.cartonPrice);
    const unitPrice = r.isSingle
      ? pp.product.singleUnitPrice != null
        ? Number(pp.product.singleUnitPrice)
        : base + surcharge
      : base;
    const avgW =
      pp.product.avgWeightPerUnit != null ? Number(pp.product.avgWeightPerUnit) : null;
    const estimatedWeight = r.isSingle ? qty : avgW ? avgW * qty : null;
    const estimatedPrice =
      !r.isSingle && pp.product.priceType === "PER_KG" && avgW
        ? unitPrice * avgW * qty
        : unitPrice * qty;

    itemsData.push({
      productId: r.productId,
      productName: pp.product.name,
      unit: r.isSingle
        ? pp.product.singlesMode === "UNITS"
          ? "יחידות"
          : 'ק"ג'
        : pp.product.unit || "יחידה",
      isSingle: r.isSingle,
      quantity: qty,
      unitPrice,
      estimatedWeight,
      estimatedPrice: Math.round(estimatedPrice * 100) / 100,
    });
  }

  if (itemsData.length === 0) {
    return NextResponse.json({ error: "אין פריטים תקינים ליצירת הזמנה" }, { status: 400 });
  }

  const itemsTotal = itemsData.reduce((s, i) => s + i.estimatedPrice, 0);
  const orderFee = Number(pricelist.orderFee ?? 0);

  // ⚠️ עדכון = מחיקה ויצירה, בטרנזקציה אחת.
  //
  // שליחה חוזרת של הקובץ מחליפה את ההזמנה הקודמת ולא מוסיפה לה.
  // זו ההתנהגות שהלקוח מצפה לה: הוא מילא קובץ מלא, לא תוספת.
  //
  // הטרנזקציה חיונית - בלעדיה כשל באמצע היה משאיר את הלקוח בלי
  // הזמנה בכלל, אחרי שהישנה כבר נמחקה.
  const result = await prisma.$transaction(async (tx) => {
    const existing = await tx.order.findFirst({
      where: { customerId, pricelistId, status: { notIn: ["CANCELLED"] } },
      select: { id: true, orderNumber: true, paymentStatus: true },
    });

    // הזמנה ששולמה כבר לא נמחקת - החלפתה הייתה מוחקת רישום כספי
    if (existing && (existing.paymentStatus === "PAID" || existing.paymentStatus === "PARTIALLY_PAID")) {
      throw new Error(
        `להזמנה #${existing.orderNumber} כבר בוצע תשלום ולכן לא ניתן להחליפה מקובץ. יש לערוך אותה ידנית.`
      );
    }

    if (existing) {
      await tx.orderItem.deleteMany({ where: { orderId: existing.id } });
      await tx.order.delete({ where: { id: existing.id } });
    }

    return tx.order.create({
      data: {
        customerId,
        // צילום מצב - שדות חובה במודל
        customerName: customer.name,
        phone: customer.phone ?? "",
        pricelistId,
        pointId: customer.defaultPointId!,
        pointNameSnapshot: customer.defaultPoint!.name,
        deliveryDateSnapshot: pricelist.deliveryDateText,
        source: "EXCEL",
        status: "PENDING_REVIEW",
        estimatedTotal: Math.round((itemsTotal + orderFee) * 100) / 100,
        items: { create: itemsData },
      },
      select: { id: true, orderNumber: true },
    });
  }).catch((e: any) => {
    throw e;
  });

  console.log(
    `[excel-order] created order #${result.orderNumber} for customer=${customerId} items=${itemsData.length}`
  );

  return NextResponse.json({
    ok: true,
    orderId: result.id,
    orderNumber: result.orderNumber,
    itemCount: itemsData.length,
  });
}
