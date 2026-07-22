// §20: ייצוא Excel מעוצב לנציג לפני יום החלוקה
// GET /api/agent/export-sale/[pricelistId]
//
// מפיק קובץ Excel עם:
// - כותרת: לוגו טקסטואלי + פרטי מכירה + שם הנציג + נקודה
// - קטע 1: לקוחות רשומים - שורה לכל פריט עם עמודות: לקוח | טלפון | מוצר | הוזמן | בפועל | הערה
// - קטע 2: 8-10 שורות ריקות למזדמנים - עם עמודת אמצעי תשלום

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAgent } from "@/lib/agent-guard";
import ExcelJS from "exceljs";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ pricelistId: string }> }
) {
  const g = await requireAgent();
  if (!g.ok) return g.res;

  const { pricelistId } = await params;

  // טעינת נתונים
  const pricelist = await prisma.pricelist.findUnique({
    where: { id: pricelistId },
    select: {
      id: true,
      name: true,
      deliveryDate: true,
      deliveryDateText: true,
    },
  });
  if (!pricelist) {
    return NextResponse.json({ error: "מחירון לא נמצא" }, { status: 404 });
  }

  // הזמנות של הנקודה
  const whereOrders: any = {
    pricelistId,
    status: { notIn: ["CANCELLED"] },
  };
  if (g.agent.agentPointId) whereOrders.pointId = g.agent.agentPointId;

  const orders = await prisma.order.findMany({
    where: whereOrders,
    orderBy: [{ customerName: "asc" }, { createdAt: "asc" }],
    include: {
      items: {
        include: { product: { select: { name: true, unit: true } } },
      },
    },
  });

  // תעודות משלוח מאושרות - להוסיף לסיכום
  const deliveryNotes = await prisma.deliveryNote.findMany({
    where: { pricelistId, status: "CONFIRMED" },
    include: {
      items: {
        include: { product: { select: { id: true, name: true } } },
      },
    },
  });

  // סיכום ק"ג לפי מוצר לפי התעודות
  const productWeightsFromNotes: Record<string, number> = {};
  for (const note of deliveryNotes) {
    for (const item of note.items) {
      if (item.productId) {
        productWeightsFromNotes[item.productId] =
          (productWeightsFromNotes[item.productId] || 0) + Number(item.weight);
      }
    }
  }

  // ═══════════════════════════════════════════════════
  // בניית ה-Excel
  // ═══════════════════════════════════════════════════

  const wb = new ExcelJS.Workbook();
  wb.creator = "צדקת רבותינו";
  wb.created = new Date();

  const ws = wb.addWorksheet("דוח חלוקה", {
    views: [{ rightToLeft: true, state: "normal" }],
    pageSetup: {
      paperSize: 9, // A4
      orientation: "landscape",
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
      margins: {
        left: 0.4, right: 0.4, top: 0.4, bottom: 0.4,
        header: 0.2, footer: 0.2,
      },
    },
    properties: { defaultRowHeight: 22 },
  });

  // ─── עיצוב צבעים ─────────────────────────────────
  const YELLOW = "FFFFE000";
  const RUST = "FFC0461E";
  const LIGHT = "FFFFF8D8";
  const GRAY_HEAD = "FF3F3F46";
  const WHITE = "FFFFFFFF";

  // ─── עמודות ─────────────────────────────────
  ws.columns = [
    { key: "customer", width: 22 },      // A: לקוח
    { key: "phone", width: 15 },         // B: טלפון
    { key: "product", width: 32 },       // C: מוצר
    { key: "ordered", width: 12 },       // D: הוזמן
    { key: "actual", width: 14 },        // E: בפועל (למלא)
    { key: "note", width: 22 },          // F: הערה (למלא)
    { key: "payment", width: 14 },       // G: תשלום (למלא - למזדמנים)
  ];

  let row = 1;

  // ─── שורה 1-2: כותרת מרכזית ─────────────────
  ws.mergeCells(row, 1, row, 7);
  const titleCell = ws.getCell(row, 1);
  titleCell.value = "צדקת רבותינו — דוח חלוקה";
  titleCell.font = { name: "Arial", bold: true, size: 20, color: { argb: RUST } };
  titleCell.alignment = { horizontal: "center", vertical: "middle" };
  titleCell.fill = {
    type: "pattern", pattern: "solid",
    fgColor: { argb: YELLOW },
  };
  ws.getRow(row).height = 40;
  row++;

  ws.mergeCells(row, 1, row, 7);
  const subCell = ws.getCell(row, 1);
  subCell.value = "עופות בשר ודגים — לכבוד שבת ויום טוב";
  subCell.font = { name: "Arial", bold: true, size: 12, color: { argb: GRAY_HEAD } };
  subCell.alignment = { horizontal: "center", vertical: "middle" };
  subCell.fill = {
    type: "pattern", pattern: "solid",
    fgColor: { argb: LIGHT },
  };
  ws.getRow(row).height = 22;
  row += 2;

  // ─── פרטי המכירה + הנציג ─────────────────
  const infoRows = [
    ["שם המכירה:", pricelist.name],
    ["תאריך חלוקה:", pricelist.deliveryDateText || (pricelist.deliveryDate ? formatDate(pricelist.deliveryDate) : "—")],
    ["שם הנציג:", g.agent.name],
    ["נקודת חלוקה:", g.agent.agentPoint?.name || "כל הנקודות"],
    ["מספר הזמנות:", String(orders.length)],
    ["תאריך הפקה:", formatDate(new Date())],
  ];

  for (const [label, value] of infoRows) {
    ws.mergeCells(row, 1, row, 2);
    const labelCell = ws.getCell(row, 1);
    labelCell.value = label;
    labelCell.font = { name: "Arial", bold: true, size: 11 };
    labelCell.alignment = { horizontal: "right", vertical: "middle" };
    labelCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: LIGHT } };

    ws.mergeCells(row, 3, row, 7);
    const valueCell = ws.getCell(row, 3);
    valueCell.value = value;
    valueCell.font = { name: "Arial", size: 11 };
    valueCell.alignment = { horizontal: "right", vertical: "middle" };

    ws.getRow(row).height = 20;
    row++;
  }

  row++;

  // ═══════════════════════════════════════════════════
  // חלק 1: לקוחות רשומים
  // ═══════════════════════════════════════════════════
  ws.mergeCells(row, 1, row, 7);
  const sect1 = ws.getCell(row, 1);
  sect1.value = `🛒 לקוחות רשומים (${orders.length})`;
  sect1.font = { name: "Arial", bold: true, size: 14, color: { argb: WHITE } };
  sect1.alignment = { horizontal: "right", vertical: "middle" };
  sect1.fill = { type: "pattern", pattern: "solid", fgColor: { argb: RUST } };
  ws.getRow(row).height = 28;
  row++;

  // כותרות עמודות
  const header1 = ["לקוח", "טלפון", "מוצר", "הוזמן", "משקל בפועל", "הערה", ""];
  const headerRow1 = ws.getRow(row);
  header1.forEach((label, idx) => {
    const cell = headerRow1.getCell(idx + 1);
    cell.value = label;
    cell.font = { name: "Arial", bold: true, size: 11, color: { argb: WHITE } };
    cell.alignment = { horizontal: "center", vertical: "middle" };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: GRAY_HEAD } };
    cell.border = allBorders();
  });
  headerRow1.height = 26;
  row++;

  // שורות של לקוחות
  if (orders.length === 0) {
    ws.mergeCells(row, 1, row, 7);
    const empty = ws.getCell(row, 1);
    empty.value = "אין הזמנות רשומות במכירה זו";
    empty.font = { italic: true, color: { argb: "FF888888" } };
    empty.alignment = { horizontal: "center", vertical: "middle" };
    empty.border = allBorders();
    row++;
  } else {
    for (const order of orders) {
      const activeItems = order.items.filter((i) => !i.isCancelled);
      if (activeItems.length === 0) continue;

      // מיזוג שם ומספר טלפון על כל שורות הפריטים של הלקוח
      const firstRow = row;
      const lastRow = firstRow + activeItems.length - 1;

      activeItems.forEach((item, idx) => {
        const r = ws.getRow(row);

        // עמודה A: לקוח (רק בשורה הראשונה)
        if (idx === 0) {
          r.getCell(1).value = `${order.customerName}\n#${order.orderNumber}`;
        }
        // עמודה B: טלפון (רק בשורה הראשונה)
        if (idx === 0) {
          r.getCell(2).value = order.phone;
        }

        // עמודה C: מוצר
        const productLabel = item.isSingle
          ? `${item.productName} (בודדים)`
          : item.productName;
        r.getCell(3).value = productLabel;

        // עמודה D: הוזמן
        const orderedText = item.isSingle
          ? `${Number(item.quantity).toFixed(2)} ק"ג`
          : `${Number(item.quantity)} קרטון`;
        r.getCell(4).value = orderedText;

        // עמודה E: משקל בפועל (ריק לנציג למלא)
        r.getCell(5).value = "";

        // עמודה F: הערה (ריק)
        r.getCell(6).value = "";

        // עמודה G: ריק (רק במזדמנים)
        r.getCell(7).value = "";

        // עיצוב כל השורה
        for (let c = 1; c <= 7; c++) {
          const cell = r.getCell(c);
          cell.alignment = {
            horizontal: c === 5 ? "center" : "right",
            vertical: "middle",
            wrapText: true,
          };
          cell.font = { name: "Arial", size: 10 };
          cell.border = allBorders();
        }
        // צביעה סירוגית של שורות לקוח (רק לקוח)
        const bg = firstRow % 2 === 0 ? "FFFCFCFC" : WHITE;
        for (let c = 1; c <= 7; c++) {
          r.getCell(c).fill = { type: "pattern", pattern: "solid", fgColor: { argb: bg } };
        }

        r.height = 30;
        row++;
      });

      // מיזוג עמודות A ו-B על שורות הלקוח
      if (activeItems.length > 1) {
        ws.mergeCells(firstRow, 1, lastRow, 1);
        ws.mergeCells(firstRow, 2, lastRow, 2);
      }

      // הבלטה של תא השם
      const nameCell = ws.getCell(firstRow, 1);
      nameCell.font = { name: "Arial", bold: true, size: 11 };
      nameCell.alignment = { horizontal: "right", vertical: "middle", wrapText: true };
    }
  }

  row += 2;

  // ═══════════════════════════════════════════════════
  // חלק 2: לקוחות מזדמנים (שורות ריקות למילוי)
  // ═══════════════════════════════════════════════════
  ws.mergeCells(row, 1, row, 7);
  const sect2 = ws.getCell(row, 1);
  sect2.value = "🧾 לקוחות מזדמנים - מלא ידנית בזמן החלוקה";
  sect2.font = { name: "Arial", bold: true, size: 14, color: { argb: WHITE } };
  sect2.alignment = { horizontal: "right", vertical: "middle" };
  sect2.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF7C3AED" } }; // סגול
  ws.getRow(row).height = 28;
  row++;

  const header2 = ["שם הלקוח", "טלפון", "מוצר", "משקל", "מחיר לק״ג", "סה״כ", "אמצעי תשלום"];
  const headerRow2 = ws.getRow(row);
  header2.forEach((label, idx) => {
    const cell = headerRow2.getCell(idx + 1);
    cell.value = label;
    cell.font = { name: "Arial", bold: true, size: 11, color: { argb: WHITE } };
    cell.alignment = { horizontal: "center", vertical: "middle" };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: GRAY_HEAD } };
    cell.border = allBorders();
  });
  headerRow2.height = 26;
  row++;

  // 15 שורות ריקות למזדמנים
  for (let i = 0; i < 15; i++) {
    const r = ws.getRow(row);
    for (let c = 1; c <= 7; c++) {
      const cell = r.getCell(c);
      cell.value = "";
      cell.border = allBorders();
      cell.fill = {
        type: "pattern", pattern: "solid",
        fgColor: { argb: i % 2 === 0 ? "FFFAF5FF" : WHITE }, // סגול-לבן סירוגי
      };
      cell.font = { name: "Arial", size: 10 };
      cell.alignment = { horizontal: "right", vertical: "middle" };
    }
    r.height = 32;
    row++;
  }

  row += 2;

  // ═══════════════════════════════════════════════════
  // חלק 3: סיכום תעודות משלוח (אם קיימות)
  // ═══════════════════════════════════════════════════
  if (Object.keys(productWeightsFromNotes).length > 0) {
    ws.mergeCells(row, 1, row, 7);
    const sect3 = ws.getCell(row, 1);
    sect3.value = "📄 ק״ג שהתקבלו מהספק (לפי תעודות משלוח)";
    sect3.font = { name: "Arial", bold: true, size: 14, color: { argb: WHITE } };
    sect3.alignment = { horizontal: "right", vertical: "middle" };
    sect3.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF059669" } }; // ירוק
    ws.getRow(row).height = 28;
    row++;

    // כותרות
    ws.mergeCells(row, 1, row, 3);
    const nH = ws.getCell(row, 1);
    nH.value = "מוצר";
    nH.font = { name: "Arial", bold: true, size: 11, color: { argb: WHITE } };
    nH.alignment = { horizontal: "center", vertical: "middle" };
    nH.fill = { type: "pattern", pattern: "solid", fgColor: { argb: GRAY_HEAD } };
    nH.border = allBorders();

    ws.mergeCells(row, 4, row, 5);
    const kH = ws.getCell(row, 4);
    kH.value = "ק״ג בתעודה";
    kH.font = { name: "Arial", bold: true, size: 11, color: { argb: WHITE } };
    kH.alignment = { horizontal: "center", vertical: "middle" };
    kH.fill = { type: "pattern", pattern: "solid", fgColor: { argb: GRAY_HEAD } };
    kH.border = allBorders();

    ws.mergeCells(row, 6, row, 7);
    const wH = ws.getCell(row, 6);
    wH.value = "ק״ג שחילקתי";
    wH.font = { name: "Arial", bold: true, size: 11, color: { argb: WHITE } };
    wH.alignment = { horizontal: "center", vertical: "middle" };
    wH.fill = { type: "pattern", pattern: "solid", fgColor: { argb: GRAY_HEAD } };
    wH.border = allBorders();

    ws.getRow(row).height = 26;
    row++;

    // מפה של productId -> productName
    const productNameMap: Record<string, string> = {};
    for (const note of deliveryNotes) {
      for (const item of note.items) {
        if (item.productId && item.product) {
          productNameMap[item.productId] = item.product.name;
        }
      }
    }

    let totalNoteWeight = 0;
    for (const [productId, weight] of Object.entries(productWeightsFromNotes)) {
      const r = ws.getRow(row);
      ws.mergeCells(row, 1, row, 3);
      const nc = ws.getCell(row, 1);
      nc.value = productNameMap[productId] || "מוצר לא ידוע";
      nc.font = { name: "Arial", size: 11 };
      nc.alignment = { horizontal: "right", vertical: "middle" };
      nc.border = allBorders();

      ws.mergeCells(row, 4, row, 5);
      const kc = ws.getCell(row, 4);
      kc.value = weight.toFixed(2);
      kc.font = { name: "Arial", bold: true, size: 12 };
      kc.alignment = { horizontal: "center", vertical: "middle" };
      kc.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF0FDF4" } };
      kc.border = allBorders();

      ws.mergeCells(row, 6, row, 7);
      const wc = ws.getCell(row, 6);
      wc.value = ""; // למילוי
      wc.border = allBorders();
      wc.fill = { type: "pattern", pattern: "solid", fgColor: { argb: WHITE } };

      r.height = 26;
      totalNoteWeight += weight;
      row++;
    }

    // שורת סיכום
    ws.mergeCells(row, 1, row, 3);
    const totLabel = ws.getCell(row, 1);
    totLabel.value = "סה״כ:";
    totLabel.font = { name: "Arial", bold: true, size: 13, color: { argb: RUST } };
    totLabel.alignment = { horizontal: "right", vertical: "middle" };
    totLabel.fill = { type: "pattern", pattern: "solid", fgColor: { argb: LIGHT } };
    totLabel.border = allBorders();

    ws.mergeCells(row, 4, row, 5);
    const totVal = ws.getCell(row, 4);
    totVal.value = totalNoteWeight.toFixed(2);
    totVal.font = { name: "Arial", bold: true, size: 13, color: { argb: RUST } };
    totVal.alignment = { horizontal: "center", vertical: "middle" };
    totVal.fill = { type: "pattern", pattern: "solid", fgColor: { argb: LIGHT } };
    totVal.border = allBorders();

    ws.mergeCells(row, 6, row, 7);
    const emptyC = ws.getCell(row, 6);
    emptyC.border = allBorders();
    emptyC.fill = { type: "pattern", pattern: "solid", fgColor: { argb: LIGHT } };

    ws.getRow(row).height = 28;
    row += 2;
  }

  // ═══════════════════════════════════════════════════
  // הערות בסוף
  // ═══════════════════════════════════════════════════
  ws.mergeCells(row, 1, row, 7);
  const notes = ws.getCell(row, 1);
  notes.value =
    "⚠️ הנחיות: מלא בעט או עיפרון את המשקלים בעמודה 'משקל בפועל' עם הערות במידת הצורך. " +
    "בערב, לאחר החלוקה, היכנס לאתר והזן את הנתונים בממשק הנציג.";
  notes.font = { name: "Arial", italic: true, size: 10, color: { argb: "FF666666" } };
  notes.alignment = { horizontal: "right", vertical: "middle", wrapText: true };
  notes.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFFBEB" } };
  notes.border = allBorders();
  ws.getRow(row).height = 40;

  // ═══════════════════════════════════════════════════
  // ייצוא
  // ═══════════════════════════════════════════════════
  const buffer = await wb.xlsx.writeBuffer();

  const fileName = `דוח_חלוקה_${g.agent.name}_${formatDateForFile(pricelist.deliveryDate || new Date())}.xlsx`;

  return new NextResponse(buffer as any, {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`,
      "Cache-Control": "no-store",
    },
  });
}

// ─── עזרים ─────────────────────────────────
function allBorders(): any {
  const style: any = { style: "thin", color: { argb: "FFD4D4D8" } };
  return { top: style, left: style, right: style, bottom: style };
}

function formatDate(d: Date | string): string {
  const date = typeof d === "string" ? new Date(d) : d;
  return date.toLocaleDateString("he-IL", {
    day: "2-digit", month: "2-digit", year: "numeric",
  });
}

function formatDateForFile(d: Date | string): string {
  const date = typeof d === "string" ? new Date(d) : d;
  const dd = String(date.getDate()).padStart(2, "0");
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const yyyy = date.getFullYear();
  return `${dd}-${mm}-${yyyy}`;
}
