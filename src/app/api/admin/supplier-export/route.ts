// §50: קובץ הזמנה לספק.
// GET /api/admin/supplier-export?pricelistId=X
//
// קובץ אקסל אחד, גיליון לכל נקודת חלוקה, ובכל גיליון הטבלה שממנה
// המנהל משדר את ההזמנה לחברה.
//
// למה זה נבנה: מסך סיכום המכירה הציג נתונים אבל לא נתן תשובה לשאלה
// היחידה שחשובה ביום ההזמנה - "כמה קרטונים אני מזמין מכל מוצר".
// כדי לענות עליה צריך להמיר יחידות ובודדים לקרטונים, וזו החלטה
// אנושית (לעגל למעלה ולהישאר עם עודף, או למטה ולהיות בחוסר).
//
// המבנה:
//   A  מוצר
//   B  קרטונים שהוזמנו
//   C  יחידות שהוזמנו
//   D  בודדים (ק"ג)
//   E  קרטונים להשלמה          ← המנהל ממלא ידנית
//   F  סה"כ קרטונים להזמנה     ← נוסחה: B+E. זו העמודה המשודרת לחברה
//   G  כמות בקרטון              ← לחישוב העודף
//   H  עודף / חוסר              ← נוסחה: (E×G) − (C או D)
//
// עמודות E ו-G הן היחידות שהמנהל נוגע בהן. השאר נעול, כדי שנוסחה
// לא תימחק בטעות ותשובש ההזמנה לספק.

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/guard";
import ExcelJS from "exceljs";

type Row = {
  productName: string;
  categoryName: string;
  cartons: number;
  units: number;
  singlesKg: number;
  /** כמה יחידות/ק"ג נכנסים בקרטון - להערכת העודף */
  perCarton: number | null;
  sortKey: number;
};

