// §24: ניהול בקשות פתיחת חשבון שהתקבלו במערכת הטלפונית.
//
// GET    /api/admin/phone-signups?status=&pointId=
// PATCH  /api/admin/phone-signups   { id, action, ... }
// DELETE /api/admin/phone-signups   { id }
//
// למה זה קיים: לקוח שנרשם בטלפון לא יכול להזמין עד שנציג יעדכן לו
// פרטי אשראי (אין דרך להזין כרטיס בטלפון בלי לעבור בסולק). בלי מסך
// שמנהל את זה, לקוחות פשוט נופלים בין הכיסאות.

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";

// אימות: מנהל רואה הכל, נציג רואה רק את הנקודות שלו.
async function resolveAccess() {
  const session = await auth();
  if (!session?.user) {
    return { ok: false as const, status: 401, error: "unauthorized" };
  }
  const userId = (session.user as any).id as string;
  const role = (session.user as any).role as string;
  if (role !== "ADMIN" && role !== "AGENT") {
    return { ok: false as const, status: 403, error: "forbidden" };
  }
  if (role === "ADMIN") {
    return { ok: true as const, role, userId, pointIds: null as string[] | null };
  }
  // נציג - שולפים את כל נקודותיו (many-to-many, עם נפילה לישן)
  const agent = await prisma.customer.findUnique({
    where: { id: userId },
    select: {
      agentPointId: true,
      agentPoints: { select: { pointId: true } },
      // §277: הרשאת מוקד טלפוני
      canManagePhoneRequests: true,
    },
  });

  // §277: 📞 **מוקד טלפוני — בלי הגבלת נקודות.**
  //
  // הצורך: נציג אחד מטפל בכל מה שמגיע מהמערכת הטלפונית. הוא
  // לא יודע מראש מאיזו נקודה הלקוח מתקשר, וסינון לפי הנקודות
  // שלו היה משאיר בקשות בלי מטפל - בדיוק הבעיה שהתפקיד בא
  // לפתור.
  //
  // ⚠️ pointIds: null זהה למנהל, וזה מכוון: במסך הזה הוא **כן**
  // מנהל. ההרשאה צרה למסך הזה בלבד - הזמנות, משקלים וכספים
  // נשארים חסומים בפניו.
  if (agent?.canManagePhoneRequests) {
    return {
      ok: true as const,
      role,
      userId,
      pointIds: null as string[] | null,
    };
  }

  const pointIds =
    agent && agent.agentPoints.length > 0
      ? agent.agentPoints.map((ap) => ap.pointId)
      : agent?.agentPointId
        ? [agent.agentPointId]
        : [];
  return { ok: true as const, role, userId, pointIds };
}

