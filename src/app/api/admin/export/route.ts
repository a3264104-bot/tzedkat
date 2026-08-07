import { NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/guard";
import { STATUS_LABELS } from "@/lib/pricing";

export async function GET(req: Request) {
  const g = await requireAdmin();
  if (!g.ok) return g.res;
  const { searchParams } = new URL(req.url);
  const type = searchParams.get("type") || "orders";
  const pricelistId = searchParams.get("pricelistId") || undefined;
  const pointId = searchParams.get("pointId") || undefined;

  const where: any = {};
  if (pricelistId) where.pricelistId = pricelistId;
  if (pointId) where.pointId = pointId;

  const orders = await prisma.order.findMany({
    where,
    include: { point: true, items: true },
    orderBy: { orderNumber: "asc" },
  });
  const active = orders.filter((o) => o.status !== "CANCELLED");

  const wb = XLSX.utils.book_new();
  // תצוגת RTL ברמת חוברת העבודה — האקסל ייפתח מימין לשמאל (נדרש ב-xlsx 0.18 ברמת ה-workbook)
  wb.Workbook = { Views: [{ RTL: true }] };
  let filename = "export.xlsx";

  // הוספת גיליון (התצוגה RTL מוגדרת ברמת החוברת למעלה)
  const appendRTL = (ws: XLSX.WorkSheet, name: string) => {
    XLSX.utils.book_append_sheet(wb, ws, name);
  };

  if (type === "orders") {
    const rows = orders.map((o) => ({
      "מס' הזמנה": o.orderNumber,
      "תאריך": new Date(o.createdAt).toLocaleDateString("he-IL"),
      "שם לקוח": o.customerName,
      "טלפון": o.phone,
      "טלפון נוסף": o.phone2 ?? "",
      "נקודת חלוקה": o.point?.name ?? o.pointNameSnapshot ?? "",
      "סטטוס": STATUS_LABELS[o.status] ?? o.status,
      "סה\"כ משוער": Number(o.estimatedTotal),
      "סה\"כ סופי": o.finalTotal ? Number(o.finalTotal) : "",
      "הערות": o.notes ?? "",
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    appendRTL(ws, "הזמנות");
    filename = "orders.xlsx";
  } else if (type === "products") {
    // 🐛 תוקן ערבוב יחידות: הקוד הישן עשה `qty += finalWeight ?? quantity`,
    // כלומר חיבר קרטונים (2) עם ק"ג (16.86) לעמודה אחת - ואחרי שקילה
    // הקרטונים "נעלמו" והוחלפו בק"ג. עכשיו עמודות נפרדות, זהה למסך הדוחות.
    const map = new Map<
      string,
      {
        name: string;
        unit: string;
        cartons: number;
        singlesKg: number;
        actualKg: number;
        weighedCartons: number;
        total: number;
      }
    >();
    for (const o of active) {
      for (const it of o.items) {
        const cur = map.get(it.productName) || {
          name: it.productName,
          unit: it.unit,
          cartons: 0,
          singlesKg: 0,
          actualKg: 0,
          weighedCartons: 0,
          total: 0,
        };
        const qty = Number(it.quantity);
        const actual = it.actualWeight != null ? Number(it.actualWeight) : null;
        if (it.isSingle) {
          cur.singlesKg += qty;
        } else {
          cur.cartons += qty;
          if (actual != null) cur.weighedCartons += qty;
        }
        if (actual != null) cur.actualKg += actual;
        cur.total += Number(it.finalPrice ?? it.estimatedPrice);
        map.set(it.productName, cur);
      }
    }
    const rows = Array.from(map.values())
      .sort((a, b) => b.cartons + b.singlesKg - (a.cartons + a.singlesKg))
      .map((p) => ({
        "מוצר": p.name,
        "קרטונים להזמנה": Math.round(p.cartons * 1000) / 1000,
        "ק\"ג בודדים": Math.round(p.singlesKg * 1000) / 1000,
        "נשקל בפועל (ק\"ג)": Math.round(p.actualKg * 1000) / 1000,
        "קרטונים שנשקלו": Math.round(p.weighedCartons * 1000) / 1000,
        "סה\"כ": Math.round(p.total * 100) / 100,
      }));
    const ws = XLSX.utils.json_to_sheet(rows);
    appendRTL(ws, "סיכום מוצרים");
    filename = "products-summary.xlsx";
  } else if (type === "bypoint") {
    // one sheet per point with items breakdown
    const points = new Map<string, typeof orders>();
    for (const o of active) {
      if (!points.has(o.point.name)) points.set(o.point.name, []);
      points.get(o.point.name)!.push(o);
    }
    for (const [pointName, pts] of points) {
      // 🐛 תוקן ערבוב יחידות. הגיליון הזה נלקח לשטח לחלוקה, ולכן חשוב
      // במיוחד שיהיה ברור מה קרטונים ומה ק"ג ולא מספר אחד מעורבב.
      const map = new Map<
        string,
        { name: string; cartons: number; singlesKg: number; actualKg: number }
      >();
      for (const o of pts) {
        for (const it of o.items) {
          const cur =
            map.get(it.productName) || {
              name: it.productName,
              cartons: 0,
              singlesKg: 0,
              actualKg: 0,
            };
          const qty = Number(it.quantity);
          const actual = it.actualWeight != null ? Number(it.actualWeight) : null;
          if (it.isSingle) cur.singlesKg += qty;
          else cur.cartons += qty;
          if (actual != null) cur.actualKg += actual;
          map.set(it.productName, cur);
        }
      }
      const rows = Array.from(map.values()).map((p) => ({
        "מוצר": p.name,
        "קרטונים": Math.round(p.cartons * 1000) / 1000,
        "ק\"ג בודדים": Math.round(p.singlesKg * 1000) / 1000,
        "נשקל בפועל (ק\"ג)": Math.round(p.actualKg * 1000) / 1000,
      }));
      const ws = XLSX.utils.json_to_sheet(rows.length ? rows : [{ "מוצר": "—" }]);
      // sheet name max 31 chars
      const safe = pointName.replace(/[\\/?*[\]]/g, "").slice(0, 28);
      appendRTL(ws, safe || "נקודה");
    }
    filename = "by-point.xlsx";
  } else if (type === "customers") {
    const map = new Map<string, { name: string; phone: string; orders: number; total: number }>();
    for (const o of active) {
      const cur = map.get(o.phone) || { name: o.customerName, phone: o.phone, orders: 0, total: 0 };
      cur.orders++;
      cur.total += Number(o.finalTotal ?? o.estimatedTotal);
      map.set(o.phone, cur);
    }
    const rows = Array.from(map.values())
      .sort((a, b) => b.total - a.total)
      .map((c) => ({
        "שם": c.name,
        "טלפון": c.phone,
        "מספר הזמנות": c.orders,
        "סך רכישות": Math.round(c.total * 100) / 100,
      }));
    const ws = XLSX.utils.json_to_sheet(rows);
    appendRTL(ws, "לקוחות");
    filename = "customers.xlsx";
  }

  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
  return new NextResponse(buf, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
