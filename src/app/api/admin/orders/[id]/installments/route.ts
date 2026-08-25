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
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/guard";

/**
 * §261: מספרי התשלומים המותרים.
 *
 * ⚠️ זהה לבורר במסך ולרשימה של נדרים. ערך אחר יתקבל כאן,
 * וייכשל בחיוב עצמו - כלומר הבעיה תתגלה ברגע הכי גרוע.
 */
const ALLOWED = [1, 2, 3, 4, 6, 10, 12];

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const g = await requireAdmin();
  if (!g.ok) return g.res;

  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const n = Number(body.installments);

  if (!ALLOWED.includes(n)) {
    return NextResponse.json(
      { error: `מספר תשלומים לא תקין. מותר: ${ALLOWED.join(", ")}` },
      { status: 400 }
    );
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
    `[installments] ADMIN set order #${order.orderNumber} to ${n} payments`
  );

  return NextResponse.json({ ok: true, installments: n });
}
