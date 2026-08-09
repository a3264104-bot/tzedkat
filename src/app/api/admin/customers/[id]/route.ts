// PATCH /api/admin/customers/[id]
// עדכון פרטי לקוח + הרשאות נציג
//
// שדות נתמכים:
//   - name, email, phone (נתונים בסיסיים)
//   - passwordPlain (סיסמה גלויה למנהל, המנהל יכול לאפס)
//   - agentPointId (נקודת חלוקה משויכת - רק לנציג)
//   - agentCanSetFinalPrice, agentCanSendPaymentLink, agentCanCharge, agentCanUpdateCards (הרשאות נציג)
//   - cardNeedsUpdate (סימון שנדרש עדכון כרטיס)

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/guard";
import { auth } from "@/lib/auth";
import bcrypt from "bcryptjs";

const ALLOWED_FIELDS = [
  "name",
  "email",
  "phone",
  "notes",
  "agentPointId",
  "agentCanSetFinalPrice",
  "agentCanSendPaymentLink",
  "agentCanCharge",
  "agentCanUpdateCards",
  "cardNeedsUpdate",
] as const;

// §24: נציג עם הרשאת agentCanResetPassword יכול לאפס סיסמה ללקוח -
// ורק את זה. הצורך: לקוח שנרשם בטלפון מקבל סיסמה אקראית שאיש לא יודע,
// ולרוב אין לו מייל, כך ש"שכחתי סיסמה" לא עוזר. הנציג ממילא מדבר איתו
// כדי לעדכן כרטיס, ובאותה שיחה יכול למסור סיסמה.
//
// ההגבלות: רק passwordPlain (לא שם/טלפון/הרשאות), ורק ללקוח בנקודות
// של הנציג. כל שדה אחר בבקשה נדחה.
async function resolveActor(body: any) {
  const admin = await requireAdmin();
  if (admin.ok) return { ok: true as const, isAdmin: true, agentId: null as string | null };

  const session = await auth();
  const role = (session?.user as any)?.role;
  const userId = (session?.user as any)?.id as string | undefined;
  if (!session?.user || role !== "AGENT" || !userId) {
    return { ok: false as const, res: admin.res };
  }

  const agent = await prisma.customer.findUnique({
    where: { id: userId },
    select: { agentCanResetPassword: true },
  });
  if (!agent?.agentCanResetPassword) {
    return { ok: false as const, res: admin.res };
  }

  // הנציג רשאי *רק* לאפס סיסמה. אם הבקשה מכילה שדה אחר - נדחית.
  const keys = Object.keys(body).filter((k) => k !== "passwordPlain");
  if (keys.length > 0 || !body.passwordPlain) {
    return {
      ok: false as const,
      res: NextResponse.json(
        { error: "נציג רשאי לאפס סיסמה בלבד" },
        { status: 403 }
      ),
    };
  }

  return { ok: true as const, isAdmin: false, agentId: userId };
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await req.json().catch(() => ({}));

  const actor = await resolveActor(body);
  if (!actor.ok) return actor.res;

  // נציג - מוודאים שהלקוח שייך לאחת מנקודותיו
  if (!actor.isAdmin && actor.agentId) {
    const agent = await prisma.customer.findUnique({
      where: { id: actor.agentId },
      select: {
        agentPointId: true,
        agentPoints: { select: { pointId: true } },
      },
    });
    const pointIds =
      agent && agent.agentPoints.length > 0
        ? agent.agentPoints.map((ap) => ap.pointId)
        : agent?.agentPointId
          ? [agent.agentPointId]
          : [];
    if (pointIds.length > 0) {
      const target = await prisma.customer.findUnique({
        where: { id },
        select: { defaultPointId: true },
      });
      const belongs =
        (target?.defaultPointId != null && pointIds.includes(target.defaultPointId)) ||
        (await prisma.order.count({
          where: { customerId: id, pointId: { in: pointIds } },
        })) > 0;
      if (!belongs) {
        return NextResponse.json(
          { error: "אין הרשאה - הלקוח אינו משויך לנקודות שלך" },
          { status: 403 }
        );
      }
    }
  }

  const data: any = {};

  // שדות רגילים
  for (const field of ALLOWED_FIELDS) {
    if (field in body) {
      data[field] = body[field];
    }
  }

  // איפוס סיסמה - passwordPlain עם ערך אמיתי
  if ("passwordPlain" in body && body.passwordPlain) {
    const plain = String(body.passwordPlain).trim();
    if (plain.length < 6) {
      return NextResponse.json(
        { error: "סיסמה חייבת להיות באורך 6 תווים לפחות" },
        { status: 400 }
      );
    }
    data.passwordPlain = plain;
    data.passwordHash = await bcrypt.hash(plain, 10);
    // אם המנהל מאפס, אנחנו סוגרים גם reset token אם היה
    data.resetToken = null;
    data.resetTokenExpiry = null;
  }

  // אימות מייל אם עודכן
  if ("email" in body && body.email) {
    const email = String(body.email).toLowerCase().trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return NextResponse.json({ error: "מייל לא תקין" }, { status: 400 });
    }
    // בדיקת כפילות
    const existing = await prisma.customer.findUnique({ where: { email } });
    if (existing && existing.id !== id) {
      return NextResponse.json(
        { error: "המייל כבר בשימוש ע\"י לקוח אחר" },
        { status: 409 }
      );
    }
    data.email = email;
  }

  // אימות טלפון אם עודכן
  if ("phone" in body && body.phone) {
    const digits = String(body.phone).replace(/\D/g, "");
    const phone = digits.startsWith("972") ? "0" + digits.slice(3) : digits;
    if (phone.length < 9 || phone.length > 10) {
      return NextResponse.json({ error: "מספר טלפון לא תקין" }, { status: 400 });
    }
    const existing = await prisma.customer.findUnique({ where: { phone } });
    if (existing && existing.id !== id) {
      return NextResponse.json(
        { error: "הטלפון כבר בשימוש ע\"י לקוח אחר" },
        { status: 409 }
      );
    }
    data.phone = phone;
  }

  // 🆕 טיפול מיוחד ב-agentPointIds (many-to-many)
  // הclient שולח מערך של pointIds. אנחנו מוחקים את כל הקשרים הקיימים
  // של הנציג ויוצרים מחדש. כך גם הוספה וגם הסרה מטופלות באותה הפעולה.
  // זה מבוצע בטרנזקציה - אם משהו נכשל, אין שינוי חלקי.
  let agentPointIds: string[] | null = null;
  if ("agentPointIds" in body) {
    if (!Array.isArray(body.agentPointIds)) {
      return NextResponse.json(
        { error: "agentPointIds חייב להיות מערך" },
        { status: 400 }
      );
    }
    // דה-דופלוקציה + סינון strings בלבד
    agentPointIds = Array.from(
      new Set(
        body.agentPointIds
          .filter((x: unknown) => typeof x === "string" && x.trim().length > 0)
          .map((x: string) => x.trim())
      )
    );
  }

  if (Object.keys(data).length === 0 && agentPointIds === null) {
    return NextResponse.json({ error: "אין שדות לעדכון" }, { status: 400 });
  }

  try {
    // אם יש עדכון של רשימת נקודות - עושים בטרנזקציה
    if (agentPointIds !== null) {
      // וידוא שכל pointIds תקינים לפני מחיקה
      if (agentPointIds.length > 0) {
        const foundPoints = await prisma.deliveryPoint.findMany({
          where: { id: { in: agentPointIds } },
          select: { id: true },
        });
        if (foundPoints.length !== agentPointIds.length) {
          return NextResponse.json(
            { error: "אחת מנקודות החלוקה שצוינו לא קיימת" },
            { status: 400 }
          );
        }
      }
      const customer = await prisma.$transaction(async (tx) => {
        // מחיקת כל הקשרים הקיימים של הנציג
        await tx.agentPoint.deleteMany({ where: { agentId: id } });
        // יצירת הקשרים החדשים
        if (agentPointIds!.length > 0) {
          await tx.agentPoint.createMany({
            data: agentPointIds!.map((pid) => ({
              agentId: id,
              pointId: pid,
            })),
          });
        }
        // עדכון שאר השדות (אם יש)
        if (Object.keys(data).length > 0) {
          return tx.customer.update({ where: { id }, data });
        }
        return tx.customer.findUnique({ where: { id } });
      });
      return NextResponse.json({ ok: true, customer });
    }
    // עדכון רגיל (בלי שינוי נקודות)
    const customer = await prisma.customer.update({
      where: { id },
      data,
    });
    return NextResponse.json({ ok: true, customer });
  } catch (e: any) {
    console.error("customer update error:", e);
    return NextResponse.json({ error: e.message || "שגיאה" }, { status: 500 });
  }
}

// DELETE /api/admin/customers/[id]
// מחיקת לקוח (רק אם אין לו הזמנות)
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const g = await requireAdmin();
  if (!g.ok) return g.res;

  const { id } = await params;

  const orderCount = await prisma.order.count({ where: { customerId: id } });
  if (orderCount > 0) {
    return NextResponse.json(
      {
        error: `לא ניתן למחוק - יש ${orderCount} הזמנות ללקוח. ניתן להשבית במקום.`,
      },
      { status: 409 }
    );
  }

  await prisma.customer.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
