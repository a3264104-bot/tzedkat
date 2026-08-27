// ═══════════════════════════════════════════════════════════════
// §261: שמירת מספר תשלומים מראש
// ═══════════════════════════════════════════════════════════════
// PATCH /api/admin/orders/[id]/installments
// Body: { installments: number }
//
// המצב מהשטח: לקוחות מבקשים פריסה בטלפון **ימים לפני** החיוב -
// לפעמים לפני שההזמנה בכלל נשקלה. המנהל צריך לרשום את זה מיד,
// אחרת הוא יזכור חמישה לקוחות ויפספס את השישי.
//
// ⚠️ נשמר ב-requestedInstallments - אותו שדה שהלקוח כותב אליו
// באתר. אין טעם בשני שדות שאומרים את אותו דבר, והחיוב ממילא
// קורא ממנו (§189).
//
// ⚠️ המנהל **גובר** על מה שהלקוח ביקש: הוא זה שמדבר איתו
// בטלפון, ומה שסוכם שם הוא האמת.

import { NextResponse } from "next/server";
import { validateInstallments } from "@/lib/installments-lib";
import { prisma } from "@/lib/prisma";
// §295: הנציג שומר פריסה כמו המנהל — עד 2.
import { auth } from "@/lib/auth";

/**
 * §261: מספרי התשלומים המותרים.
 *
 * ⚠️ זהה לבורר במסך ולרשימה של נדרים. ערך אחר יתקבל כאן,
 * וייכשל בחיוב עצמו - כלומר הבעיה תתגלה ברגע הכי גרוע.
 */
// §296: הרשימה והתקרה בספרייה המשותפת.

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  // §295: מנהל **או נציג**.
  //
  // הצורך: לקוח מבקש פריסה בטלפון ימים לפני החיוב, והנציג הוא
  // זה שמדבר איתו. שליחתו למנהל על כל בקשה כזו הופכת אותו
  // למתווך מיותר.
  const session = await auth();
  const role = (session?.user as any)?.role;
  if (role !== "ADMIN" && role !== "AGENT") {
    return NextResponse.json({ error: "אין הרשאה" }, { status: 403 });
  }
  const isAdmin = role === "ADMIN";

  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const n = Number(body.installments);

  // §296: אימות מהספרייה — כולל תקרת הנציג.
  const instErr = validateInstallments(n, isAdmin);
  if (instErr) {
    return NextResponse.json({ error: instErr }, { status: isAdmin ? 400 : 403 });
  }


  const order = await prisma.order.findUnique({
    where: { id },
    select: { id: true, orderNumber: true, paymentStatus: true },
  });
  if (!order) {
    return NextResponse.json({ error: "הזמנה לא נמצאה" }, { status: 404 });
  }

  // ⚠️ הזמנה ששולמה כבר - אין מה לשנות, והשינוי היה מטעה:
  // הוא ייראה כאילו הוא משפיע על חיוב שכבר בוצע.
  if (order.paymentStatus === "PAID") {
    return NextResponse.json(
      { error: "ההזמנה כבר שולמה — לא ניתן לשנות פריסה" },
      { status: 400 }
    );
  }

  await prisma.order.update({
    where: { id },
    data: { requestedInstallments: n },
  });

  console.log(
    `[installments] ${role} set order #${order.orderNumber} to ${n} payments`
  );

  return NextResponse.json({ ok: true, installments: n });
}