export async function GET(req: Request) {
  const acc = await resolveAccess();
  if (!acc.ok) {
    return NextResponse.json({ error: acc.error }, { status: acc.status });
  }

  const { searchParams } = new URL(req.url);
  const status = searchParams.get("status") || undefined;
  const pointId = searchParams.get("pointId") || undefined;

  const where: any = {};
  if (status && status !== "all") where.status = status;
  if (pointId) where.pointId = pointId;
  // נציג מוגבל לנקודותיו. רשימה ריקה = אין לו נקודות = לא רואה כלום.
  if (acc.pointIds !== null) {
    where.pointId = pointId ? pointId : { in: acc.pointIds };
    if (acc.pointIds.length === 0) {
      return NextResponse.json({
        rows: [],
        counts: {},
        messages: [],
        newMessagesCount: 0,
        isAgent: true,
      });
    }
  }

  const rows = await prisma.phoneSignupRequest.findMany({
    where,
    orderBy: [{ status: "asc" }, { createdAt: "asc" }],
    include: {
      point: { select: { id: true, name: true, city: true } },
      customer: {
        select: {
          id: true,
          name: true,
          phone: true,
          email: true,
          // מקור האמת להשלמה: אם יש טוקן, הטיפול הסתיים בפועל
          paymentToken: true,
          cardLast4: true,
          createdAt: true,
          // §56: כמה הזמנות יש ללקוח - המסך חוסם מחיקה אם יש,
          // כי אז יש היסטוריה לשמר וההשבתה היא הדרך הנכונה.
          _count: { select: { orders: true } },
        },
      },
    },
    take: 300,
  });

  // ספירה לפי סטטוס - למונים במסך
  const counts: Record<string, number> = {};
  for (const r of rows) counts[r.status] = (counts[r.status] || 0) + 1;

  // §25: הודעות שלקוחות השאירו בשיחה.
  //
  // §57: 🐛 תוקן - הנציג קיבל את *כל* ההודעות מכל הנקודות.
  //
  // הסינון הקודם היה `role === "ADMIN" ? {} : { status: "NEW" }` -
  // כלומר לנציג סוננו רק הודעות שטופלו, אבל לא לפי נקודה בכלל.
  // התוצאה: נציג מקרלין ראה הודעות של לקוחות מנדבורנא, וגם להפך.
  //
  // הקושי: ל-PhoneMessage אין pointId - הוא מקושר ל-customerId
  // ולטלפון בלבד. לכן הנקודה נגזרת מ-defaultPointId של הלקוח.
  //
  // מתקשר לא מזוהה (בלי customerId) מוצג *רק למנהל* - אין שום דרך
  // לדעת לאיזו נקודה הוא שייך, וניחוש היה שולח אותו לנציג הלא נכון.
  const messageWhere: any = {};
  if (acc.pointIds !== null) {
    messageWhere.customer = { defaultPointId: { in: acc.pointIds } };
  }

  const messages = await prisma.phoneMessage.findMany({
    where: messageWhere,
    orderBy: [{ status: "asc" }, { createdAt: "desc" }],
    take: 100,
    include: {
      customer: {
        select: { id: true, name: true, defaultPoint: { select: { name: true } } },
      },
    },
  });

  // §57: כמה הודעות לא מזוהות ממתינות - מוצג למנהל בלבד, כדי שידע
  // שיש פניות שאף נציג לא יראה והוא היחיד שיכול לטפל בהן.
  const unassignedMessages =
    acc.pointIds === null
      ? await prisma.phoneMessage.count({
          where: { status: "NEW", customerId: null },
        })
      : 0;

  // §57: בקשות "יתומות" - נקודה שאין לה אף נציג משויך.
  // בלי ההתראה הזו הבקשה יושבת ברשימה ואף אחד לא לוקח אחריות עליה.
  let orphanRequests = 0;
  if (acc.pointIds === null) {
    const openPointIds = Array.from(
      new Set(
        rows
          .filter((r) => r.status !== "COMPLETED" && r.status !== "FAILED")
          .map((r) => r.pointId)
      )
    );
    if (openPointIds.length > 0) {
      const linked = await prisma.agentPoint.findMany({
        where: { pointId: { in: openPointIds } },
        select: { pointId: true },
      });
      const legacy = await prisma.customer.findMany({
        where: { agentPointId: { in: openPointIds }, role: "AGENT" },
        select: { agentPointId: true },
      });
      const covered = new Set([
        ...linked.map((l) => l.pointId),
        ...legacy.map((l) => l.agentPointId).filter(Boolean),
      ]);
      orphanRequests = rows.filter(
        (r) =>
          r.status !== "COMPLETED" &&
          r.status !== "FAILED" &&
          !covered.has(r.pointId)
      ).length;
    }
  }

  return NextResponse.json({
    messages: messages.map((m) => ({
      id: m.id,
      phone: m.phone,
      customerName: m.customer?.name ?? null,
      customerId: m.customerId,
      pointName: m.customer?.defaultPoint?.name ?? null,
      kind: m.kind,
      status: m.status,
      transcript: m.transcript,
      recordingPath: m.recordingPath,
      adminNote: m.adminNote,
      createdAt: m.createdAt.toISOString(),
      handledAt: m.handledAt?.toISOString() ?? null,
    })),
    newMessagesCount: messages.filter((m) => m.status === "NEW").length,
    unassignedMessages,
    orphanRequests,
    isAgent: acc.pointIds !== null,
    counts,
    rows: rows.map((r) => ({
      id: r.id,
      customerId: r.customerId,
      customerName: r.customerName || r.customer?.name || "",
      phone: r.phone,
      email: r.customer?.email ?? null,
      pointId: r.pointId,
      pointName: r.point?.name ?? "",
      pointCity: r.point?.city ?? null,
      assignedAgentId: r.assignedAgentId,
      assignedAt: r.assignedAt?.toISOString() ?? null,
      status: r.status,
      contactedAt: r.contactedAt?.toISOString() ?? null,
      contactedBy: r.contactedBy,
      completedAt: r.completedAt?.toISOString() ?? null,
      failReason: r.failReason,
      note: r.note,
      createdAt: r.createdAt.toISOString(),
      // 🔑 מקור האמת: הטיפול הושלם רק אם ללקוח באמת יש טוקן.
      // הסטטוס בטבלה יכול להיות לא מעודכן אם מישהו שכח ללחוץ.
      hasToken: !!r.customer?.paymentToken,
      cardLast4: r.customer?.cardLast4 ?? null,
      // §56: לחסימת מחיקה במסך
      orderCount: r.customer?._count.orders ?? 0,
      // כמה ימים הבקשה ממתינה
      daysWaiting: Math.floor(
        (Date.now() - r.createdAt.getTime()) / (1000 * 60 * 60 * 24)
      ),
    })),
  });
}

