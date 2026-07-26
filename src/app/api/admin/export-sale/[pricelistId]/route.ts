// §20: ייצוא Excel של דוח מכירה מלא למנהל
// GET /api/admin/export-sale/[pricelistId]
//
// מפיק קובץ Excel רב-שכבתי:
// 1. סיכום מכירה - נתונים כללים + התראות + כספים
// 2. הזמנות - כל הזמנה שורה עם פירוט
// 3. מזדמנים - רשימת מזדמנים + פרטי תשלום
// 4. פערי מוצרים - השוואת תעודות ↔ חלוקה
// 5. נציגים - עמלות + מזומן + חובות

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/guard";
import ExcelJS from "exceljs";

// עיצוב
const YELLOW = "FFFFE000";
const RUST = "FFC0461E";
const LIGHT = "FFFFF8D8";
const HEAD = "FF3F3F46";
const WHITE = "FFFFFFFF";
const RED_BG = "FFFEE2E2";
const AMBER_BG = "FFFEF3C7";
const GREEN_BG = "FFD1FAE5";
const BLUE_BG = "FFDBEAFE";

const PAYMENT_LABELS: Record<string, string> = {
  CASH: "מזומן",
  CARD_TERMINAL: "אשראי במסוף",
  TRANSFER: "העברה בנקאית",
  ONLINE: "אשראי אונליין",
};

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ pricelistId: string }> }
) {
  const g = await requireAdmin();
  if (!g.ok) return g.res;

  const { pricelistId } = await params;

  const pricelist = await prisma.pricelist.findUnique({
    where: { id: pricelistId },
    select: {
      id: true, name: true, status: true,
      deliveryDate: true, deliveryDateText: true,
      closeDate: true, editDeadline: true,
    },
  });
  if (!pricelist) {
    return NextResponse.json({ error: "מחירון לא נמצא" }, { status: 404 });
  }

  // ─── תעודות משלוח ─────────────────
  const deliveryNotes = await prisma.deliveryNote.findMany({
    where: { pricelistId, status: "CONFIRMED" },
    include: {
      items: {
        include: { product: { select: { id: true, name: true } } },
      },
    },
  });

  const productWeightsFromNotes: Record<string, { name: string; weight: number; cartons: number }> = {};
  for (const note of deliveryNotes) {
    for (const item of note.items) {
      if (!item.productId) continue;
      const name = item.product?.name || item.productNameOnNote;
      if (!productWeightsFromNotes[item.productId]) {
        productWeightsFromNotes[item.productId] = { name, weight: 0, cartons: 0 };
      }
      productWeightsFromNotes[item.productId].weight += Number(item.weight);
      productWeightsFromNotes[item.productId].cartons += item.quantity;
    }
  }

  // ─── הזמנות ─────────────────
  const orders = await prisma.order.findMany({
    where: { pricelistId, status: { notIn: ["CANCELLED"] } },
    orderBy: [{ customerName: "asc" }],
    include: {
      point: { select: { id: true, name: true } },
      items: true,
    },
  });

  // ─── מזדמנים ─────────────────
  const walkins = await prisma.walkinOrder.findMany({
    where: { pricelistId },
    include: {
      items: true,
      agent: { select: { id: true, name: true } },
    },
    orderBy: { createdAt: "asc" },
  });

  // ─── נציגים ─────────────────
  const agentSummaries = await prisma.agentSaleSummary.findMany({
    where: { pricelistId },
    include: {
      agent: {
        select: {
          id: true, name: true, phone: true, email: true,
          agentPoint: { select: { id: true, name: true } },
          commissionRateCarton: true,
          commissionRateSingles: true,
        },
      },
    },
  });

  const agentPayments = await prisma.agentPayment.findMany({
    where: { pricelistId },
  });

  // ─── חישובי סיכום ─────────────────
  const productWeightsUsed: Record<string, number> = {};
  let totalOrderRevenue = 0;
  let itemsEntered = 0;
  let itemsTotal = 0;

  for (const order of orders) {
    for (const it of order.items) {
      if (it.isCancelled) continue;
      itemsTotal++;
      const w = it.agentEnteredWeight ? Number(it.agentEnteredWeight) : 0;
      if (w > 0) {
        itemsEntered++;
        productWeightsUsed[it.productId] = (productWeightsUsed[it.productId] || 0) + w;
      }
      if (it.finalPrice) totalOrderRevenue += Number(it.finalPrice);
      else if (it.estimatedPrice) totalOrderRevenue += Number(it.estimatedPrice);
    }
  }

  let walkinRevenue = 0;
  let walkinCash = 0;
  let walkinCardTerminal = 0;
  let walkinTransferPending = 0;
  let walkinTransferReceived = 0;
  let walkinOnline = 0;
  for (const w of walkins) {
    walkinRevenue += Number(w.totalAmount);
    if (w.paymentMethod === "CASH") walkinCash += Number(w.totalAmount);
    else if (w.paymentMethod === "CARD_TERMINAL") walkinCardTerminal += Number(w.totalAmount);
    else if (w.paymentMethod === "TRANSFER") {
      if (w.paymentReceived) walkinTransferReceived += Number(w.totalAmount);
      else walkinTransferPending += Number(w.totalAmount);
    } else if (w.paymentMethod === "ONLINE") walkinOnline += Number(w.totalAmount);

    for (const it of w.items) {
      productWeightsUsed[it.productId] = (productWeightsUsed[it.productId] || 0) + Number(it.weight);
    }
  }

  const totalCommissions = agentSummaries.reduce(
    (s, a) => s + Number(a.totalCommission), 0
  );

  // ═══════════════════════════════════════════════════
  // בניית הExcel
  // ═══════════════════════════════════════════════════
  const wb = new ExcelJS.Workbook();
  wb.creator = "צדקת רבותינו";
  wb.created = new Date();

  // ─── Sheet 1: סיכום מכירה ─────────────────
  buildSummarySheet(wb, {
    pricelist,
    totalOrders: orders.length,
    totalWalkins: walkins.length,
    itemsTotal,
    itemsEntered,
    totalOrderRevenue,
    walkinRevenue,
    walkinCash,
    walkinCardTerminal,
    walkinTransferPending,
    walkinTransferReceived,
    walkinOnline,
    totalCommissions,
    totalRevenue: totalOrderRevenue + walkinRevenue,
    deliveryNotesCount: deliveryNotes.length,
  });

  // ─── Sheet 2: הזמנות ─────────────────
  buildOrdersSheet(wb, orders);

  // ─── Sheet 3: מזדמנים ─────────────────
  buildWalkinsSheet(wb, walkins);

  // ─── Sheet 4: פערי מוצרים ─────────────────
  buildProductComparisonSheet(wb, productWeightsFromNotes, productWeightsUsed);

  // ─── Sheet 5: נציגים ─────────────────
  buildAgentsSheet(wb, agentSummaries, walkins, agentPayments);

  // ─── Sheet 6: תעודות משלוח ─────────────────
  buildDeliveryNotesSheet(wb, deliveryNotes);

  const buffer = await wb.xlsx.writeBuffer();
  const fileName = `דוח_מכירה_מלא_${pricelist.name.replace(/[^\w\u0590-\u05FF\s-]/g, "")}_${formatDateForFile(pricelist.deliveryDate || new Date())}.xlsx`;

  return new NextResponse(buffer as any, {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`,
      "Cache-Control": "no-store",
    },
  });
}

// ═══════════════════════════════════════════════════
// Sheet 1: סיכום מכירה
// ═══════════════════════════════════════════════════
function buildSummarySheet(wb: ExcelJS.Workbook, data: any) {
  const ws = wb.addWorksheet("סיכום מכירה", {
    views: [{ rightToLeft: true, state: "normal" }],
    properties: { defaultRowHeight: 22 },
  });

  ws.columns = [{ width: 30 }, { width: 20 }, { width: 20 }, { width: 20 }, { width: 20 }];

  let row = 1;

  // Header
  ws.mergeCells(row, 1, row, 5);
  const t = ws.getCell(row, 1);
  t.value = "צדקת רבותינו — דוח מכירה מלא";
  t.font = { name: "Arial", bold: true, size: 22, color: { argb: RUST } };
  t.alignment = { horizontal: "center", vertical: "middle" };
  t.fill = { type: "pattern", pattern: "solid", fgColor: { argb: YELLOW } };
  ws.getRow(row).height = 44;
  row++;

  ws.mergeCells(row, 1, row, 5);
  const sub = ws.getCell(row, 1);
  sub.value = data.pricelist.name;
  sub.font = { name: "Arial", bold: true, size: 14, color: { argb: HEAD } };
  sub.alignment = { horizontal: "center", vertical: "middle" };
  sub.fill = { type: "pattern", pattern: "solid", fgColor: { argb: LIGHT } };
  ws.getRow(row).height = 26;
  row += 2;

  // פרטים כלליים
  addSectionHeader(ws, row, "פרטי מכירה", 5);
  row++;
  const info = [
    ["שם המכירה", data.pricelist.name],
    ["תאריך חלוקה", data.pricelist.deliveryDateText || (data.pricelist.deliveryDate ? formatDate(data.pricelist.deliveryDate) : "—")],
    ["סטטוס", data.pricelist.status],
    ["תעודות משלוח מאושרות", String(data.deliveryNotesCount)],
    ["תאריך הפקת הדוח", formatDate(new Date())],
  ];
  for (const [label, value] of info) {
    ws.mergeCells(row, 1, row, 2);
    const l = ws.getCell(row, 1);
    l.value = label;
    l.font = { name: "Arial", bold: true, size: 11 };
    l.alignment = { horizontal: "right", vertical: "middle" };
    l.fill = { type: "pattern", pattern: "solid", fgColor: { argb: LIGHT } };
    l.border = allBorders();

    ws.mergeCells(row, 3, row, 5);
    const v = ws.getCell(row, 3);
    v.value = value;
    v.font = { name: "Arial", size: 11 };
    v.alignment = { horizontal: "right", vertical: "middle" };
    v.border = allBorders();
    ws.getRow(row).height = 22;
    row++;
  }
  row++;

  // התקדמות
  addSectionHeader(ws, row, "התקדמות", 5);
  row++;
  const progress = [
    ["סה״כ הזמנות", data.totalOrders],
    ["סה״כ מזדמנים", data.totalWalkins],
    ["פריטים סה״כ", data.itemsTotal],
    ["פריטים שהוזנו", data.itemsEntered],
    ["אחוז השלמה", data.itemsTotal > 0 ? `${((data.itemsEntered / data.itemsTotal) * 100).toFixed(1)}%` : "—"],
  ];
  for (const [label, value] of progress) {
    ws.mergeCells(row, 1, row, 2);
    const l = ws.getCell(row, 1);
    l.value = label;
    l.font = { name: "Arial", bold: true, size: 11 };
    l.alignment = { horizontal: "right", vertical: "middle" };
    l.fill = { type: "pattern", pattern: "solid", fgColor: { argb: LIGHT } };
    l.border = allBorders();

    ws.mergeCells(row, 3, row, 5);
    const v = ws.getCell(row, 3);
    v.value = value;
    v.font = { name: "Arial", bold: true, size: 12 };
    v.alignment = { horizontal: "right", vertical: "middle" };
    v.border = allBorders();
    ws.getRow(row).height = 22;
    row++;
  }
  row++;

  // סיכום כספי
  addSectionHeader(ws, row, "סיכום כספי", 5);
  row++;

  const fin = [
    ["הכנסה מהזמנות אתר", data.totalOrderRevenue, GREEN_BG],
    ["הכנסה ממזדמנים", data.walkinRevenue, GREEN_BG],
    ["  מזומן", data.walkinCash, AMBER_BG],
    ["  אשראי במסוף פיזי", data.walkinCardTerminal, null],
    ["  אשראי אונליין", data.walkinOnline, null],
    ["  העברות שהתקבלו", data.walkinTransferReceived, GREEN_BG],
    ["  העברות ממתינות", data.walkinTransferPending, AMBER_BG],
    ["סה״כ הכנסה", data.totalRevenue, GREEN_BG],
    ["עמלות לנציגים", -data.totalCommissions, RED_BG],
    ["הכנסה נטו", data.totalRevenue - data.totalCommissions, GREEN_BG],
  ];

  for (const [label, value, bg] of fin) {
    ws.mergeCells(row, 1, row, 2);
    const l = ws.getCell(row, 1);
    l.value = label;
    const isBold = String(label).indexOf(" ") !== 2;
    l.font = { name: "Arial", bold: isBold, size: isBold ? 12 : 10 };
    l.alignment = { horizontal: "right", vertical: "middle" };
    if (bg) l.fill = { type: "pattern", pattern: "solid", fgColor: { argb: bg as string } };
    l.border = allBorders();

    ws.mergeCells(row, 3, row, 5);
    const v = ws.getCell(row, 3);
    v.value = value;
    v.numFmt = '₪#,##0.00';
    v.font = {
      name: "Arial", bold: isBold, size: isBold ? 12 : 11,
      color: { argb: Number(value) < 0 ? "FFDC2626" : HEAD },
    };
    v.alignment = { horizontal: "center", vertical: "middle" };
    if (bg) v.fill = { type: "pattern", pattern: "solid", fgColor: { argb: bg as string } };
    v.border = allBorders();
    ws.getRow(row).height = 22;
    row++;
  }
}

// ═══════════════════════════════════════════════════
// Sheet 2: הזמנות
// ═══════════════════════════════════════════════════
function buildOrdersSheet(wb: ExcelJS.Workbook, orders: any[]) {
  const ws = wb.addWorksheet("הזמנות", {
    views: [{ rightToLeft: true, state: "normal" }],
    properties: { defaultRowHeight: 22 },
  });

  ws.columns = [
    { header: "לקוח", key: "customer", width: 22 },
    { header: "טלפון", key: "phone", width: 15 },
    { header: "מספר הזמנה", key: "orderNumber", width: 12 },
    { header: "נקודה", key: "point", width: 18 },
    { header: "מוצר", key: "product", width: 26 },
    { header: "הוזמן", key: "ordered", width: 12 },
    { header: "מחיר יח׳", key: "unitPrice", width: 10 },
    { header: "משקל נציג", key: "agentWeight", width: 11 },
    { header: "משקל סופי", key: "finalWeight", width: 11 },
    { header: "מחיר סופי", key: "finalPrice", width: 12 },
    { header: "הערה", key: "note", width: 22 },
    { header: "סטטוס", key: "status", width: 12 },
  ];

  styleHeaderRow(ws, 1, 12);

  let row = 2;
  for (const order of orders) {
    const items = order.items;
    if (items.length === 0) continue;

    const firstRow = row;
    for (const item of items) {
      const r = ws.getRow(row);
      r.getCell(1).value = order.customerName;
      r.getCell(2).value = order.phone;
      r.getCell(3).value = order.orderNumber;
      r.getCell(4).value = order.point?.name || "—";

      const label = item.isSingle ? `${item.productName} (בודדים)` : item.productName;
      r.getCell(5).value = label;
      r.getCell(6).value = item.isSingle
        ? `${Number(item.quantity).toFixed(2)} ק"ג`
        : `${Number(item.quantity)} קרטון`;
      r.getCell(7).value = Number(item.unitPrice);
      r.getCell(7).numFmt = '₪#,##0.00';

      r.getCell(8).value = item.agentEnteredWeight ? Number(item.agentEnteredWeight) : null;
      r.getCell(9).value = item.actualWeight ? Number(item.actualWeight) : (item.agentEnteredWeight ? Number(item.agentEnteredWeight) : null);
      r.getCell(10).value = item.finalPrice ? Number(item.finalPrice) : null;
      r.getCell(10).numFmt = '₪#,##0.00';
      r.getCell(11).value = item.agentNote || "";

      let statusText = "";
      let statusBg: string | null = null;
      if (item.isCancelled) {
        statusText = "✗ בוטל";
        statusBg = RED_BG;
      } else if (item.agentEnteredWeight) {
        statusText = "✓ הוזן";
        statusBg = GREEN_BG;
      } else {
        statusText = "ממתין";
        statusBg = AMBER_BG;
      }
      r.getCell(12).value = statusText;
      if (statusBg) {
        r.getCell(12).fill = { type: "pattern", pattern: "solid", fgColor: { argb: statusBg } };
      }

      // עיצוב כללי
      for (let c = 1; c <= 12; c++) {
        const cell = r.getCell(c);
        cell.alignment = {
          horizontal: c === 8 || c === 9 || c === 10 || c === 12 ? "center" : "right",
          vertical: "middle",
          wrapText: true,
        };
        cell.font = {
          name: "Arial", size: 10,
          strike: item.isCancelled,
          color: { argb: item.isCancelled ? "FF9CA3AF" : HEAD },
        };
        cell.border = allBorders();
      }
      r.height = 26;
      row++;
    }

    // מיזוג עמודות של הלקוח
    if (items.length > 1) {
      ws.mergeCells(firstRow, 1, row - 1, 1);
      ws.mergeCells(firstRow, 2, row - 1, 2);
      ws.mergeCells(firstRow, 3, row - 1, 3);
      ws.mergeCells(firstRow, 4, row - 1, 4);
    }
    // הבלטת שם
    for (let c = 1; c <= 4; c++) {
      const cell = ws.getCell(firstRow, c);
      cell.font = { name: "Arial", bold: c === 1, size: 11 };
    }
  }

  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: row - 1, column: 12 } };
  ws.views = [{ rightToLeft: true, state: "frozen", ySplit: 1 }];
}

