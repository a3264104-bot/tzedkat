// ═══════════════════════════════════════════════════════════════
// §149: בקשות הרשמה טלפוניות - צד הנציג
// ═══════════════════════════════════════════════════════════════
// GET   /api/agent/signups          -> בקשות הנקודות שלו
// PATCH /api/agent/signups          -> טיפול בבקשה
//
// למה הנציג ולא רק המנהל: הלקוח מתקשר, נרשם, ובוחר נקודת חלוקה.
// הנציג של אותה נקודה הוא זה שיפגוש אותו - הוא מכיר את השם,
// יודע אם הוא אמיתי, ויכול לאשר מיד. עד היום זה חיכה למנהל,
// ולקוח שנרשם ביום שישי היה תקוע עד שמישהו יבדוק.

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAgent } from "@/lib/agent-guard";
import { ensureLoginCode } from "@/lib/login-code";

export async function GET(req: Request) {
  const g = await requireAgent();
  if (!g.ok) return g.res;

  const url = new URL(req.url);
  const showDone = url.searchParams.get("done") === "1";

  // ⚠️ מערך נקודות ריק אצל נציג = **חסימה**, לא "בלי הגבלה".
  //
  // זה הדפוס שכבר נתפס כבאג פעמיים (§70, דפוס ג'): נציג בלי
  // נקודות היה עוקף את הסינון כולו ורואה את כל המערכת.
  if (!g.isAdmin && g.agentPointIds.length === 0) {
    return NextResponse.json(
      { error: "אין לך נקודת חלוקה משויכת. פנה למנהל." },
      { status: 403 }
    );
  }

  const requests = await prisma.phoneSignupRequest.findMany({
    where: {
      ...(g.isAdmin ? {} : { pointId: { in: g.agentPointIds } }),
      status: showDone
        ? { in: ["COMPLETED", "FAILED"] }
        : { in: ["NEW", "ASSIGNED", "CONTACTED"] },
    },
    orderBy: { createdAt: "desc" },
    take: 50,
    select: {
      id: true,
      customerId: true,
      customerName: true,
      phone: true,
      status: true,
      note: true,
      failReason: true,
      contactedAt: true,
      completedAt: true,
      createdAt: true,
      point: { select: { id: true, name: true, city: true } },
      customer: {
        select: {
          id: true,
          name: true,
          email: true,
          paymentToken: true,
          paymentPreference: true,
          loginCode: true,
          isActive: true,
          _count: { select: { orders: true } },
        },
      },
    },
  });

  return NextResponse.json({
    requests: requests.map((r) => ({
      id: r.id,
      customerId: r.customerId,
      // ⚠️ השם מהבקשה ולא מהלקוח: הוא נקלט מזיהוי דיבור וייתכן
      // שהמנהל תיקן אותו מאז. הנציג צריך לראות את שניהם כדי
      // לזהות על מי מדובר.
      spokenName: r.customerName,
      currentName: r.customer?.name ?? null,
      phone: r.phone,
      status: r.status,
      note: r.note,
      failReason: r.failReason,
      pointName: r.point?.name ?? null,
      pointCity: r.point?.city ?? null,
      createdAt: r.createdAt.toISOString(),
      contactedAt: r.contactedAt?.toISOString() ?? null,
      completedAt: r.completedAt?.toISOString() ?? null,
      // מצב הלקוח - כדי שהנציג ידע מה עוד חסר
      hasCard: !!r.customer?.paymentToken,
      isCash: r.customer?.paymentPreference === "CASH",
      hasCode: !!r.customer?.loginCode,
      hasEmail: !!r.customer?.email,
      orderCount: r.customer?._count.orders ?? 0,
      customerActive: r.customer?.isActive !== false,
    })),
    counts: {
      pending: requests.filter((r) =>
        ["NEW", "ASSIGNED", "CONTACTED"].includes(r.status)
      ).length,
    },
  });
}

