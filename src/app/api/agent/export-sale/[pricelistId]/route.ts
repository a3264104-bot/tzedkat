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
  // §176: 🚨 מערך ריק = **חסימה**, לא "בלי הגבלה".
  //
  // 🐛 מה שהיה: `length > 0` דילג על הסינון כשלנציג אין נקודות -
  // והוא קיבל את דף החלוקה של **כל הנקודות במערכת**, כולל
  // לקוחות של נציגים אחרים עם שמות, טלפונים וסכומים.
  //
  // ⚠️ זה הדפוס שנתפס כבר פעמיים (§70), והוא חזר. מערך ריק
  // אצל נציג אינו "אין הגבלה" - הוא "אין לו שום נקודה".
  if (!g.isAdmin) {
    if (g.agentPointIds.length === 0) {
      return NextResponse.json(
        { error: "אין לך נקודת חלוקה משויכת. פנה למנהל." },
        { status: 403 }
      );
    }
    whereOrders.pointId = { in: g.agentPointIds };
  }

  // §208: שעת הסגירה - לסימון הזמנות שנוספו אחריה.
  //
  // 🐛 הפער: המנהל מזין הזמנות אחרי הסגירה (§206) ומדפיס דף
  // חלוקה מחדש - אבל בדף כל השורות נראות זהה. הנציג שקיבל דף
  // מעודכן לא יודע איזו שורה חדשה, ואם הוא כבר התחיל לעבוד עם
  // הדף הישן הוא עלול לדלג עליה.
  const closeDate =
    (
      await prisma.pricelist.findUnique({
        where: { id: pricelistId },
        select: { closeDate: true },
      })
    )?.closeDate ?? null;

  const orders = await prisma.order.findMany({
    where: whereOrders,
    // §208: החדשות **ראשונות**.
    //
    // ⚠️ בכוונה בראש הרשימה ולא בסוף: הנציג שמקבל דף מעודכן
    // צריך לראות מיד מה נוסף, בלי לסרוק 40 שורות. ומי שעובד
    // לפי סדר א-ב ימצא אותן ממילא לפי השם.
    // §233: המיון נעשה בקוד ולא כאן - ראה sortByLastName למטה.
    //
    // ⚠️ Prisma לא יכול למיין לפי "שם משפחה, ואם אין אז המילה
    // האחרונה בשם המלא". orderBy כאן נשאר רק כדי שהסדר יהיה
    // יציב בין קריאות.
    orderBy: [{ customerName: "asc" }, { createdAt: "asc" }],
    include: {
      // §192: 🐛 הדף המודפס הציג את **השם מרגע ההזמנה**.
      //
      // customerName הוא snapshot - הוא נכון להיסטוריה, אבל בדף
      // החלוקה הוא פשוט שגוי: המנהל תיקן שמות במסך השלמת השמות,
      // והדף המשיך להדפיס את הישנים.
      //
      // ⚠️ השם הנוכחי גובר. אם הלקוח נמחק (customer=null) נופלים
      // ל-snapshot, כי עדיף שם ישן מאשר שורה בלי שם בכלל.
      // §233: firstName/lastName למיון לפי שם משפחה.
      customer: {
        select: { name: true, phone: true, firstName: true, lastName: true },
      },
      items: {
        include: {
          product: {
            select: {
              id: true,
              name: true,
              unit: true,
              // §233: קובע אם המוצר מפוצל למשבצות. PACKAGE = קרטון
              // שנשקל, UNIT = יחידות עם משקל מודפס.
              saleType: true,
              // §161: הקטגוריה - קובעת אילו מוצרים מקבלים צבע.
              // בלעדיה isColoredCategory תמיד false, והתכונה
              // לא הייתה עושה כלום.
              category: { select: { name: true } },
            },
          },
        },
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
    buildDistributionSheet(
      wb,
      grp.name,
      // §233: ממוין לפי שם משפחה, לא לפי שם פרטי
      [...grp.orders].sort(sortByLastName),
      saleTitle,
      g.agent.name,
      // §208: לסימון הזמנות שנוספו אחרי הסגירה
      closeDate
    );
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
// §140: גיליון נקודה אחת - תא לכל פריט, לא עמודה לכל מוצר
// ─────────────────────────────────────────────────────────────
// 🐛 המבנה הקודם: עמודה קבועה לכל מוצר שהוזמן בנקודה. זה עובד
// כשכולם מזמינים מאותם 5-6 מוצרים - וקורס ברגע שלא. עשרים
// לקוחות שכל אחד לקח שני מוצרים שונים = 40 עמודות ודף בלתי
// קריא.
//
// המבנה עכשיו: **כל תא הוא פריט**. שם המוצר והכמות בתוך התא,
// ומתחתיהם משבצת למשקל. מספר העמודות נקבע לפי כמה פריטים
// מזמין הלקוח, ולא לפי גודל הקטלוג.
//
// ⚠️ ארבע עמודות ולא שבע: הנתונים מהמערכת מראים חציון של 3
// פריטים ו-p90 של 6.5. ארבע מכסות את רוב הלקוחות בשורה אחת,
// והשאר גולשים לשורה שנייה - צר וקריא, במקום דף רחב שרובו ריק.
const ITEMS_PER_ROW = 4;

// §161: צבע למוצרי **בשר בקר בלבד**.
//
// הבקשה מהשטח: "כל הבשרים נראים אותו דבר, ואם אני לא עובד לפי
// סוג אני מתבלבל". שמות כמו "שריר", "צלי כתף" ו"אנטריקוט"
// מתמזגים לעין בדף עם 40 שורות.
//
// ⚠️ 🐛 הגרסה הראשונה צבעה **את כל המוצרים**, וזה ביטל בדיוק
// את הערך: כשהכל צבעוני, שום דבר לא בולט. עוף ודגים נבדלים
// ממילא בשם ואינם צריכים סימון.
//
// ⚠️ גוונים בהירים בלבד: הטקסט שחור, וצבע רווי היה הופך את
// הדף לבלתי קריא בהדפסה בשחור-לבן.

/**
 * §161: הקטגוריות שמקבלות צבע.
 *
 * ⚠️ השוואה חלקית (includes) ולא מדויקת: שם הקטגוריה עשוי
 * להשתנות ל"בשר בקר טרי" או "בקר", ובדיקה מדויקת הייתה שוברת
 * את התכונה בשקט ביום שמישהו יערוך את השם.
 */
const COLORED_CATEGORIES = ["בשר", "בקר"];

function isColoredCategory(categoryName: string | null | undefined): boolean {
  const c = (categoryName || "").trim();
  if (!c) return false;
  return COLORED_CATEGORIES.some((k) => c.includes(k));
}
const PRODUCT_COLORS = [
  "FFFFF3CD", // חרדל בהיר
  "FFD4EDDA", // ירוק
  "FFCCE5FF", // תכלת
  "FFF8D7DA", // ורוד
  "FFE2D9F3", // סגול
  "FFFFE0CC", // כתום
  "FFD1F2EB", // טורקיז
  "FFFCE4EC", // ורוד בהיר
  "FFE8F5E9", // ירקרק
  "FFFFF9C4", // צהוב
];

/**
 * §161: מפת צבעים לגיליון - **בלי התנגשויות**.
 *
 * 🐛 הגרסה הראשונה השתמשה ב-hash של השם. עם 10 צבעים,
 * "אנטריקוט" ו"חזה עוף" קיבלו את אותו גוון - וזה מבטל בדיוק
 * את מה שהנציג ביקש: להבחין ביניהם בלי לקרוא.
 *
 * ⚠️ עכשיו הקצאה סדרתית לפי סדר הופעה בגיליון. המוצרים
 * ממוינים לפני כן, ולכן הסדר יציב בין הדפסה להדפסה.
 *
 * ⚠️ מעבר ל-10 מוצרים הצבעים חוזרים - אבל שני מוצרים עם אותו
 * צבע יהיו רחוקים זה מזה ברשימה, ולא שכנים כמו בהתנגשות hash.
 */
function buildColorMap(orders: any[]): Map<string, string> {
  const names = new Set<string>();
  for (const o of orders) {
    for (const it of o.items) {
      if (it.isCancelled) continue;
      // §161: רק בשר בקר. שאר המוצרים נשארים ברקע האחיד.
      if (!isColoredCategory(it.product?.category?.name)) continue;
      names.add(it.product?.name || it.productName);
    }
  }
  const map = new Map<string, string>();
  Array.from(names)
    .sort((a, b) => a.localeCompare(b, "he"))
    .forEach((n, i) => map.set(n, PRODUCT_COLORS[i % PRODUCT_COLORS.length]));
  return map;
}

/**
 * §233: מיון לפי **שם משפחה**.
 *
 * 🐛 מה שהיה: מיון לפי השם המלא, כלומר לפי השם הפרטי. הנציג
 * שמחפש את "ניימן" בדף עבר על כל האלף-בית של השמות הפרטיים.
 *
 * ⚠️ **ברמת המודול** ולא בתוך GET: הפונקציה נדרשת בשני מקומות,
 * ובתוך פונקציה אחת היא הייתה מחוץ להיקף של השנייה - וזה בדיוק
 * מה שהכשיל את ה-build.
 *
 * ⚠️ שלוש רמות נפילה:
 *   1. lastName אם קיים (§173)
 *   2. המילה האחרונה בשם המלא - ניחוש סביר לרוב השמות
 *   3. השם המלא, אם אין כלום
 *
 * ⚠️ localeCompare עם "he": בלעדיו האותיות ממוינות לפי קוד
 * Unicode, ו-"ץ" יוצא לפני "א".
 */
function lastNameOf(o: any): string {
  const c = o.customer;
  if (c?.lastName?.trim()) return c.lastName.trim();
  const full = (c?.name || o.customerName || "").trim();
  if (!full) return "";
  const parts = full.split(/\s+/);
  return parts.length > 1 ? parts[parts.length - 1] : full;
}

function sortByLastName(a: any, b: any): number {
  const r = lastNameOf(a).localeCompare(lastNameOf(b), "he");
  if (r !== 0) return r;
  // ⚠️ שם משפחה זהה - ממיינים לפי השם המלא, כדי ששני "כהן"
  // יופיעו בסדר קבוע ולא ישתנו בין הדפסות.
  return (a.customer?.name || a.customerName || "").localeCompare(
    b.customer?.name || b.customerName || "",
    "he"
  );
}

function buildDistributionSheet(
  wb: ExcelJS.Workbook,
  pointName: string,
  orders: any[],
  saleTitle: string,
  agentName: string,
  // §208: שעת הסגירה - לסימון הזמנות שנוספו אחריה.
  //
  // ⚠️ פרמטר ולא משתנה גלובלי: הפונקציה נקראת פעם לכל נקודה,
  // ו-closeDate נשלף פעם אחת ב-GET. העברה מפורשת מונעת תלות
  // בסדר הקריאות.
  closeDate: Date | null
) {
  // שם גיליון: אקסל אוסר : \ / ? * [ ] ומגביל ל-31 תווים
  const safeName = pointName.replace(/[:\\/?*[\]]/g, "-").slice(0, 31) || "נקודה";
  const ws = wb.addWorksheet(safeName, {
    views: [{ rightToLeft: true, state: "frozen", xSplit: 2, ySplit: 4 }],
    pageSetup: {
      paperSize: 9,
      orientation: "landscape",
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
      margins: { left: 0.25, right: 0.25, top: 0.4, bottom: 0.4, header: 0.2, footer: 0.2 },
      // ⚠️ הכותרת חוזרת בכל דף מודפס. בלעדיה, מהדף השני והלאה
      // הנציג רואה טבלה בלי שמות עמודות.
      printTitlesRow: "4:4",
    },
  });

  // §161: מפת הצבעים - נבנית פעם אחת לגיליון
  const colorMap = buildColorMap(orders);

  // ─── עמודות: שם, טלפון, 4 פריטים, מזומן, טופל ───
  ws.columns = [
    { width: 18 },
    { width: 13 },
    ...Array.from({ length: ITEMS_PER_ROW }, () => ({ width: 17 })),
    { width: 9 },
    { width: 7 },
  ];
  const cashCol = 2 + ITEMS_PER_ROW + 1;
  const lastCol = cashCol + 1;

  // ─── כותרת ───
  ws.mergeCells(1, 1, 1, lastCol);
  const t = ws.getCell(1, 1);
  t.value = `${pointName} — ${saleTitle}`;
  t.font = { size: 15, bold: true, color: { argb: "FFFFFFFF" } };
  t.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFC0461E" } };
  t.alignment = { horizontal: "center", vertical: "middle" };
  ws.getRow(1).height = 22;

  ws.mergeCells(2, 1, 2, lastCol);
  const sub = ws.getCell(2, 1);
  // §208: מקרא ההזמנות המאוחרות + שעת ההדפסה המדויקת.
  //
  // ⚠️ **שעה ולא רק תאריך**: כשהמנהל מדפיס פעמיים באותו יום -
  // אחרי הסגירה ואחרי עוד תוספות - התאריך לבדו לא מבדיל בין
  // הדפים, והנציג לא יודע איזה עדכני.
  const lateCount = closeDate
    ? orders.filter((o: any) => new Date(o.createdAt) > closeDate).length
    : 0;

  sub.value =
    `נציג: ${agentName} · ${orders.length} לקוחות · הודפס ${new Date().toLocaleString(
      "he-IL",
      {
        timeZone: "Asia/Jerusalem",
        day: "2-digit",
        month: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      }
    )}` +
    (lateCount > 0 ? ` · ⭐ ${lateCount} נוספו אחרי הסגירה` : "") +
    // §236: מקרא הקרטון **תמיד** בשורת המשנה.
    //
    // ⚠️ המקרא הגדול (שורה 3) מוצג רק כשיש הזמנות מאוחרות, ולכן
    // אי אפשר לסמוך עליו. השורה הזו נמצאת בכל דף.
    " · ⬛ = קרטון שלם" +
    ` · לקוח ששילם במזומן — לסמן בעמודת "מזומן" ולעדכן במערכת`;
  sub.font = { size: 9, color: { argb: "FF666666" } };
  sub.alignment = { horizontal: "center" };

  // §208: מקרא בולט - רק כשיש הזמנות מאוחרות.
  //
  // ⚠️ מוצג רק כשרלוונטי: בדף רגיל הוא רעש, ומי שרואה אותו
  // תמיד מפסיק לקרוא אותו.
  if (lateCount > 0) {
    ws.mergeCells(3, 1, 3, lastCol);
    const leg = ws.getCell(3, 1);
    leg.value =
      "⭐ שורות מסומנות בכוכבית ובאדום — נוספו אחרי סגירת המכירה. אם קיבלת דף קודם, אלה השורות החדשות.   ·   ⬛ = קרטון שלם";
    leg.font = { size: 10, bold: true, color: { argb: "FFB91C1C" } };
    leg.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFEE2E2" } };
    leg.alignment = { horizontal: "center", vertical: "middle" };
    ws.getRow(3).height = 18;
  }

  // ─── כותרות עמודות ───
  const hdr = ws.getRow(4);
  hdr.getCell(1).value = "שם הלקוח";
  hdr.getCell(2).value = "טלפון";
  for (let i = 0; i < ITEMS_PER_ROW; i++) {
    hdr.getCell(3 + i).value = `מוצר ${i + 1} · משקל`;
  }
  hdr.getCell(cashCol).value = "מזומן";
  hdr.getCell(lastCol).value = "טופל";

  for (let c = 1; c <= lastCol; c++) {
    const cell = ws.getCell(4, c);
    cell.font = { bold: true, size: 10, color: { argb: "FF7C2D12" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF5E6DC" } };
    cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
    cell.border = {
      top: { style: "thin" },
      left: { style: "thin" },
      bottom: { style: "medium" },
      right: { style: "thin" },
    };
  }
  ws.getRow(4).height = 20;

  // ─── שורות הלקוחות ───
  const thin = { style: "thin" as const, color: { argb: "FFBBBBBB" } };
  const cellBorder = { top: thin, left: thin, bottom: thin, right: thin };
  let r = 5;

  orders.forEach((o, idx) => {
    const items = o.items.filter((it: any) => !it.isCancelled);
    // ⚠️ לקוח בלי פריטים עדיין מקבל שורה: ייתכן שהוא יגיע ויקנה
    // כמזדמן, והנציג צריך לראות שהוא ברשימה.
    // §203: 🐛 4 קרטונים = תא אחד עם משבצת משקל אחת.
    //
    // הנציג שוקל כל קרטון בנפרד - אין דרך למלא משקל אחד ל-4
    // קרטונים. הוא נאלץ לרשום בצד או לחבר בראש, וזה בדיוק
    // המקום שבו נופלות טעויות.
    //
    // ⚠️ **רק קרטונים**. בודדים לפי ק"ג הם שקילה אחת: "3 ק"ג
    // פרגית" זה משקל אחד, ופיצול שלו לשלוש משבצות היה מבלבל.
    //
    // ⚠️ תקרה של 12: לקוח שמזמין 20 קרטונים יקבל 12 משבצות
    // והשאר בהערה. דף עם 20 משבצות לפריט אחד אינו קריא, וזה
    // מקרה נדיר שממילא דורש התייחסות ידנית.
    const expanded: any[] = [];
    for (const it of items) {
      const qty = Number(it.quantity) || 0;
      // §233: 🐛 10 נקניקים פוצלו ל-10 משבצות.
      //
      // התנאי היה `!isSingle` בלבד - אבל זה תופס **כל** מה שאינו
      // בודדים, כולל מוצרים שנמכרים ביחידות. נקניק, כבד ארוז,
      // עוף טחון: כולם UNIT, כולם קיבלו משבצת לכל יחידה.
      //
      // ⚠️ ההבחנה הנכונה: **מה נשקל בנפרד**.
      //   קרטון בשר  → כל אחד נשקל  → משבצת לכל אחד ✓
      //   10 נקניקים → משקל מודפס   → משבצת אחת ✓
      //   3 ק"ג פרגית → שקילה אחת   → משבצת אחת ✓
      //
      // ⚠️ saleType === "PACKAGE" הוא הקרטון (§178). UNIT ו-WEIGHT
      // אינם מפוצלים.
      const saleType = it.product?.saleType ?? it.saleType;
      const isCarton =
        !it.isSingle &&
        saleType === "PACKAGE" &&
        Number.isInteger(qty) &&
        qty > 1;
      if (isCarton) {
        const n = Math.min(qty, 12);
        for (let k = 0; k < n; k++) {
          // ⚠️ partIndex/partTotal - כדי שהתא יציג "1 מתוך 4"
          // והנציג ידע כמה נשארו לו.
          expanded.push({ ...it, quantity: 1, partIndex: k + 1, partTotal: qty });
        }
        // ⚠️ העודף מעבר לתקרה נרשם כתא אחד עם הערה, ולא נעלם.
        if (qty > 12) {
          expanded.push({ ...it, quantity: qty - 12, partOverflow: true });
        }
      } else {
        expanded.push(it);
      }
    }

    const chunks: any[][] = [];
    for (let i = 0; i < Math.max(1, expanded.length); i += ITEMS_PER_ROW) {
      chunks.push(expanded.slice(i, i + ITEMS_PER_ROW));
    }

    const startRow = r;
    const stripe = idx % 2 === 1;

    chunks.forEach((chunk, ci) => {
      // גובה נדיב: שתי שורות טקסט בתא (מוצר + מקום למשקל)
      ws.getRow(r).height = 30;

      // שם וטלפון רק בשורה הראשונה של הלקוח
      if (ci === 0) {
        const nameCell = ws.getCell(r, 1);
        // §208: סימון הזמנה שנוספה אחרי סגירת המכירה.
        //
        // ⚠️ ⭐ ולא צבע בלבד: הדף מודפס, ולעיתים בשחור-לבן.
        // סימן טקסטואלי עובד בכל מדפסת.
        const isLate =
          closeDate != null && new Date(o.createdAt) > closeDate;
        // §192: השם הנוכחי, לא ה-snapshot
        nameCell.value =
          (isLate ? "⭐ " : "") + (o.customer?.name || o.customerName);
        nameCell.font = {
          bold: true,
          size: 10,
          // §208: אדום לשורה שנוספה אחרי הסגירה. נראה גם בהדפסה
          // בגווני אפור, כי הוא כהה יותר מהכחול-אפור הרגיל.
          color: { argb: isLate ? "FFB91C1C" : "FF2C3E4F" },
        };
        nameCell.alignment = { vertical: "middle", wrapText: true };

        const phoneCell = ws.getCell(r, 2);
        phoneCell.value = o.phone || "";
        phoneCell.font = { size: 9 };
        phoneCell.alignment = { horizontal: "center", vertical: "middle" };
      } else {
        // ⚠️ סימן המשך: בלעדיו שורה שנייה נראית כמו לקוח חדש
        // בלי שם, והנציג מחפש למי היא שייכת.
        const contCell = ws.getCell(r, 1);
        contCell.value = "↳ המשך";
        contCell.font = { size: 8, italic: true, color: { argb: "FF999999" } };
        contCell.alignment = { horizontal: "right", vertical: "middle" };
        // ⚠️ הטלפון **לא** נכתב שוב. עמודת הטלפון ממוזגת על כל
        // שורות הלקוח בהמשך, אבל ExcelJS משאיר ערך שכבר נכתב -
        // ובבדיקה בפועל הוא הופיע פעמיים.
      }

      // הפריטים
      for (let i = 0; i < ITEMS_PER_ROW; i++) {
        const col = 3 + i;
        const cell = ws.getCell(r, col);
        const it = chunk[i];

        if (it) {
          // §140: המוצר והכמות בשורה אחת, ומתחתיהם קו למשקל.
          // חוסך גובה ומאפשר יותר שורות בדף.
          // §236: קרטון = PACKAGE. אותה הבחנה של §233.
          const cartonType =
            (it.product?.saleType ?? it.saleType) === "PACKAGE";
          const qty = formatItemQty({
            isSingle: it.isSingle,
            quantity: Number(it.quantity),
            unit: it.unit,
          });
          const name = it.product?.name || it.productName;
          // §203: סימון "1 מתוך 4" בקרטון שפוצל.
          //
          // ⚠️ בלי הסימון הנציג רואה 4 תאים זהים ולא יודע אם
          // הוא כבר שקל את השני או דילג עליו. עם הסימון הוא
          // מסמן ומתקדם.
          const partTag = it.partTotal
            ? `  (${it.partIndex}/${it.partTotal})`
            : it.partOverflow
              ? "  (יתרה)"
              : "";
          // §236: 🔲 סימון קרטון שלם.
          //
          // 🐛 המצב מהשטח: הנציג צריך לשלוף קרטון שלם מבין עשרות
          // חלקים בודדים על אותו דף. שם המוצר לבדו לא מבדיל -
          // "שריר" מופיע גם כקרטון וגם כ-3 ק"ג בודדים.
          //
          // ⚠️ ריבוע מלא ⬛ ולא כוכבית: ⭐ כבר תפוסה לסימון הזמנות
          // שנוספו אחרי הסגירה (§208), ושני סימנים זהים בדף אחד
          // מבטלים זה את זה.
          //
          // ⚠️ הסימן **בתחילת השורה השנייה**, ליד הכמות: שם המוצר
          // ארוך ונחתך, והסימן היה נעלם. הכמות תמיד נראית.
          const isWholeCarton = !it.isSingle && cartonType;
          const cartonMark = isWholeCarton ? "⬛ " : "";
          cell.value = `${name}${partTag}\n${cartonMark}${qty}   ______`;
          cell.font = {
            size: 9,
            // ⚠️ קרטון מודגש: גם בהדפסה בשחור-לבן ההבדל נראה.
            bold: isWholeCarton,
          };
          cell.alignment = { vertical: "top", wrapText: true, horizontal: "right" };
          // §161: צבע לפי המוצר - כדי שהנציג יזהה בסריקה מהירה
          // ולא יצטרך לקרוא כל שם.
          cell.fill = {
            type: "pattern",
            pattern: "solid",
            fgColor: { argb: colorMap.get(name) || "FFFFFBEF" },
          };
        } else if (stripe) {
          cell.fill = {
            type: "pattern",
            pattern: "solid",
            fgColor: { argb: "FFFAFAFA" },
          };
        }
        cell.border = cellBorder;
      }

      // מזומן וטופל - רק בשורה הראשונה, ממוזגים על כל השורות
      for (const c of [cashCol, lastCol]) {
        ws.getCell(r, c).border = cellBorder;
      }

      // פס לסירוגין על שם וטלפון
      if (stripe) {
        for (const c of [1, 2]) {
          const cell = ws.getCell(r, c);
          if (!cell.fill) {
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

      r++;
    });

    // ⚠️ מיזוג עמודות המזומן והסימון על כל שורות הלקוח: הן
    // שייכות ללקוח ולא לשורה, וסימון כפול היה מבלבל.
    if (chunks.length > 1) {
      ws.mergeCells(startRow, cashCol, r - 1, cashCol);
      ws.mergeCells(startRow, lastCol, r - 1, lastCol);
      // הטלפון ממוזג על כל שורות הלקוח - הוא שייך לו, לא לשורה
      ws.mergeCells(startRow, 2, r - 1, 2);
    }

    const cashCell = ws.getCell(startRow, cashCol);
    cashCell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FFF0FDF4" },
    };
    cashCell.alignment = { horizontal: "center", vertical: "middle" };

    const doneCell = ws.getCell(startRow, lastCol);
    doneCell.border = {
      top: { style: "thin", color: { argb: "FF999999" } },
      left: { style: "medium", color: { argb: "FFC0461E" } },
      bottom: { style: "thin", color: { argb: "FF999999" } },
      right: { style: "thin", color: { argb: "FF999999" } },
    };
    doneCell.alignment = { horizontal: "center", vertical: "middle" };
  });

  // ─── שורות ריקות למזדמנים ───
  const firstBlank = r + 1;
  ws.mergeCells(r, 1, r, lastCol);
  const bt = ws.getCell(r, 1);
  bt.value = "מזדמנים (למילוי בשטח)";
  bt.font = { bold: true, size: 10, color: { argb: "FF8B5A00" } };
  bt.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFF4E0" } };
  bt.alignment = { horizontal: "center" };

  for (let i = 0; i < 8; i++) {
    const rowNum = firstBlank + i;
    ws.getRow(rowNum).height = 30;
    for (let c = 1; c <= lastCol; c++) {
      ws.getCell(rowNum, c).border = cellBorder;
    }
  }
}