// ═══════════════════════════════════════════════════
// Sheet 3: מזדמנים
// ═══════════════════════════════════════════════════
function buildWalkinsSheet(wb: ExcelJS.Workbook, walkins: any[]) {
  const ws = wb.addWorksheet("מזדמנים", {
    views: [{ rightToLeft: true, state: "normal" }],
    properties: { defaultRowHeight: 22 },
  });

  ws.columns = [
    { header: "מספר", key: "num", width: 10 },
    { header: "לקוח", key: "customer", width: 22 },
    { header: "טלפון", key: "phone", width: 15 },
    { header: "מייל", key: "email", width: 22 },
    { header: "נציג", key: "agent", width: 18 },
    { header: "מוצר", key: "product", width: 26 },
    { header: "משקל", key: "weight", width: 10 },
    { header: "מחיר יח׳", key: "unitPrice", width: 10 },
    { header: "סה״כ פריט", key: "totalItem", width: 12 },
    { header: "אמצעי תשלום", key: "payment", width: 15 },
    { header: "התקבל", key: "received", width: 10 },
    { header: "פרטי תשלום", key: "paymentNote", width: 22 },
    { header: "סה״כ הזמנה", key: "totalOrder", width: 12 },
  ];

  styleHeaderRow(ws, 1, 13);

  let row = 2;
  for (const w of walkins) {
    const items = w.items;
    if (items.length === 0) continue;
    const firstRow = row;
    for (const item of items) {
      const r = ws.getRow(row);
      r.getCell(1).value = w.walkinNumber;
      r.getCell(2).value = w.customerName;
      r.getCell(3).value = w.customerPhone || "—";
      r.getCell(4).value = w.customerEmail || "—";
      r.getCell(5).value = w.agent?.name || "—";

      const label = item.isSingle ? `${item.productName} (בודדים)` : item.productName;
      r.getCell(6).value = label;
      r.getCell(7).value = Number(item.weight);
      r.getCell(8).value = Number(item.unitPrice);
      r.getCell(8).numFmt = '₪#,##0.00';
      r.getCell(9).value = Number(item.totalPrice);
      r.getCell(9).numFmt = '₪#,##0.00';

      r.getCell(10).value = PAYMENT_LABELS[w.paymentMethod] || w.paymentMethod;
      r.getCell(11).value = w.paymentReceived ? "✓ כן" : "⏳ ממתין";
      if (!w.paymentReceived) {
        r.getCell(11).fill = { type: "pattern", pattern: "solid", fgColor: { argb: AMBER_BG } };
      }
      r.getCell(12).value = w.paymentNote || "";
      r.getCell(13).value = Number(w.totalAmount);
      r.getCell(13).numFmt = '₪#,##0.00';

      for (let c = 1; c <= 13; c++) {
        const cell = r.getCell(c);
        cell.alignment = {
          horizontal: c === 1 || c === 7 || c === 8 || c === 9 || c === 11 || c === 13 ? "center" : "right",
          vertical: "middle",
        };
        cell.font = { name: "Arial", size: 10 };
        cell.border = allBorders();
      }
      r.height = 26;
      row++;
    }

    if (items.length > 1) {
      // מיזוגים
      for (const c of [1, 2, 3, 4, 5, 10, 11, 12, 13]) {
        ws.mergeCells(firstRow, c, row - 1, c);
      }
    }
    ws.getCell(firstRow, 2).font = { name: "Arial", bold: true, size: 11 };
  }

  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: row - 1, column: 13 } };
  ws.views = [{ rightToLeft: true, state: "frozen", ySplit: 1 }];
}

