import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "@/lib/prisma";

const schema = z
  .object({
    name: z.string().min(1, "יש להזין שם"),
    phone: z.string().trim().optional().nullable(),
    email: z.string().trim().email("כתובת מייל לא תקינה").optional().nullable().or(z.literal("")),
    password: z.string().min(6, "הסיסמה חייבת להכיל לפחות 6 תווים"),
    defaultPointId: z.string().optional().nullable(),
  })
  .refine((d) => (d.phone && d.phone.length > 0) || (d.email && d.email.length > 0), {
    message: "יש להזין טלפון או מייל (לפחות אחד מהשניים)",
  });

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const data = schema.parse(body);

    const phone = data.phone?.trim() || null;
    const email = data.email?.trim().toLowerCase() || null;

    // בדיקת כפילות מפורשת - לפני יצירה - כדי להחזיר הודעה ידידותית ולא רק שגיאת unique מה-DB
    if (phone) {
      const existingByPhone = await prisma.customer.findUnique({ where: { phone } });
      if (existingByPhone) {
        return NextResponse.json(
          {
            error: "כבר קיים חשבון עם מספר הטלפון הזה. נסה להתחבר, או לאפס סיסמה.",
            code: "DUPLICATE_PHONE",
          },
          { status: 409 }
        );
      }
    }
    if (email) {
      const existingByEmail = await prisma.customer.findUnique({ where: { email } });
      if (existingByEmail) {
        return NextResponse.json(
          {
            error: "כבר קיים חשבון עם כתובת המייל הזו. נסה להתחבר, או לאפס סיסמה.",
            code: "DUPLICATE_EMAIL",
          },
          { status: 409 }
        );
      }
    }

    const passwordHash = await bcrypt.hash(data.password, 10);

    const customer = await prisma.customer.create({
      data: {
        name: data.name.trim(),
        phone,
        email,
        passwordHash,
        defaultPointId: data.defaultPointId || null,
      },
    });

    // לא מחזירים passwordHash בתשובה
    return NextResponse.json({
      ok: true,
      id: customer.id,
      // מחזירים identifier כדי שהקליינט יוכל לבצע signIn אוטומטי מיד אחרי ההרשמה
      identifier: phone || email,
    });
  } catch (e: any) {
    if (e?.issues) {
      // zod validation error - מחזירים את ההודעה הראשונה הברורה
      const msg = e.issues[0]?.message || "נתונים שגויים";
      return NextResponse.json({ error: msg }, { status: 400 });
    }
    // הגנה כפולה: אם משום מה ה-unique constraint ב-DB נתפס (race condition בין הבדיקה ליצירה)
    if (e?.code === "P2002") {
      return NextResponse.json(
        { error: "כבר קיים חשבון עם הפרטים האלה. נסה להתחבר, או לאפס סיסמה.", code: "DUPLICATE" },
        { status: 409 }
      );
    }
    console.error(e);
    return NextResponse.json({ error: "שגיאת שרת" }, { status: 500 });
  }
}
