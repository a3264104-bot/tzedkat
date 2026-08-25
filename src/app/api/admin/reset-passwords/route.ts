// ═══════════════════════════════════════════════════════════════
// §226: איפוס סיסמאות ללקוחות תקועים
// ═══════════════════════════════════════════════════════════════
// GET  /api/admin/reset-passwords        — מי תקוע (בלי לשנות כלום)
// POST /api/admin/reset-passwords        — מאפס ומחזיר אקסל
//
// 🐛 המצב שיצר את זה (§225): הסיסמה נשמרה מוצפנת בלבד, ולכן
// לקוח שלא זכר אותה — ואין לו מייל או קוד כניסה — נשאר מחוץ
// למערכת, והמנהל לא יכול היה לעזור.
//
// 36 לקוחות במצב הזה. איפוס ידני של כל אחד דרך המסך הוא 36
// פעמים חמש קליקים, וזה בדיוק מה שלא קורה בפועל.
//
// ⚠️ **רק מי שבאמת תקוע**: יש סיסמה מוצפנת, אין גרסה גלויה,
// אין קוד כניסה, ואין מייל לאיפוס עצמי. מי שיש לו מייל יכול
// "שכחתי סיסמה" בעצמו, ואיפוס שלו רק ינתק אותו מהסיסמה שהוא
// אולי כן זוכר.

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/guard";
import bcrypt from "bcryptjs";
import ExcelJS from "exceljs";
import crypto from "crypto";

/**
 * §226: סיסמה **קריאה בטלפון**.
 *
 * ⚠️ המחולל הקיים במערכת מחזיר base64 (24 בייטים), שמכיל
 * `/`, `+` ו-`=`. המנהל צריך להקריא את זה בטלפון ללקוח -
 * ו"סלאש" ו"פלוס" הם מתכון לטעויות.
 *
 * ⚠️ **בלי תווים דו-משמעיים**: O/0, I/l/1. הם נשמעים זהה
 * בהקראה, והלקוח ינסה להיכנס עם התו הלא נכון.
 *
 * ⚠️ 8 תווים מהאלפבית הזה = ~30 ביט. מספיק מול נעילה אחרי
 * 5 ניסיונות, וקצר מספיק להקראה.
 */
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

function generateStrongPassword(): string {
  const bytes = crypto.randomBytes(8);
  let out = "";
  for (let i = 0; i < 8; i++) {
    out += ALPHABET[bytes[i] % ALPHABET.length];
  }
  return out;
}

/**
 * §226: התנאי ל"תקוע".
 *
 * ⚠️ מוגדר פעם אחת ומשמש גם ב-GET וגם ב-POST. שתי הגדרות
 * מקבילות היו מתפצלות, והמנהל היה מאפס קבוצה אחרת ממה שראה.
 */
const STUCK_WHERE = {
  isActive: true,
  // §270: 🐛 `{ not: null }` אינו חוקי ב-Prisma.
  //
  // המנוע מצפה לערך, לא ל-null - השגיאה היא
  // "Argument `not` must not be null".
  //
  // ⚠️ הצורה הנכונה: `{ not: "" }` על שדה nullable מסנן גם
  // NULL וגם מחרוזת ריקה, וזה בדיוק מה שרצינו.
  passwordHash: { not: "" },
  passwordPlain: null,
  loginCode: null,
  OR: [{ email: null }, { email: "" }],
} as const;

export async function GET() {
  const g = await requireAdmin();
  if (!g.ok) return g.res;

  const rows = await prisma.customer.findMany({
    where: STUCK_WHERE as any,
    select: { id: true, name: true, phone: true, role: true },
    orderBy: [{ role: "asc" }, { name: "asc" }],
  });

  return NextResponse.json({
    count: rows.length,
    // ⚠️ פילוח לפי תפקיד: נציג תקוע הוא בעיה תפעולית מיידית,
    // לקוח תקוע יתגלה כשהוא ינסה להזמין.
    byRole: rows.reduce<Record<string, number>>((acc, r) => {
      acc[r.role] = (acc[r.role] ?? 0) + 1;
      return acc;
    }, {}),
    rows,
  });
}

