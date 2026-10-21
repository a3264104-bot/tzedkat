// ═══════════════════════════════════════════════════════════════
// יצירת הזמנה מקובץ אקסל — מקור אחד לשני המסלולים
// ═══════════════════════════════════════════════════════════════
//   1. המנהל מעלה קובץ במסך "הזמנה דרך אקסל" (PUT /api/admin/excel-order)
//   2. הלקוח עונה למייל עם הקובץ, והמערכת קולטת אותו לבד (inbound-excel)
//
// ⚠️ שני המסלולים חייבים לחסום ולחשב בדיוק אותו דבר. לכן הלוגיקה כאן,
// וההבדל היחיד הוא `enforceCloseTime`: מנהל רשאי להזין אחרי שעת
// הסגירה (§206/§207), לקוח במייל — לא.

import { prisma } from "@/lib/prisma";
import { canChargeCard, expiryMessage } from "@/lib/card-expiry-lib";
import { isCashFor, newOrderPaymentMethod } from "@/lib/cash-customer";

export type ExcelOrderRow = { productId: string; isSingle: boolean; quantity: number };

export type ExcelOrderFailCode =
  | "NO_CUSTOMER"
  | "NO_SALE"
  | "INACTIVE_CUSTOMER"
  | "NO_POINT"
  | "POINT_NOT_IN_SALE"
  | "NO_PAYMENT"
  | "CARD_PROBLEM"
  | "SALE_NOT_ACTIVE"
  | "SALE_CLOSED"
  | "NO_ITEMS"
  | "ALREADY_PAID";

export type ExcelOrderResult =
  | {
      ok: true;
      orderId: string;
      orderNumber: number;
      replacedOrderNumber: number | null;
      items: { name: string; quantity: number; unit: string; isSingle: boolean; estimatedPrice: number }[];
      orderFee: number;
      estimatedTotal: number;
      pointName: string;
      saleName: string;
      deliveryDateText: string | null;
      closeDate: Date | null;
      isCash: boolean;
    }
  | { ok: false; code: ExcelOrderFailCode; error: string };

