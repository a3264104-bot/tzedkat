// שינוי תפקיד + שיוך נקודה של משתמש - למנהל בלבד
// PATCH /api/admin/users/[id]/role
// Body: { role?: "CUSTOMER"|"AGENT"|"ADMIN", agentPointId?: string|null,
//         commissionRateCarton?: number, commissionRateSingles?: number }

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/guard";

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const g = await requireAdmin();
  if (!g.ok) return g.res;

  const { id } = await params;
  const body = await req.json().catch(() => ({}));

  const user = await prisma.customer.findUnique({ where: { id } });
  if (!user) {
    return NextResponse.json({ error: "משתמש לא נמצא" }, { status: 404 });
  }

  const data: any = {};

  if ("role" in body) {
    const role = String(body.role);
    if (!["CUSTOMER", "AGENT", "ADMIN"].includes(role)) {
      return NextResponse.json({ error: "תפקיד לא חוקי" }, { status: 400 });
    }
    data.role = role;

    // אם משנים לתפקיד שאינו AGENT, ננקה את הנקודה
    // (רק אם המשתמש לא ADMIN - כי מנהל יכול גם להיות משויך לנקודה במקרים מיוחדים)
    if (role === "CUSTOMER") {
      data.agentPointId = null;
    }
  }

  if ("agentPointId" in body) {
    data.agentPointId = body.agentPointId || null;
  }

  if ("commissionRateCarton" in body) {
    const v = Number(body.commissionRateCarton);
    if (isNaN(v) || v < 0) {
      return NextResponse.json({ error: "עמלת קרטונים לא תקינה" }, { status: 400 });
    }
    data.commissionRateCarton = v;
  }

  if ("commissionRateSingles" in body) {
    const v = Number(body.commissionRateSingles);
    if (isNaN(v) || v < 0) {
      return NextResponse.json({ error: "עמלת בודדים לא תקינה" }, { status: 400 });
    }
    data.commissionRateSingles = v;
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "אין שדות לעדכון" }, { status: 400 });
  }

  await prisma.customer.update({ where: { id }, data });

  return NextResponse.json({
    ok: true,
    role: data.role || user.role,
  });
}
