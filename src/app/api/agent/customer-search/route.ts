// §55: חיפוש לקוח למסך הנציג — לפי טלפון או לפי שם.
// GET /api/agent/customer-search?q=X
//
// שינויים מהגרסה הקודמת:
//
// 1. חיפוש לפי שם, ולא רק לפי טלפון. הנציג בשטח לא תמיד יודע את
//    המספר, והוא היה נאלץ לוותר או ליצור לקוח כפול.
//
// 2. 🐛 בדיקת שייכות לנקודה. קודם כל לקוח הוחזר לכל נציג, בלי קשר
//    לנקודה שלו — הנציג יכול היה לפתוח הזמנה ללקוח של נקודה אחרת.
//    עכשיו לקוח מחוץ לנקודות שלו מוחזר *חסום* עם הסבר מי הנציג
//    האחראי.
//
//    למה חסום ולא מוסתר: אם הלקוח נעלם מהחיפוש, הנציג חושב שהוא לא
//    קיים ויוצר אותו מחדש — וזו כפילות שמפצלת היסטוריה והזמנות.
//
// 3. לקוח לא פעיל מסומן ונחסם.
//
// פרמטר `phone` נתמך לתאימות אחורה עם קוד קיים.

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";

export type SearchHit = {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  isActivated: boolean;
  isActive: boolean;
  hasCard: boolean;
  cardLast4: string | null;
  /** §60: CASH = לקוח מזומן (לא יידרש כרטיס בהזמנת נציג) */
  paymentPreference: string;
  pointId: string | null;
  pointName: string | null;
  orderCount: number;
  /** האם הנציג רשאי לפתוח הזמנה ללקוח הזה */
  allowed: boolean;
  /** אם לא — למה, בנוסח שאפשר להציג ישירות */
  blockedReason: string | null;
};

