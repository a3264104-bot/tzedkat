// ⚖️ אקסל סיכום משקלים: גיליון סיכום + גיליון לכל נקודת חלוקה.
import ExcelJS from "exceljs";
import type { WeightPoint, loadSaleWeights } from "@/lib/sale-weights-lib";

type Data = NonNullable<Awaited<ReturnType<typeof loadSaleWeights>>>;

const HEADER_FILL: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF334155" } };
const CUST_FILL: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFDF6E3" } };
const MISSING_FILL: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFEE2E2" } };

/** שם גיליון חוקי באקסל: עד 31 תווים, בלי []:*?/\ וייחודי */
function sheetName(name: string, used: Set<string>) {
  let base = name.replace(/[\[\]:*?/\\]/g, " ").trim().slice(0, 28) || "נקודה";
  let n = base;
  let i = 2;
  while (used.has(n)) n = `${base.slice(0, 26)} ${i++}`;
  used.add(n);
  return n;
}

function header(ws: ExcelJS.Worksheet, cols: string[]) {
  const row = ws.addRow(cols);
  row.font = { bold: true, color: { argb: "FFFFFFFF" } };
  row.eachCell((c) => {
    c.fill = HEADER_FILL;
    c.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
  });
  ws.views = [{ rightToLeft: true, state: "frozen", ySplit: row.number }];
}

function pointSheet(wb: ExcelJS.Workbook, p: WeightPoint, used: Set<string>) {
  const ws = wb.addWorksheet(sheetName(p.pointName, used), { views: [{ rightToLeft: true }] });
  ws.columns = [
    { width: 9 }, { width: 22 }, { width: 13 }, { width: 26 }, { width: 9 },
    { width: 24 }, { width: 11 }, { width: 10 }, { width: 11 }, { width: 14 },
  ];
  ws.addRow([`נקודה: ${p.pointName}`]).font = { bold: true, size: 14 };
  ws.addRow([
    `${p.orders.length} הזמנות · סה"כ משקל ${p.totalWeight} ק"ג · סה"כ לחיוב ₪${p.totalFinal.toFixed(2)}` +
      (p.missing > 0 ? ` · ⚠️ ${p.missing} פריטים בלי משקל` : ""),
  ]);
  ws.addRow([]);
  header(ws, ["הזמנה", "לקוח", "טלפון", "מוצר", "כמות", "משקל לכל קרטון", 'סה"כ משקל', "מחיר ליח׳", "סכום", "מצב"]);
  for (const o of p.orders) {
    const first = ws.addRow([
      o.orderNumber,
      o.customerName,
      o.phone,
      "",
      "",
      "",
      "",
      "",
      o.finalTotal ?? "",
      (o.locked ? "ננעל ✓" : "לא ננעל") + (o.missing ? ` · חסר ${o.missing}` : ""),
    ]);
    first.font = { bold: true };
    first.eachCell((c) => (c.fill = CUST_FILL));
    for (const it of o.items) {
      const row = ws.addRow([
        "",
        "",
        "",
        it.productName + (it.isSingle ? " (בודדים)" : "") + (it.cancelled ? " — בוטל" : ""),
        it.quantity,
        it.parts && it.parts.length > 1 ? it.parts.map((x) => (x == null ? "—" : x)).join(" + ") : "",
        it.weight ?? "",
        it.unitPrice,
        it.finalPrice ?? "",
        it.cancelled ? "בוטל" : it.weight == null ? "⚠️ חסר משקל" : "",
      ]);
      if (it.cancelled) row.font = { strike: true, color: { argb: "FF9CA3AF" } };
      else if (it.weight == null) row.eachCell((c) => (c.fill = MISSING_FILL));
    }
  }
  ws.addRow([]);
  ws.addRow(["סיכום לפי מוצר"]).font = { bold: true };
  header(ws, ["", "מוצר", "", "", "כמות", "", 'סה"כ משקל']);
  // ⚠️ header() מקפיא את השורה האחרונה — מחזירים את ההקפאה לכותרת הראשית
  ws.views = [{ rightToLeft: true, state: "frozen", ySplit: 4 }];
  for (const pr of p.products) ws.addRow(["", pr.name, "", "", pr.quantity, "", pr.weight]);
  ws.getColumn(8).numFmt = "#,##0.00";
  ws.getColumn(9).numFmt = "#,##0.00";
  ws.getColumn(7).numFmt = "#,##0.000";
}

export function buildSaleWeightsWorkbook(data: Data): ExcelJS.Workbook {
  const wb = new ExcelJS.Workbook();
  const used = new Set<string>();
  const sum = wb.addWorksheet(sheetName("סיכום", used), { views: [{ rightToLeft: true }] });
  sum.columns = [{ width: 28 }, { width: 10 }, { width: 14 }, { width: 14 }, { width: 14 }];
  sum.addRow([`סיכום משקלים — ${data.pricelist.name}`]).font = { bold: true, size: 14 };
  sum.addRow([]);
  header(sum, ["נקודה", "הזמנות", 'סה"כ משקל', 'סה"כ לחיוב', "פריטים בלי משקל"]);
  for (const p of data.points) {
    sum.addRow([p.pointName, p.orders.length, p.totalWeight, p.totalFinal, p.missing || ""]);
  }
  const t = sum.addRow(['סה"כ', data.totals.orders, data.totals.weight, data.totals.final, data.totals.missing || ""]);
  t.font = { bold: true };
  sum.getColumn(4).numFmt = "#,##0.00";

  for (const p of data.points) pointSheet(wb, p, used);

  return wb;
}
