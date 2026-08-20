// ═══════════════════════════════════════════════════════════════
// §153: הלקוח משנה את פרטי הכניסה שלו
// ═══════════════════════════════════════════════════════════════
// POST /api/customer/credential   { current, next }
//
// 🐛 הפער: הדרך היחידה לשנות הייתה "שלח קישור למייל". לרוב
// הלקוחות אין מייל, ולכן לא הייתה להם שום דרך - הם היו תקועים
// עם מה שהמערכת נתנה, או נאלצים להתקשר לנציג.
//
// ⚠️ הערך החדש נשמר **בשני השדות**: loginCode ו-passwordHash.
//
// זו הנקודה שהופכת אותו ל"אחד" באמת:
//   • passwordHash - bcrypt, חד-כיווני, משמש לאימות
//   • loginCode    - מוצפן דו-כיווני, ולכן **ניתן להקראה בטלפון**
//
// שמירה ב-passwordHash בלבד הייתה שוברת את ההקראה: bcrypt אינו
// הפיך, והמערכת הטלפונית לא יכולה להקריא ערך שאי אפשר לפענח.

import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { encryptCode, decryptCode, codesMatch } from "@/lib/login-code";

/** ⚠️ 4-12 תווים. ארוך מזה אינו ניתן להקראה מעשית בטלפון. */
const MIN_LEN = 4;
const MAX_LEN = 12;

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "יש להתחבר" }, { status: 401 });
  }
  const userId = (session.user as any).id as string;

  const b = await req.json().catch(() => ({}));
  const current = String(b.current ?? "").trim();
  const next = String(b.next ?? "").trim();

  const customer = await prisma.customer.findUnique({
    where: { id: userId },
    select: {
      id: true,
      loginCode: true,
      passwordHash: true,
      isActive: true,
    },
  });
  if (!customer) {
    return NextResponse.json({ error: "לקוח לא נמצא" }, { status: 404 });
  }
  if (customer.isActive === false) {
    return NextResponse.json({ error: "החשבון אינו פעיל" }, { status: 403 });
  }

  // ─── אימות הפרטים הנוכחיים ───
  //
  // ⚠️ חובה, גם כשהמשתמש כבר מחובר. מי שתפס טלפון פתוח יכול היה
  // לשנות את פרטי הכניסה ולנעול את הבעלים מחוץ לחשבון שלו.
  //
  // ⚠️ בודקים את שני המקורות, בדיוק כמו בהתחברות (§125) - אחרת
  // לקוח שנכנס בסיסמה לא יוכל לאמת איתה כאן.
  let ok = false;
  const storedCode = decryptCode(customer.loginCode);
  if (storedCode && codesMatch(storedCode, current)) ok = true;
  if (!ok && customer.passwordHash) {
    ok = await bcrypt.compare(current, customer.passwordHash);
  }
  if (!ok) {
    return NextResponse.json(
      { error: "הפרטים הנוכחיים שגויים" },
      { status: 400 }
    );
  }

  // ─── ולידציה של הערך החדש ───
  if (next.length < MIN_LEN || next.length > MAX_LEN) {
    return NextResponse.json(
      { error: `הפרטים חייבים להיות באורך ${MIN_LEN} עד ${MAX_LEN} תווים` },
      { status: 400 }
    );
  }

  // ⚠️ אותיות לטיניות וספרות בלבד.
  //
  // עברית, רווחים וסימנים אינם ניתנים להקראה אמינה בטלפון, והלקוח
  // ששומע אותם לא יידע מה להקליד. הגבלה כאן עדיפה על תסכול אחר כך.
  if (!/^[A-Za-z0-9]+$/.test(next)) {
    return NextResponse.json(
      {
        error:
          "ניתן להשתמש באותיות באנגלית ובספרות בלבד — כדי שנוכל להקריא את הפרטים במערכת הטלפונית.",
      },
      { status: 400 }
    );
  }

  if (next === current) {
    return NextResponse.json(
      { error: "הפרטים החדשים זהים לנוכחיים" },
      { status: 400 }
    );
  }

  // ⚠️ ערכים נפוצים נחסמים. "1234" הוא הניחוש הראשון של כל מי
  // שמנסה להיכנס לחשבון של מישהו אחר.
  const WEAK = ["1234", "12345", "123456", "0000", "1111", "abcd", "aaaa"];
  if (WEAK.includes(next.toLowerCase())) {
    return NextResponse.json(
      { error: "הפרטים פשוטים מדי. נא לבחור משהו אחר." },
      { status: 400 }
    );
  }

  // ─── שמירה בשני השדות ───
  await prisma.customer.update({
    where: { id: userId },
    data: {
      // לאימות בכניסה
      passwordHash: await bcrypt.hash(next, 10),
      // ⚠️ בגלוי - כדי שהמנהל יוכל למסור ללקוח ששכח
      passwordPlain: next,
      // ⚠️ מוצפן דו-כיווני - זה מה שמאפשר הקראה בטלפון
      loginCode: encryptCode(next),
      loginCodeSetAt: new Date(),
      // ניקוי נעילה: מי ששינה בהצלחה אינו אמור להיחסם מיד אחרי
      failedLoginAttempts: 0,
      lockedUntil: null,
    },
  });

  console.log(`[credential] changed by customer=${userId}`);

  return NextResponse.json({
    ok: true,
    message:
      "הפרטים עודכנו. ניתן להשתמש בהם בכניסה לאתר, והם יושמעו גם במערכת הטלפונית.",
  });
}