// ═══════════════════════════════════════════════════
// Sheet 4: השוואת מוצרים
// ═══════════════════════════════════════════════════
function buildProductComparisonSheet(
  wb: ExcelJS.Workbook,
  fromNotes: Record<string, { name: string; weight: number; cartons: number }>,
  used: Record<string, number>
) {
  const ws = wb.addWorksheet("פערי מוצרים", {
    views: [{ rightToLeft: true, state: "normal" }],
    properties: { defaultRowHeight: 22 },
  });

  ws.columns = [
    { header: "מוצר", key: "product", width: 30 },
    { header: "קרטונים בתעודה", key: "cartons", width: 15 },
    { header: "ק״ג בתעודה", key: "received", width: 14 },
    { header: "ק״ג שחולק", key: "distributed", width: 14 },
    { header: "פער ק״ג", key: "diff", width: 12 },
    { header: "אחוז סטייה", key: "percent", width: 12 },
    { header: "סטטוס", key: "status", width: 20 },
  ];

  styleHeaderRow(ws, 1, 7);

  const allIds = new Set([...Object.keys(fromNotes), ...Object.keys(used)]);
  const rows: any[] = [];
  for (const id of allIds) {
    const received = fromNotes[id];
    const receivedW = received?.weight || 0;
    const distributed = used[id] || 0;
    const name = received?.name || "מוצר לא זוהה";

    let diff = 0;
    let percent = 0;
    let status = "אין תעודה";
    let bg = "FFF3F4F6";

    if (receivedW > 0) {
      diff = receivedW - distributed;
      percent = (diff / receivedW) * 100;
      if (diff < 0) { status = "🚨 חריגה"; bg = RED_BG; }
      else if (percent > 5) { status = "פער משמעותי"; bg = RED_BG; }
      else if (percent > 1) { status = "פער קטן"; bg = AMBER_BG; }
      else { status = "✓ תקין"; bg = GREEN_BG; }
    }

    rows.push({ name, cartons: received?.cartons || 0, receivedW, distributed, diff, percent, status, bg });
  }

  rows.sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff));

  let row = 2;
  for (const r of rows) {
    const rr = ws.getRow(row);
    rr.getCell(1).value = r.name;
    rr.getCell(2).value = r.cartons;
    rr.getCell(3).value = r.receivedW || null;
    rr.getCell(4).value = r.distributed;
    rr.getCell(5).value = r.receivedW > 0 ? r.diff : null;
    rr.getCell(6).value = r.receivedW > 0 ? r.percent / 100 : null;
    rr.getCell(6).numFmt = "0.0%";
    rr.getCell(7).value = r.status;

    for (let c = 1; c <= 7; c++) {
      const cell = rr.getCell(c);
      cell.alignment = {
        horizontal: c === 1 ? "right" : "center",
        vertical: "middle",
      };
      cell.font = { name: "Arial", size: 11 };
      cell.border = allBorders();
      if (c === 7) {
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: r.bg } };
        cell.font = { name: "Arial", size: 11, bold: true };
      }
    }
    rr.height = 24;
    row++;
  }

  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: row - 1, column: 7 } };
  ws.views = [{ rightToLeft: true, state: "frozen", ySplit: 1 }];
}

