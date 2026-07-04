import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/guard";

// אכיפת מורכבות סיסמה לנציג - לפחות 10 תווים, אות ומספר
function validatePassword(pw: string): string | null {
  if (!pw || pw.length < 10) return "סיסמת נציג חייבת להכיל לפחות 10 תווים";
  if (!/[a-zA-Zא-ת]/.test(pw)) return "הסיסמה חייבת להכיל לפחות אות אחת";
  if (!/[0-9]/.test(pw)) return "הסיסמה חייבת להכיל לפחות ספרה אחת";
  return null;
}

// רשימת כל הנציגים
export async function GET() {
  const g = await requireAdmin();
  if (!g.ok) return g.res;

  const agents = await prisma.customer.findMany({
    where: { role: "AGENT" },
    include: { agentPoint: { select: { id: true, name: true, city: true } } },
    orderBy: { createdAt: "desc" },
  });

  // לא מחזירים passwordHash
  return NextResponse.json(
    agents.map((a) => ({
      id: a.id,
      name: a.name,
      email: a.email,
      phone: a.phone,
      agentPointId: a.agentPointId,
      agentPointName: a.agentPoint?.name ?? null,
      agentCanSetFinalPrice: a.agentCanSetFinalPrice,
    }))
  );
}

// יצירת נציג חדש
export async function POST(req: Request) {
  const g = await requireAdmin();
  if (!g.ok) return g.res;

  const b = await req.json();
  const name = String(b.name || "").trim();
  const email = String(b.email || "").trim().toLowerCase();
  const password = String(b.password || "");

  if (!name) return NextResponse.json({ error: "יש להזין שם" }, { status: 400 });
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: "כתובת מייל לא תקינה" }, { status: 400 });
  }
  const pwError = validatePassword(password);
  if (pwError) return NextResponse.json({ error: pwError }, { status: 400 });

  // בדיקת כפילות מייל (גם מול לקוחות רגילים - כי שניהם בטבלת Customer)
  const existing = await prisma.customer.findUnique({ where: { email } });
  if (existing) {
    return NextResponse.json({ error: "כבר קיים משתמש עם המייל הזה" }, { status: 409 });
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const agent = await prisma.customer.create({
    data: {
      name,
      email,
      passwordHash,
      role: "AGENT",
      agentPointId: b.agentPointId || null,
      agentCanSetFinalPrice: !!b.agentCanSetFinalPrice,
    },
  });

  return NextResponse.json({ ok: true, id: agent.id });
}
