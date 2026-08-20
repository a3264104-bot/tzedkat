import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/guard";

// רשימת/חיפוש לקוחות למנהל
export async function GET(req: Request) {
  const g = await requireAdmin();
  if (!g.ok) return g.res;

  const { searchParams } = new URL(req.url);
  const q = (searchParams.get("q") || "").trim();
  // §52: ברירת המחדל מציגה גם לקוחות שהושבתו, עם תגית.
  // המנהל צריך לראות אותם כדי להפעיל מחדש או לבדוק היסטוריה -
  // הסתרה מוחלטת הייתה הופכת אותם לבלתי נגישים.
  // includeInactive=false מסתיר אותם למי שרוצה רשימה נקייה.
  const includeInactive = searchParams.get("includeInactive") !== "false";

  const searchFilter = q
    ? {
        OR: [
          { name: { contains: q, mode: "insensitive" as const } },
          { phone: { contains: q } },
          { email: { contains: q, mode: "insensitive" as const } },
        ],
      }
    : {};

  // §127: 🐛 ההגבלה הייתה 100 **בשקט**.
  //
  // המנהל ראה רשימה שנראתה מלאה, בלי שום סימן שחסרים לקוחות.
  // עם 150 לקוחות, 50 מהם פשוט לא היו קיימים מבחינתו - והוא
  // היה יוצר לקוח כפול למי שכבר קיים ולא הופיע בחיפוש.
  //
  // ⚠️ ההגבלה עצמה נשארת: 2,000 שורות עם כל ה-include הזה הן
  // תשובה כבדה שתאט את המסך. אבל עכשיו היא **גבוהה מספיק**
  // לשימוש אמיתי, ובעיקר - מדווחת.
  const LIMIT = 500;

  const where = {
    ...searchFilter, // בלי סינון role - להראות הכל, גם נציגים ומנהלים
    ...(includeInactive ? {} : { isActive: true }),
  };

  // ⚠️ הספירה במקביל ולא בטור: עם המסד באירלנד כל שאילתה היא
  // נסיעה חוצת-אוקיינוס, והרצה בטור מכפילה את זמן הטעינה.
  const [customers, totalCount] = await Promise.all([
    prisma.customer.findMany({
    where,
    include: {
      defaultPoint: { select: { name: true, city: true } },
      _count: { select: { orders: true } },
      // 🆕 כל הנקודות של הנציג (many-to-many דרך AgentPoint)
      agentPoints: {
        select: {
          point: { select: { id: true, name: true, city: true } },
        },
      },
    },
    orderBy: { createdAt: "desc" },
    take: LIMIT,
    }),
    prisma.customer.count({ where }),
  ]);

  // §127: התשובה כוללת עכשיו מטא-דאטה, כדי שהמסך יוכל לומר
  // "מוצגים 500 מתוך 730". מבנה מערך נשמר בשדה rows לתאימות.
  return NextResponse.json({
    total: totalCount,
    shown: customers.length,
    truncated: totalCount > customers.length,
    rows: customers.map((c) => ({
      id: c.id,
      name: c.name,
      phone: c.phone,
      email: c.email,
      // §82: המזהה עצמו, לא רק השם - הבורר במסך העריכה צריך לדעת
      // מה נבחר, ובלעדיו הוא נפתח ריק תמיד.
      // §122: האם יש ללקוח סיסמה משלו. בלי זה הפאנל לא יודע
      // להבדיל בין "אין לו דרך להיכנס" ל"נכנס בסיסמה שבחר",
      // ומציג אזהרה שגויה ללקוח שנרשם באתר בעצמו.
      //
      // ⚠️ בוליאני בלבד - ה-hash עצמו לעולם לא יוצא מהשרת.
      hasPassword: !!c.passwordHash,
      // §145: מקבל קובץ אקסל להזמנה בכל מכירה
      wantsExcelOrder: !!c.wantsExcelOrder,
      // §126: יתרת זכות פתוחה - המנהל צריך לראות למי חייבים,
      // בלי להיכנס לכל כרטיס בנפרד.
      creditBalance: Number(c.creditBalance ?? 0),
      defaultPointId: c.defaultPointId,
      pointName: c.defaultPoint?.name ?? null,
      city: c.defaultPoint?.city ?? null,
      orderCount: c._count.orders,
      hasPaymentToken: !!c.paymentToken,
      cardLast4: c.cardLast4,
      cardExpiry: c.cardExpiry,
      cardNeedsUpdate: c.cardNeedsUpdate,
      passwordPlain: c.passwordPlain,
      // §62: **רק** האם יש קוד ומתי נקבע. הקוד עצמו לעולם לא נשלח
      // ברשימה - הוא נמשך בבקשה ייעודית (/api/admin/customer-code)
      // רק כשהמנהל לוחץ "הצג", וכל לחיצה נרשמת ביומן.
      //
      // לו היה מוחזר כאן, כל טעינת מסך הייתה שולחת לדפדפן את הקודים
      // של 100 לקוחות בבת אחת - ו-screenshot אחד היה חושף את כולם.
      hasLoginCode: !!c.loginCode,
      loginCodeSetAt: c.loginCodeSetAt,
      // §62: נעילה מפני ניחוש - המנהל צריך לדעת אם לקוח חסום
      lockedUntil: c.lockedUntil,
      failedLoginAttempts: c.failedLoginAttempts,
      // §60: אופן תשלום
      paymentPreference: c.paymentPreference,
      role: c.role,
      // §52: מצב פעילות - לתגית ברשימה ולכפתור ההשבתה במודל.
      // לקוח לא פעיל: לא מקבל מיילים, לא נכלל בברודקסט ובתזכורות,
      // ולא יכול לבצע הזמנה. ההיסטוריה שלו נשמרת במלואה.
      isActive: c.isActive,
      deactivatedAt: c.deactivatedAt,
      deactivatedReason: c.deactivatedReason,
      // deprecated - נשמר לתאימות אחורה עד שכל ה-UI ידע להשתמש ב-agentPoints[]
      agentPointId: c.agentPointId,
      // 🆕 רשימת כל הנקודות שהנציג משויך אליהן
      agentPoints: c.agentPoints.map((ap) => ({
        id: ap.point.id,
        name: ap.point.name,
        city: ap.point.city,
      })),
      agentCanSetFinalPrice: c.agentCanSetFinalPrice,
      agentCanSendPaymentLink: c.agentCanSendPaymentLink,
      agentCanCharge: c.agentCanCharge,
      agentCanUpdateCards: c.agentCanUpdateCards,
      commissionRateCarton: Number(c.commissionRateCarton),
      commissionRateSingles: Number(c.commissionRateSingles),
      createdAt: c.createdAt,
    })),
  });
}
