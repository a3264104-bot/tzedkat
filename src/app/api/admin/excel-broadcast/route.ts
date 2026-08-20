// ═══════════════════════════════════════════════════════════════
// §145: שליחת קבצי אקסל ללקוחות שביקשו
// ═══════════════════════════════════════════════════════════════
// POST /api/admin/excel-broadcast   { pricelistId, force? }
// GET  /api/admin/excel-broadcast?pricelistId=  -> מי יקבל, ומה נשלח
//
// התרחיש: מכירה מופעלת, ולקוחות שסומנו כ"רוצים אקסל" מקבלים
// אוטומטית קובץ עם כל מוצרי המכירה. הם ממלאים כמויות ומחזירים
// במייל, והמנהל מעלה את הקובץ במסך ההזמנה דרך אקסל.
//
// ⚠️ למה לא cron: המנהל מפעיל מכירה ידנית, ולכן הרגע הנכון לשלוח
// הוא הרגע הזה. cron היה שולח באיחור, או שולח למכירה שהופעלה
// בטעות ונסגרה מיד.

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/guard";
import { buildOrderExcel, type ExcelRowSpec } from "@/lib/excel-order-lib";
import { sendExcelOrderEmail } from "@/lib/email";

// ═══════════════════════════════════════════════════════════════
// GET - מי יקבל
// ═══════════════════════════════════════════════════════════════
export async function GET(req: Request) {
  const g = await requireAdmin();
  if (!g.ok) return g.res;

  const url = new URL(req.url);
  const pricelistId = url.searchParams.get("pricelistId");
  if (!pricelistId) {
    return NextResponse.json({ error: "חסר מזהה מכירה" }, { status: 400 });
  }

  const [pricelist, candidates] = await Promise.all([
    prisma.pricelist.findUnique({
      where: { id: pricelistId },
      select: {
        id: true,
        name: true,
        status: true,
        agentOnly: true,
        excelSentAt: true,
        excelSentCount: true,
      },
    }),
    prisma.customer.findMany({
      where: { wantsExcelOrder: true, isActive: true },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        defaultPointId: true,
        defaultPoint: { select: { name: true } },
      },
      orderBy: { name: "asc" },
    }),
  ]);

  if (!pricelist) {
    return NextResponse.json({ error: "מכירה לא נמצאה" }, { status: 404 });
  }

  // ⚠️ שני תנאים חוסמים, ושניהם מדווחים בנפרד: לקוח בלי מייל אין
  // לאן לשלוח לו, ולקוח בלי נקודת חלוקה - הקובץ נבנה עם הנקודה
  // שלו בכותרת, ובלעדיה הוא לא יידע לאן להגיע.
  const ready = candidates.filter((c) => c.email && c.defaultPointId);
  const noEmail = candidates.filter((c) => !c.email);
  const noPoint = candidates.filter((c) => c.email && !c.defaultPointId);

  return NextResponse.json({
    pricelist,
    ready: ready.map((c) => ({
      id: c.id,
      name: c.name,
      email: c.email,
      pointName: c.defaultPoint?.name ?? null,
    })),
    blocked: {
      noEmail: noEmail.map((c) => ({ id: c.id, name: c.name, phone: c.phone })),
      noPoint: noPoint.map((c) => ({ id: c.id, name: c.name, phone: c.phone })),
    },
    counts: {
      total: candidates.length,
      ready: ready.length,
      noEmail: noEmail.length,
      noPoint: noPoint.length,
    },
  });
}

