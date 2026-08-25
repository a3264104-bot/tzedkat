// ═══════════════════════════════════════════════════════════════
// §257: ייצוא בקשות הרשמה מהטלפון לאקסל
// ═══════════════════════════════════════════════════════════════
// GET /api/admin/phone-signups/export?status=OPEN
//
// המצב: לקוחות נרשמים ב-IVR, ונציג צריך לחזור אליהם להשלמת
// פרטי אשראי. הרשימה קיימת במסך - אבל הנציג בשטח לא יושב מול
// מחשב, והמנהל צריך להעביר לו רשימה שאפשר להתקשר לפיה.
//
// ⚠️ מקובץ לפי **נקודת חלוקה**: כל נציג אחראי לנקודות שלו,
// ורשימה מעורבבת מחייבת אותו לסנן ידנית 40 שורות כדי למצוא 5.
//
// ⚠️ גיליון לכל נקודה ולא עמודה: אפשר לשלוח לנציג את הגיליון
// שלו בלבד, בלי שיראה לקוחות של אחרים.

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/guard";
import ExcelJS from "exceljs";

/** תוויות הסטטוסים - זהות למסך, כדי שלא יהיו שתי שפות */
const STATUS_LABELS: Record<string, string> = {
  NEW: "חדש",
  ASSIGNED: "שויך לנציג",
  CONTACTED: "נוצר קשר",
  COMPLETED: "הושלם",
  FAILED: "נדחה / לא הושלם",
};

