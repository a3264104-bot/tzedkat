// ═══════════════════════════════════════════════════════════════
// §279: דף מיון — לפי מוצר, לא לפי לקוח
// ═══════════════════════════════════════════════════════════════
// GET /api/agent/sorting-sheet/[pricelistId]
//
// למה זה נדרש: בחלוקה יש **שני שלבים פיזיים שונים**, ודף
// החלוקה הקיים משרת רק את השני.
//
//   מיון   — פותחים קרטון, מחלקים לערימות   ← אין דף
//   מסירה  — לקוח מגיע, שוקלים, נותנים      ← דף החלוקה
//
// והשלב הראשון הוא הבלגן: הנציג מוצא חבילת שניצל ולא יודע למי
// היא שייכת, ומתחיל לעבור על 40 שורות בזמן שלקוחות מחכים.
//
// ⚠️ הדף הזה עונה על שאלה אחת: **"למי שייך המוצר שבידי?"**
// לכן הוא ממוין לפי מוצר, וכל מוצר מרכז את כל הלקוחות שהזמינו.
//
// ⚠️ והסכום בראש כל מוצר הופך אותו מרשימה לכלי בקרה: הנציג
// סופר 18 ורואה שכתוב 20 - הוא יודע שחסרים שניים **לפני**
// שהלקוח האחרון מגיע ואין לו.
//
// ⚠️ ומשבצות הסימון עונות על השאלה ההפוכה בסוף היום: נותר
// שניצל, הוא מסתכל, ורואה שורה אחת לא מסומנת.

import { NextResponse } from "next/server";
// §280: סימני קטגוריה — מקור אמת יחיד
import { categoryMark, CATEGORY_LEGEND } from "@/lib/category-mark-lib";
import { prisma } from "@/lib/prisma";
import { requireAgent } from "@/lib/agent-guard";
import ExcelJS from "exceljs";



