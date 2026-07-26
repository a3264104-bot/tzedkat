// §20: איפוס סיסמא לנציג
// POST /api/admin/agents/[id]/reset-password
// מייצר סיסמא זמנית חדשה, מעדכן ב-DB, ומחזיר אותה למנהל (פעם אחת בלבד).
// מכיוון שהסיסמאות מוצפנות ב-DB (bcrypt), לא ניתן להציג את הישנה.

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/guard";
import bcrypt from "bcryptjs";

// יצירת סיסמא אקראית קריאה - 4 אותיות + 4 ספרות
function generatePassword(): string {
  const letters = "abcdefghjkmnpqrstuvwxyz"; // בלי אותיות מבלבלות (i, l, o)
  const numbers = "23456789"; // בלי 0, 1
  let out = "";
  for (let i = 0; i < 4; i++) {
    out += letters[Math.floor(Math.random() * letters.length)];
  }
  for (let i = 0; i < 4; i++) {
    out += numbers[Math.floor(Math.random() * numbers.length)];
  }
  return out;
}

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const g = await requireAdmin();
  if (!g.ok) return g.res;

  const { id } = await params;

  const agent = await prisma.customer.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      role: true,
      phone: true,
      email: true,
    },
  });

  if (!agent) {
    return NextResponse.json({ error: "משתמש לא נמצא" }, { status: 404 });
  }

  if (agent.role !== "AGENT" && agent.role !== "ADMIN") {
    return NextResponse.json(
      { error: "ניתן לאפס סיסמא רק לנציגים או מנהלים" },
      { status: 400 }
    );
  }

  const newPassword = generatePassword();
  const hashed = await bcrypt.hash(newPassword, 10);

  await prisma.customer.update({
    where: { id },
    data: {
      passwordHash: hashed,
      // שמירת הסיסמא בטקסט גלוי כדי שהמנהל יוכל לראות אותה בהמשך
      passwordPlain: newPassword,
    },
  });

  // מחזירים את הסיסמא הגלויה
  return NextResponse.json({
    ok: true,
    agent: {
      id: agent.id,
      name: agent.name,
      phone: agent.phone,
      email: agent.email,
    },
    newPassword,
    message: "הסיסמא אופסה. היא תישאר גלויה בפרופיל הנציג לצפייה עתידית.",
  });
}