export async function GET(req: Request) {
  const g = await requireAdmin();
  if (!g.ok) return g.res;

  const { searchParams } = new URL(req.url);
  // ⚠️ ברירת מחדל: **רק הפתוחים**. זו כל מטרת הרשימה - מי שעוד
  // צריך שיחזרו אליו. מי שהושלם כבר לקוח.
  const scope = searchParams.get("status") || "OPEN";

  const where =
    scope === "ALL"
      ? {}
      : scope === "OPEN"
        ? { status: { notIn: ["COMPLETED", "FAILED"] } }
        : { status: scope };

  const rows = await prisma.phoneSignupRequest.findMany({
    where,
    orderBy: [{ createdAt: "asc" }],
    include: {
      point: { select: { name: true, city: true } },
      customer: {
        select: {
          name: true,
          firstName: true,
          lastName: true,
          phone: true,
          phone2: true,
          email: true,
          // ⚠️ מצב הכרטיס: הנציג צריך לדעת אם הלקוח כבר הסתדר
          // בינתיים - אין טעם להתקשר למי שכבר הזין כרטיס באתר.
          paymentToken: true,
          paymentPreference: true,
        },
      },
    },
  });

  // ⚠️ שמות הנציגים: assignedAgentId הוא מזהה, והנציג בשטח
  // צריך לראות שם. שליפה אחת במקום N.
  const agentIds = Array.from(
    new Set(rows.map((r) => r.assignedAgentId).filter(Boolean) as string[])
  );
  const agentMap = new Map<string, string>();
  if (agentIds.length > 0) {
    const agents = await prisma.customer.findMany({
      where: { id: { in: agentIds } },
      select: { id: true, name: true },
    });
    for (const a of agents) agentMap.set(a.id, a.name);
  }

  // ─── קיבוץ לפי נקודה ───
  const byPoint = new Map<string, { name: string; rows: typeof rows }>();
  for (const r of rows) {
    const key = r.pointId || "none";
    const name = r.point
      ? `${r.point.name}${r.point.city ? ` — ${r.point.city}` : ""}`
      : "ללא נקודה";
    if (!byPoint.has(key)) byPoint.set(key, { name, rows: [] });
    byPoint.get(key)!.rows.push(r);
  }

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

  // ─── גיליון ריכוז ───
  // ⚠️ ראשון: המנהל רוצה לראות כמה יש בכל נקודה לפני שהוא מחליט
  // למי לשלוח מה.
  const sum = wb.addWorksheet("ריכוז", {
    views: [{ rightToLeft: true, state: "frozen", ySplit: 3 }],
  });
  banner(sum, 3, "📞 בקשות הרשמה מהטלפון", `${rows.length} ממתינים · ${now}`);
  headerRow(sum, ["נקודת חלוקה", "ממתינים", "נציג משויך"], 3);

  let sr = 4;
  for (const [, grp] of byPoint) {
    sum.getCell(sr, 1).value = grp.name;
    sum.getCell(sr, 2).value = grp.rows.length;
    // ⚠️ כל הנציגים שמשויכים לבקשות בנקודה - לרוב אחד, אבל
    // אם יש כמה, המנהל צריך לדעת.
    const agents = Array.from(
      new Set(
        grp.rows
          .map((r) => (r.assignedAgentId ? agentMap.get(r.assignedAgentId) : null))
          .filter(Boolean) as string[]
      )
    );
    sum.getCell(sr, 3).value = agents.length > 0 ? agents.join(", ") : "—";
    sum.getCell(sr, 2).font = { bold: true, size: 12 };
    sum.getCell(sr, 2).alignment = { horizontal: "center" };
    sr++;
  }
  sum.getColumn(1).width = 38;
  sum.getColumn(2).width = 12;
  sum.getColumn(3).width = 24;

  // ─── גיליון לכל נקודה ───
  for (const [, grp] of byPoint) {
    // ⚠️ אקסל אוסר : \ / ? * [ ] ומגביל ל-31 תווים
    const safe =
      grp.name.replace(/[:\\/?*[\]]/g, "-").slice(0, 31) || "נקודה";
    const ws = wb.addWorksheet(safe, {
      views: [{ rightToLeft: true, state: "frozen", ySplit: 4 }],
      pageSetup: { paperSize: 9, orientation: "landscape", fitToPage: true },
    });

    banner(ws, 8, `📞 ${grp.name}`, `${grp.rows.length} ממתינים לחזרה · ${now}`);
    headerRow(
      ws,
      [
        "שם",
        "טלפון",
        "טלפון נוסף",
        "סטטוס",
        "נציג",
        "נרשם",
        "מצב תשלום",
        "הערה",
      ],
      4
    );

    let r = 5;
    for (const row of grp.rows) {
      const c = row.customer;
      // ⚠️ השם הנוכחי ולא ה-snapshot: המנהל תיקן שמות (§173),
      // וה-snapshot נשאר עם "לקוח טלפוני".
      ws.getCell(r, 1).value = c?.name || row.customerName || "—";
      ws.getCell(r, 2).value = c?.phone || row.phone || "";
      ws.getCell(r, 3).value = c?.phone2 || "";
      ws.getCell(r, 4).value = STATUS_LABELS[row.status] ?? row.status;
      ws.getCell(r, 5).value = row.assignedAgentId
        ? (agentMap.get(row.assignedAgentId) ?? "—")
        : "—";
      ws.getCell(r, 6).value = row.createdAt.toLocaleString("he-IL", {
        timeZone: "Asia/Jerusalem",
        day: "2-digit",
        month: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      });

      // ⚠️ מצב התשלום חוסך שיחות: לקוח שהזין כרטיס בינתיים או
      // סומן כמזומן כבר לא צריך שיחזרו אליו.
      const hasCard = !!c?.paymentToken;
      const isCash = c?.paymentPreference === "CASH";
      const payCell = ws.getCell(r, 7);
      payCell.value = isCash
        ? "✓ מזומן"
        : hasCard
          ? "✓ יש כרטיס"
          : "✗ ממתין לכרטיס";
      payCell.font = {
        size: 10,
        bold: !hasCard && !isCash,
        color: { argb: hasCard || isCash ? "FF15803D" : "FFB91C1C" },
      };

      ws.getCell(r, 8).value = row.note || "";

      for (let col = 1; col <= 8; col++) {
        const cell = ws.getCell(r, col);
        if (col !== 7) cell.font = { size: 10 };
        cell.alignment = {
          horizontal: col === 1 || col === 8 ? "right" : "center",
          vertical: "middle",
          wrapText: col === 8,
        };
        cell.border = {
          top: { style: "thin", color: { argb: "FFE4E4E7" } },
          bottom: { style: "thin", color: { argb: "FFE4E4E7" } },
          left: { style: "thin", color: { argb: "FFE4E4E7" } },
          right: { style: "thin", color: { argb: "FFE4E4E7" } },
        };
      }
      // ⚠️ פס לסירוגין: 40 שורות טלפונים בלי הבחנה קשות לסריקה.
      if ((r - 5) % 2 === 1) {
        for (let col = 1; col <= 8; col++) {
          if (col === 7) continue;
          ws.getCell(r, col).fill = {
            type: "pattern",
            pattern: "solid",
            fgColor: { argb: "FFFAFAFA" },
          };
        }
      }
      r++;
    }

    ws.getColumn(1).width = 26;
    ws.getColumn(2).width = 15;
    ws.getColumn(3).width = 15;
    ws.getColumn(4).width = 16;
    ws.getColumn(5).width = 20;
    ws.getColumn(6).width = 14;
    ws.getColumn(7).width = 16;
    ws.getColumn(8).width = 30;
  }

  if (byPoint.size === 0) {
    const ws = wb.addWorksheet("אין ממתינים", {
      views: [{ rightToLeft: true }],
    });
    ws.getCell(1, 1).value = "אין בקשות הרשמה ממתינות ✓";
    ws.getCell(1, 1).font = { size: 14, bold: true };
  }

  const buf = await wb.xlsx.writeBuffer();
  const fname = `בקשות-הרשמה-${now.replace(/[:/]/g, "-")}.xlsx`;
  return new NextResponse(Buffer.from(buf) as any, {
    status: 200,
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(fname)}`,
    },
  });
}

function banner(
  ws: ExcelJS.Worksheet,
  cols: number,
  title: string,
  sub: string
) {
  ws.mergeCells(1, 1, 1, cols);
  const t = ws.getCell(1, 1);
  t.value = title;
  t.font = { size: 15, bold: true, color: { argb: "FFFFFFFF" } };
  t.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFC0461E" } };
  t.alignment = { horizontal: "center", vertical: "middle" };
  ws.getRow(1).height = 24;

  ws.mergeCells(2, 1, 2, cols);
  const s = ws.getCell(2, 1);
  s.value = sub;
  s.font = { size: 10, color: { argb: "FF666666" } };
  s.alignment = { horizontal: "center" };
}

function headerRow(ws: ExcelJS.Worksheet, head: string[], row: number) {
  head.forEach((h, i) => {
    const c = ws.getCell(row, i + 1);
    c.value = h;
    c.font = { size: 11, bold: true };
    c.alignment = { horizontal: "center", vertical: "middle" };
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE4E4E7" } };
    c.border = { bottom: { style: "medium" } };
  });
  ws.getRow(row).height = 24;
}