export async function POST(req: Request) {
  const g = await requireAdmin();
  if (!g.ok) return g.res;

  const body = await req.json().catch(() => ({}));

  // ⚠️ אישור מפורש: הפעולה מנתקת לקוחות מהסיסמה הנוכחית שלהם.
  // מי שכן זכר אותה יגלה פתאום שהיא לא עובדת, ולכן זו לא פעולה
  // שמפעילים בלחיצה מקרית.
  if (body.confirm !== "RESET") {
    return NextResponse.json(
      { error: "נדרש אישור מפורש" },
      { status: 400 }
    );
  }

  const rows = await prisma.customer.findMany({
    where: STUCK_WHERE as any,
    select: { id: true, name: true, phone: true, role: true },
    orderBy: [{ role: "asc" }, { name: "asc" }],
  });

  if (rows.length === 0) {
    return NextResponse.json({ error: "אין לקוחות תקועים" }, { status: 400 });
  }

  // ─── האיפוס ───
  const results: Array<{ name: string; phone: string; pass: string; role: string }> =
    [];

  for (const c of rows) {
    const pass = generateStrongPassword();
    const hash = await bcrypt.hash(pass, 10);
    await prisma.customer.update({
      where: { id: c.id },
      data: {
        passwordHash: hash,
        // §225: **וגם** הגרסה הגלויה. זו כל מטרת התיקון.
        passwordPlain: pass,
        // ⚠️ שחרור נעילה: לקוח שניסה להיכנס וטעה כמה פעמים נעול,
        // ואיפוס בלי שחרור היה משאיר אותו חסום עם סיסמה חדשה.
        failedLoginAttempts: 0,
        lockedUntil: null,
      },
    });
    results.push({ name: c.name, phone: c.phone ?? "", pass, role: c.role });
  }

  console.log(
    `[reset-passwords] ADMIN ${g.session?.user?.email} reset ${results.length} passwords`
  );

  // ─── האקסל ───
  // ⚠️ קובץ ולא JSON: המנהל צריך להתקשר ללקוחות אחד־אחד ולמסור
  // להם את הסיסמה. רשימה במסך נעלמת ברענון.
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("סיסמאות", {
    views: [{ rightToLeft: true, state: "frozen", ySplit: 3 }],
  });

  ws.mergeCells("A1:D1");
  const t = ws.getCell("A1");
  t.value = "🔑 סיסמאות שאופסו";
  t.font = { size: 15, bold: true, color: { argb: "FFFFFFFF" } };
  t.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFB91C1C" } };
  t.alignment = { horizontal: "center", vertical: "middle" };
  ws.getRow(1).height = 24;

  ws.mergeCells("A2:D2");
  const sub = ws.getCell("A2");
  sub.value =
    `${results.length} לקוחות · ` +
    new Date().toLocaleString("he-IL", {
      timeZone: "Asia/Jerusalem",
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }) +
    " · ⚠️ קובץ רגיש — למסירה ללקוחות בלבד";
  sub.font = { size: 10, bold: true, color: { argb: "FF92400E" } };
  sub.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFEF3C7" } };
  sub.alignment = { horizontal: "center" };

  ["שם", "טלפון", "סיסמה חדשה", "תפקיד"].forEach((h, i) => {
    const c = ws.getCell(3, i + 1);
    c.value = h;
    c.font = { size: 11, bold: true };
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE4E4E7" } };
    c.alignment = { horizontal: "center" };
  });

  let r = 4;
  for (const x of results) {
    ws.getCell(r, 1).value = x.name;
    ws.getCell(r, 2).value = x.phone;
    // ⚠️ Courier: הסיסמה מוקראת בטלפון, וגופן אחיד מונע בלבול
    // בין l ל-1 ובין O ל-0.
    const p = ws.getCell(r, 3);
    p.value = x.pass;
    p.font = { name: "Courier New", size: 12, bold: true };
    ws.getCell(r, 4).value =
      x.role === "AGENT" ? "נציג" : x.role === "ADMIN" ? "מנהל" : "לקוח";
    // ⚠️ נציג מודגש: הוא צריך את הסיסמה כדי לעבוד בחלוקה, ולא
    // כדי להזמין מתישהו.
    if (x.role !== "CUSTOMER") {
      for (let c = 1; c <= 4; c++) {
        ws.getCell(r, c).fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: "FFFEF3C7" },
        };
      }
    }
    r++;
  }

  ws.getColumn(1).width = 32;
  ws.getColumn(2).width = 15;
  ws.getColumn(3).width = 18;
  ws.getColumn(4).width = 10;

  const buf = await wb.xlsx.writeBuffer();
  return new NextResponse(Buffer.from(buf) as any, {
    status: 200,
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(
        "סיסמאות-שאופסו.xlsx"
      )}`,
    },
  });
}
