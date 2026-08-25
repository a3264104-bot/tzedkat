// §20: helper לוודא שהמשתמש הוא נציג פעיל
// שימוש: const g = await requireAgent(); if (!g.ok) return g.res;

import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function requireAgent() {
  const session = await auth();
  if (!session?.user) {
    return {
      ok: false as const,
      res: NextResponse.json({ error: "יש להתחבר" }, { status: 401 }),
    };
  }
  const userId = (session.user as any).id as string;
  const role = (session.user as any).role as string;

  if (role !== "AGENT" && role !== "ADMIN") {
    return {
      ok: false as const,
      res: NextResponse.json({ error: "אין הרשאה" }, { status: 403 }),
    };
  }

  // טעינת פרטי הנציג (עם agentPointId הישן + agentPoints החדש רב-נקודתי + עמלות)
  const agent = await prisma.customer.findUnique({
    where: { id: userId },
    select: {
      id: true,
      name: true,
      role: true,
      // 🔴 deprecated - נשמר לתאימות אחורה (קוד שעדיין קורא ל-agentPoint/agentPointId)
      agentPointId: true,
      agentPoint: { select: { id: true, name: true, city: true } },
      // 🆕 כל הנקודות של הנציג (many-to-many דרך AgentPoint).
      // זהו מקור האמת לסינון - נציג יכול להיות משויך לכמה נקודות.
      agentPoints: {
        select: {
          point: { select: { id: true, name: true, city: true } },
        },
      },
      commissionRateCarton: true,
      commissionRateSingles: true,
      // §277: הרשאת מוקד טלפוני
      canManagePhoneRequests: true,
    },
  });

  if (!agent) {
    return {
      ok: false as const,
      res: NextResponse.json({ error: "נציג לא נמצא" }, { status: 404 }),
    };
  }

  // רשימת מזהי הנקודות של הנציג - מקור אמת אחיד לכל סינון.
  // מעדיף את agentPoints (רב-נקודתי); נופל ל-agentPointId הישן אם המערך ריק
  // (נציג שעדיין לא הועבר ל-many-to-many). ADMIN מקבל [] = בלי הגבלה.
  const agentPointIds =
    agent.agentPoints.length > 0
      ? agent.agentPoints.map((ap) => ap.point.id)
      : agent.agentPointId
        ? [agent.agentPointId]
        : [];

  return {
    ok: true as const,
    session,
    userId,
    role,
    agent,
    agentPointIds,
    isAdmin: role === "ADMIN",
    /**
     * §277: הרשאת **מוקד טלפוני**.
     *
     * נציג עם ההרשאה הזו מטפל בכל הבקשות שמגיעות מהמערכת
     * הטלפונית - הרשמות, הודעות שהושארו, ועדכוני אשראי.
     *
     * ⚠️ **חוצה נקודות**: בניגוד לכל הרשאה אחרת, הוא רואה את
     * הכל. מוקד לא יודע מראש מאיזו נקודה הלקוח מתקשר, וסינון
     * היה משאיר בקשות בלי מטפל.
     *
     * ⚠️ צרה בכוונה: היא פותחת שלושה מסכים בלבד - לא הזמנות,
     * לא משקלים, ולא כספים.
     */
    canPhoneDesk:
      role === "ADMIN" || agent.canManagePhoneRequests === true,
  };
}
