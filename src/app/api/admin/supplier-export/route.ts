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
// §63: הייבוא הועבר מ-route.ts לספרייה. ייבוא בין קבצי route הוא גם
// מה שהכריח את supplier-plan/route.ts לייצא את הפונקציה - ייצוא
// שאסור ב-App Router והפיל את ה-build.
import { collectPlan } from "@/lib/supplier-plan";


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

  // §51: אותו מקור נתונים כמו המסך (collectPlan), כדי שהקובץ והמסך
  // יציגו בדיוק את אותם מספרים - כולל ההחלטות ששמורות בעמודות
  // "להשלמה" ו"כמות בקרטון".
  const points = (await collectPlan(pricelistId, null)).points as {
    id: string;
    name: string;
    city: string | null;
  }[];

  if (points.length === 0) {
    return NextResponse.json({ error: "אין הזמנות במכירה זו" }, { status: 400 });
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

  // התוכנית של כל נקודה — לגיליון שלה, ולפירוט בגיליון המרכז
  const perPoint = await Promise.all(
    points.map(async (pt) => ({ pt, rows: (await collectPlan(pricelistId, pt.id)).rows as PlanRowLike[] }))
  );

  // גיליון מרכז ראשון - זה מה שפותחים כדי לשדר לחברה.
  // מוצג רק כשיש יותר מנקודה אחת, אחרת זו כפילות.
  if (points.length > 1) {
    const all = await collectPlan(pricelistId, null);
    const ws = wb.addWorksheet("סיכום כל הנקודות", {
      views: [{ rightToLeft: true, state: "frozen", ySplit: 4 }],
      pageSetup: PRINT_SETUP,
    });
    // 🆕 עמודה לכל נקודת חלוקה — **מספרים בלבד**, כותרת למעלה.
    // קודם: כל הפירוט כטקסט בתא אחד — אי אפשר לסמן ולסכם. עכשיו בוחרים
    // בעכבר את העמודות (ביתר א׳ + ביתר ב׳...) ואקסל מסכם בשורת המצב.
    const pointCols: PointCol[] = perPoint
      .map(({ pt, rows }) => ({
        name: shortPointName(pt.name, pt.city),
        city: pt.city,
        values: new Map(rows.map((row) => [row.productId, row])),
      }))
      .filter((pc) => [...pc.values.values()].some((v) => primaryQty(v) > 0 || (v.singlesKg || 0) > 0))
      .sort((x, y) => (x.city || "").localeCompare(y.city || "", "he") || x.name.localeCompare(y.name, "he"));
    buildSheet(ws, HEAD, "כל נקודות החלוקה", pricelist, all.rows as PlanRowLike[], pointCols);
  }

  // גיליון לכל נקודה - לפיצול הסחורה אחרי שהיא מגיעה
  for (const { pt, rows } of perPoint) {
    const one = { rows };
    const ws = wb.addWorksheet(safeSheetName(pt.name), {
      views: [{ rightToLeft: true, state: "frozen", ySplit: 4 }],
      pageSetup: PRINT_SETUP,
    });
    buildSheet(
      ws,
      HEAD,
      pt.name + (pt.city ? ` — ${pt.city}` : ""),
      pricelist,
      one.rows as PlanRowLike[]
    );
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

type PlanRowLike = {
  productId: string;
  productName: string;
  categoryName: string;
  cartons: number;
  units: number;
  singlesKg: number;
  extraCartons: number;
  unitsPerCarton: number | null;
};

type PointCol = { name: string; city: string | null; values: Map<string, PlanRowLike> };

// המספר בעמודת הנקודה בשורת המוצר: קרטונים + יחידות (לא ק"ג).
// ⚠️ ק"ג בודדים — בשורה נפרדת מתחת ("בודדים ק"ג"), אחרת עמודה של נקודה
// הייתה מערבבת קרטונים בנקודה אחת וקילו בנקודה אחרת, והסכום חסר משמעות.
function primaryQty(row: PlanRowLike): number {
  return (row.cartons || 0) + (row.units || 0);
}
function kgQty(row: PlanRowLike): number {
  return Math.round((row.singlesKg || 0) * 100) / 100;
}

// כמות לפירוט: קרטונים, ואם הוזמן גם ביחידות/בודדים — גם הם
function qtyText(row: PlanRowLike): string {
  const parts: string[] = [];
  if (row.cartons) parts.push(`${row.cartons} קר׳`);
  if (row.units) parts.push(`${row.units} יח׳`);
  if (row.singlesKg) parts.push(`${Math.round(row.singlesKg * 100) / 100} ק"ג`);
  return parts.join(" + ");
}

// '"בית אהרן" - ביתר B1 - פחד יצחק 5' → 'בית אהרן (ביתר עילית)'
function shortPointName(name: string, city: string | null): string {
  const quoted = name.match(/"([^"]+)"/)?.[1];
  const base = (quoted || name.split(" - ")[0] || name).trim();
  return city && !base.includes(city) ? `${base} (${city})` : base;
}

// 🖨️ הדפסה: לרוחב, כל העמודות בעמוד אחד, כותרות העמודות בכל עמוד.
// בלי זה הגיליון (9 עמודות, ~190 תווים) נחתך לשני עמודים לרוחב.
const PRINT_SETUP: Partial<ExcelJS.PageSetup> = {
  paperSize: 9,
  orientation: "landscape",
  fitToPage: true,
  fitToWidth: 1,
  fitToHeight: 0,
  margins: { left: 0.25, right: 0.25, top: 0.4, bottom: 0.4, header: 0.2, footer: 0.2 },
  printTitlesRow: "4:4",
};

// שם גיליון חוקי: עד 31 תווים, בלי : \ / ? * [ ]
function safeSheetName(name: string): string {
  return name.replace(/[:\\/?*[\]]/g, "-").slice(0, 31) || "נקודה";
}

function buildSheet(
  ws: ExcelJS.Worksheet,
  HEAD: string[],
  title: string,
  pricelist: { name: string; deliveryDateText: string | null },
  rows: PlanRowLike[],
  // רק בגיליון המרכז: עמודה לכל נקודה (מ-I והלאה)
  pointCols: PointCol[] = []
) {
  const FIRST_POINT_COL = 9;
  const lastCol = 8 + pointCols.length;
  const lastColLetter = colLetter(lastCol);
  // ─── כותרת ───
  ws.mergeCells(`A1:${lastColLetter}1`);
  const t = ws.getCell("A1");
  t.value = `${pricelist.name} — הזמנה לספק`;
  t.font = { name: "Arial", size: 14, bold: true, color: { argb: "FF7C2D12" } };
  t.alignment = { horizontal: "center", vertical: "middle" };
  ws.getRow(1).height = 26;

  ws.mergeCells(`A2:${lastColLetter}2`);
  const sub = ws.getCell("A2");
  sub.value =
    `📍 ${title}` + (pricelist.deliveryDateText ? ` · חלוקה: ${pricelist.deliveryDateText}` : "");
  sub.font = { name: "Arial", size: 11, bold: true };
  sub.alignment = { horizontal: "center" };

  ws.mergeCells(`A3:${lastColLetter}3`);
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
  ws.getRow(HEAD_ROW).height = pointCols.length ? 120 : 34;

  // כותרות הנקודות — טקסט אנכי, כמו בטבלה הידנית
  pointCols.forEach((pc, i) => {
    const c = ws.getCell(HEAD_ROW, FIRST_POINT_COL + i);
    c.value = pc.name;
    c.font = { name: "Arial", size: 10, bold: true };
    c.alignment = { textRotation: 90, horizontal: "center", vertical: "bottom", wrapText: true };
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFDBEAFE" } };
    c.border = { bottom: { style: "medium" }, top: { style: "thin" }, left: { style: "thin" }, right: { style: "thin" } };
  });

  // ─── שורות ───
  // הסדר כבר נקבע ב-collectPlan (קטגוריה ואז מוצר)
  const sorted = rows;
  let r = HEAD_ROW + 1;
  let lastCategory = "";

  for (const row of sorted) {
    // כותרת קטגוריה - עוזרת למצוא מוצר מהר ברשימה ארוכה
    if (row.categoryName && row.categoryName !== lastCategory) {
      ws.mergeCells(`A${r}:${lastColLetter}${r}`);
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

    // E - ההחלטה ששמורה מהמסך. הקובץ והמסך מציגים אותו מספר.
    const e = ws.getCell(r, 5);
    if (row.extraCartons) e.value = row.extraCartons;
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
    // ⚠️ result: הערך המחושב נשמר בקובץ. בלי זה, בתצוגה מוגנת של אקסל
    // (לפני "הפעל עריכה") ובמציגים בטלפון העמודה החשובה ביותר נראתה ריקה.
    f.value = { formula: `SUM(B${r},E${r})`, result: (row.cartons || 0) + (row.extraCartons || 0) };
    f.font = { name: "Arial", size: 12, bold: true, color: { argb: "FFC0461E" } };
    f.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFF7ED" } };
    f.alignment = { horizontal: "center" };
    f.border = { left: { style: "medium" }, right: { style: "medium" } };

    // G - כמות בקרטון. ממולא אוטומטית כשניתן לגזור, אחרת ריק למילוי.
    const gCell = ws.getCell(r, 7);
    if (row.unitsPerCarton) gCell.value = row.unitsPerCarton;
    gCell.protection = { locked: false };
    gCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFFBEB" } };
    gCell.alignment = { horizontal: "center" };

    // H - עודף/חוסר. חיובי = נשאר לי, שלילי = חסר לי.
    // מוצג רק אם יש הזמנות ביחידות או בבודדים - בקרטון שלם אין המרה.
    const h = ws.getCell(r, 8);
    const ordered = row.units || row.singlesKg || 0;
    h.value = {
      result:
        !row.unitsPerCarton || (!row.units && !row.singlesKg)
          ? ""
          : Math.round(((row.extraCartons || 0) * row.unitsPerCarton - ordered) * 100) / 100,
      // ⚠️ ISBLANK ולא ="" - תא שנכתב אליו null נחשב ריק באקסל,
      // והשוואה למחרוזת ריקה לא תופסת אותו.
      // N() ממיר ריק ל-0 כדי שהחישוב לא ייתן #VALUE.
      formula:
        `IF(OR(ISBLANK(G${r}),AND(ISBLANK(C${r}),ISBLANK(D${r}))),"",` +
        `N(E${r})*N(G${r})-IF(ISBLANK(C${r}),N(D${r}),N(C${r})))`,
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

    // עמודות הנקודות — מספר בלבד (ריק = הנקודה לא הזמינה)
    const pointCell = (rr: number, i: number, v: number) => {
      const c = ws.getCell(rr, FIRST_POINT_COL + i);
      c.value = v ? v : null;
      c.font = { name: "Arial", size: 11 };
      c.alignment = { horizontal: "center" };
      c.border = { left: { style: "thin", color: { argb: "FFD4D4D8" } }, right: { style: "thin", color: { argb: "FFD4D4D8" } } };
    };
    pointCols.forEach((pc, i) => {
      const pr = pc.values.get(row.productId);
      // מוצר שהוזמן רק בבודדים — הק"ג בשורה עצמה
      pointCell(r, i, pr ? (row.cartons || row.units ? primaryQty(pr) : kgQty(pr)) : 0);
    });
    // מוצר שהוזמן גם בבודדים (ק"ג) — שורה נוספת מתחתיו, רק בגיליון המרכז
    if (pointCols.length && (row.singlesKg || 0) > 0 && (row.cartons || row.units)) {
      r++;
      const label = ws.getCell(r, 1);
      label.value = `   ↳ ${row.productName} — בודדים (ק"ג)`;
      label.font = { name: "Arial", size: 9, italic: true, color: { argb: "FF8B5A00" } };
      label.alignment = { horizontal: "right" };
      pointCols.forEach((pc, i) => {
        const pr = pc.values.get(row.productId);
        pointCell(r, i, pr ? kgQty(pr) : 0);
        ws.getCell(r, FIRST_POINT_COL + i).font = { name: "Arial", size: 10, italic: true, color: { argb: "FF8B5A00" } };
      });
    }
    r++;
  }

  // ─── שורת סיכום ───
  const firstData = HEAD_ROW + 1;
  const lastData = r - 1;
  r++;
  ws.getCell(r, 1).value = "סה״כ";
  ws.getCell(r, 1).font = { name: "Arial", size: 12, bold: true };
  const totals: Record<number, number> = {
    2: rows.reduce((t, x) => t + (x.cartons || 0), 0),
    3: rows.reduce((t, x) => t + (x.units || 0), 0),
    4: Math.round(rows.reduce((t, x) => t + (x.singlesKg || 0), 0) * 100) / 100,
    5: rows.reduce((t, x) => t + (x.extraCartons || 0), 0),
  };
  totals[6] = totals[2] + totals[5];
  for (const col of [2, 3, 4, 5, 6]) {
    const c = ws.getCell(r, col);
    c.value = {
      formula: `SUM(${colLetter(col)}${firstData}:${colLetter(col)}${lastData})`,
      result: totals[col],
    };
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
  // ⚠️ אין סה"כ לעמודות הנקודות: הן מערבבות מוצרים שונים. מסכמים בבחירה בעכבר.

  // ─── רוחב ונעילה ───
  ws.getColumn(1).width = 34;
  ws.getColumn(2).width = 13;
  ws.getColumn(3).width = 13;
  ws.getColumn(4).width = 13;
  ws.getColumn(5).width = 14;
  ws.getColumn(6).width = 16;
  ws.getColumn(7).width = 12;
  ws.getColumn(8).width = 12;
  pointCols.forEach((_, i) => {
    ws.getColumn(FIRST_POINT_COL + i).width = 6;
  });

  // נעילה: רק E ו-G פתוחות. מונע מחיקה בשוגג של הנוסחה ב-F,
  // שהיא הנתון שממנו משדרים את ההזמנה.
  ws.protect("tzidkat", {
    selectLockedCells: true,
    selectUnlockedCells: true,
    formatCells: false,
    sort: true,
  });
}

// 1 → A, 26 → Z, 27 → AA (עם הרבה נקודות העמודות עוברות את Z)
function colLetter(n: number): string {
  let out = "";
  while (n > 0) {
    const m = (n - 1) % 26;
    out = String.fromCharCode(65 + m) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}
