// ═══════════════════════════════════════════════════════════════
// §115: הזמנה דרך אקסל במייל
// ═══════════════════════════════════════════════════════════════
// למי זה: לקוח שיש לו מייל אבל לא נוח לו עם האתר או עם התפריט
// הקולי. ערוץ הזמנה רביעי (source: "EXCEL") לצד אתר, טלפון ונציג.
//
// הזרימה: המנהל מפיק קובץ ללקוח ושולח במייל -> הלקוח ממלא כמויות
// ומחזיר -> המנהל מעלה -> תצוגה מקדימה -> אישור -> ההזמנה נוצרת.
//
// ⚠️ ההפקה והפענוח יושבים באותו קובץ **בכוונה**. שניהם חייבים
// להסכים על אותו מבנה עמודות ועל אותה שיטת חתימה; פיצול לשני
// קבצים היה מזמין מצב שבו אחד השתנה והשני לא, והתקלה הייתה
// מתגלה רק כשלקוח אמיתי מחזיר קובץ.

import ExcelJS from "exceljs";
// גיבוי לפענוח: קובץ שנשמר ב-Google Sheets / בטלפון / בתוכנה אחרת לפעמים
// בלי טבלת סגנונות, ו-ExcelJS נופל עליו ("Cannot read ... styles").
import * as XLSX from "xlsx";
import crypto from "crypto";

// ─── מבנה העמודות ───
// A מזהה מקודד (מוסתר) | B חתימה (מוסתר) | C קטגוריה | D מוצר
// E כשרות | F יחידה | G מחיר ליחידה | H כמות (לעריכה) | I סה"כ
const COL = {
  ref: 1,
  sig: 2,
  category: 3,
  product: 4,
  kashrut: 5,
  unit: 6,
  price: 7,
  qty: 8,
  total: 9,
  /** מוסתר: כמה פעמים המחיר נכנס בשורה (משקל ממוצע לקרטון במחיר לק"ג) */
  factor: 10,
} as const;

/** השורה שבה מתחילים הנתונים. שלוש שורות כותרת מעליה. */
const DATA_START_ROW = 5;

export type ExcelRowSpec = {
  productId: string;
  isSingle: boolean;
  categoryName: string;
  productName: string;
  kashrut: string;
  unit: string;
  unitPrice: number;
  /** כמות שהלקוח כבר הזמין - לעדכון הזמנה קיימת */
  existingQty?: number;
  /** 🐛 "סה"כ משוער" חושב מחיר × כמות גם בקרטון שמתומחר לק"ג — 2 קרטוני
   *  אסאדו (75.90 לק"ג) יצאו ₪151.80 במקום ~₪2,000. כאן: המשקל הממוצע
   *  לקרטון (כמו באתר). ריק = 1. */
  estimateFactor?: number;
};

export type ExcelHeader = {
  /** §inbound: מזהה הלקוח — נחתם בקובץ, כדי שקובץ שחוזר במייל יזוהה
   *  בוודאות (ולא רק לפי כתובת השולח) */
  customerId?: string;
  customerName: string;
  customerPhone: string;
  pointName: string;
  saleName: string;
  pricelistId: string;
  deliveryDateText: string | null;
  singleSurcharge: number;
};

// ═══════════════════════════════════════════════════════════════
// חתימה
// ═══════════════════════════════════════════════════════════════
// כל שורה נושאת מזהה מקודד וחתימת HMAC על המזהה **והמחיר**.
//
// למה גם המחיר: בלעדיו לקוח יכול לשנות את המחיר בקובץ ולהחזיר
// אותו, והמערכת הייתה מקבלת את המחיר החדש. עם החתימה, כל שינוי
// במחיר פוסל את השורה.
//
// ⚠️ המחיר לא נלקח מהקובץ בשום מקרה - הוא נשלף מחדש מהמחירון
// בזמן היצירה. החתימה כאן היא שכבת גילוי, לא מקור אמת.
function rowRef(productId: string, pricelistId: string, isSingle: boolean): string {
  return `P:${productId}S:${pricelistId}${isSingle ? "U:1" : ""}`;
}

// 🐛 היה רק NEXTAUTH_SECRET — שלא קיים באתר החי (שם AUTH_SECRET), ולכן
// הקבצים נשלחו בלי חתימה והבדיקה דולגה. עכשיו: AUTH_SECRET, ואם אין —
// NEXTAUTH_SECRET.
function signingSecret(): string {
  return process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET || "";
}

function sign(ref: string, price: number): string {
  const secret = signingSecret();
  if (!secret) {
    // בלי מפתח אין חתימה אמיתית. לא זורקים - הקובץ עדיין שימושי -
    // אבל הפענוח יסמן את השורות כלא-מאומתות והמנהל יראה זאת.
    return "";
  }
  return crypto
    .createHmac("sha256", secret)
    .update(`${ref}|${price.toFixed(2)}`)
    .digest("base64")
    .slice(0, 24);
}

