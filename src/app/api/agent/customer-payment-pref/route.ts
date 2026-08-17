// §60: החלפת אופן התשלום של לקוח ע"י נציג/מנהל.
// POST /api/agent/customer-payment-pref
// Body: { customerId: string, preference: "CASH" | "CREDIT" }
//
// הכיוון העיקרי כאן הוא אשראי -> מזומן. הכיוון ההפוך (מזומן -> אשראי)
// מתבצע בפועל דרך הזנת כרטיס: save-token מציב CREDIT אוטומטית כשנשמר
// טוקן, וכך לא נוצר מצב ביניים "אשראי בלי טוקן". ה-route הזה מאפשר
// מעבר ל-CREDIT רק ללקוח שכבר יש לו טוקן שמור (למשל אחרי שסומן מזומן
// בטעות).
//
// הרשאות: מנהל, או נציג עם agentCanUpdateCards - אותה הרשאה שמכסה
// עדכון כרטיסי לקוחות, כי שני הכיוונים משנים את אופן הגבייה מהלקוח.
// בנוסף, נציג מוגבל ללקוחות שלו לפי אותו כלל כמו מסך ההזמנה (§55):
// לקוח שהוא יצר, או ששייך לאחת מנקודותיו, או שהזמין בהן בעבר.

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";

export async function POST(req: Request) {
  const session = await auth();
  const role = (session?.user as any)?.role;
  const sessionUserId = (session?.user as any)?.id as string;
  if (!session?.user || (role !== "AGENT" && role !== "ADMIN") || !sessionUserId) {
    return NextResponse.json({ error: "לא מורשה" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const customerId = String(body.customerId || "").trim();
  const preference = String(body.preference || "").trim();

  if (!customerId) {
    return NextResponse.json({ error: "חסר מזהה לקוח" }, { status: 400 });
  }
  if (preference !== "CASH" && preference !== "CREDIT") {
    return NextResponse.json(
      { error: "אופן תשלום לא תקין - יש לבחור מזומן או אשראי" },
      { status: 400 }
    );
  }

  const customer = await prisma.customer.findUnique({
    where: { id: customerId },
    select: {
      id: true,
      name: true,
      role: true,
      isActive: true,
      paymentToken: true,
      paymentPreference: true,
      defaultPointId: true,
      createdByAgentId: true,
    },
  });
  if (!customer || customer.role !== "CUSTOMER") {
    return NextResponse.json({ error: "לקוח לא נמצא" }, { status: 404 });
  }

  // §52: לקוח מושבת - אין מה לשנות לו אופן תשלום
  if (customer.isActive === false) {
    return NextResponse.json(
      { error: "הלקוח מסומן כלא פעיל. יש להפעיל אותו מחדש לפני שינוי אופן התשלום." },
      { status: 403 }
    );
  }

  // ─── הרשאות נציג ───
  if (role === "AGENT") {
    const agent = await prisma.customer.findUnique({
      where: { id: sessionUserId },
      select: {
        agentCanUpdateCards: true,
        agentPointId: true, // deprecated - תאימות אחורה
        agentPoints: { select: { pointId: true } },
      },
    });
    if (!agent?.agentCanUpdateCards) {
      return NextResponse.json(
        { error: "אין לך הרשאה לשנות אופן תשלום של לקוחות" },
        { status: 403 }
      );
    }

    // §55: אותו כלל שייכות כמו במסך ההזמנה. נציג בלי נקודות - חסום.
    const agentPointIds = new Set(agent.agentPoints.map((ap) => ap.pointId));
    if (agent.agentPointId) agentPointIds.add(agent.agentPointId);
    if (agentPointIds.size === 0) {
      return NextResponse.json(
        { error: "אין לך נקודת חלוקה משויכת. פנה למנהל." },
        { status: 403 }
      );
    }

    const isCreator = customer.createdByAgentId === sessionUserId;
    const samePoint =
      customer.defaultPointId !== null &&
      agentPointIds.has(customer.defaultPointId);
    const hasOrderAtPoint =
      !isCreator &&
      !samePoint &&
      (await prisma.order.count({
        where: {
          customerId: customer.id,
          pointId: { in: Array.from(agentPointIds) },
        },
      })) > 0;

    if (!isCreator && !samePoint && !hasOrderAtPoint) {
      return NextResponse.json(
        { error: "הלקוח משויך לנקודה אחרת - לא ניתן לשנות את אופן התשלום שלו" },
        { status: 403 }
      );
    }
  }

  // ─── מעבר לאשראי מחייב טוקן קיים ───
  // אין מצב ביניים "אשראי בלי כרטיס": לקוח כזה היה נתקע ברשימת
  // כשלי החיוב. אם אין טוקן, ה-UI צריך לפתוח את זרימת הכרטיס
  // (UpdateCardButton) - ו-save-token יעביר ל-CREDIT בעצמו.
  if (preference === "CREDIT" && !customer.paymentToken) {
    return NextResponse.json(
      {
        error:
          "ללקוח אין כרטיס שמור. כדי לעבור לאשראי יש להזין כרטיס - עם שמירת הכרטיס הלקוח יעבור לאשראי אוטומטית.",
        needsCard: true,
      },
      { status: 400 }
    );
  }

  // §61: אם הערך כבר זהה - לא מעדכנים, אבל *כן* ממשיכים לסגירת
  // הבקשה. לקוח שכבר סומן CASH ובקשתו נשארה תקועה מ"ממתינה" הוא
  // בדיוק המקרה שצריך תיקון, ויציאה מוקדמת כאן הייתה מנציחה אותו.
  const changed = customer.paymentPreference !== preference;

  if (changed) {
    await prisma.customer.update({
      where: { id: customerId },
      data: { paymentPreference: preference },
    });

    console.log(
      `[customer-payment-pref] ${role} ${sessionUserId} changed customer ${customerId} (${customer.name}): ${customer.paymentPreference} -> ${preference}`
    );
  }

  // §61: סגירת בקשת ההרשמה הטלפונית.
  //
  // 🐛 הפער: §56 סוגר את הבקשה ב-save-token, כי אז "טיפול" פירושו
  // היה בהכרח אימות כרטיס. מאז נוסף מסלול המזומן - וסימון הלקוח
  // כמשלם מזומן הוא בדיוק אותה השלמה: אין מה לאמת, הגבייה מוסדרת.
  // בלי הסגירה כאן הבקשה נשארה "ממתינה" לנצח, המנהל ראה לקוח שכבר
  // טופל כאילו הוא תקוע, וכל סינון או דוח לפי סטטוס שיקר.
  //
  // רק בכיוון CASH: מעבר ל-CREDIT מתרחש דרך שמירת טוקן, ושם §56
  // כבר סוגר.
  let closedRequests = 0;
  if (preference === "CASH") {
    const closed = await prisma.phoneSignupRequest.updateMany({
      where: { customerId, status: { notIn: ["COMPLETED"] } },
      data: { status: "COMPLETED", completedAt: new Date() },
    });
    closedRequests = closed.count;
    if (closedRequests > 0) {
      console.log(
        `[customer-payment-pref] closed ${closedRequests} phone signup request(s) for customer=${customerId} (marked as CASH)`
      );
    }
  }

  return NextResponse.json({
    ok: true,
    paymentPreference: preference,
    unchanged: !changed,
    closedRequests,
  });
}