export async function GET(req: Request) {
  const session = await auth();
  const role = (session?.user as any)?.role;
  const userId = (session?.user as any)?.id as string;
  if (!session?.user || (role !== "AGENT" && role !== "ADMIN")) {
    return NextResponse.json({ error: "לא מורשה" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  // תומך בשני השמות: q (חדש) ו-phone (תאימות אחורה)
  const raw = (searchParams.get("q") || searchParams.get("phone") || "").trim();
  if (raw.length < 2) {
    return NextResponse.json({ found: false, results: [] });
  }

  // ─── נקודות הנציג ───
  // מנהל רואה הכל. נציג מוגבל לנקודות שלו.
  let myPointIds: string[] = [];
  if (role === "AGENT") {
    const agent = await prisma.customer.findUnique({
      where: { id: userId },
      select: {
        agentPointId: true,
        agentPoints: { select: { pointId: true } },
      },
    });
    myPointIds =
      (agent?.agentPoints.length ?? 0) > 0
        ? agent!.agentPoints.map((ap) => ap.pointId)
        : agent?.agentPointId
          ? [agent.agentPointId]
          : [];
  }
  const isAdmin = role === "ADMIN";

  // ─── זיהוי סוג החיפוש ───
  // ספרות בלבד (אחרי ניקוי) = טלפון. אחרת = שם.
  // שדה אחד שמזהה לבד, במקום שני שדות או בורר שהנציג צריך להבין.
  const digits = raw.replace(/\D/g, "");
  const looksLikePhone = digits.length >= 6 && /^[\d\-+()\s]+$/.test(raw);

  let where: any;
  if (looksLikePhone) {
    // נירמול טלפון - זהה לאלגוריתם ב-auth.ts וב-register
    const localPhone = digits.startsWith("972") ? "0" + digits.slice(3) : digits;
    const candidates = Array.from(new Set([raw, digits, localPhone])).filter(Boolean);
    where = { OR: candidates.map((p) => ({ phone: p })) };
  } else {
    where = { name: { contains: raw, mode: "insensitive" as const } };
  }

  const rows = await prisma.customer.findMany({
    where,
    select: {
      id: true,
      name: true,
      phone: true,
      email: true,
      role: true,
      isActivated: true,
      isActive: true,
      cardLast4: true,
      paymentToken: true,
      paymentPreference: true,
      defaultPointId: true,
      defaultPoint: { select: { id: true, name: true, city: true } },
      _count: { select: { orders: true } },
    },
    orderBy: { name: "asc" },
    take: looksLikePhone ? 5 : 8,
  });

  // ─── משתמש מערכת (נציג/מנהל) ───
  // נשמר מהגרסה הקודמת: אי אפשר ליצור לקוח עם טלפון של איש צוות.
  const systemUser = rows.find((c) => c.role !== "CUSTOMER");
  if (systemUser && rows.length === 1) {
    return NextResponse.json({
      found: false,
      results: [],
      isSystemUser: true,
      systemRole: systemUser.role,
      customerName: systemUser.name,
    });
  }

  // ─── שמות הנציגים האחראים על נקודות שאינן שלי ───
  // נטען רק לנקודות הרלוונטיות, כדי שההודעה תגיד למי לפנות ולא רק
  // "אין הרשאה".
  const foreignPointIds = Array.from(
    new Set(
      rows
        .filter((c) => c.role === "CUSTOMER")
        .map((c) => c.defaultPointId)
        .filter((pid): pid is string => !!pid && !isAdmin && !myPointIds.includes(pid))
    )
  );
  const agentsByPoint = new Map<string, string[]>();
  if (foreignPointIds.length > 0) {
    const links = await prisma.agentPoint.findMany({
      where: { pointId: { in: foreignPointIds } },
      select: { pointId: true, agent: { select: { name: true } } },
    });
    for (const l of links) {
      const arr = agentsByPoint.get(l.pointId) || [];
      arr.push(l.agent.name);
      agentsByPoint.set(l.pointId, arr);
    }
    // נציגים שעדיין על השדה הישן (agentPointId) ולא ב-AgentPoint
    const legacy = await prisma.customer.findMany({
      where: { agentPointId: { in: foreignPointIds }, role: "AGENT" },
      select: { agentPointId: true, name: true },
    });
    for (const a of legacy) {
      if (!a.agentPointId) continue;
      const arr = agentsByPoint.get(a.agentPointId) || [];
      if (!arr.includes(a.name)) arr.push(a.name);
      agentsByPoint.set(a.agentPointId, arr);
    }
  }

  const results: SearchHit[] = rows
    .filter((c) => c.role === "CUSTOMER")
    .map((c) => {
      let allowed = true;
      let blockedReason: string | null = null;

      // לקוח שהושבת - חסום לכולם, גם למנהל.
      // הוא ביקש להפסיק, ופתיחת הזמנה עבורו סותרת את זה.
      if (c.isActive === false) {
        allowed = false;
        blockedReason =
          "הלקוח מסומן כלא פעיל. יש להפעיל אותו מחדש במסך הלקוחות לפני פתיחת הזמנה.";
      } else if (!isAdmin) {
        if (!c.defaultPointId) {
          allowed = false;
          blockedReason =
            "ללקוח לא הוגדרה נקודת חלוקה. יש לפנות למנהל להשלמת השיוך.";
        } else if (!myPointIds.includes(c.defaultPointId)) {
          const names = agentsByPoint.get(c.defaultPointId) || [];
          const pointName = c.defaultPoint?.name || "נקודה אחרת";
          allowed = false;
          blockedReason =
            `הלקוח משויך לנקודת החלוקה "${pointName}"` +
            (names.length > 0
              ? ` — הנציג האחראי: ${names.join(", ")}.`
              : " שאינה מהנקודות שלך.") +
            " לא ניתן לפתוח עבורו הזמנה מכאן.";
        }
      }

      return {
        id: c.id,
        name: c.name,
        phone: c.phone,
        email: c.email,
        isActivated: c.isActivated,
        isActive: c.isActive !== false,
        hasCard: !!c.paymentToken,
        cardLast4: c.cardLast4,
        paymentPreference: c.paymentPreference,
        pointId: c.defaultPointId,
        pointName: c.defaultPoint?.name || null,
        orderCount: c._count.orders,
        allowed,
        blockedReason,
      };
    });

  return NextResponse.json({
    found: results.length > 0,
    searchType: looksLikePhone ? "phone" : "name",
    results,
    // תאימות אחורה: קוד קיים מצפה ל-customer יחיד בחיפוש טלפון
    customer: looksLikePhone && results.length === 1 ? results[0] : null,
  });
}
