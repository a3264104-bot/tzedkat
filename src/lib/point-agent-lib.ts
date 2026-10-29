// 💸 הנציג של נקודה — למי שייך חוב שנוצר מהמכירה
//
// הכלל העסקי: חוב שנוצר מהזמנה במכירה (כרטיס נכשל / שולם חלקית
// בסגירת המכירה) הוא של הנציג של הנקודה, תמיד. הנציג חייב למנהל את
// כל הכסף של המכירה, ועד שהלקוח משלים — החוב נשאר אצל הנציג.
//
// ⚠️ רק משתמשים בתפקיד AGENT. בטבלת AgentPoint יש גם שיוכים ישנים
// של משתמשים שאינם נציגים (מנהל / לקוח) — הם לא בעלי חוב.
// כמה נציגים בנקודה → מי שמשויך הכי מוקדם (יציב, לא משתנה בין קריאות).

import { prisma } from "@/lib/prisma";

export async function agentIdForPoint(pointId: string | null | undefined): Promise<string | null> {
  if (!pointId) return null;
  const ap = await prisma.agentPoint.findFirst({
    where: { pointId, agent: { role: "AGENT" } },
    orderBy: { createdAt: "asc" },
    select: { agentId: true },
  });
  if (ap) return ap.agentId;
  // שיוך ישן (נקודה אחת לנציג) — עדיין קיים אצל חלק מהנציגים
  const legacy = await prisma.customer.findFirst({
    where: { agentPointId: pointId, role: "AGENT" },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  return legacy?.id ?? null;
}

/** כל הנציגים (לבחירה כשהמנהל רושם חוב), עם סימון מי מהנקודה של הלקוח */
export async function listAgentsForPoint(pointId: string | null | undefined) {
  const agents = await prisma.customer.findMany({
    where: { role: "AGENT" },
    select: {
      id: true,
      name: true,
      agentPointId: true,
      agentPoints: { select: { pointId: true } },
    },
    orderBy: { name: "asc" },
  });
  return agents.map((a) => ({
    id: a.id,
    name: a.name,
    ofPoint:
      !!pointId && (a.agentPointId === pointId || a.agentPoints.some((p) => p.pointId === pointId)),
  }));
}
