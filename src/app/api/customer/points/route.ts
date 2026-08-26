import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// endpoint ציבורי - לא מצריך auth - נקודות חלוקה נדרשות בשלב ההרשמה לפני שהלקוח מחובר
export async function GET() {
  const points = await prisma.deliveryPoint.findMany({
    where: {
      isActive: true,
      // §289: 🚨 **נקודות סמויות אינן לעיני לקוחות.**
      //
      // הפרצה: ה-endpoint הזה ציבורי (נדרש בהרשמה, לפני התחברות)
      // והחזיר את **כל** הנקודות הפעילות - כולל הסמויות.
      //
      // נקודה סמויה נוצרת עבור אדם ספציפי - חנות או בית פרטי.
      // לקוח אקראי שבחר אותה בהרשמה היה מגיע למקום שלא מיועד לו,
      // הנציג לא מכיר אותו, ובעל הנקודה מקבל אורח לא צפוי.
      //
      // ⚠️ ובנוסף: שמות הנקודות הסמויות **הם שמות של אנשים**
      // ("גוטליב חיים", "ערנרייך דוד חיים"). ה-endpoint חשף
      // אותם לכל מי שפתח את דף ההרשמה.
      //
      // ⚠️ המנהל משייך נקודה סמויה ידנית - זו כל מהותה.
      isPrivate: false,
    },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    select: { id: true, name: true, city: true },
  });
  return NextResponse.json(points);
}
