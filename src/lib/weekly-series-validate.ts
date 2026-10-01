// §396: ולידציה משותפת ליצירה ועריכה של סדרה שבועית.
//
// ⚠️ בקובץ נפרד ולא ב-route.ts: Next.js מאפשר לייצא מ-route רק
// GET/POST/PATCH וכו'. ייצוא נוסף שובר את ה-build.

import { prisma } from "@/lib/prisma";

// ───────────────────────────────────────────────────────────────
// ולידציה משותפת ל-POST ול-PATCH
// ───────────────────────────────────────────────────────────────
export async function parseSeriesBody(
  b: any,
  seriesId: string | null
): Promise<
  | { error: string }
  | {
      fields: {
        name: string;
        isActive: boolean;
        switchDay: number;
        switchMinute: number;
        orderFee: number;
        singleSurcharge: number;
        deliveryNote: string | null;
      };
      pointIds: string[];
      products: { productId: string; price: number | null }[];
    }
> {
  const name = String(b?.name ?? "").trim();
  if (!name) return { error: "יש להזין שם לסדרה" };
  if (name.length > 80) return { error: "השם ארוך מדי" };

  const switchDay = Number(b?.switchDay);
  if (!Number.isInteger(switchDay) || switchDay < 0 || switchDay > 6) {
    return { error: "יום ההחלפה אינו תקין" };
  }
  const switchMinute = Number(b?.switchMinute);
  if (!Number.isInteger(switchMinute) || switchMinute < 0 || switchMinute > 1439) {
    return { error: "שעת ההחלפה אינה תקינה" };
  }

  const orderFee = Number(b?.orderFee ?? 3);
  const singleSurcharge = Number(b?.singleSurcharge ?? 3);
  if (!Number.isFinite(orderFee) || orderFee < 0 || orderFee > 100) {
    return { error: "דמי ההזמנה אינם תקינים" };
  }
  if (!Number.isFinite(singleSurcharge) || singleSurcharge < 0 || singleSurcharge > 100) {
    return { error: "תוספת הבודדים אינה תקינה" };
  }

  const pointIds: string[] = Array.isArray(b?.pointIds)
    ? Array.from(new Set(b.pointIds.map((x: unknown) => String(x)).filter(Boolean)))
    : [];
  if (pointIds.length === 0) return { error: "יש לבחור לפחות נקודת חלוקה אחת" };

  const productsRaw: any[] = Array.isArray(b?.products) ? b.products : [];
  const seen = new Set<string>();
  const products: { productId: string; price: number | null }[] = [];
  for (const p of productsRaw) {
    const productId = String(p?.productId ?? "");
    if (!productId || seen.has(productId)) continue;
    seen.add(productId);
    const price =
      p?.price === null || p?.price === undefined || p?.price === ""
        ? null
        : Number(p.price);
    if (price !== null && (!Number.isFinite(price) || price < 0)) {
      return { error: "מחיר לא תקין באחד המוצרים" };
    }
    products.push({ productId, price });
  }
  if (products.length === 0) return { error: "יש לבחור לפחות מוצר אחד לתבנית" };

  // ⚠️ נקודה בסדרה אחת בלבד. אחרת לא ברור איזה שבוע הלקוח רואה.
  // ההודעה אומרת **איפה** היא כבר נמצאת — המנהל לא יחפש.
  const taken = await prisma.weeklySeriesPoint.findMany({
    where: {
      pointId: { in: pointIds },
      ...(seriesId ? { seriesId: { not: seriesId } } : {}),
    },
    select: {
      point: { select: { name: true } },
      series: { select: { name: true } },
    },
  });
  if (taken.length > 0) {
    return {
      error:
        "נקודה יכולה להיות בסדרה שבועית אחת בלבד: " +
        taken.map((t) => `${t.point.name} (כבר ב"${t.series.name}")`).join(", "),
    };
  }

  const deliveryNote = String(b?.deliveryNote ?? "").trim().slice(0, 120) || null;

  return {
    fields: {
      name,
      isActive: b?.isActive === undefined ? true : !!b.isActive,
      switchDay,
      switchMinute,
      orderFee: Math.round(orderFee * 100) / 100,
      singleSurcharge: Math.round(singleSurcharge * 100) / 100,
      deliveryNote,
    },
    pointIds,
    products,
  };
}