export async function createExcelOrder(opts: {
  customerId: string;
  pricelistId: string;
  rows: ExcelOrderRow[];
  /** לקוח (מייל) — לא אחרי שעת הסגירה. מנהל — כן. */
  enforceCloseTime: boolean;
}): Promise<ExcelOrderResult> {
  const { customerId, pricelistId, rows, enforceCloseTime } = opts;

  const [customer, pricelist] = await Promise.all([
    prisma.customer.findUnique({
      where: { id: customerId },
      select: {
        id: true,
        // §115: name ו-phone הם שדות **חובה** ב-Order - צילום מצב
        name: true,
        phone: true,
        isActive: true,
        paymentToken: true,
        cardExpiry: true,
        cardNeedsUpdate: true,
        paymentPreference: true,
        cashPricelistId: true,
        defaultPointId: true,
        defaultPoint: { select: { id: true, name: true } },
      },
    }),
    prisma.pricelist.findUnique({
      where: { id: pricelistId },
      select: {
        id: true,
        name: true,
        status: true,
        closeDate: true,
        orderFee: true,
        singleSurcharge: true,
        deliveryDateText: true,
        points: { select: { pointId: true } },
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

  // ⚠️ **כל החסימות נבדקות כאן**, גם אם מסך התצוגה המקדימה כבר בדק.
  if (!customer) return { ok: false, code: "NO_CUSTOMER", error: "לקוח לא נמצא" };
  if (!pricelist) return { ok: false, code: "NO_SALE", error: "מכירה לא נמצאה" };
  if (customer.isActive === false) return { ok: false, code: "INACTIVE_CUSTOMER", error: "הלקוח מושבת" };
  if (!customer.defaultPointId || !customer.defaultPoint) {
    return { ok: false, code: "NO_POINT", error: "ללקוח לא הוגדרה נקודת חלוקה" };
  }
  if (pricelist.points.length > 0 && !pricelist.points.some((p) => p.pointId === customer.defaultPointId)) {
    return { ok: false, code: "POINT_NOT_IN_SALE", error: "נקודת החלוקה של הלקוח לא משתתפת במכירה הזו" };
  }

  // מזומן (קבוע או למכירה הזו) — בלי כרטיס. אחרת — כרטיס תקין חובה.
  const isCash = isCashFor(customer, pricelist.id);
  if (!isCash) {
    if (!customer.paymentToken) {
      return { ok: false, code: "NO_PAYMENT", error: "ללקוח אין כרטיס אשראי שמור" };
    }
    // §202: כרטיס שפג / סומן לעדכון
    if (customer.cardNeedsUpdate || !canChargeCard(customer.cardExpiry)) {
      return {
        ok: false,
        code: "CARD_PROBLEM",
        error: expiryMessage(customer.cardExpiry) ?? "כרטיס האשראי של הלקוח צריך עדכון",
      };
    }
  }
  if (pricelist.status !== "ACTIVE") return { ok: false, code: "SALE_NOT_ACTIVE", error: "המכירה אינה פעילה" };
  if (enforceCloseTime && pricelist.closeDate && new Date() > new Date(pricelist.closeDate)) {
    return { ok: false, code: "SALE_CLOSED", error: "ההרשמה למכירה נסגרה" };
  }

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
    const avgW = pp.product.avgWeightPerUnit != null ? Number(pp.product.avgWeightPerUnit) : null;
    const estimatedWeight = r.isSingle ? qty : avgW ? avgW * qty : null;
    const estimatedPrice =
      !r.isSingle && pp.product.priceType === "PER_KG" && avgW ? unitPrice * avgW * qty : unitPrice * qty;

    itemsData.push({
      productId: r.productId,
      productName: pp.product.name,
      unit: r.isSingle ? (pp.product.singlesMode === "UNITS" ? "יחידות" : 'ק"ג') : pp.product.unit || "יחידה",
      isSingle: r.isSingle,
      quantity: qty,
      unitPrice,
      estimatedWeight,
      estimatedPrice: Math.round(estimatedPrice * 100) / 100,
    });
  }

  if (itemsData.length === 0) return { ok: false, code: "NO_ITEMS", error: "אין פריטים תקינים ליצירת הזמנה" };

  const itemsTotal = itemsData.reduce((s, i) => s + i.estimatedPrice, 0);
  const orderFee = Number(pricelist.orderFee ?? 0);
  const paymentMethod = newOrderPaymentMethod(customer, pricelist.id);

  // ⚠️ עדכון = מחיקה ויצירה, בטרנזקציה אחת. שליחה חוזרת של הקובץ מחליפה
  // את ההזמנה הקודמת ולא מוסיפה לה — הלקוח מילא קובץ מלא, לא תוספת.
  let replacedOrderNumber: number | null = null;
  try {
    const created = await prisma.$transaction(async (tx) => {
      // §392: מחליפים רק הזמנה פתוחה (טרם שולמה)
      const existing = await tx.order.findFirst({
        where: {
          customerId,
          pricelistId,
          status: { notIn: ["CANCELLED"] },
          paymentStatus: { notIn: ["PAID", "PARTIALLY_PAID", "DEBT_CARRIED"] },
        },
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          orderNumber: true,
          paymentStatus: true,
          customerId: true,
          appliedDebt: true,
          appliedCreditBalance: true,
        },
      });

      if (existing && existing.paymentStatus === "CHARGING") {
        throw Object.assign(new Error(`הזמנה #${existing.orderNumber} נמצאת בחיוב כרגע ולכן לא ניתן להחליפה מקובץ.`), {
          code: "ALREADY_PAID",
        });
      }

      if (existing) {
        // §375: החוב והיתרה חוזרים ללקוח לפני המחיקה
        const d = Number(existing.appliedDebt ?? 0);
        const b = Number(existing.appliedCreditBalance ?? 0);
        if ((d > 0 || b > 0) && existing.customerId) {
          await tx.customer.update({
            where: { id: existing.customerId },
            data: {
              ...(d > 0 ? { debtBalance: { increment: d } } : {}),
              ...(b > 0 ? { creditBalance: { increment: b } } : {}),
            },
          });
        }
        await tx.orderItem.deleteMany({ where: { orderId: existing.id } });
        await tx.order.delete({ where: { id: existing.id } });
        replacedOrderNumber = existing.orderNumber;
      }

      return tx.order.create({
        data: {
          customerId,
          customerName: customer.name,
          phone: customer.phone ?? "",
          pricelistId,
          pointId: customer.defaultPointId!,
          pointNameSnapshot: customer.defaultPoint!.name,
          deliveryDateSnapshot: pricelist.deliveryDateText,
          source: "EXCEL",
          status: "PENDING_REVIEW",
          ...(paymentMethod ? { paymentMethod } : {}),
          estimatedTotal: Math.round((itemsTotal + orderFee) * 100) / 100,
          items: { create: itemsData },
        },
        select: { id: true, orderNumber: true },
      });
    });

    return {
      ok: true,
      orderId: created.id,
      orderNumber: created.orderNumber,
      replacedOrderNumber,
      items: itemsData.map((i) => ({
        name: i.productName,
        quantity: i.quantity,
        unit: i.unit,
        isSingle: i.isSingle,
        estimatedPrice: i.estimatedPrice,
      })),
      orderFee,
      estimatedTotal: Math.round((itemsTotal + orderFee) * 100) / 100,
      pointName: customer.defaultPoint.name,
      saleName: pricelist.name,
      deliveryDateText: pricelist.deliveryDateText,
      closeDate: pricelist.closeDate,
      isCash,
    };
  } catch (e: any) {
    if (e?.code === "ALREADY_PAID") return { ok: false, code: "ALREADY_PAID", error: e.message };
    throw e;
  }
}