// זיהוי הלקוח בקובץ: תא A1 = "C:<id>", תא B1 = חתימה. העמודות מוסתרות.
// לקוח שמעביר את הקובץ לחבר — החבר ישלח קובץ של הלקוח המקורי, והמערכת
// תדחה אותו כי כתובת השולח לא תואמת (ראו inbound-excel).
const CUSTOMER_REF_PREFIX = "C:";
function signCustomer(customerId: string, pricelistId: string): string {
  return sign(`${CUSTOMER_REF_PREFIX}${customerId}|${pricelistId}`, 0);
}

// ═══════════════════════════════════════════════════════════════
// הפקת הקובץ
// ═══════════════════════════════════════════════════════════════
export async function buildOrderExcel(
  header: ExcelHeader,
  rows: ExcelRowSpec[]
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "צדקת רבותינו";
  const ws = wb.addWorksheet("הזמנה", {
    views: [{ rightToLeft: true, state: "frozen", ySplit: DATA_START_ROW - 1 }],
  });

  ws.columns = [
    { key: "ref", width: 1, hidden: true },
    { key: "sig", width: 1, hidden: true },
    // רוחבים: "קרטון (מחיר לק"ג)", "בד"ץ העדה החרדית" ושמות עם "(בודדים)"
    // נחתכו ברוחבים הקודמים
    { key: "category", width: 13 },
    { key: "product", width: 36 },
    { key: "kashrut", width: 18 },
    { key: "unit", width: 19 },
    { key: "price", width: 13 },
    { key: "qty", width: 10 },
    { key: "total", width: 14 },
    { key: "factor", width: 1, hidden: true },
  ];

  // ─── זיהוי לקוח (עמודות מוסתרות) ───
  if (header.customerId) {
    ws.getCell(1, COL.ref).value = `${CUSTOMER_REF_PREFIX}${header.customerId}`;
    ws.getCell(1, COL.sig).value = signCustomer(header.customerId, header.pricelistId);
  }

  // ─── כותרת ───
  ws.mergeCells(1, COL.category, 1, COL.total);
  const t = ws.getCell(1, COL.category);
  t.value = `הזמנה — ${header.saleName}`;
  t.font = { size: 16, bold: true };
  t.alignment = { horizontal: "center" };

  ws.mergeCells(2, COL.category, 2, COL.total);
  const sub = ws.getCell(2, COL.category);
  sub.value =
    `${header.customerName} · ${header.customerPhone} · נקודת חלוקה: ${header.pointName}` +
    (header.deliveryDateText ? ` · חלוקה: ${header.deliveryDateText}` : "");
  sub.font = { size: 11 };
  sub.alignment = { horizontal: "center" };

  ws.mergeCells(3, COL.category, 3, COL.total);
  const inst = ws.getCell(3, COL.category);
  inst.value =
    'למילוי: הזינו כמות בעמודה "כמות" בלבד, ושלחו את הקובץ חזרה במייל. שאר העמודות נעולות.';
  inst.font = { size: 10, italic: true, color: { argb: "FF666666" } };
  inst.alignment = { horizontal: "center" };

  // ─── כותרות עמודות ───
  const hdr = ws.getRow(DATA_START_ROW - 1);
  hdr.getCell(COL.category).value = "קטגוריה";
  hdr.getCell(COL.product).value = "מוצר";
  hdr.getCell(COL.kashrut).value = "כשרות";
  hdr.getCell(COL.unit).value = "יחידה";
  hdr.getCell(COL.price).value = "מחיר ליחידה";
  hdr.getCell(COL.qty).value = "כמות";
  hdr.getCell(COL.total).value = 'סה"כ משוער';
  hdr.font = { bold: true };
  hdr.eachCell((c) => {
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE8E8E8" } };
    c.border = { bottom: { style: "medium" } };
  });

  // ─── שורות המוצרים ───
  rows.forEach((r, i) => {
    const rowNum = DATA_START_ROW + i;
    const row = ws.getRow(rowNum);
    const ref = rowRef(r.productId, header.pricelistId, r.isSingle);

    row.getCell(COL.ref).value = ref;
    row.getCell(COL.sig).value = sign(ref, r.unitPrice);
    row.getCell(COL.category).value = r.categoryName;
    row.getCell(COL.product).value =
      r.productName + (r.isSingle ? " (בודדים)" : "");
    row.getCell(COL.kashrut).value = r.kashrut;
    row.getCell(COL.unit).value = r.unit;
    row.getCell(COL.price).value = r.unitPrice;
    row.getCell(COL.price).numFmt = '#,##0.00 ₪';

    // הכמות שכבר הוזמנה מופיעה מלאה - כך הקובץ משמש גם לעדכון
    // הזמנה קיימת, והלקוח רואה מה יש לו ומשנה רק את מה שצריך.
    const qtyCell = row.getCell(COL.qty);
    if (r.existingQty && r.existingQty > 0) qtyCell.value = r.existingQty;
    qtyCell.protection = { locked: false };
    qtyCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFF9E6" } };
    // ⚠️ ExcelJS אינו תומך ב-outline כקיצור לארבעת הצדדים -
    // הטיפוס Partial<Borders> מכיר רק top/left/bottom/right.
    const qtyBorder = { style: "thin" as const, color: { argb: "FFD4A017" } };
    qtyCell.border = {
      top: qtyBorder,
      left: qtyBorder,
      bottom: qtyBorder,
      right: qtyBorder,
    };

    const totalCell = row.getCell(COL.total);
    row.getCell(COL.factor).value = r.estimateFactor && r.estimateFactor > 0 ? r.estimateFactor : 1;
    totalCell.value = { formula: `IF(H${rowNum}="",0,G${rowNum}*H${rowNum}*J${rowNum})` };
    totalCell.numFmt = '#,##0.00 ₪';

    // בודדים בגוון שונה - היחידה והמחיר שונים לגמרי, ולקוח שלא
    // ישים לב עלול להזמין 12 קרטונים במקום 12 קילו
    if (r.isSingle) {
      row.getCell(COL.product).font = { color: { argb: "FF8B5A00" } };
    }
  });

  // ─── סיכום ───
  const last = DATA_START_ROW + rows.length - 1;
  const sum = ws.getRow(last + 2);
  sum.getCell(COL.price).value = 'סה"כ משוער:';
  sum.getCell(COL.price).font = { bold: true };
  sum.getCell(COL.total).value = {
    formula: rows.length ? `SUM(I${DATA_START_ROW}:I${last})` : "0",
  };
  sum.getCell(COL.total).numFmt = '#,##0.00 ₪';
  sum.getCell(COL.total).font = { bold: true, size: 12 };

  const note = ws.getRow(last + 4);
  ws.mergeCells(last + 4, COL.category, last + 4, COL.total);
  note.getCell(COL.category).value =
    "⚖️ המחירים משוערים. מוצרים הנמכרים לפי משקל נשקלים בחלוקה, והמחיר הסופי שבו יחויב הכרטיס נקבע לפי המשקל בפועל.";
  note.getCell(COL.category).font = { size: 9, color: { argb: "FF8B5A00" } };
  note.getCell(COL.category).alignment = { wrapText: true };

  // ⚠️ נעילת הגיליון חוץ מעמודת הכמות. זו הגנה מפני **טעות**, לא
  // מפני זדון: אקסל מאפשר להסיר הגנה בלי סיסמה. ההגנה האמיתית
  // היא החתימה, שנבדקת בשרת.
  await ws.protect("tzidkat", {
    selectLockedCells: true,
    selectUnlockedCells: true,
    formatCells: false,
  });

  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}

