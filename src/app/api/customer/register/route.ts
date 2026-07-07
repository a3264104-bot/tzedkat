import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "@/lib/prisma";

// מודל הזיהוי: טלפון = חובה (המזהה הראשי להתחברות, לכולם יש).
// מייל = אופציונלי אך מומלץ (מאפשר איפוס סיסמה עצמאי + אישורי הזמנה).
const schema = z.object({
  name: z.string().min(1, "יש להזין שם"),
  phone: z.string().trim().min(1, "יש להזין מספר טלפון"),
  email: z.string().trim().email("כתובת מייל לא תקינה").optional().nullable().or(z.literal("")),
  password: z.string().min(6, "הסיסמה חייבת להכיל לפחות 6 תווים"),
  defaultPointId: z.string().optional().nullable(),
});

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const data = schema.parse(body);

    // נירמול טלפון: שומרים תמיד ספרות בלבד בפורמט מקומי (0501234567),
    // כדי שההתחברות תמצא את המספר בלי תלות באיך המשתמש הקליד (מקפים/רווחים/+972)
    const digits = data.phone.replace(/\D/g, "");
    const phone = digits.startsWith("972") ? "0" + digits.slice(3) : digits;
    if (phone.length < 9 || phone.length > 10) {
      return NextResponse.json({ error: "מספר טלפון לא תקין" }, { status: 400 });
    }
    const email = data.email?.trim().toLowerCase() || null;

    // בדיקת כפילות מפורשת - לפני יצירה - כדי להחזיר הודעה ידידותית ולא רק שגיאת unique מה-DB
    if (phone) {
      const existingByPhone = await prisma.customer.findUnique({ where: { phone } });
      if (existingByPhone) {
        return NextResponse.json(
          {
            error:
              "כבר קיים חשבון עם מספר הטלפון הזה. נסה להתחבר עם הטלפון והסיסמה, או השתמש ב'שכחתי סיסמה' עם המייל שנרשמת איתו במקור.",
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
            error:
              "כבר קיים חשבון עם כתובת המייל הזו. נסה להתחבר, או השתמש ב'שכחתי סיסמה' כדי לקבל קישור לאיפוס.",
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