export async function GET(req: Request) {
  const g = await requireAdmin();
  if (!g.ok) return g.res;

  const { searchParams } = new URL(req.url);
  const pricelistId = searchParams.get("pricelistId");
  if (!pricelistId) {
    return NextResponse.json({ error: "חסרה מכירה" }, { status: 400 });
  }

  const pricelist = await prisma.pricelist.findUnique({
    where: { id: pricelistId },
    select: { id: true, name: true, deliveryDateText: true },
  });
  if (!pricelist) {
    return NextResponse.json({ error: "מכירה לא נמצאה" }, { status: 404 });
  }

  const orders = await prisma.order.findMany({
    where: { pricelistId, status: { notIn: ["CANCELLED"] } },
    include: {
      point: { select: { id: true, name: true, city: true } },
      items: {
        where: { isCancelled: false },
        include: {
          product: {
            select: {
              id: true,
              name: true,
              unit: true,
              singlesMode: true,
              avgWeightPerUnit: true,
              packageWeight: true,
              sortOrder: true,
              category: { select: { name: true, sortOrder: true } },
            },
          },
        },
      },
    },
  });

  // מזדמנים נכללים גם הם - הם סחורה שיצאה מהמלאי בדיוק כמו הזמנה
  const walkins = await prisma.walkinOrder.findMany({
    where: { pricelistId },
    include: {
      point: { select: { id: true, name: true, city: true } },
      items: {
        include: {
          product: {
            select: {
              id: true,
              name: true,
              unit: true,
              singlesMode: true,
              avgWeightPerUnit: true,
              packageWeight: true,
              sortOrder: true,
              category: { select: { name: true, sortOrder: true } },
            },
          },
        },
      },
    },
  });

  // ─── צבירה: נקודה -> מוצר -> שלוש הכמויות ───
  const byPoint = new Map<string, { name: string; city: string | null; rows: Map<string, Row> }>();

  function bucket(pointId: string, pointName: string, city: string | null) {
    let b = byPoint.get(pointId);
    if (!b) {
      b = { name: pointName, city, rows: new Map() };
      byPoint.set(pointId, b);
    }
    return b;
  }

  function rowFor(b: { rows: Map<string, Row> }, pr: any): Row {
    let r = b.rows.get(pr.id);
    if (!r) {
      // כמה נכנס בקרטון. לבודדים בק"ג זה משקל הקרטון. ליחידות אין
      // שדה ייעודי בסכמה, ולכן מנסים לגזור ממשקל הקרטון חלקי משקל
      // האריזה - ואם לא ניתן, המנהל ימלא ידנית בעמודה G.
      let perCarton: number | null = null;
      const avgW = pr.avgWeightPerUnit != null ? Number(pr.avgWeightPerUnit) : null;
      if (pr.singlesMode === "UNITS") {
        const pkg = parseFloat(String(pr.packageWeight ?? "").replace(/[^\d.]/g, ""));
        if (avgW && pkg > 0) {
          // packageWeight לרוב בגרמים ("500 ג'"), avgWeightPerUnit בק"ג
          const pkgKg = pkg > 20 ? pkg / 1000 : pkg;
          perCarton = Math.round(avgW / pkgKg);
        }
      } else if (avgW) {
        perCarton = avgW; // בודדים בק"ג: הקרטון מכיל avgW ק"ג
      }

      r = {
        productName: pr.name,
        categoryName: pr.category?.name ?? "",
        cartons: 0,
        units: 0,
        singlesKg: 0,
        perCarton,
        sortKey: (pr.category?.sortOrder ?? 999) * 1000 + (pr.sortOrder ?? 0),
      };
      b.rows.set(pr.id, r);
    }
    return r;
  }

  // סיווג הפריט לאחת משלוש העמודות.
  // חשוב: מוצר ארוז שנמכר ביחידות (unit != קרטון) נספר כיחידות גם
  // כשהוא לא מסומן isSingle - אחרת הוא היה נספר כקרטון ומעוות את
  // ההזמנה לספק.
  function classify(pr: any, unit: string | null, isSingle: boolean) {
    const u = (unit || pr.unit || "").trim();
    if (isSingle) {
      return pr.singlesMode === "UNITS" ? "units" : "singlesKg";
    }
    if (u && u !== "קרטון" && u !== 'ק"ג') return "units";
    return "cartons";
  }

  for (const o of orders) {
    if (!o.point) continue;
    const b = bucket(o.point.id, o.point.name, o.point.city);
    for (const it of o.items) {
      if (!it.product) continue;
      const r = rowFor(b, it.product);
      const qty = Number(it.quantity);
      const kind = classify(it.product, it.unit, it.isSingle);
      if (kind === "cartons") r.cartons += qty;
      else if (kind === "units") r.units += qty;
      else r.singlesKg += qty;
    }
  }

  for (const w of walkins) {
    if (!w.point) continue;
    const b = bucket(w.point.id, w.point.name, w.point.city);
    for (const it of w.items) {
      if (!it.product) continue;
      const r = rowFor(b, it.product);
      // במזדמנים נשמר משקל ולא כמות
      const kind = classify(it.product, it.product.unit, it.isSingle);
      if (kind === "units") r.units += Number(it.weight);
      else r.singlesKg += Number(it.weight);
    }
  }

  if (byPoint.size === 0) {
    return NextResponse.json(
      { error: "אין הזמנות במכירה זו" },
      { status: 400 }
    );
  }

  // ─── בניית הקובץ ───
  const wb = new ExcelJS.Workbook();
  wb.creator = "צדקת רבותינו";
  wb.created = new Date();

  const HEAD = [
    "מוצר",
    "קרטונים שהוזמנו",
    "יחידות שהוזמנו",
    'בודדים (ק"ג)',
    "קרטונים להשלמה",
    "סה״כ קרטונים להזמנה",
    "כמות בקרטון",
    "עודף / חוסר",
  ];

  // גיליון מרכז - סיכום כל הנקודות יחד, לספק שמספק למחסן אחד
  const totals = new Map<string, Row>();

  const sortedPoints = Array.from(byPoint.entries()).sort((a, b) =>
    a[1].name.localeCompare(b[1].name, "he")
  );

  for (const [, pt] of sortedPoints) {
    const ws = wb.addWorksheet(safeSheetName(pt.name), {
      views: [{ rightToLeft: true, state: "frozen", ySplit: 4 }],
    });
    buildSheet(ws, HEAD, pt.name + (pt.city ? ` — ${pt.city}` : ""), pricelist, pt.rows);

    // צבירה לגיליון המרכז
    for (const [pid, r] of pt.rows) {
      let t = totals.get(pid);
      if (!t) {
        t = { ...r, cartons: 0, units: 0, singlesKg: 0 };
        totals.set(pid, t);
      }
      t.cartons += r.cartons;
      t.units += r.units;
      t.singlesKg += r.singlesKg;
    }
  }

  // הגיליון המרכז ראשון - זה מה שהמנהל פותח קודם
  if (sortedPoints.length > 1) {
    const ws = wb.addWorksheet("סיכום כל הנקודות", {
      views: [{ rightToLeft: true, state: "frozen", ySplit: 4 }],
    });
    buildSheet(ws, HEAD, "כל נקודות החלוקה", pricelist, totals);
    // מעבירים לראש הרשימה
    const idx = wb.worksheets.findIndex((x) => x.name === "סיכום כל הנקודות");
    if (idx > 0) {
      const sheet = wb.worksheets.splice(idx, 1)[0];
      wb.worksheets.unshift(sheet);
      wb.worksheets.forEach((s, i) => ((s as any).orderNo = i + 1));
    }
  }

  const buf = await wb.xlsx.writeBuffer();
  const fname = `הזמנה-לספק-${pricelist.name}.xlsx`.replace(/[\\/:*?"<>|]/g, "-");
  return new NextResponse(Buffer.from(buf) as any, {
    status: 200,
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(fname)}`,
    },
  });
}

// שם גיליון חוקי: עד 31 תווים, בלי : \ / ? * [ ]
function safeSheetName(name: string): string {
  return name.replace(/[:\\/?*[\]]/g, "-").slice(0, 31) || "נקודה";
}

function buildSheet(
  ws: ExcelJS.Worksheet,
  HEAD: string[],
  title: string,
  pricelist: { name: string; deliveryDateText: string | null },
  rows: Map<string, Row>
) {
  // ─── כותרת ───
  ws.mergeCells("A1:H1");
  const t = ws.getCell("A1");
  t.value = `${pricelist.name} — הזמנה לספק`;
  t.font = { name: "Arial", size: 14, bold: true, color: { argb: "FF7C2D12" } };
  t.alignment = { horizontal: "center", vertical: "middle" };
  ws.getRow(1).height = 26;

  ws.mergeCells("A2:H2");
  const sub = ws.getCell("A2");
  sub.value =
    `📍 ${title}` + (pricelist.deliveryDateText ? ` · חלוקה: ${pricelist.deliveryDateText}` : "");
  sub.font = { name: "Arial", size: 11, bold: true };
  sub.alignment = { horizontal: "center" };

  ws.mergeCells("A3:H3");
  const ins = ws.getCell("A3");
  ins.value =
    'מלא את עמודה E (קרטונים להשלמה) — עמודה F מתעדכנת לבד וזו הכמות להזמנה מהחברה.';
  ins.font = { name: "Arial", size: 10, bold: true, color: { argb: "FF92400E" } };
  ins.alignment = { horizontal: "center" };
  ins.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFEF3C7" } };

  // ─── כותרות עמודות ───
  const HEAD_ROW = 4;
  HEAD.forEach((h, i) => {
    const c = ws.getCell(HEAD_ROW, i + 1);
    c.value = h;
    c.font = { name: "Arial", size: 11, bold: true };
    c.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
    c.border = { bottom: { style: "medium" }, top: { style: "thin" } };
    // צבע לפי תפקיד: מה שהמנהל ממלא בצהוב, עמודת ההזמנה בכתום בולט
    const col = i + 1;
    c.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: {
        argb:
          col === 5 || col === 7
            ? "FFFDE68A" // E, G - למילוי ידני
            : col === 6
              ? "FFF97316" // F - עמודת ההזמנה, הכי חשובה
              : "FFE4E4E7",
      },
    };
    if (col === 6) c.font = { name: "Arial", size: 11, bold: true, color: { argb: "FFFFFFFF" } };
  });
  ws.getRow(HEAD_ROW).height = 34;

  // ─── שורות ───
  const sorted = Array.from(rows.values()).sort((a, b) => a.sortKey - b.sortKey);
  let r = HEAD_ROW + 1;
  let lastCategory = "";

  for (const row of sorted) {
    // כותרת קטגוריה - עוזרת למצוא מוצר מהר ברשימה ארוכה
    if (row.categoryName && row.categoryName !== lastCategory) {
      ws.mergeCells(`A${r}:H${r}`);
      const c = ws.getCell(r, 1);
      c.value = row.categoryName;
      c.font = { name: "Arial", size: 11, bold: true, color: { argb: "FF3F3F46" } };
      c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF4F4F5" } };
      c.alignment = { horizontal: "right" };
      lastCategory = row.categoryName;
      r++;
    }

    ws.getCell(r, 1).value = row.productName;
    ws.getCell(r, 2).value = row.cartons || null;
    ws.getCell(r, 3).value = row.units || null;
    ws.getCell(r, 4).value = row.singlesKg ? Math.round(row.singlesKg * 100) / 100 : null;

    // E - מילוי ידני
    const e = ws.getCell(r, 5);
    e.protection = { locked: false };
    e.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFFBEB" } };
    e.border = {
      left: { style: "thin" },
      right: { style: "thin" },
      top: { style: "thin" },
      bottom: { style: "thin" },
    };

    // F - סה"כ להזמנה. הנוסחה ולא ערך קבוע, כדי שהמספר יתעדכן
    // ברגע שהמנהל ממלא את E.
    const f = ws.getCell(r, 6);
    f.value = { formula: `SUM(B${r},E${r})` };
    f.font = { name: "Arial", size: 12, bold: true, color: { argb: "FFC0461E" } };
    f.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFF7ED" } };
    f.alignment = { horizontal: "center" };
    f.border = { left: { style: "medium" }, right: { style: "medium" } };

    // G - כמות בקרטון. ממולא אוטומטית כשניתן לגזור, אחרת ריק למילוי.
    const gCell = ws.getCell(r, 7);
    if (row.perCarton) gCell.value = row.perCarton;
    gCell.protection = { locked: false };
    gCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFFBEB" } };
    gCell.alignment = { horizontal: "center" };

    // H - עודף/חוסר. חיובי = נשאר לי, שלילי = חסר לי.
    // מוצג רק אם יש הזמנות ביחידות או בבודדים - בקרטון שלם אין המרה.
    const h = ws.getCell(r, 8);
    h.value = {
      formula: `IF(OR(G${r}="",AND(C${r}="",D${r}="")),"",E${r}*G${r}-IF(C${r}="",D${r},C${r}))`,
    };
    h.alignment = { horizontal: "center" };
    // ירוק = עודף, אדום = חוסר
    ws.addConditionalFormatting({
      ref: `H${r}`,
      rules: [
        {
          type: "cellIs",
          operator: "lessThan",
          formulae: ["0"],
          priority: 1,
          style: { font: { color: { argb: "FFB91C1C" }, bold: true } },
        },
        {
          type: "cellIs",
          operator: "greaterThan",
          formulae: ["0"],
          priority: 2,
          style: { font: { color: { argb: "FF15803D" } } },
        },
      ],
    });

    for (let c = 1; c <= 4; c++) {
      ws.getCell(r, c).alignment = { horizontal: c === 1 ? "right" : "center" };
      ws.getCell(r, c).font = { name: "Arial", size: 10 };
    }
    r++;
  }

  // ─── שורת סיכום ───
  const firstData = HEAD_ROW + 1;
  const lastData = r - 1;
  r++;
  ws.getCell(r, 1).value = "סה״כ";
  ws.getCell(r, 1).font = { name: "Arial", size: 12, bold: true };
  for (const col of [2, 3, 4, 5, 6]) {
    const c = ws.getCell(r, col);
    c.value = { formula: `SUM(${colLetter(col)}${firstData}:${colLetter(col)}${lastData})` };
    c.font = { name: "Arial", size: 12, bold: true };
    c.alignment = { horizontal: "center" };
    c.border = { top: { style: "double" } };
  }
  ws.getCell(r, 6).font = {
    name: "Arial",
    size: 13,
    bold: true,
    color: { argb: "FFC0461E" },
  };

  // ─── רוחב ונעילה ───
  ws.getColumn(1).width = 34;
  ws.getColumn(2).width = 13;
  ws.getColumn(3).width = 13;
  ws.getColumn(4).width = 13;
  ws.getColumn(5).width = 14;
  ws.getColumn(6).width = 16;
  ws.getColumn(7).width = 12;
  ws.getColumn(8).width = 12;

  // נעילה: רק E ו-G פתוחות. מונע מחיקה בשוגג של הנוסחה ב-F,
  // שהיא הנתון שממנו משדרים את ההזמנה.
  ws.protect("tzidkat", {
    selectLockedCells: true,
    selectUnlockedCells: true,
    formatCells: false,
    sort: true,
  });
}

function colLetter(n: number): string {
  return String.fromCharCode(64 + n);
}
