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
      "נקודת חלוקה": o.point.name,
      "סטטוס": STATUS_LABELS[o.status] ?? o.status,
      "סה\"כ משוער": Number(o.estimatedTotal),
      "סה\"כ סופי": o.finalTotal ? Number(o.finalTotal) : "",
      "הערות": o.notes ?? "",
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    appendRTL(ws, "הזמנות");
    filename = "orders.xlsx";
  } else if (type === "products") {
    const map = new Map<string, { name: string; unit: string; qty: number; total: number }>();
    for (const o of active) {
      for (const it of o.items) {
        const cur = map.get(it.productName) || {
          name: it.productName,
          unit: it.unit,
          qty: 0,
          total: 0,
        };
        cur.qty += Number(it.finalWeight ?? it.quantity);
        cur.total += Number(it.finalPrice ?? it.estimatedPrice);
        map.set(it.productName, cur);
      }
    }
    const rows = Array.from(map.values())
      .sort((a, b) => b.qty - a.qty)
      .map((p) => ({
        "מוצר": p.name,
        "סה\"כ כמות": Math.round(p.qty * 100) / 100,
        "יחידה": p.unit,
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
      const map = new Map<string, { name: string; unit: string; qty: number }>();
      for (const o of pts) {
        for (const it of o.items) {
          const cur = map.get(it.productName) || { name: it.productName, unit: it.unit, qty: 0 };
          cur.qty += Number(it.finalWeight ?? it.quantity);
          map.set(it.productName, cur);
        }
      }
      const rows = Array.from(map.values()).map((p) => ({
        "מוצר": p.name,
        "כמות": Math.round(p.qty * 100) / 100,
        "יחידה": p.unit,
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