// ═══════════════════════════════════════════════════════════════
// פענוח הקובץ שחזר
// ═══════════════════════════════════════════════════════════════
export type ParsedRow = {
  productId: string;
  isSingle: boolean;
  productName: string;
  quantity: number;
  /** המחיר כפי שהופיע בקובץ - להשוואה בלבד, לא לשימוש */
  priceInFile: number;
};

export type ParseIssue = {
  rowNumber: number;
  productName: string;
  reason: string;
};

export type ParseResult = {
  pricelistId: string | null;
  rows: ParsedRow[];
  issues: ParseIssue[];
  /** האם החתימות נבדקו בכלל (false כשאין מפתח) */
  signatureChecked: boolean;
  /** הלקוח שהקובץ הופק עבורו (רק אם החתימה תקינה); null בקבצים ישנים */
  customerId: string | null;
};

/** תא בגיליון, בלי תלות בספרייה שקראה אותו (שורה/עמודה מ-1) */
type Grid = { get: (row: number, col: number) => unknown; lastRow: number };

function gridFromExcelJS(ws: ExcelJS.Worksheet): Grid {
  return {
    get: (r, c) => {
      const v = ws.getRow(r).getCell(c).value as any;
      if (v && typeof v === "object") {
        if ("result" in v) return v.result; // נוסחה
        if ("richText" in v) return v.richText.map((t: any) => t.text).join("");
        if ("text" in v) return v.text; // קישור
      }
      return v;
    },
    lastRow: ws.rowCount,
  };
}

function gridFromSheetJS(buffer: Buffer): Grid {
  const wb = XLSX.read(buffer, { type: "buffer" });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const range = XLSX.utils.decode_range(ws["!ref"] || "A1");
  return {
    get: (r, c) => {
      const cell = ws[XLSX.utils.encode_cell({ r: r - 1, c: c - 1 })];
      return cell ? cell.v : null;
    },
    lastRow: range.e.r + 1,
  };
}