// ═══════════════════════════════════════════════════
// Sheet 5: נציגים
// ═══════════════════════════════════════════════════
function buildAgentsSheet(
  wb: ExcelJS.Workbook,
  summaries: any[],
  walkins: any[],
  payments: any[]
) {
  const ws = wb.addWorksheet("נציגים ותשלומים", {
    views: [{ rightToLeft: true, state: "normal" }],
    properties: { defaultRowHeight: 22 },
  });

  ws.columns = [
    { header: "נציג", key: "name", width: 20 },
    { header: "טלפון", key: "phone", width: 15 },
    { header: "מייל", key: "email", width: 22 },
    { header: "נקודה", key: "point", width: 18 },
    { header: "ק״ג קרטונים", key: "cartons", width: 12 },
    { header: "ק״ג בודדים", key: "singles", width: 12 },
    { header: "ק״ג מזדמנים", key: "walkinKg", width: 12 },
    { header: "לקוחות", key: "custs", width: 10 },
    { header: "מזדמנים", key: "walkinsCount", width: 10 },
    { header: "עמלה סה״כ", key: "commission", width: 14 },
    { header: "מזומן שאסף", key: "cashCollected", width: 14 },
    { header: "העביר למנהל", key: "cashHandedIn", width: 14 },
    { header: "שולם", key: "paid", width: 12 },
    { header: "יתרה", key: "balance", width: 14 },
    { header: "סטטוס", key: "status", width: 12 },
    { header: "הערת נציג", key: "note", width: 30 },
  ];

  styleHeaderRow(ws, 1, 16);

  let row = 2;
  for (const s of summaries) {
    const agentId = s.agentId;
    const cashCollected = walkins
      .filter((w) => w.agentId === agentId && w.paymentMethod === "CASH" && w.paymentReceived)
      .reduce((sum, w) => sum + Number(w.totalAmount), 0);
    const cashHandedIn = payments
      .filter((p) => p.agentId === agentId && p.type === "COLLECTED")
      .reduce((sum, p) => sum + Number(p.amount), 0);
    const paid = payments
      .filter((p) => p.agentId === agentId && p.type === "PAID")
      .reduce((sum, p) => sum + Number(p.amount), 0);
    const balance = Number(s.totalCommission) - paid - (cashCollected - cashHandedIn);

    const r = ws.getRow(row);
    r.getCell(1).value = s.agent.name;
    r.getCell(2).value = s.agent.phone || "—";
    r.getCell(3).value = s.agent.email || "—";
    r.getCell(4).value = s.agent.agentPoint?.name || "—";
    r.getCell(5).value = Number(s.totalCartonWeight);
    r.getCell(6).value = Number(s.totalSinglesWeight);
    r.getCell(7).value = Number(s.totalWalkinWeight);
    r.getCell(8).value = s.totalCustomers;
    r.getCell(9).value = s.totalWalkins;
    r.getCell(10).value = Number(s.totalCommission);
    r.getCell(10).numFmt = '₪#,##0.00';
    r.getCell(11).value = cashCollected || null;
    r.getCell(11).numFmt = '₪#,##0.00';
    r.getCell(12).value = cashHandedIn || null;
    r.getCell(12).numFmt = '₪#,##0.00';
    r.getCell(13).value = paid || null;
    r.getCell(13).numFmt = '₪#,##0.00';
    r.getCell(14).value = balance;
    r.getCell(14).numFmt = '₪#,##0.00';

    // צביעת יתרה
    if (balance > 0.01) {
      r.getCell(14).fill = { type: "pattern", pattern: "solid", fgColor: { argb: RED_BG } };
      r.getCell(14).font = { name: "Arial", bold: true, size: 11, color: { argb: "FFDC2626" } };
    } else if (balance < -0.01) {
      r.getCell(14).fill = { type: "pattern", pattern: "solid", fgColor: { argb: GREEN_BG } };
      r.getCell(14).font = { name: "Arial", bold: true, size: 11, color: { argb: "FF059669" } };
    }

    r.getCell(15).value = s.status === "CONFIRMED" ? "✓ סגור" : "פתוח";
    r.getCell(15).fill = {
      type: "pattern", pattern: "solid",
      fgColor: { argb: s.status === "CONFIRMED" ? GREEN_BG : AMBER_BG },
    };
    r.getCell(16).value = s.remainderNote || "";

    for (let c = 1; c <= 16; c++) {
      const cell = r.getCell(c);
      cell.alignment = {
        horizontal: c >= 5 && c <= 14 ? "center" : "right",
        vertical: "middle",
        wrapText: true,
      };
      if (!cell.font) cell.font = { name: "Arial", size: 11 };
      cell.border = allBorders();
    }
    r.height = 28;
    row++;
  }

  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: row - 1, column: 16 } };
  ws.views = [{ rightToLeft: true, state: "frozen", ySplit: 1 }];
}