// ═══════════════════════════════════════════════════════════════
// PATCH - טיפול בבקשה
// ═══════════════════════════════════════════════════════════════
// Body: { id, action: "approve" | "fail" | "contacted", reason?, note? }
export async function PATCH(req: Request) {
  const g = await requireAgent();
  if (!g.ok) return g.res;

  const b = await req.json().catch(() => ({}));
  const id = String(b.id || "");
  const action = String(b.action || "");

  if (!id || !action) {
    return NextResponse.json({ error: "חסרים נתונים" }, { status: 400 });
  }

  const request = await prisma.phoneSignupRequest.findUnique({
    where: { id },
    select: {
      id: true,
      customerId: true,
      customerName: true,
      pointId: true,
      status: true,
    },
  });
  if (!request) {
    return NextResponse.json({ error: "בקשה לא נמצאה" }, { status: 404 });
  }

  // בדיקת שייכות
  if (!g.isAdmin) {
    if (g.agentPointIds.length === 0) {
      return NextResponse.json(
        { error: "אין לך נקודת חלוקה משויכת" },
        { status: 403 }
      );
    }
    if (!g.agentPointIds.includes(request.pointId)) {
      return NextResponse.json(
        { error: "אין הרשאה - הבקשה אינה באחת מהנקודות שלך" },
        { status: 403 }
      );
    }
  }

  // ─── סימון "יצרתי קשר" ───
  if (action === "contacted") {
    await prisma.phoneSignupRequest.update({
      where: { id },
      data: {
        status: "CONTACTED",
        contactedAt: new Date(),
        contactedBy: g.agent.id,
        ...(b.note ? { note: String(b.note).trim().slice(0, 300) } : {}),
      },
    });
    return NextResponse.json({ ok: true, status: "CONTACTED" });
  }

  // ─── דחייה ───
  if (action === "fail") {
    const reason = String(b.reason || "").trim();
    if (!reason) {
      return NextResponse.json(
        { error: "יש לציין סיבה - כדי שהמנהל יוכל להבין מה קרה" },
        { status: 400 }
      );
    }
    await prisma.phoneSignupRequest.update({
      where: { id },
      data: {
        status: "FAILED",
        failReason: reason.slice(0, 200),
        contactedBy: g.agent.id,
        contactedAt: new Date(),
      },
    });
    // ⚠️ הלקוח **אינו** נמחק. ייתכן שהוא ינסה שוב, או שהמנהל
    // ירצה לבדוק. מחיקה הייתה גם שוברת את הקשר לבקשה.
    return NextResponse.json({ ok: true, status: "FAILED" });
  }

  // ─── אישור ───
  if (action === "approve") {
    // §149: הלקוח נוצר כ**אשראי** כברירת מחדל.
    //
    // ⚠️ המשמעות: הוא לא יוכל להזמין עד שיוזן לו כרטיס. זו
    // התנהגות מכוונת - רוב הלקוחות משלמים באשראי, והנציג יזין
    // את הכרטיס בשיחה או בחלוקה.
    //
    // מי שאין לו כרטיס - הנציג משנה למזומן בכרטיס הלקוח, ואז
    // הוא יכול להזמין בעצמו (§143).
    const customer = await prisma.customer.findUnique({
      where: { id: request.customerId },
      select: { id: true, name: true, defaultPointId: true, isActive: true },
    });
    if (!customer) {
      return NextResponse.json({ error: "הלקוח לא נמצא" }, { status: 404 });
    }

    await prisma.customer.update({
      where: { id: customer.id },
      data: {
        // ⚠️ שיוך לנקודה שהלקוח בחר בשיחה. בלעדיו הוא לא יופיע
        // ברשימת הנציג ולא יקבל תזכורות חלוקה.
        ...(customer.defaultPointId ? {} : { defaultPointId: request.pointId }),
        // לקוח שהושבת בעבר ומבקש להצטרף מחדש - מופעל שוב
        ...(customer.isActive === false ? { isActive: true } : {}),
      },
    });

    // §121: קוד כניסה - בלעדיו אין לו דרך להיכנס לאתר או לשמוע
    // אותו בטלפון. לא חוסם: כשל לא יבטל אישור שכבר בוצע.
    let code: string | null = null;
    try {
      code = await ensureLoginCode(prisma, customer.id);
    } catch (e) {
      console.error("[signup-approve] code generation failed:", e);
    }

    await prisma.phoneSignupRequest.update({
      where: { id },
      data: {
        status: "COMPLETED",
        completedAt: new Date(),
        contactedBy: g.agent.id,
        ...(request.status === "NEW" ? { contactedAt: new Date() } : {}),
        ...(b.note ? { note: String(b.note).trim().slice(0, 300) } : {}),
      },
    });

    console.log(
      `[signup-approve] request=${id} customer=${customer.id} by agent=${g.agent.id}`
    );

    return NextResponse.json({
      ok: true,
      status: "COMPLETED",
      customerId: customer.id,
      // הקוד מוחזר כדי שהנציג ימסור אותו ללקוח מיד בשיחה
      loginCode: code,
    });
  }

  return NextResponse.json({ error: "פעולה לא מוכרת" }, { status: 400 });
}
