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
// §129: תצוגת יחידות - מקור אחד לכל המערכת
import { formatItemQty } from "@/lib/order-display";

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
  // §117: 🐛 דפוס ג' - השליפה השתמשה ב-agentPointId היחיד, ולכן
  // נציג המשויך לכמה נקודות קיבל דוח של אחת בלבד. השאר פשוט לא
  // הופיעו, בלי שום סימן לכך שחסר משהו.
  if (!g.isAdmin && g.agentPointIds.length > 0) {
    whereOrders.pointId = { in: g.agentPointIds };
  }

  const orders = await prisma.order.findMany({
    where: whereOrders,
    orderBy: [{ customerName: "asc" }, { createdAt: "asc" }],
    include: {
      items: {
        include: { product: { select: { id: true, name: true, unit: true } } },
      },
      // §117: הנקודה - לפיצול לגיליון נפרד לכל נקודת חלוקה
      point: { select: { id: true, name: true } },
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

  // ═══════════════════════════════════════════════════════════════
  // §117: דף חלוקה - שורה לכל לקוח, מוצרים בעמודות
  // ═══════════════════════════════════════════════════════════════
  // 🐛 מה שהיה: שורה לכל **פריט**. לקוח עם 6 מוצרים תפס 6 שורות,
  // ובנקודה עם 100 לקוחות זה 600 שורות - עשרות דפים שהנציג סוחב
  // ביד בחלוקה ומחפש בהם איפה הוא נמצא.
  //
  // עכשיו: שורה אחת ללקוח, עמודה לכל מוצר. אותו עיקרון בדיוק
  // כמו טבלת המשקלים באתר (§81), רק על נייר.
  //
  // ⚠️ גיליון נפרד לכל נקודה: הנציג מחלק בנקודה אחת, ואין טעם
  // שיסחוב את כולן. הוא מדפיס רק את הגיליון שלו.

  const wb = new ExcelJS.Workbook();
  wb.creator = "צדקת רבותינו";
  wb.created = new Date();

  // קיבוץ לפי נקודה
  const byPoint = new Map<string, { name: string; orders: typeof orders }>();
  for (const o of orders) {
    const pid = o.pointId;
    const name = o.point?.name || o.pointNameSnapshot || "נקודה לא ידועה";
    if (!byPoint.has(pid)) byPoint.set(pid, { name, orders: [] });
    byPoint.get(pid)!.orders.push(o);
  }
  if (byPoint.size === 0) {
    byPoint.set("empty", { name: "אין הזמנות", orders: [] });
  }

  const saleTitle =
    pricelist.name +
    (pricelist.deliveryDateText ? ` — חלוקה: ${pricelist.deliveryDateText}` : "");

  for (const [, grp] of byPoint) {
    buildDistributionSheet(wb, grp.name, grp.orders, saleTitle, g.agent.name);
  }

  const buf = await wb.xlsx.writeBuffer();
  const fname = `דף-חלוקה-${pricelist.name.replace(/[^\u0590-\u05FF\w\s-]/g, "").trim()}.xlsx`;
  return new NextResponse(buf as any, {
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(fname)}`,
    },
  });
}

// ─────────────────────────────────────────────────────────────
// גיליון נקודה אחת
// ─────────────────────────────────────────────────────────────
function buildDistributionSheet(
  wb: ExcelJS.Workbook,
  pointName: string,
  orders: any[],
  saleTitle: string,
  agentName: string
) {
  // שם גיליון: אקסל אוסר : \ / ? * [ ] ומגביל ל-31 תווים
  const safeName = pointName.replace(/[:\\/?*[\]]/g, "-").slice(0, 31) || "נקודה";
  const ws = wb.addWorksheet(safeName, {
    views: [{ rightToLeft: true, state: "frozen", xSplit: 2, ySplit: 5 }],
    pageSetup: {
      paperSize: 9,
      orientation: "landscape",
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
      margins: { left: 0.25, right: 0.25, top: 0.4, bottom: 0.4, header: 0.2, footer: 0.2 },
      // ⚠️ הכותרת חוזרת בכל דף מודפס. בלי זה, מהדף השני והלאה
      // הנציג רואה עמודות מספרים בלי לדעת איזה מוצר זה איזה.
      printTitlesRow: "4:5",
    },
  });

  // ─── העמודות: רק מוצרים שהוזמנו בפועל ───
  //
  // לא כל הקטלוג - רק מה שמישהו בנקודה הזו הזמין. מוצר שאיש לא
  // הזמין הוא עמודה ריקה שגוזלת רוחב יקר על דף מודפס.
  //
  // הסדר לפי מספר המזמינים: הנפוצים ראשונים, קרוב לשם הלקוח.
  const prodCount = new Map<string, { id: string; name: string; unit: string; n: number }>();
  for (const o of orders) {
    for (const it of o.items) {
      if (it.isCancelled) continue;
      const cur = prodCount.get(it.productId) || {
        id: it.productId,
        name: it.product?.name || it.productName,
        unit: it.unit || "",
        n: 0,
      };
      cur.n++;
      prodCount.set(it.productId, cur);
    }
  }
  const products = Array.from(prodCount.values()).sort(
    (a, b) => b.n - a.n || a.name.localeCompare(b.name, "he")
  );

  // רוחב עמודות: שם, טלפון, מוצרים, טופל
  // §131: עמודת מזומן לפני "טופל".
  //
  // התרחיש: לקוח רשום כמשלם באשראי, וביום החלוקה הביא מזומן.
  // הנציג מסמן על הנייר, ואחר כך מזין במערכת - ואם אין לו איפה
  // לרשום, הוא יזכור שלושה לקוחות ויפספס את הרביעי. הכרטיס
  // יחויב בערב והלקוח ישלם פעמיים.
  ws.columns = [
    { width: 20 },
    { width: 14 },
    ...products.map(() => ({ width: 11 })),
    { width: 10 },
    { width: 7 },
  ];
  const cashCol = 2 + products.length + 1;
  const lastCol = cashCol + 1;

  // ─── כותרת ───
  ws.mergeCells(1, 1, 1, lastCol);
  const t = ws.getCell(1, 1);
  t.value = `${pointName} — ${saleTitle}`;
  // §130: צבעי המותג. דף שנראה כמו מסמך של העמותה ולא כמו
  // פלט גולמי - הנציג מחזיק אותו מול לקוחות.
  t.font = { size: 15, bold: true, color: { argb: "FFFFFFFF" } };
  t.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFC0461E" } };
  t.alignment = { horizontal: "center" };

  ws.mergeCells(2, 1, 2, lastCol);
  const sub = ws.getCell(2, 1);
  sub.value =
    `נציג: ${agentName} · ${orders.length} לקוחות · הודפס ${new Date().toLocaleDateString("he-IL")}` +
    ` · לקוח ששילם במזומן — לסמן בעמודת "מזומן" ולעדכן במערכת`;
  sub.font = { size: 10, color: { argb: "FF666666" } };
  sub.alignment = { horizontal: "center" };

  // ─── כותרות עמודות (שתי שורות) ───
  // שורה 4: שם המוצר. שורה 5: "הוזמן | משקל".
  ws.mergeCells(4, 1, 5, 1);
  ws.mergeCells(4, 2, 5, 2);
  ws.getCell(4, 1).value = "שם הלקוח";
  // ⚠️ הטלפון בעמודה קבועה ליד השם, ולא בשורה נפרדת: בחלוקה
  // הנציג צריך להתקשר ללקוח שלא הגיע, ובלי מספר מול העיניים
  // הוא חוזר לרכב לחפש ברשימה אחרת.
  ws.getCell(4, 2).value = "טלפון";

  products.forEach((p, i) => {
    const col = 3 + i;
    ws.mergeCells(4, col, 4, col);
    const c = ws.getCell(4, col);
    c.value = p.name;
    c.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
    const c2 = ws.getCell(5, col);
    c2.value = "הוזמן / משקל";
    c2.font = { size: 8, color: { argb: "FF888888" } };
    c2.alignment = { horizontal: "center" };
  });

  ws.mergeCells(4, cashCol, 5, cashCol);
  const cashHdr = ws.getCell(4, cashCol);
  cashHdr.value = "מזומן\nשולם";
  cashHdr.alignment = { horizontal: "center", vertical: "middle", wrapText: true };

  ws.mergeCells(4, lastCol, 5, lastCol);
  ws.getCell(4, lastCol).value = "טופל";

  for (let c = 1; c <= lastCol; c++) {
    for (let r = 4; r <= 5; r++) {
      const cell = ws.getCell(r, c);
      cell.font = { bold: r === 4, size: r === 4 ? 10 : 8, ...(r === 5 ? { color: { argb: "FF888888" } } : {}) };
      cell.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: r === 4 ? "FFF5E6DC" : "FFFAF3EE" },
      };
      cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
      cell.border = {
        top: { style: "thin" },
        left: { style: "thin" },
        bottom: { style: r === 5 ? "medium" : "thin" },
        right: { style: "thin" },
      };
    }
  }
  ws.getRow(4).height = 30;
  ws.getRow(5).height = 12;

  // ─── שורות הלקוחות ───
  const thin = { style: "thin" as const, color: { argb: "FFBBBBBB" } };
  const cellBorder = { top: thin, left: thin, bottom: thin, right: thin };

  orders.forEach((o, idx) => {
    const r = 6 + idx;
    const row = ws.getRow(r);
    // גובה נדיב - צריך מקום לכתוב משקל ביד
    row.height = 26;

    const nameCell = ws.getCell(r, 1);
    nameCell.value = o.customerName;
    nameCell.font = { bold: true, size: 10, color: { argb: "FF2C3E4F" } };
    nameCell.alignment = { vertical: "middle" };

    const phoneCell = ws.getCell(r, 2);
    phoneCell.value = o.phone || "";
    phoneCell.font = { size: 9 };
    phoneCell.alignment = { horizontal: "center", vertical: "middle" };

    const itemByProduct = new Map<string, any>();
    for (const it of o.items) {
      if (!it.isCancelled) itemByProduct.set(it.productId, it);
    }

    products.forEach((p, i) => {
      const col = 3 + i;
      const cell = ws.getCell(r, col);
      const it = itemByProduct.get(p.id);
      if (it) {
        // הכמות שהוזמנה מודפסת; המשקל נכתב ביד לצידה.
        // הקו האנכי מפריד ויזואלית בין השניים.
        const qty = Number(it.quantity);
        // §129: 🐛 אותו באג של §128 - `isSingle ? ק"ג : מספר עירום`.
        // מוצר שנמכר ביחידות הופיע כמספר בלי יחידה, והנציג לא ידע
        // אם לשקול או לספור. formatItemQty הוא המקור היחיד.
        const label = formatItemQty({
          isSingle: it.isSingle,
          quantity: qty,
          unit: it.unit,
        });
        cell.value = `${label}  |`;
        cell.font = { size: 9, color: { argb: "FF555555" } };
        cell.alignment = { horizontal: "right", vertical: "middle" };
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFFBEF" } };
      } else {
        // לא הזמין - מוצלל, כדי שלא ייראה כמו משקל שנשכח
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF2F2F2" } };
      }
      cell.border = cellBorder;
    });

    // משבצת סימון - מקבילה לוי"ו שבאתר (§103)
    // §131: משבצת המזומן. גוון ירקרק כדי שתיבדל מהמשקלים -
    // הנציג רושם שם סכום או ✓, ולא משקל.
    const cashCell = ws.getCell(r, cashCol);
    cashCell.border = cellBorder;
    cashCell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FFF0FDF4" },
    };
    cashCell.alignment = { horizontal: "center", vertical: "middle" };

    // §130: משבצת הסימון מודגשת - היא הפעולה שהנציג מחפש
    const doneCell = ws.getCell(r, lastCol);
    doneCell.border = {
      top: { style: "thin", color: { argb: "FF999999" } },
      left: { style: "medium", color: { argb: "FFC0461E" } },
      bottom: { style: "thin", color: { argb: "FF999999" } },
      right: { style: "thin", color: { argb: "FF999999" } },
    };

    // פסים לסירוגין - קל לעקוב אחרי שורה ארוכה על דף מודפס
    // §130: פס לסירוגין על **כל** השורה. קודם הוא כוסה רק על שתי
    // העמודות הראשונות, ובדף רחב העין איבדה את השורה באמצע -
    // בדיוק מה שהפס נועד למנוע.
    if (idx % 2 === 1) {
      for (let c = 1; c <= lastCol; c++) {
        const cell = ws.getCell(r, c);
        // לא דורסים מילוי קיים (תא מוצר שהוזמן / מוצלל)
        if (!cell.fill || (cell.fill as any).pattern !== "solid") {
          cell.fill = {
            type: "pattern",
            pattern: "solid",
            fgColor: { argb: "FFFAFAFA" },
          };
        }
      }
    }
    ws.getCell(r, 1).border = cellBorder;
    ws.getCell(r, 2).border = cellBorder;
  });

  // ─── שורות ריקות למזדמנים ───
  const firstBlank = 6 + orders.length + 1;
  ws.mergeCells(firstBlank - 1, 1, firstBlank - 1, lastCol);
  const bt = ws.getCell(firstBlank - 1, 1);
  bt.value = "מזדמנים (למילוי בשטח)";
  bt.font = { bold: true, size: 10, color: { argb: "FF8B5A00" } };
  bt.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFF4E0" } };
  bt.alignment = { horizontal: "center" };

  for (let i = 0; i < 8; i++) {
    const r = firstBlank + i;
    ws.getRow(r).height = 26;
    for (let c = 1; c <= lastCol; c++) {
      ws.getCell(r, c).border = cellBorder;
    }
  }
}