// ═══════════════════════════════════════════════════
// Sheet 6: תעודות משלוח
// ═══════════════════════════════════════════════════
function buildDeliveryNotesSheet(wb: ExcelJS.Workbook, notes: any[]) {
  const ws = wb.addWorksheet("תעודות משלוח", {
    views: [{ rightToLeft: true, state: "normal" }],
    properties: { defaultRowHeight: 22 },
  });

  ws.columns = [
    { header: "מספר תעודה", key: "num", width: 14 },
    { header: "ספק", key: "supplier", width: 22 },
    { header: "תאריך", key: "date", width: 14 },
    { header: "מוצר בתעודה", key: "productOnNote", width: 26 },
    { header: "מוצר במערכת", key: "productSystem", width: 26 },
    { header: "קרטונים", key: "cartons", width: 10 },
    { header: "משקל ק״ג", key: "weight", width: 12 },
  ];

  styleHeaderRow(ws, 1, 7);

  let row = 2;
  for (const note of notes) {
    for (const item of note.items) {
      const r = ws.getRow(row);
      r.getCell(1).value = note.noteNumber || "—";
      r.getCell(2).value = note.supplierName || "—";
      r.getCell(3).value = note.noteDate ? formatDate(note.noteDate) : "—";
      r.getCell(4).value = item.productNameOnNote;
      r.getCell(5).value = item.product?.name || (item.productId ? "—" : "❌ לא הותאם");
      r.getCell(6).value = item.quantity;
      r.getCell(7).value = Number(item.weight);

      if (!item.productId) {
        r.getCell(5).fill = { type: "pattern", pattern: "solid", fgColor: { argb: RED_BG } };
      }

      for (let c = 1; c <= 7; c++) {
        const cell = r.getCell(c);
        cell.alignment = {
          horizontal: c === 1 || c === 6 || c === 7 ? "center" : "right",
          vertical: "middle",
        };
        cell.font = { name: "Arial", size: 10 };
        cell.border = allBorders();
      }
      r.height = 24;
      row++;
    }
  }

  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: row - 1, column: 7 } };
  ws.views = [{ rightToLeft: true, state: "frozen", ySplit: 1 }];
}

