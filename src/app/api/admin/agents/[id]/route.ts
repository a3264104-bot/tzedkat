import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/guard";

function validatePassword(pw: string): string | null {
  if (!pw || pw.length < 10) return "סיסמת נציג חייבת להכיל לפחות 10 תווים";
  if (!/[a-zA-Zא-ת]/.test(pw)) return "הסיסמה חייבת להכיל לפחות אות אחת";
  if (!/[0-9]/.test(pw)) return "הסיסמה חייבת להכיל לפחות ספרה אחת";
  return null;
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const g = await requireAdmin();
  if (!g.ok) return g.res;
  const { id } = await params;
  const b = await req.json();

  // ודא שזה אכן נציג
  const agent = await prisma.customer.findUnique({ where: { id } });
  if (!agent || agent.role !== "AGENT") {
    return NextResponse.json({ error: "נציג לא נמצא" }, { status: 404 });
  }

  const data: any = {};
  if ("name" in b && b.name) data.name = String(b.name).trim();
  if ("agentPointId" in b) data.agentPointId = b.agentPointId || null;
  if ("agentCanSetFinalPrice" in b) data.agentCanSetFinalPrice = !!b.agentCanSetFinalPrice;

  // איפוס סיסמה (אופציונלי) - המנהל מזין סיסמה חדשה
  if (b.password) {
    const pwError = validatePassword(String(b.password));
    if (pwError) return NextResponse.json({ error: pwError }, { status: 400 });
    data.passwordHash = await bcrypt.hash(String(b.password), 10);
  }

  await prisma.customer.update({ where: { id }, data });
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const g = await requireAdmin();
  if (!g.ok) return g.res;
  const { id } = await params;

  const agent = await prisma.customer.findUnique({ where: { id } });
  if (!agent || agent.role !== "AGENT") {
    return NextResponse.json({ error: "נציג לא נמצא" }, { status: 404 });
  }

  // אם לנציג יש הזמנות משויכות - לא מוחקים, רק הופכים ללקוח רגיל מושבת
  const orderCount = await prisma.order.count({ where: { customerId: id } });
  if (orderCount > 0) {
    await prisma.customer.update({
      where: { id },
      data: { role: "CUSTOMER", agentPointId: null, agentCanSetFinalPrice: false },
    });
    return NextResponse.json({ ok: true, demoted: true });
  }

  await prisma.customer.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
