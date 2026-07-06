import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/guard";

// עדכון לקוח ע"י מנהל: איפוס סיסמה / עדכון מייל / שם / טלפון.
// זהו מסלול החילוץ ללקוחות שנתקעו (שכחו סיסמה בלי מייל רשום וכו')
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const g = await requireAdmin();
  if (!g.ok) return g.res;
  const { id } = await params;
  const b = await req.json();

  const customer = await prisma.customer.findUnique({ where: { id } });
  if (!customer || customer.role !== "CUSTOMER") {
    return NextResponse.json({ error: "לקוח לא נמצא" }, { status: 404 });
  }

  const data: any = {};

  if ("name" in b && b.name) data.name = String(b.name).trim();

  // עדכון מייל - עם בדיקת כפילות
  if ("email" in b) {
    const email = b.email ? String(b.email).trim().toLowerCase() : null;
    if (email) {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return NextResponse.json({ error: "כתובת מייל לא תקינה" }, { status: 400 });
      }
      const existing = await prisma.customer.findUnique({ where: { email } });
      if (existing && existing.id !== id) {
        return NextResponse.json({ error: "המייל כבר שייך למשתמש אחר" }, { status: 409 });
      }
    }
    data.email = email;
  }

  // עדכון טלפון - עם בדיקת כפילות
  if ("phone" in b) {
    const phone = b.phone ? String(b.phone).trim() : null;
    if (phone) {
      const existing = await prisma.customer.findUnique({ where: { phone } });
      if (existing && existing.id !== id) {
        return NextResponse.json({ error: "הטלפון כבר שייך למשתמש אחר" }, { status: 409 });
      }
    }
    data.phone = phone;
  }

  // איפוס סיסמה ע"י המנהל - סיסמה זמנית שנמסרת ללקוח טלפונית
  if (b.newPassword) {
    const pw = String(b.newPassword);
    if (pw.length < 6) {
      return NextResponse.json({ error: "סיסמה חייבת לפחות 6 תווים" }, { status: 400 });
    }
    data.passwordHash = await bcrypt.hash(pw, 10);
    // מבטלים טוקן איפוס קיים אם יש (הסיסמה החדשה גוברת)
    data.resetToken = null;
    data.resetTokenExpiry = null;
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "לא נשלח שום שינוי" }, { status: 400 });
  }

  await prisma.customer.update({ where: { id }, data });
  return NextResponse.json({ ok: true });
}
