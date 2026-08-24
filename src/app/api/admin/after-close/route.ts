// ═══════════════════════════════════════════════════════════════
// §207: תוספות אחרי סגירת המכירה — קובץ לספק
// ═══════════════════════════════════════════════════════════════
// GET /api/admin/after-close?pricelistId=X
//
// המצב: המכירה נסגרה, ההזמנה שודרה לחברה, ואז מגיעות עוד בקשות
// בטלפון. המנהל מזין אותן (§206), ואז צריך לדעת **בדיוק** מה
// להוסיף לספק ואיזה דף חלוקה להדפיס מחדש.
//
// 🐛 מה שהיה: שאילתת SQL ידנית ב-Supabase. זה עובד פעם אחת, אבל
// לא כשצריך לעשות את זה בכל מכירה - והמנהל פשוט יוותר ויחשב
// בראש, וזה בדיוק מה שגורם לחוסר או לעודף מול הספק.
//
// ⚠️ הקובץ **נפרד** מדף החלוקה הרגיל בכוונה: הוא נותן תשובה
// לשאלה אחרת ("מה להוסיף") ומיועד לנמען אחר (החברה, לא הנציג).
// מיזוג שלהם היה מייצר דף שאי אפשר להעביר לאף אחד מהם.

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/guard";
import ExcelJS from "exceljs";

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
    select: {
      id: true,
      name: true,
      closeDate: true,
      deliveryDateText: true,
    },
  });
  if (!pricelist) {
    return NextResponse.json({ error: "מכירה לא נמצאה" }, { status: 404 });
  }
  if (!pricelist.closeDate) {
    return NextResponse.json(
      { error: "למכירה זו לא הוגדרה שעת סגירה — אין 'אחרי סגירה'" },
      { status: 400 }
    );
  }

  // ⚠️ createdAt > closeDate: זה מה שמגדיר "אחרי סגירה". לא
  // הסטטוס ולא סימון ידני - רק העובדה שההזמנה נוצרה אחרי הרגע
  // שבו המכירה אמורה הייתה להיסגר.
  const orders = await prisma.order.findMany({
    where: {
      pricelistId,
      status: { notIn: ["CANCELLED"] },
      createdAt: { gt: pricelist.closeDate },
    },
    orderBy: { createdAt: "asc" },
    include: {
      customer: { select: { name: true, phone: true } },
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
              sortOrder: true,
              category: { select: { name: true, sortOrder: true } },
            },
          },
        },
      },
    },
  });

  // §227: מפת מזהה → שם נציג.
  //
  // ⚠️ שליפה אחת במקום N: יש עשרות הזמנות ומעט נציגים, ושאילתה
  // לכל שורה הייתה עשרות סיבובים למסד באירלנד.
  const agentIds = Array.from(
    new Set(orders.map((o) => o.placedByAgentId).filter(Boolean) as string[])
  );
  const agentMap = new Map<string, string>();
  if (agentIds.length > 0) {
    const found = await prisma.customer.findMany({
      // ⚠️ id **או** email: השדה מכיל את שניהם לפי המסלול שיצר
      // את ההזמנה, וחיפוש לפי אחד בלבד היה מפספס חצי.
      where: { OR: [{ id: { in: agentIds } }, { email: { in: agentIds } }] },
      select: { id: true, email: true, name: true },
    });
    for (const a of found) {
      agentMap.set(a.id, a.name);
      if (a.email) agentMap.set(a.email, a.name);
    }
  }
  const agentName = (v: string | null) =>
    !v ? "המנהל" : (agentMap.get(v) ?? v);

  const wb = new ExcelJS.Workbook();
  wb.creator = "צדקת רבותינו";
  wb.created = new Date();

  const closeTxt = pricelist.closeDate.toLocaleString("he-IL", {
    timeZone: "Asia/Jerusalem",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });

  // ═══════════════════════════════════════════════════════════
  // גיליון 1: מה להוסיף לספק
  // ═══════════════════════════════════════════════════════════
  // ⚠️ ראשון בכוונה: זה מה שפותחים כשמתקשרים לחברה.
  const ws1 = wb.addWorksheet("להוסיף לספק", {
    views: [{ rightToLeft: true, state: "frozen", ySplit: 4 }],
  });

  banner(
    ws1,
    5,
    `⚠️ תוספות אחרי סגירה — ${pricelist.name}`,
    `המכירה נסגרה ב-${closeTxt} · ${orders.length} הזמנות נוספו אחריה`,
    "אלה הכמויות שיש להוסיף להזמנה שכבר שודרה לחברה. אינן כלולות בה."
  );

  const HEAD1 = ["מוצר", "קטגוריה", "קרטונים", 'בודדים (ק"ג / יח׳)', "הזמנות"];
  headerRow(ws1, HEAD1, 4);

  // ─── צבירה לפי מוצר ───
  type Agg = {
    name: string;
    cat: string;
    catSort: number;
    prodSort: number;
    cartons: number;
    singles: number;
    orderIds: Set<string>;
  };
  const agg = new Map<string, Agg>();

  for (const o of orders) {
    for (const it of o.items) {
      const pr = it.product;
      if (!pr) continue;
      let a = agg.get(pr.id);
      if (!a) {
        a = {
          name: pr.name,
          cat: pr.category?.name ?? "",
          catSort: pr.category?.sortOrder ?? 999,
          prodSort: pr.sortOrder ?? 0,
          cartons: 0,
          singles: 0,
          orderIds: new Set(),
        };
        agg.set(pr.id, a);
      }
      const qty = Number(it.quantity);
      if (it.isSingle) a.singles += qty;
      else a.cartons += qty;
      a.orderIds.add(o.id);
    }
  }

  const sorted = Array.from(agg.values()).sort(
    (a, b) => a.catSort - b.catSort || a.prodSort - b.prodSort
  );

  let r = 5;
  let lastCat = "";
  for (const a of sorted) {
    if (a.cat && a.cat !== lastCat) {
      ws1.mergeCells(r, 1, r, 5);
      const c = ws1.getCell(r, 1);
      c.value = a.cat;
      c.font = { size: 11, bold: true, color: { argb: "FF3F3F46" } };
      c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF4F4F5" } };
      c.alignment = { horizontal: "right" };
      lastCat = a.cat;
      r++;
    }
    ws1.getCell(r, 1).value = a.name;
    // ⚠️ null ולא 0: תא ריק קריא יותר מאפס, והמנהל מזהה מיד
    // איפה יש כמות ואיפה לא.
    ws1.getCell(r, 2).value = a.cat || null;
    ws1.getCell(r, 3).value = a.cartons || null;
    ws1.getCell(r, 4).value = a.singles
      ? Math.round(a.singles * 100) / 100
      : null;
    ws1.getCell(r, 5).value = a.orderIds.size;
    for (let c = 1; c <= 5; c++) {
      const cell = ws1.getCell(r, c);
      cell.alignment = { horizontal: c === 1 ? "right" : "center" };
      cell.font = { size: 10, bold: c === 3 };
      if (c === 3 && a.cartons) {
        // הקרטונים הם המספר שמשודר לחברה - מודגש
        cell.font = { size: 12, bold: true, color: { argb: "FFC0461E" } };
      }
    }
    r++;
  }

  if (sorted.length === 0) {
    ws1.mergeCells(r, 1, r, 5);
    const c = ws1.getCell(r, 1);
    c.value = "לא נוספו הזמנות אחרי הסגירה ✓";
    c.font = { size: 12, bold: true, color: { argb: "FF15803D" } };
    c.alignment = { horizontal: "center" };
  }

  ws1.getColumn(1).width = 32;
  ws1.getColumn(2).width = 18;
  ws1.getColumn(3).width = 12;
  ws1.getColumn(4).width = 18;
  ws1.getColumn(5).width = 10;

  // ═══════════════════════════════════════════════════════════
  // גיליון 2: אילו נקודות להדפיס מחדש
  // ═══════════════════════════════════════════════════════════
  const ws2 = wb.addWorksheet("נקודות להדפסה", {
    views: [{ rightToLeft: true, state: "frozen", ySplit: 4 }],
  });
  banner(
    ws2,
    4,
    "אילו דפי חלוקה להדפיס מחדש",
    `${orders.length} הזמנות נוספו אחרי הסגירה`,
    "רק הנקודות ברשימה השתנו. אין צורך להדפיס את השאר."
  );
  headerRow(ws2, ["נקודת חלוקה", "הזמנות חדשות", "לקוחות", "הוזן ע\"י"], 4);

  const byPoint = new Map<
    string,
    { name: string; count: number; names: string[]; by: Set<string> }
  >();
  for (const o of orders) {
    const key = o.point?.id ?? "none";
    const name = o.point?.name ?? "ללא נקודה";
    if (!byPoint.has(key))
      byPoint.set(key, { name, count: 0, names: [], by: new Set() });
    const b = byPoint.get(key)!;
    b.count++;
    b.names.push(o.customer?.name ?? o.customerName);
    // §227: מי הזין - כדי שהמנהל ידע למי לפנות בשאלה
    b.by.add(agentName(o.placedByAgentId));
  }

  let r2 = 5;
  for (const b of Array.from(byPoint.values()).sort((a, z) => z.count - a.count)) {
    ws2.getCell(r2, 1).value = b.name;
    ws2.getCell(r2, 2).value = b.count;
    // ⚠️ שמות הלקוחות ולא רק מספר: כך אפשר לוודא בדף המודפס
    // שהם באמת שם, במקום לספור שורות.
    ws2.getCell(r2, 3).value = b.names.join(", ");
    ws2.getCell(r2, 4).value = Array.from(b.by).join(", ");
    ws2.getCell(r2, 1).font = { size: 11, bold: true };
    ws2.getCell(r2, 2).alignment = { horizontal: "center" };
    ws2.getCell(r2, 2).font = { size: 12, bold: true, color: { argb: "FFC0461E" } };
    ws2.getCell(r2, 3).alignment = { wrapText: true, vertical: "top" };
    ws2.getCell(r2, 3).font = { size: 9 };
    r2++;
  }
  ws2.getColumn(1).width = 34;
  ws2.getColumn(2).width = 14;
  ws2.getColumn(3).width = 46;
  ws2.getColumn(4).width = 20;

  // ═══════════════════════════════════════════════════════════
  // גיליון 3: פירוט ההזמנות
  // ═══════════════════════════════════════════════════════════
  // ⚠️ אחרון: הוא לתחקור ולא לפעולה. מי שמתקשר לחברה לא צריך
  // אותו, אבל מי שבודק "רגע, מי זה היה?" כן.
  const ws3 = wb.addWorksheet("פירוט ההזמנות", {
    views: [{ rightToLeft: true, state: "frozen", ySplit: 4 }],
  });
  banner(
    ws3,
    6,
    "ההזמנות שנוספו אחרי הסגירה",
    `נסגרה ב-${closeTxt}`,
    "לתחקור ולבדיקה. אלה ההזמנות שאינן בספירה המקורית."
  );
  headerRow(ws3, ["#", "לקוח", "טלפון", "נקודה", "נוצרה", "הוזן ע\"י"], 4);

  let r3 = 5;
  for (const o of orders) {
    ws3.getCell(r3, 1).value = o.orderNumber;
    ws3.getCell(r3, 2).value = o.customer?.name ?? o.customerName;
    ws3.getCell(r3, 3).value = o.customer?.phone ?? o.phone;
    ws3.getCell(r3, 4).value = o.point?.name ?? "—";
    ws3.getCell(r3, 5).value = o.createdAt.toLocaleString("he-IL", {
      timeZone: "Asia/Jerusalem",
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
    // §227: מי הזין. "המנהל" כשאין נציג משויך.
    // §227: מי הזין.
    //
    // ⚠️ placedByAgentId הוא **מזהה או מייל**, לא יחס - לכן
    // ההמרה לשם נעשית ממפה שנבנית מראש. בלי זה היה מוצג
    // "cmrb2aphx000dl504" במקום "יוסי כהן".
    ws3.getCell(r3, 6).value = agentName(o.placedByAgentId);
    for (let c = 1; c <= 6; c++) {
      ws3.getCell(r3, c).font = { size: 10 };
      ws3.getCell(r3, c).alignment = { horizontal: c === 2 ? "right" : "center" };
    }
    r3++;
  }
  ws3.getColumn(1).width = 8;
  ws3.getColumn(2).width = 24;
  ws3.getColumn(3).width = 15;
  ws3.getColumn(4).width = 30;
  ws3.getColumn(5).width = 14;
  ws3.getColumn(6).width = 20;

  const buf = await wb.xlsx.writeBuffer();
  const fname = `תוספות-אחרי-סגירה-${pricelist.name}.xlsx`.replace(
    /[\\/:*?"<>|]/g,
    "-"
  );
  return new NextResponse(Buffer.from(buf) as any, {
    status: 200,
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(fname)}`,
    },
  });
}

/**
 * §207: כותרת אזהרה בראש הגיליון.
 *
 * ⚠️ אדום ולא כתום: הקובץ הזה מתאר מצב חריג, ומי שמקבל אותו
 * חייב להבין מיד שאלה **תוספות** ולא ההזמנה המלאה. גיליון שנראה
 * כמו כל דוח אחר יגרום למישהו לשדר אותו כהזמנה שלמה.
 */
function banner(
  ws: ExcelJS.Worksheet,
  cols: number,
  title: string,
  sub: string,
  note: string
) {
  ws.mergeCells(1, 1, 1, cols);
  const t = ws.getCell(1, 1);
  t.value = title;
  t.font = { size: 15, bold: true, color: { argb: "FFFFFFFF" } };
  t.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFB91C1C" } };
  t.alignment = { horizontal: "center", vertical: "middle" };
  ws.getRow(1).height = 26;

  ws.mergeCells(2, 1, 2, cols);
  const s = ws.getCell(2, 1);
  s.value = sub;
  s.font = { size: 11, bold: true };
  s.alignment = { horizontal: "center" };

  ws.mergeCells(3, 1, 3, cols);
  const n = ws.getCell(3, 1);
  n.value = note;
  n.font = { size: 10, bold: true, color: { argb: "FF92400E" } };
  n.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFEF3C7" } };
  n.alignment = { horizontal: "center" };
}

function headerRow(ws: ExcelJS.Worksheet, head: string[], row: number) {
  head.forEach((h, i) => {
    const c = ws.getCell(row, i + 1);
    c.value = h;
    c.font = { size: 11, bold: true };
    c.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE4E4E7" } };
    c.border = { bottom: { style: "medium" } };
  });
  ws.getRow(row).height = 28;
}