export async function PATCH(req: Request) {
  const acc = await resolveAccess();
  if (!acc.ok) {
    return NextResponse.json({ error: acc.error }, { status: acc.status });
  }

  const body = await req.json().catch(() => ({}));
  const id = String(body.id || "").trim();
  const action = String(body.action || "").trim();
  if (!id || !action) {
    return NextResponse.json({ error: "חסרים פרטים" }, { status: 400 });
  }

  // §25: סימון הודעה כטופלה נוגע בטבלה אחרת (PhoneMessage) ולכן
  // מטופל לפני בדיקת הבקשה - אחרת החיפוש ב-phoneSignupRequest ייכשל.
  if (action === "message_handled") {
    const msg = await prisma.phoneMessage.findUnique({
      where: { id },
      select: {
        id: true,
        customer: { select: { defaultPointId: true } },
      },
    });
    if (!msg) {
      return NextResponse.json({ error: "הודעה לא נמצאה" }, { status: 404 });
    }
    // §57: נציג יכול לטפל רק בהודעות של לקוחות מנקודותיו.
    // בלי הבדיקה, נציג היה יכול לסמן כטופלת הודעה של נקודה אחרת
    // והנציג האמיתי לא היה יודע שהיא נעלמה לו.
    if (acc.pointIds !== null) {
      const pid = msg.customer?.defaultPointId;
      if (!pid || !acc.pointIds.includes(pid)) {
        return NextResponse.json(
          { error: "אין הרשאה - ההודעה לא באחת מהנקודות שלך" },
          { status: 403 }
        );
      }
    }
    await prisma.phoneMessage.update({
      where: { id },
      data: {
        status: "HANDLED",
        handledAt: new Date(),
        handledBy: acc.userId,
        ...(body.note ? { adminNote: String(body.note).slice(0, 1000) } : {}),
      },
    });
    return NextResponse.json({ ok: true });
  }

  const existing = await prisma.phoneSignupRequest.findUnique({
    where: { id },
    select: { id: true, pointId: true, customerId: true },
  });
  if (!existing) {
    return NextResponse.json({ error: "בקשה לא נמצאה" }, { status: 404 });
  }
  // נציג יכול לטפל רק בבקשות של נקודותיו
  if (acc.pointIds !== null && !acc.pointIds.includes(existing.pointId)) {
    return NextResponse.json(
      { error: "אין הרשאה - הבקשה לא באחת מהנקודות שלך" },
      { status: 403 }
    );
  }

  const who = acc.userId;
  const data: any = {};

  switch (action) {
    case "assign":
      // שיוך נציג ספציפי (עקיפה ידנית של המנהל). ריק = החזרה לשיוך לפי נקודה.
      if (acc.role !== "ADMIN") {
        return NextResponse.json({ error: "רק מנהל יכול לשייך נציג" }, { status: 403 });
      }
      data.assignedAgentId = body.agentId ? String(body.agentId) : null;
      data.assignedAt = body.agentId ? new Date() : null;
      data.status = body.agentId ? "ASSIGNED" : "NEW";
      break;

    case "contacted":
      data.status = "CONTACTED";
      data.contactedAt = new Date();
      data.contactedBy = who;
      break;

    case "fail":
      data.status = "FAILED";
      data.failReason = body.reason ? String(body.reason).slice(0, 300) : null;
      break;

    case "reopen":
      data.status = "NEW";
      data.failReason = null;
      data.completedAt = null;
      break;

    case "note":
      data.note = body.note ? String(body.note).slice(0, 1000) : null;
      break;

    case "point":
      // שינוי נקודה - מעביר את הבקשה לטיפול נציגי נקודה אחרת
      if (acc.role !== "ADMIN") {
        return NextResponse.json({ error: "רק מנהל יכול לשנות נקודה" }, { status: 403 });
      }
      if (!body.pointId) {
        return NextResponse.json({ error: "חסרה נקודה" }, { status: 400 });
      }
      data.pointId = String(body.pointId);
      data.assignedAgentId = null;
      data.assignedAt = null;
      break;

    default:
      return NextResponse.json({ error: "פעולה לא מוכרת" }, { status: 400 });
  }

  const updated = await prisma.phoneSignupRequest.update({
    where: { id },
    data,
    include: { customer: { select: { paymentToken: true } } },
  });

  // סגירה אוטומטית: אם ללקוח כבר יש טוקן, הטיפול הסתיים בפועל -
  // לא ממתינים שמישהו יזכור ללחוץ "הושלם".
  //
  // §56: הסגירה הזו רצה רק כשמישהו מבצע פעולה כאן. הסגירה בזמן
  // אמת - כשהלקוח מעדכן כרטיס - נמצאת ב-save-token.
  if (updated.customer?.paymentToken && updated.status !== "COMPLETED") {
    await prisma.phoneSignupRequest.update({
      where: { id },
      data: { status: "COMPLETED", completedAt: new Date() },
    });
  }

  return NextResponse.json({ ok: true });
}

