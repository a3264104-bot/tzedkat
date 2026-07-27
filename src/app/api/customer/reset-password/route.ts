import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";

export async function POST(req: Request) {
  try {
    const { token, password } = await req.json();
    if (!token || !password) {
      return NextResponse.json({ error: "נתונים חסרים" }, { status: 400 });
    }
    if (String(password).length < 6) {
      return NextResponse.json({ error: "הסיסמה חייבת להכיל לפחות 6 תווים" }, { status: 400 });
    }

    const customer = await prisma.customer.findUnique({ where: { resetToken: String(token) } });
    if (!customer || !customer.resetTokenExpiry || customer.resetTokenExpiry < new Date()) {
      return NextResponse.json(
        { error: "קישור האיפוס אינו תקין או שפג תוקפו. נא לבקש קישור חדש." },
        { status: 400 }
      );
    }

    const passwordHash = await bcrypt.hash(String(password), 10);
    // חשוב: מנקים passwordPlain אם היה (מנציג שאיפס לו מנהל בעבר).
    // אחרי איפוס עצמי הסיסמא לא זמינה יותר למנהל - נדרש איפוס מחדש דרך המנהל.
    // וגם: מסמנים isActivated=true כי אם המשתמש עשה איפוס בעצמו, סימן שהחשבון פעיל.
    await prisma.customer.update({
      where: { id: customer.id },
      data: {
        passwordHash,
        passwordPlain: null,
        isActivated: true,
        resetToken: null,
        resetTokenExpiry: null,
      },
    });

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "שגיאת שרת" }, { status: 500 });
  }
}
