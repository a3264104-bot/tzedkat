// §62: ניהול קוד ההתחברות של לקוח - למנהל בלבד.
//
// POST /api/admin/customer-code
//   { customerId, action: "view" }              -> מחזיר את הקוד הפעיל
//   { customerId, action: "generate", length? } -> מייצר קוד חדש ומחזיר אותו
//   { customerId, action: "set", code }         -> קובע קוד ידני
//
// ═══════════════════════════════════════════════════════════════
// למה POST גם לצפייה
// ═══════════════════════════════════════════════════════════════
// GET נראה טבעי יותר, אבל לצפייה בקוד יש תופעת לוואי (רישום ביומן)
// והיא חושפת סוד. GET עם מזהה הלקוח ב-URL היה נשמר בהיסטוריית
// הדפדפן, בלוגים של Vercel ובכל proxy בדרך. POST משאיר את המזהה
// בגוף הבקשה ואינו נשמר במקומות האלה.
//
// ⚠️ הקוד עצמו לעולם לא נכתב ללוג ולא ל-meta של היומן. היומן מתעד
// ש*נצפה* קוד, לא מה הוא.

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/guard";
import { audit } from "@/lib/audit";
import {
  encryptCode,
  decryptCode,
  generateLoginCode,
  generateStrongPassword,
  validateLoginCode,
  isCodeKeyConfigured,
} from "@/lib/login-code";

export async function POST(req: Request) {
  const g = await requireAdmin();
  if (!g.ok) return g.res;

  // בלי המפתח אי אפשר להצפין ולא לפענח. ההודעה מפורשת כדי שלא
  // ייראה כמו תקלה אקראית - זו הגדרת סביבה חסרה.
  if (!isCodeKeyConfigured()) {
    return NextResponse.json(
      {
        error:
          "AUTH_CODE_KEY אינו מוגדר בסביבת ההרצה. יש להגדיר מפתח של 64 תווי hex לפני שימוש בקודי התחברות.",
        code: "NO_KEY",
      },
      { status: 500 }
    );
  }

  const actorId = (g.session!.user as any).id as string;
  const actorName = (g.session!.user as any).name as string | undefined;

  const body = await req.json().catch(() => ({}));
  const customerId = String(body.customerId || "").trim();
  const action = String(body.action || "").trim();

  if (!customerId) {
    return NextResponse.json({ error: "חסר מזהה לקוח" }, { status: 400 });
  }

  const customer = await prisma.customer.findUnique({
    where: { id: customerId },
    select: {
      id: true,
      name: true,
      phone: true,
      role: true,
      loginCode: true,
      loginCodeSetAt: true,
    },
  });
  if (!customer) {
    return NextResponse.json({ error: "לקוח לא נמצא" }, { status: 404 });
  }

  // ─────────────────────────────────────────────────────────
  // צפייה בקוד הפעיל
  // ─────────────────────────────────────────────────────────
  if (action === "view") {
    if (!customer.loginCode) {
      return NextResponse.json({
        ok: true,
        hasCode: false,
        message: "ללקוח עדיין אין קוד התחברות. ניתן לייצר לו קוד חדש.",
      });
    }

    const plain = decryptCode(customer.loginCode);
    if (plain === null) {
      // פענוח נכשל = המפתח שונה מאז שהקוד נשמר, או שהערך נפגם.
      // אין דרך לשחזר; היחיד שנשאר הוא לייצר קוד חדש.
      return NextResponse.json(
        {
          error:
            "לא ניתן לפענח את הקוד. ייתכן ש-AUTH_CODE_KEY הוחלף מאז שהקוד נשמר. יש לייצר קוד חדש ללקוח.",
          code: "DECRYPT_FAILED",
        },
        { status: 500 }
      );
    }

    await audit({
      actorId,
      actorRole: "ADMIN",
      actorName,
      action: "VIEW_CODE",
      targetId: customer.id,
      targetName: customer.name,
      req,
    });

    return NextResponse.json({
      ok: true,
      hasCode: true,
      loginCode: plain,
      loginCodeSetAt: customer.loginCodeSetAt,
    });
  }

  // ─────────────────────────────────────────────────────────
  // יצירת קוד חדש / קביעת קוד ידני
  // ─────────────────────────────────────────────────────────
  if (action === "generate" || action === "set") {
    let plain: string;

    if (action === "generate") {
      // §83: שני מצבים - קוד מספרי קצר ללקוח, סיסמה אלפאנומרית
      // ארוכה לבעלי הרשאות. הבחירה מגיעה מהמסך, אבל האורך מאומת
      // כאן: קליינט ישן או בקשה ישירה לא יקבעו סיסמה בת 3 תווים.
      if (body.strong) {
        const len = Number(body.length) || 14;
        if (len < 10 || len > 32) {
          return NextResponse.json(
            { error: "אורך סיסמה חזקה חייב להיות בין 10 ל-32 תווים" },
            { status: 400 }
          );
        }
        plain = generateStrongPassword(len);
      } else {
        const length = Number(body.length) || 6;
        if (![4, 5, 6].includes(length)) {
          return NextResponse.json(
            { error: "אורך קוד חייב להיות 4, 5 או 6 ספרות" },
            { status: 400 }
          );
        }
        plain = generateLoginCode(length);
      }
    } else {
      plain = String(body.code || "").trim();
      const check = validateLoginCode(plain);
      if (!check.ok) {
        return NextResponse.json({ error: check.error }, { status: 400 });
      }
    }

    await prisma.customer.update({
      where: { id: customerId },
      data: {
        loginCode: encryptCode(plain),
        loginCodeSetAt: new Date(),
        // קוד חדש מנקה נעילה קיימת - הלקוח שהתקשר כי לא הצליח
        // להיכנס לא אמור להישאר נעול אחרי שקיבל קוד תקין.
        failedLoginAttempts: 0,
        lockedUntil: null,
        // §62: הסיסמה הישנה מבוטלת. שמירת שתי דרכי כניסה במקביל
        // הייתה משאירה פתח שהמנהל לא רואה ולא יכול לנהל.
        passwordPlain: null,
      },
    });

    await audit({
      actorId,
      actorRole: "ADMIN",
      actorName,
      action: "SET_CODE",
      targetId: customer.id,
      targetName: customer.name,
      // ⚠️ בלי הקוד. רק העובדה שנקבע ובאיזה אורך.
      // ⚠️ בלי הקוד. רק העובדה שנקבע, אורכו, וסוגו.
      meta: {
        method: action,
        length: plain.length,
        kind: /^\d+$/.test(plain) ? "numeric" : "alphanumeric",
      },
      req,
    });

    console.log(
      `[customer-code] ADMIN ${actorId} set login code for customer=${customerId} (${action})`
    );

    return NextResponse.json({ ok: true, loginCode: plain });
  }

  return NextResponse.json({ error: "פעולה לא מוכרת" }, { status: 400 });
}