export async function GET(
  req: Request,
  { params }: { params: Promise<{ pricelistId: string }> }
) {
  const g = await requireAgent();
  if (!g.ok) return g.res;

  const { pricelistId } = await params;

  const pricelist = await prisma.pricelist.findUnique({
    where: { id: pricelistId },
    select: { id: true, name: true, deliveryDateText: true, closeDate: true },
  });
  if (!pricelist) {
    return NextResponse.json({ error: "מכירה לא נמצאה" }, { status: 404 });
  }

  // §282: 🎯 סינון לנקודה אחת.
  //
  // התרחיש: המנהל מדפיס לנציג מסוים ולא צריך את 14 הנקודות.
  // קובץ עם 14 לשוניות אומר לחפש את הנכונה, ואז להדפיס רק
  // אותה - שני שלבים שאפשר לחסוך.
  //
  // ⚠️ ריק = כל הנקודות. ההתנהגות הקיימת נשמרת בדיוק.
  const { searchParams } = new URL(req.url);
  const onlyPointId = (searchParams.get("pointId") || "").trim();

  const whereOrders: any = {
    pricelistId,
    status: { notIn: ["CANCELLED"] },
    ...(onlyPointId ? { pointId: onlyPointId } : {}),
  };

  // ⚠️ אותו סינון של דף החלוקה (§117): נציג רואה רק את הנקודות
  // שלו, ומערך ריק אינו "בלי הגבלה" אלא "אין לו נקודה".
  if (!g.isAdmin) {
    if (g.agentPointIds.length === 0) {
      return NextResponse.json(
        { error: "אין לך נקודת חלוקה משויכת. פנה למנהל." },
        { status: 403 }
      );
    }
    whereOrders.pointId = { in: g.agentPointIds };
  }

  const orders = await prisma.order.findMany({
    where: whereOrders,
    include: {
      items: {
        where: { isCancelled: false },
        include: {
          product: {
            select: {
              id: true,
              name: true,
              unit: true,
              saleType: true,
              // §281: משקל קרטון — לסיכום המשקל בכותרת המוצר
              avgWeightPerUnit: true,
              category: { select: { name: true } },
            },
          },
        },
      },
      customer: { select: { name: true, lastName: true } },
      point: { select: { id: true, name: true, city: true } },
    },
  });

  // ─── קיבוץ: נקודה → מוצר → לקוחות ───
  type Line = {
    orderNumber: number;
    customerName: string;
    qty: number;
    unitLabel: string;
    isLate: boolean;
  };
  type ProdGroup = {
    productName: string;
    mark: string;
    lines: Line[];
    totalCartons: number;
    totalSingles: number;
    unitLabel: string;
    /** §281: משקל משוער כולל — קרטונים × משקל קרטון + בודדים */
    estWeight: number;
    /** §284: PACKAGE = קרטון · UNIT/WEIGHT = יחידות */
    isCartonProduct: boolean;
  };

  const byPoint = new Map<
    string,
    { name: string; products: Map<string, ProdGroup> }
  >();

  const closeDate = pricelist.closeDate ? new Date(pricelist.closeDate) : null;

  for (const o of orders) {
    const pid = o.pointId || "none";
    const pname = o.point
      ? `${o.point.name}${o.point.city ? ` — ${o.point.city}` : ""}`
      : "ללא נקודה";
    if (!byPoint.has(pid))
      byPoint.set(pid, { name: pname, products: new Map() });
    const grp = byPoint.get(pid)!;

    const isLate = !!closeDate && new Date(o.createdAt) > closeDate;

    for (const it of o.items) {
      const key = it.productId || it.productName;
      const pName = it.product?.name || it.productName;
      if (!grp.products.has(key)) {
        grp.products.set(key, {
          productName: pName,
          mark: categoryMark(it.product?.category?.name),
          lines: [],
          totalCartons: 0,
          totalSingles: 0,
          estWeight: 0,
          isCartonProduct:
            (it.product?.saleType ?? (it as any).saleType) === "PACKAGE",
          unitLabel: it.product?.unit || "יח׳",
        });
      }
      const pg = grp.products.get(key)!;
      const qty = Number(it.quantity);

      // ⚠️ קרטונים ובודדים נספרים בנפרד: "20" בלי הבחנה יכול
      // להיות 20 קרטונים או 20 ק"ג, וזה הבדל של פי עשרה.
      if (it.isSingle) {
        pg.totalSingles += qty;
        // ⚠️ בודדים **הם** ק"ג (§274), ולכן הכמות היא המשקל.
        pg.estWeight += qty;
      } else {
        pg.totalCartons += qty;
        // ⚠️ קרטון × משקל משוער — **רק למוצרי PACKAGE**.
        //
        // §284: avgWeightPerUnit הוא משקל **קרטון** (§276).
        // הכפלה שלו בכמות יחידות של נקניק הייתה נותנת מספר
        // חסר משמעות - 10 נקניקים × 12 ק"ג = 120 ק"ג.
        const isPkg =
          (it.product?.saleType ?? (it as any).saleType) === "PACKAGE";
        const avg = Number((it.product as any)?.avgWeightPerUnit ?? 0);
        if (isPkg && avg > 0) pg.estWeight += qty * avg;
      }

      pg.lines.push({
        orderNumber: o.orderNumber,
        // ⚠️ השם הנוכחי ולא ה-snapshot: המנהל תיקן שמות (§192).
        customerName: o.customer?.name || o.customerName,
        qty,
        // §284: 🐛 כל מה שאינו "בודדים" נקרא "קרטון" — גם נקניק.
        //
        // מוצר UNIT (נקניק, כבד ארוז) נמכר ביחידות, לא בקרטונים.
        // הנציג קרא "10 קרטון נקניק" וחיפש קרטונים שלא קיימים.
        //
        // ⚠️ אותה הבחנה של §233: saleType === "PACKAGE" הוא
        // הקרטון. השאר יחידות.
        unitLabel: it.isSingle
          ? it.product?.unit === "יחידה"
            ? "יח׳"
            : 'ק"ג'
          : (it.product?.saleType ?? (it as any).saleType) === "PACKAGE"
            ? "קרטון"
            : "יח׳",
        isLate,
      });
    }
  }

  // ─── בניית הקובץ ───
  const wb = new ExcelJS.Workbook();
  wb.creator = "צדקת רבותינו";
  wb.created = new Date();

  const now = new Date().toLocaleString("he-IL", {
    timeZone: "Asia/Jerusalem",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });

  const saleTitle =
    pricelist.name +
    (pricelist.deliveryDateText ? ` · ${pricelist.deliveryDateText}` : "");

  for (const [, grp] of byPoint) {
    // ⚠️ אקסל אוסר : \ / ? * [ ] ומגביל ל-31 תווים
    const safe = grp.name.replace(/[:\\/?*[\]]/g, "-").slice(0, 31) || "נקודה";
    const ws = wb.addWorksheet(safe, {
      views: [{ rightToLeft: true, state: "frozen", ySplit: 3 }],
      pageSetup: {
        paperSize: 9,
        orientation: "portrait",
        fitToPage: true,
        fitToWidth: 1,
        fitToHeight: 0,
        margins: {
          left: 0.3,
          right: 0.3,
          top: 0.4,
          bottom: 0.4,
          header: 0.2,
          footer: 0.2,
        },
      },
    });

    // ─── כותרת ───
    // ⚠️ שם הנקודה **ראשון וגדול**: הנציג מקבל ערימת דפים ביום
    // החלוקה, וצריך לדעת במבט אחד איזה דף שלו.
    ws.mergeCells(1, 1, 1, 4);
    const t = ws.getCell(1, 1);
    t.value = `📦 דף מיון — ${grp.name}`;
    t.font = { size: 15, bold: true, color: { argb: "FFFFFFFF" } };
    t.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1D4ED8" } };
    t.alignment = { horizontal: "center", vertical: "middle" };
    ws.getRow(1).height = 24;

    ws.mergeCells(2, 1, 2, 4);
    const sub = ws.getCell(2, 1);
    sub.value = `${saleTitle} · הודפס ${now}`;
    sub.font = { size: 10, color: { argb: "FF444444" } };
    sub.alignment = { horizontal: "center" };

    ws.mergeCells(3, 1, 3, 4);
    const legend = ws.getCell(3, 1);
    // ⚠️ ההסבר קצר בכוונה: דף שצריך לקרוא אותו לא נקרא ביום
    // חלוקה. שתי שורות זה הגבול.
    legend.value =
      "סמן ☐ בכל מסירה. מה שנשאר לא מסומן בסוף — זה מה שנותר ולמי.   ${CATEGORY_LEGEND} · ⭐ נוסף אחרי הסגירה";
    legend.font = { size: 9, italic: true, color: { argb: "FF1D4ED8" } };
    legend.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FFDBEAFE" },
    };
    legend.alignment = { horizontal: "center", wrapText: true };
    ws.getRow(3).height = 26;

    // ─── המוצרים ───
    // ⚠️ ממוין לפי שם: הנציג מחפש "שניצל" ועובר על הדף לפי
    // אלפבית, לא לפי סדר אקראי.
    const products = Array.from(grp.products.values()).sort((a, b) =>
      a.productName.localeCompare(b.productName, "he")
    );

    let r = 5;
    for (const pg of products) {
      // ── כותרת המוצר עם הסכום ──
      ws.mergeCells(r, 1, r, 4);
      const h = ws.getCell(r, 1);
      // ⚠️ הסכום **בכותרת**: זה מה שהופך את הדף מרשימה לכלי
      // בקרה. הנציג סופר 18 ורואה 20 - וידע שחסרים שניים לפני
      // שהלקוח האחרון מגיע.
      const totals: string[] = [];
      // §284: התווית לפי סוג המוצר, לא "קרטונים" תמיד.
      if (pg.totalCartons > 0)
        totals.push(
          `${pg.totalCartons} ${pg.isCartonProduct ? "קרטונים" : "יחידות"}`
        );
      if (pg.totalSingles > 0)
        totals.push(`${Math.round(pg.totalSingles * 10) / 10} בודדים`);

      // §281: משקל משוער כולל — לבקרה מול תעודת הספק.
      //
      // ⚠️ רק כשיש נתון: avgWeightPerUnit לא ממולא בכל מוצר,
      // וניחוש היה גרוע מחוסר.
      if (pg.estWeight > 0) {
        totals.push(`≈${Math.round(pg.estWeight)} ק"ג`);
      }

      // §281: 🐛 "טופל: 18/20" — **לא ניתן לחשב על נייר.**
      //
      // הבקשה הייתה להציג מונה טופל, אבל הסימון נעשה **בעט על
      // הדף המודפס** - המערכת לא יודעת מה סומן.
      //
      // ⚠️ הפתרון: משבצות ריקות שהנציג ממלא בעצמו. הוא סופר
      // ורושם, וזה בדיוק אותה תועלת בלי להבטיח מספר שאי אפשר
      // לדעת.
      //
      // ⚠️ מספר שגוי גרוע ממשבצת ריקה: נציג שרואה "טופל 18/20"
      // מהמערכת ובפועל טיפל ב-20 - מפסיק לבטוח בדף.
      const doneBox = `   טופל: ____ / ${pg.totalCartons || Math.round(pg.totalSingles)}`;

      h.value = `${pg.mark ? pg.mark + "  " : ""}${pg.productName}   ←   ${totals.join(" · ") || "—"}${doneBox}`;
      h.font = { size: 13, bold: true, color: { argb: "FF1F2937" } };
      h.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FFE5E7EB" },
      };
      h.alignment = { horizontal: "right", vertical: "middle", indent: 1 };
      h.border = { bottom: { style: "medium" } };
      ws.getRow(r).height = 24;
      r++;

      // ── השורות ──
      // ⚠️ ממוין לפי מספר הזמנה: הנציג שמצא חבילה ומחפש לפי
      // המספר שעל הדף השני מוצא אותה מיד.
      const lines = [...pg.lines].sort(
        (a, b) => a.orderNumber - b.orderNumber
      );

      for (const ln of lines) {
        // ⚠️ המשבצת ראשונה ורחבה: היא הפעולה, לא קישוט. סימון
        // בעט ביד עם כפפות דורש מקום.
        const box = ws.getCell(r, 1);
        box.value = "☐";
        box.font = { size: 16 };
        box.alignment = { horizontal: "center", vertical: "middle" };

        const num = ws.getCell(r, 2);
        num.value = `${ln.isLate ? "⭐" : ""}#${ln.orderNumber}`;
        num.font = {
          size: 11,
          bold: true,
          color: { argb: ln.isLate ? "FFB91C1C" : "FF6B7280" },
        };
        num.alignment = { horizontal: "center", vertical: "middle" };

        const nm = ws.getCell(r, 3);
        nm.value = ln.customerName;
        nm.font = {
          size: 11,
          bold: true,
          color: { argb: ln.isLate ? "FFB91C1C" : "FF111827" },
        };
        nm.alignment = { horizontal: "right", vertical: "middle" };

        const q = ws.getCell(r, 4);
        q.value = `${Math.round(ln.qty * 10) / 10} ${ln.unitLabel}`;
        q.font = { size: 12, bold: true };
        q.alignment = { horizontal: "center", vertical: "middle" };

        // §285: פסי רקע לסירוגין — כמו בדף החלוקה.
        //
        // ⚠️ F0F0F0 (94% לבן): נראה במדפסת רגילה, לא מבזבז טונר,
        // והטקסט נשאר חד. FAFAFA שהיה קודם פשוט נעלם בהדפסה.
        //
        // ⚠️ כאן הפס מפריד בין **לקוחות באותו מוצר** - הנציג
        // עובר שורה-שורה ומסמן, וקו רציף מונע דילוג.
        const rowStripe = (r - 5) % 2 === 1;
        for (let c = 1; c <= 4; c++) {
          const cc = ws.getCell(r, c);
          cc.fill = {
            type: "pattern",
            pattern: "solid",
            fgColor: { argb: rowStripe ? "FFF0F0F0" : "FFFFFFFF" },
          };
          cc.border = {
            bottom: { style: "thin", color: { argb: "FFD1D5DB" } },
          };
        }
        ws.getRow(r).height = 22;
        r++;
      }

      // ⚠️ שורה ריקה בין מוצרים: בלעדיה הדף הופך לקיר טקסט.
      r++;
    }

    if (products.length === 0) {
      ws.getCell(5, 1).value = "אין הזמנות בנקודה זו";
      ws.getCell(5, 1).font = { size: 12, italic: true };
    }

    ws.getColumn(1).width = 6;
    ws.getColumn(2).width = 10;
    ws.getColumn(3).width = 30;
    ws.getColumn(4).width = 14;
  }

  if (byPoint.size === 0) {
    const ws = wb.addWorksheet("אין הזמנות", {
      views: [{ rightToLeft: true }],
    });
    ws.getCell(1, 1).value = "אין הזמנות במכירה זו";
    ws.getCell(1, 1).font = { size: 14, bold: true };
  }

  const buf = await wb.xlsx.writeBuffer();
  const fname = `דף-מיון-${pricelist.name}.xlsx`;
  return new NextResponse(Buffer.from(buf) as any, {
    status: 200,
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(fname)}`,
    },
  });
}
