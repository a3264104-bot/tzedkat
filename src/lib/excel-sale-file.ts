// ═══════════════════════════════════════════════════════════════
// קובץ ההזמנה של מכירה — אישי לכל לקוח
// ═══════════════════════════════════════════════════════════════
// מקור אחד לשני מקומות ששולחים את הקובץ:
//   • "📊 שלח אקסל" במסך המכירות (excel-broadcast)
//   • "📣 הודעת פתיחה" במסך שליחת מייל ללקוחות — צירוף הקובץ (broadcast)
//
// המוצרים זהים לכולם ולכן נבנים פעם אחת (loadSaleExcelBase). מה שאישי
// הוא הכותרת (שם, טלפון, נקודה) וחתימת הלקוח — בזכותה קובץ שחוזר במייל
// מזוהה ונהפך להזמנה (inbound-excel).

import { prisma } from "@/lib/prisma";
import { buildOrderExcel, type ExcelRowSpec } from "@/lib/excel-order-lib";

export type SaleExcelBase = {
  pricelist: { id: string; name: string; deliveryDateText: string | null; closeDate: Date | null; singleSurcharge: number };
  rows: ExcelRowSpec[];
  closeText: string | null;
};

export async function loadSaleExcelBase(pricelistId: string): Promise<SaleExcelBase | null> {
  const pricelist = await prisma.pricelist.findUnique({
    where: { id: pricelistId },
    select: {
      id: true,
      name: true,
      closeDate: true,
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
              saleType: true,
              isActive: true,
              allowSingles: true,
              singlesMode: true,
              singleUnitPrice: true,
              avgWeightPerUnit: true,
              kashrut: true,
              kashrutRef: { select: { name: true } },
              category: { select: { name: true } },
            },
          },
        },
      },
    },
  });
  if (!pricelist) return null;

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
      // §313: saleType קובע אם זה קרטון (ולא priceType)
      unit: p.saleType === "PACKAGE" ? (p.priceType === "PER_KG" ? 'קרטון (מחיר לק"ג)' : "קרטון") : p.unit || "יחידה",
      unitPrice: base,
      // מחיר לק"ג × משקל ממוצע לקרטון — אותו חישוב כמו בהזמנה באתר
      ...(p.priceType === "PER_KG" && p.avgWeightPerUnit != null
        ? { estimateFactor: Number(p.avgWeightPerUnit) }
        : {}),
    });
    if (p.allowSingles) {
      rows.push({
        productId: p.id,
        isSingle: true,
        categoryName: category,
        productName: p.name,
        kashrut,
        unit: p.singlesMode === "UNITS" ? "יחידות" : 'ק"ג',
        unitPrice: p.singleUnitPrice != null ? Number(p.singleUnitPrice) : base + surcharge,
      });
    }
  }
  rows.sort(
    (a, b) =>
      a.categoryName.localeCompare(b.categoryName, "he") ||
      a.productName.localeCompare(b.productName, "he") ||
      Number(a.isSingle) - Number(b.isSingle)
  );

  const closeText = pricelist.closeDate
    ? pricelist.closeDate.toLocaleDateString("he-IL", {
        // §402: שעון ישראל
        timeZone: "Asia/Jerusalem",
        day: "numeric",
        month: "long",
        hour: "2-digit",
        minute: "2-digit",
      })
    : null;

  return {
    pricelist: {
      id: pricelist.id,
      name: pricelist.name,
      deliveryDateText: pricelist.deliveryDateText,
      closeDate: pricelist.closeDate,
      singleSurcharge: surcharge,
    },
    rows,
    closeText,
  };
}

export function buildCustomerSaleFile(
  base: SaleExcelBase,
  customer: { id: string; name: string; phone: string | null; pointName: string | null }
): Promise<Buffer> {
  return buildOrderExcel(
    {
      customerId: customer.id,
      customerName: customer.name,
      customerPhone: customer.phone || "",
      pointName: customer.pointName || "",
      saleName: base.pricelist.name,
      pricelistId: base.pricelist.id,
      deliveryDateText: base.pricelist.deliveryDateText,
      singleSurcharge: base.pricelist.singleSurcharge,
    },
    base.rows
  );
}

export function saleFileName(saleName: string): string {
  return `הזמנה-${saleName.replace(/[^֐-׿\w\s-]/g, "").trim() || "order"}.xlsx`;
}