// ═══════════════════════════════════════════════════════════════
// POST - שליחה
// ═══════════════════════════════════════════════════════════════
export async function POST(req: Request) {
  const g = await requireAdmin();
  if (!g.ok) return g.res;

  const b = await req.json().catch(() => ({}));
  const pricelistId = String(b.pricelistId || "");
  if (!pricelistId) {
    return NextResponse.json({ error: "חסר מזהה מכירה" }, { status: 400 });
  }

  const pricelist = await prisma.pricelist.findUnique({
    where: { id: pricelistId },
    select: {
      id: true,
      name: true,
      status: true,
      agentOnly: true,
      closeDate: true,
      deliveryDateText: true,
      singleSurcharge: true,
      excelSentAt: true,
      excelSentCount: true,
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
  });

  if (!pricelist) {
    return NextResponse.json({ error: "מכירה לא נמצאה" }, { status: 404 });
  }
  if (pricelist.status !== "ACTIVE") {
    return NextResponse.json(
      { error: "ניתן לשלוח רק ממכירה פעילה" },
      { status: 400 }
    );
  }
  // ⚠️ מכירה לנציגים בלבד לא נשלחת ללקוחות - זו כל הנקודה שלה.
  if (pricelist.agentOnly) {
    return NextResponse.json(
      { error: "המכירה מיועדת לנציגים בלבד ואינה נשלחת ללקוחות" },
      { status: 400 }
    );
  }
  // ⚠️ שליחה חוזרת דורשת אישור מפורש. מנהל שסוגר ומפעיל מכירה
  // מחדש לא צריך להציף את הלקוחות באותו קובץ פעמיים.
  if (pricelist.excelSentAt && !b.force) {
    return NextResponse.json(
      {
        error: `כבר נשלחו קבצים למכירה זו ב-${pricelist.excelSentAt.toLocaleString("he-IL")} (${pricelist.excelSentCount} נמענים). לשליחה חוזרת יש לאשר.`,
        code: "ALREADY_SENT",
        sentAt: pricelist.excelSentAt.toISOString(),
        sentCount: pricelist.excelSentCount,
      },
      { status: 409 }
    );
  }

  const customers = await prisma.customer.findMany({
    where: {
      wantsExcelOrder: true,
      isActive: true,
      email: { not: null },
      defaultPointId: { not: null },
    },
    select: {
      id: true,
      name: true,
      email: true,
      phone: true,
      defaultPoint: { select: { name: true } },
    },
  });

  if (customers.length === 0) {
    return NextResponse.json(
      {
        error:
          "אין לקוחות עם מייל ונקודת חלוקה שסומנו לקבלת אקסל. יש לסמן בכרטיס הלקוח.",
      },
      { status: 400 }
    );
  }

  // ─── בניית שורות הקובץ, פעם אחת לכל הלקוחות ───
  //
  // ⚠️ המוצרים זהים לכולם, ולכן אין טעם לבנות אותם מחדש לכל לקוח.
  // מה שמשתנה הוא הכותרת (שם, טלפון, נקודה) והכמויות הקיימות.
  const surcharge = Number(pricelist.singleSurcharge ?? 0);
  const baseRows: ExcelRowSpec[] = [];
  for (const pp of pricelist.products) {
    const p = pp.product;
    if (!p.isActive) continue;
    const base = Number(pp.price ?? p.cartonPrice);
    const kashrut = p.kashrutRef?.name || p.kashrut || "";
    const category = p.category?.name || "כללי";

    baseRows.push({
      productId: p.id,
      isSingle: false,
      categoryName: category,
      productName: p.name,
      kashrut,
      unit: p.priceType === "PER_KG" ? 'קרטון (מחיר לק"ג)' : p.unit || "יחידה",
      unitPrice: base,
    });

    if (p.allowSingles) {
      baseRows.push({
        productId: p.id,
        isSingle: true,
        categoryName: category,
        productName: p.name,
        kashrut,
        unit: p.singlesMode === "UNITS" ? "יחידות" : 'ק"ג',
        unitPrice:
          p.singleUnitPrice != null ? Number(p.singleUnitPrice) : base + surcharge,
      });
    }
  }

  baseRows.sort(
    (a, b2) =>
      a.categoryName.localeCompare(b2.categoryName, "he") ||
      a.productName.localeCompare(b2.productName, "he") ||
      Number(a.isSingle) - Number(b2.isSingle)
  );

  if (baseRows.length === 0) {
    return NextResponse.json(
      { error: "אין מוצרים פעילים במכירה" },
      { status: 400 }
    );
  }

  const closeText = pricelist.closeDate
    ? pricelist.closeDate.toLocaleDateString("he-IL", {
        day: "numeric",
        month: "long",
        hour: "2-digit",
        minute: "2-digit",
      })
    : null;

  // ─── שליחה ───
  //
  // ⚠️ בטור ולא במקביל. Resend מגביל קצב, ושליחה של 50 מיילים
  // בבת אחת הייתה נחסמת חלקית - וחלק מהלקוחות לא היו מקבלים
  // כלום בלי שנדע מי.
  const sent: string[] = [];
  const failed: { name: string; error: string }[] = [];

  for (const c of customers) {
    try {
      const buf = await buildOrderExcel(
        {
          customerName: c.name,
          customerPhone: c.phone || "",
          pointName: c.defaultPoint?.name || "",
          saleName: pricelist.name,
          pricelistId: pricelist.id,
          deliveryDateText: pricelist.deliveryDateText,
          singleSurcharge: surcharge,
        },
        baseRows
      );

      const res = await sendExcelOrderEmail({
        customerName: c.name,
        email: c.email!,
        saleName: pricelist.name,
        deliveryDateText: pricelist.deliveryDateText,
        closeDateText: closeText,
        fileBuffer: buf,
      });

      if (res.ok) sent.push(c.name);
      else failed.push({ name: c.name, error: res.error || "שגיאה" });
    } catch (e: any) {
      failed.push({ name: c.name, error: String(e?.message || e).slice(0, 200) });
    }
  }

  await prisma.pricelist.update({
    where: { id: pricelistId },
    data: { excelSentAt: new Date(), excelSentCount: sent.length },
  });

  console.log(
    `[excel-broadcast] pricelist=${pricelistId} sent=${sent.length} failed=${failed.length}`
  );

  return NextResponse.json({
    ok: true,
    sentCount: sent.length,
    failedCount: failed.length,
    sent,
    failed,
  });
}