export async function parseOrderExcel(buffer: Buffer): Promise<ParseResult> {
  let grid: Grid;
  try {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer as any);
    grid = gridFromExcelJS(wb.worksheets[0]);
  } catch (e) {
    // ⚠️ לא נופלים: קובץ "תקין לאקסל" שנשמר בכלי אחר עדיין קריא כאן
    console.warn("[excel-order] ExcelJS failed, falling back to SheetJS:", (e as Error)?.message);
    grid = gridFromSheetJS(buffer);
  }

  const rows: ParsedRow[] = [];
  const issues: ParseIssue[] = [];
  let pricelistId: string | null = null;
  // קובץ ישן (נשלח לפני התיקון, בלי אף חתימה) — מתקבל כמו קודם, בלי
  // בדיקת חתימות. המחיר ממילא לא נלקח מהקובץ (נשלף מהמחירון).
  let anySig = false;
  for (let r = DATA_START_ROW; r <= grid.lastRow && !anySig; r++) {
    if (String(grid.get(r, COL.sig) ?? "").trim()) anySig = true;
  }
  const signatureChecked = !!signingSecret() && anySig;

  // זיהוי הלקוח (שורה 1, עמודות מוסתרות) — נבדק אחרי שידוע המכירה
  const custRef = String(grid.get(1, COL.ref) ?? "").trim();
  const custSig = String(grid.get(1, COL.sig) ?? "").trim();

  for (let rowNumber = DATA_START_ROW; rowNumber <= grid.lastRow; rowNumber++) {
    const ref = String(grid.get(rowNumber, COL.ref) ?? "").trim();
    if (!ref) continue; // שורת סיכום או ריקה

    const name = String(grid.get(rowNumber, COL.product) ?? "").trim() || `שורה ${rowNumber}`;

    // ⚠️ שורה שנדחית **מדווחת ולא נבלעת**. לקוח שהזמין משהו שלא
    // נקלט חייב לדעת - אחרת הוא יגיע לחלוקה ויגלה שחסר לו מוצר.
    const m = ref.match(/^P:(.+?)S:([^U]+)(U:1)?$/);
    if (!m) {
      issues.push({ rowNumber, productName: name, reason: "מזהה שורה פגום — ייתכן שהקובץ נערך" });
      continue;
    }
    const [, productId, plId, singleFlag] = m;
    const isSingle = !!singleFlag;

    if (!pricelistId) pricelistId = plId;
    else if (pricelistId !== plId) {
      issues.push({ rowNumber, productName: name, reason: "השורה שייכת למכירה אחרת" });
      continue;
    }

    const rawQty = grid.get(rowNumber, COL.qty);
    if (rawQty === null || rawQty === undefined || String(rawQty).trim() === "") continue; // לא הוזמן

    // "2", 2, "2.5", "2,5" — כולם כמות. טקסט אחר — שגיאה מדווחת.
    const qty = Number(String(rawQty).trim().replace(",", "."));
    if (!Number.isFinite(qty) || qty <= 0) {
      if (qty !== 0) {
        issues.push({ rowNumber, productName: name, reason: `כמות לא תקינה: "${rawQty}"` });
      }
      continue;
    }

    const priceInFile = Number(grid.get(rowNumber, COL.price) ?? 0);

    if (signatureChecked) {
      const expected = sign(ref, priceInFile);
      const actual = String(grid.get(rowNumber, COL.sig) ?? "").trim();
      if (!actual) {
        issues.push({ rowNumber, productName: name, reason: "חסרה חתימה — השורה הוספה ידנית" });
        continue;
      }
      if (actual !== expected) {
        issues.push({
          rowNumber,
          productName: name,
          reason: "החתימה אינה תואמת — המחיר או המזהה שונו בקובץ",
        });
        continue;
      }
    }

    rows.push({ productId, isSingle, productName: name, quantity: qty, priceInFile });
  }

  // מזהה לקוח תקף רק עם חתימה תואמת (ושל אותה מכירה)
  let customerId: string | null = null;
  if (custRef.startsWith(CUSTOMER_REF_PREFIX) && pricelistId) {
    const id = custRef.slice(CUSTOMER_REF_PREFIX.length);
    // ⚠️ תמיד עם חתימה (כשיש מפתח) — גם בקובץ "ישן" בלי חתימות שורה:
    // אחרת מחיקת החתימות + "C:<לקוח אחר>" הייתה מספיקה כדי להתחזות.
    if (!signingSecret() || (custSig && custSig === signCustomer(id, pricelistId))) customerId = id;
  }

  return { pricelistId, rows, issues, signatureChecked, customerId };
}
