// §62: כניסה בשם משתמש (Login As).
//
// POST /api/admin/impersonate         Body: { targetId }  -> כרטיס כניסה
// POST /api/admin/impersonate/return  (action: "return")  -> כרטיס חזרה
//
// ═══════════════════════════════════════════════════════════════
// למה כרטיס ולא החלפת session ישירה
// ═══════════════════════════════════════════════════════════════
// ה-JWT של Auth.js נחתם רק בתוך ה-provider, ו-route רגיל לא יכול
// לכתוב אליו. אילו היינו מסמנים התחזות ב-cookie נפרד, הדפדפן היה
// יכול לזייף אותו ולהפוך כל לקוח למנהל.
//
// לכן: השרת מנפיק כרטיס חד-פעמי במסד (60 שניות), הקליינט פודה אותו
// מול provider ה-impersonate, וזהות המתחזה נכנסת ל-JWT החתום. שום
// ערך מהקליינט אינו נלקח כפשוטו.
//
// החזרה עובדת באותו מנגנון הפוך: כרטיס עם isReturn שמחזיר את המנהל
// לעצמו ומאפס את שדות ההתחזות ב-JWT.

import { NextResponse } from "next/server";
import crypto from "crypto";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { audit } from "@/lib/audit";

const TICKET_TTL_SECONDS = 60;

function newToken(): string {
  return crypto.randomBytes(32).toString("hex");
}

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "יש להתחבר" }, { status: 401 });
  }

  const sessionUserId = (session.user as any).id as string;
  const role = (session.user as any).role as string;
  const impersonatorId = (session.user as any).impersonatorId as string | null;

  const body = await req.json().catch(() => ({}));
  const action = String(body.action || "start");

  // ─────────────────────────────────────────────────────────
  // חזרה למנהל
  // ─────────────────────────────────────────────────────────
  // ההרשאה כאן אינה role הנוכחי (שהוא של הלקוח שנכנסנו אליו), אלא
  // עצם קיומו של impersonatorId ב-JWT החתום. זו הסיבה שהוא נשמר שם
  // ולא נגזר מהקליינט.
  if (action === "return") {
    if (!impersonatorId) {
      return NextResponse.json(
        { error: "אינך נמצא במצב כניסה בשם משתמש" },
        { status: 400 }
      );
    }

    const actor = await prisma.customer.findUnique({
      where: { id: impersonatorId },
      select: { id: true, name: true, role: true, isActive: true },
    });
    if (!actor || actor.isActive === false) {
      return NextResponse.json(
        { error: "חשבון המנהל אינו זמין. יש להתנתק ולהתחבר מחדש." },
        { status: 403 }
      );
    }

    const token = newToken();
    await prisma.impersonationTicket.create({
      data: {
        token,
        targetId: actor.id,
        actorId: actor.id,
        actorRole: actor.role,
        actorName: actor.name,
        isReturn: true,
        expiresAt: new Date(Date.now() + TICKET_TTL_SECONDS * 1000),
      },
    });

    await audit({
      actorId: actor.id,
      actorRole: actor.role,
      actorName: actor.name,
      action: "IMPERSONATE_STOP",
      targetId: sessionUserId,
      req,
    });

    return NextResponse.json({ ok: true, ticket: token });
  }

  // ─────────────────────────────────────────────────────────
  // תחילת כניסה בשם משתמש
  // ─────────────────────────────────────────────────────────
  // מנהל בלבד. נציג אינו יכול להתחזות ללקוח - זו הרשאה גורפת מדי
  // (היא כוללת גישה לכרטיס האשראי השמור ולכל ההיסטוריה). מעבר
  // נציג<->לקוח הוא מנגנון נפרד ומצומצם.
  if (role !== "ADMIN") {
    return NextResponse.json({ error: "אין הרשאה" }, { status: 403 });
  }
  // מניעת שרשור: התחזות מתוך התחזות מסבכת את מסלול החזרה ואין לה צורך
  if (impersonatorId) {
    return NextResponse.json(
      { error: "כבר נמצא במצב כניסה בשם משתמש. יש לחזור תחילה." },
      { status: 400 }
    );
  }

  const targetId = String(body.targetId || "").trim();
  if (!targetId) {
    return NextResponse.json({ error: "חסר מזהה משתמש" }, { status: 400 });
  }
  if (targetId === sessionUserId) {
    return NextResponse.json({ error: "זהו החשבון שלך" }, { status: 400 });
  }

  const target = await prisma.customer.findUnique({
    where: { id: targetId },
    select: { id: true, name: true, role: true, isActive: true },
  });
  if (!target) {
    return NextResponse.json({ error: "משתמש לא נמצא" }, { status: 404 });
  }

  // המנהל שיוזם - נטען מטבלת Customer אם קיים שם, אחרת מטבלת Admin
  // הנפרדת. חשוב: אם המנהל אינו רשומת Customer, אין לו לאן לחזור
  // דרך ה-provider, ולכן חוסמים עם הסבר במקום להשאיר אותו תקוע.
  const actorAsCustomer = await prisma.customer.findUnique({
    where: { id: sessionUserId },
    select: { id: true, name: true, role: true },
  });
  if (!actorAsCustomer) {
    return NextResponse.json(
      {
        error:
          "החשבון שלך מנוהל בטבלת המנהלים הישנה ואין לו פרופיל לקוח, ולכן לא ניתן לחזור אליו אחרי כניסה בשם משתמש. יש להשתמש בחשבון מנהל מסוג Customer.",
        code: "LEGACY_ADMIN",
      },
      { status: 400 }
    );
  }

  const token = newToken();
  await prisma.impersonationTicket.create({
    data: {
      token,
      targetId: target.id,
      actorId: actorAsCustomer.id,
      actorRole: actorAsCustomer.role,
      actorName: actorAsCustomer.name,
      isReturn: false,
      expiresAt: new Date(Date.now() + TICKET_TTL_SECONDS * 1000),
    },
  });

  await audit({
    actorId: actorAsCustomer.id,
    actorRole: actorAsCustomer.role,
    actorName: actorAsCustomer.name,
    action: "IMPERSONATE_START",
    targetId: target.id,
    targetName: target.name,
    meta: { targetRole: target.role, targetInactive: target.isActive === false },
    req,
  });

  return NextResponse.json({
    ok: true,
    ticket: token,
    target: { id: target.id, name: target.name, role: target.role },
  });
}