// ═══════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════
function addSectionHeader(ws: ExcelJS.Worksheet, row: number, title: string, cols: number) {
  ws.mergeCells(row, 1, row, cols);
  const cell = ws.getCell(row, 1);
  cell.value = title;
  cell.font = { name: "Arial", bold: true, size: 14, color: { argb: WHITE } };
  cell.alignment = { horizontal: "right", vertical: "middle" };
  cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: RUST } };
  ws.getRow(row).height = 28;
}

function styleHeaderRow(ws: ExcelJS.Worksheet, row: number, cols: number) {
  const r = ws.getRow(row);
  for (let c = 1; c <= cols; c++) {
    const cell = r.getCell(c);
    cell.font = { name: "Arial", bold: true, size: 11, color: { argb: WHITE } };
    cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEAD } };
    cell.border = allBorders();
  }
  r.height = 32;
}

function allBorders(): any {
  const style: any = { style: "thin", color: { argb: "FFD4D4D8" } };
  return { top: style, left: style, right: style, bottom: style };
}

function formatDate(d: Date | string): string {
  const date = typeof d === "string" ? new Date(d) : d;
  return date.toLocaleDateString("he-IL", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function formatDateForFile(d: Date | string): string {
  const date = typeof d === "string" ? new Date(d) : d;
  const dd = String(date.getDate()).padStart(2, "0");
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const yyyy = date.getFullYear();
  return `${dd}-${mm}-${yyyy}`;
}