// §56: מחיקת בקשה שלא הבשילה.
//
// למה מחיקה מותרת כאן, בניגוד ללקוח רגיל: בקשה שלא הושלמה אינה
// נושאת היסטוריה - אין הזמנות, אין חיובים, אין תעודות. השארתה
// ברשימה רק גורמת לחזור אליה שוב ושוב.
//
// אבל אם ללקוח *כן* יש הזמנות, המחיקה נחסמת. שם יש היסטוריה שחייבת
// להישמר לדוחות של מכירות עבר, וההשבתה (§52) היא הדרך.
export async function DELETE(req: Request) {
  const acc = await resolveAccess();
  if (!acc.ok) {
    return NextResponse.json({ error: acc.error }, { status: acc.status });
  }

  const body = await req.json().catch(() => ({}));
  const id = String(body.id || "").trim();
  if (!id) {
    return NextResponse.json({ error: "חסר מזהה" }, { status: 400 });
  }

  const request = await prisma.phoneSignupRequest.findUnique({
    where: { id },
    select: {
      id: true,
      pointId: true,
      customerId: true,
      customerName: true,
      customer: {
        select: {
          id: true,
          role: true,
          _count: { select: { orders: true } },
        },
      },
    },
  });
  if (!request) {
    return NextResponse.json({ error: "בקשה לא נמצאה" }, { status: 404 });
  }

  // נציג יכול למחוק רק בקשות של נקודותיו
  if (acc.pointIds !== null && !acc.pointIds.includes(request.pointId)) {
    return NextResponse.json(
      { error: "אין הרשאה - הבקשה לא באחת מהנקודות שלך" },
      { status: 403 }
    );
  }

  const orderCount = request.customer?._count.orders ?? 0;
  if (orderCount > 0) {
    return NextResponse.json(
      {
        error:
          `ללקוח יש ${orderCount} הזמנות במערכת ולכן לא ניתן למחוק אותו. ` +
          `במקום זאת ניתן לסמן אותו כלא פעיל במסך הלקוחות — ההיסטוריה ` +
          `נשמרת והוא מפסיק לקבל פניות.`,
        code: "HAS_ORDERS",
        orderCount,
      },
      { status: 409 }
    );
  }

  // הגנה נוספת: לא מוחקים נציג או מנהל בטעות
  if (request.customer && request.customer.role !== "CUSTOMER") {
    return NextResponse.json(
      { error: "לא ניתן למחוק חשבון של נציג או מנהל" },
      { status: 403 }
    );
  }

  await prisma.$transaction(async (tx) => {
    await tx.phoneSignupRequest.delete({ where: { id } });
    // מוחקים גם את חשבון הלקוח שנוצר עבור הבקשה. הוא נוצר רק בשבילה,
    // אין לו הזמנות, ובלי מחיקה הוא נשאר יתום ברשימת הלקוחות.
    if (request.customerId) {
      await tx.customer.deleteMany({
        where: { id: request.customerId, role: "CUSTOMER" },
      });
    }
  });

  console.log(
    `[phone-signups] ${acc.role} ${acc.userId} deleted request ${id} (${request.customerName})`
  );

  return NextResponse.json({ ok: true });
}
