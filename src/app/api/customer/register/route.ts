import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
// §167: סגירת פניות טלפוניות פתוחות בהקמת לקוח
import { closeOpenRequestsForPhone } from "@/lib/close-requests-lib";
import { normalizePhone, isValidPhone, cleanName } from "@/lib/identity";
// §173: הרכבת השם המלא משם פרטי ומשפחה
import { buildName } from "@/lib/name-lib";
// §121: הפקת קוד כניסה אוטומטית
import { ensureLoginCode } from "@/lib/login-code";

// מודל הזיהוי: טלפון = חובה (המזהה הראשי להתחברות, לכולם יש).
// מייל = אופציונלי אך מומלץ (מאפשר איפוס סיסמה עצמאי + אישורי הזמנה).
const schema = z.object({
  // §173: שם פרטי ומשפחה בנפרד.
  //
  // ⚠️ name נשאר אופציונלי לתאימות: קליינט ישן ששולח רק name
  // ימשיך לעבוד עד שהמסך יתעדכן. אם שניהם הגיעו - הפיצול מנצח.
  name: z.string().optional(),
  firstName: z.string().optional(),
  lastName: z.string().optional(),
  phone: z.string().trim().min(1, "יש להזין מספר טלפון"),
  email: z.string().trim().email("כתובת מייל לא תקינה").optional().nullable().or(z.literal("")),
  password: z.string().min(6, "הסיסמה חייבת להכיל לפחות 6 תווים"),
  defaultPointId: z.string().optional().nullable(),
  // §66: אופציונלי. ההסכמה למיילים אוחדה לתוך אישור התנאים ונכללת
  // בנוסח שהלקוח מאשר; השדה נשאר לתאימות עם קליינטים ישנים בלבד.
  agreedToEmails: z.boolean().optional(),
  // §22: הסכמה לתנאי השימוש ומדיניות הפרטיות - חובה.
  // optional ב-zod בכוונה: קליינטים ישנים (טאב פתוח מלפני הפריסה) לא ישלחו
  // את השדה, ואנחנו לא רוצים שההרשמה תיפול עם "נתונים שגויים" גנרי.
  // האכיפה האמיתית נעשית למטה עם הודעה ברורה.
  agreedToTerms: z.boolean().optional(),
});

// גרסת התנאים שהלקוח מאשר. יש לעדכן כשמשנים את עמוד התנאים באופן מהותי,
// כדי שהתיעוד יראה לאיזו גרסה בדיוק כל לקוח הסכים.
const TERMS_VERSION = "2026-08";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const data = schema.parse(body);

    // נירמול טלפון: שומרים תמיד ספרות בלבד בפורמט מקומי (0501234567),
    // כדי שההתחברות תמצא את המספר בלי תלות באיך המשתמש הקליד (מקפים/רווחים/+972)
    // §71: מקור אמת אחד לנירמול - ראה src/lib/identity.ts
    const phone = normalizePhone(data.phone);
    if (!isValidPhone(phone)) {
      return NextResponse.json({ error: "מספר טלפון לא תקין" }, { status: 400 });
    }

    // §289: 🚨 **אימות הנקודה בשרת.**
    //
    // הפרצה: defaultPointId הגיע מהלקוח ונשמר כמו שהוא. מסך
    // ההרשמה מציג רק נקודות ציבוריות (אחרי התיקון ב-points),
    // אבל בקשה ידנית עוקפת מסך.
    //
    // נקודה סמויה נוצרת עבור אדם ספציפי - חנות או בית פרטי.
    // לקוח שנרשם אליה מגיע למקום שלא מיועד לו, הנציג לא מכיר
    // אותו, ובעל הנקודה מקבל אורח לא צפוי.
    //
    // ⚠️ אותה טעות של §221 (מחירון נציגים): המסך הסתיר, והשרת
    // לא אימת. שם זה היה מחירי סיטונאות, כאן זו כתובת של אדם.
    //
    // ⚠️ המנהל משייך נקודה סמויה ידנית - זו כל מהותה.
    if (data.defaultPointId) {
      const point = await prisma.deliveryPoint.findUnique({
        where: { id: data.defaultPointId },
        select: { isActive: true, isPrivate: true },
      });
      if (!point || !point.isActive || point.isPrivate) {
        return NextResponse.json(
          { error: "נקודת החלוקה שנבחרה אינה זמינה" },
          { status: 400 }
        );
      }
    }
    // §173: הרכבת השם.
    //
    // 🐛 מה שגרם לבעיה: שדה שם אחד. לקוחות הזינו "ברכה" בלבד,
    // ובחלוקה אי אפשר היה לדעת אם זה שם פרטי או משפחה.
    //
    // ⚠️ הבדיקה בשרת ולא רק בטופס: הסתרת שדה נעקפת בבקשה ישירה,
    // וזה בדיוק המקרה שיצר את הנתונים החסרים.
    //
    // ⚠️ תאימות לאחור: קליינט ישן ששולח רק name ממשיך לעבוד -
    // אחרת פריסה חלקית הייתה שוברת את ההרשמה לגמרי.
    let firstName: string | null = null;
    let lastName: string | null = null;
    let fullName: string;

    if (data.firstName || data.lastName) {
      const built = buildName(data.firstName, data.lastName);
      if (!built.ok) {
        return NextResponse.json({ error: built.error }, { status: 400 });
      }
      firstName = built.firstName;
      lastName = built.lastName;
      fullName = built.name;
    } else {
      const legacy = cleanName(String(data.name ?? ""));
      if (!legacy || legacy.length < 2) {
        return NextResponse.json(
          { error: "יש להזין שם פרטי ושם משפחה" },
          { status: 400 }
        );
      }
      fullName = legacy;
    }

    const email = data.email?.trim().toLowerCase() || null;

    // §66: אישור התנאים כולל את ההסכמה למיילים (סעיף 2).
    //
    // 🐛 מה שהשתנה: קודם היו שתי בדיקות נפרדות, ומי שסימן רק אחת
    // קיבל שגיאה ונטש. עכשיו הנוסח שהלקוח מאשר כולל במפורש גם
    // "קבלת עדכונים במייל", ולכן אישור אחד מספיק.
    //
    // ⚠️ ההסכמה עצמה לא בוטלה ולא הפכה משתמעת: היא כתובה בנוסח,
    // ונשמרת עם חותמת זמן וגרסת תנאים - ההוכחה שתידרש במחלוקת
    // (GDPR/CAN-SPAM) נשארת שלמה.
    //
    // agreedToEmails עדיין מתקבל בגוף הבקשה לתאימות עם קליינטים
    // ישנים, אבל האכיפה היא על agreedToTerms בלבד.
    if (!data.agreedToTerms) {
      return NextResponse.json(
        {
          error:
            "יש לאשר את תנאי השימוש, מדיניות הפרטיות וקבלת העדכונים כדי להירשם",
        },
        { status: 400 }
      );
    }

    // §76: מחושב כאן ולא אחרי בדיקות הכפילות, כי מסלול השלמת
    // ההרשמה הטלפונית (למטה) משתמש בו לפני נקודת היצירה.
    const passwordHash = await bcrypt.hash(data.password, 10);

    // בדיקת כפילות מפורשת - לפני יצירה - כדי להחזיר הודעה ידידותית ולא רק שגיאת unique מה-DB
    if (phone) {
      const existingByPhone = await prisma.customer.findUnique({
        where: { phone },
        select: {
          id: true,
          email: true,
          loginCode: true,
          paymentToken: true,
          isActivated: true,
          _count: { select: { orders: true } },
        },
      });

      // ═══════════════════════════════════════════════════════════
      // §76: השלמת הרשמה של לקוח שנרשם בטלפון
      // ═══════════════════════════════════════════════════════════
      // 🐛 הפער: לקוח שנרשם ב-IVR ועדיין לא אושר ע"י נציג הגיע
      // לאתר, בחר "הרשמה", וקיבל "המספר כבר קיים" - בלי שום דרך
      // להמשיך. ההודעה שלחה אותו ל"שכחתי סיסמה" שעובד רק דרך מייל
      // שאין לו.
      //
      // עכשיו: אם החשבון עדיין **ריק** - אין כרטיס אשראי ואין
      // הזמנות - הטופס פשוט משלים אותו. אין כאן סיכון גדול יותר
      // מהרשמה חופשית רגילה: אין מה לגנוב מחשבון ריק, ולקוח לא
      // מאושר ממילא אינו יכול להזמין.
      //
      // ⚠️ הגבול: ברגע שיש טוקן אשראי או הזמנות, ההשלמה נחסמת -
      // שם השתלטות הייתה נותנת גישה לכרטיס השמור ולהיסטוריה.
      const isEmptyAccount =
        !existingByPhone?.paymentToken && (existingByPhone?._count.orders ?? 0) === 0;

      if (existingByPhone && isEmptyAccount) {
        // מייל חדש - רק אם אינו תפוס אצל לקוח אחר
        if (email) {
          const emailTaken = await prisma.customer.findFirst({
            where: { email, NOT: { id: existingByPhone.id } },
            select: { id: true },
          });
          if (emailTaken) {
            return NextResponse.json(
              {
                error:
                  "כתובת המייל הזו כבר משויכת לחשבון אחר. נסה מייל אחר, או התחבר לחשבון הקיים.",
                code: "DUPLICATE_EMAIL",
              },
              { status: 409 }
            );
          }
        }

        const updated = await prisma.customer.update({
          where: { id: existingByPhone.id },
          data: {
            name: fullName,
            firstName,
            lastName,
            email,
            passwordHash,
            // נקודה חדשה רק אם נבחרה; אחרת נשמרת זו שנבחרה בטלפון
            ...(data.defaultPointId ? { defaultPointId: data.defaultPointId } : {}),
            // הלקוח השלים בעצמו - החשבון פעיל מבחינתו
            isActivated: true,
            agreedToEmails: true,
            agreedToEmailsAt: new Date(),
            agreedToTerms: true,
            agreedToTermsAt: new Date(),
            termsVersion: TERMS_VERSION,
          },
          select: { id: true },
        });

        // §76: סגירת בקשת ההרשמה הטלפונית, כדי שהנציג לא יקים אותו
        // שוב. בלי זה היו שתי רשומות במסך "בקשות מהטלפון" - אחת
        // פתוחה שכבר טופלה - והנציג היה יוצר כפילות.
        await prisma.phoneSignupRequest
          .updateMany({
            // ⚠️ הסטטוסים של PhoneSignupRequest הם
            // NEW -> ASSIGNED -> CONTACTED -> COMPLETED / FAILED.
            // "DONE" אינו קיים כאן (הוא שייך ל-PersonalRequest).
            where: {
              customerId: existingByPhone.id,
              status: { notIn: ["COMPLETED", "FAILED"] },
            },
            data: {
              status: "COMPLETED",
              completedAt: new Date(),
              note: "הלקוח השלים את ההרשמה באתר בעצמו",
            },
          })
          .catch((e) => {
            // כשל כאן לא מצדיק כשל בהרשמה - הנציג יראה בקשה כפולה
            // וזה מטרד, לא נזק.
            console.error("[register] failed closing phone signup request:", e);
          });

        console.log(
          `[register] completed phone-signup account: customer=${existingByPhone.id}`
        );

        return NextResponse.json({
          ok: true,
          id: updated.id,
          identifier: phone,
          completedPhoneSignup: true,
        });
      }

      if (existingByPhone) {
        // §75: 🐛 המסר הקודם שלח את הלקוח ל"שכחתי סיסמה" - שעובד
        // **רק דרך מייל**. לקוח שנרשם בטלפון אין לו מייל בכלל, ולכן
        // הוא נתקע: ההרשמה חסומה, וההתאוששות בלתי אפשרית.
        //
        // עכשיו המסר תלוי במה שבאמת קיים לו:
        //   יש קוד  -> הוא קיבל אותו בשיחה. שולחים אותו להתחבר.
        //   יש מייל -> "שכחתי סיסמה" באמת רלוונטי.
        //   אין כלום -> להתקשר שוב ל-IVR, ששם ישמע קוד.
        const hasCode = !!existingByPhone.loginCode;
        const hasEmail = !!existingByPhone.email;

        return NextResponse.json(
          {
            error: hasCode
              ? "מספר הטלפון הזה כבר רשום במערכת. בשיחה הטלפונית קיבלת קוד כניסה בן 4 ספרות — היכנס עם מספר הטלפון והקוד הזה."
              : hasEmail
                ? "כבר קיים חשבון עם מספר הטלפון הזה. נסה להתחבר, או השתמש ב'שכחתי סיסמה' עם המייל שנרשמת איתו."
                : "מספר הטלפון הזה כבר רשום במערכת, אך אין לו עדיין קוד כניסה. התקשר למערכת הטלפונית — הקוד יוקרא לך בשיחה.",
            code: "DUPLICATE_PHONE",
            // הקליינט מציג מסלול המשך במקום שגיאה סתומה
            hasLoginCode: hasCode,
            hasEmail,
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

    const customer = await prisma.customer.create({
      data: {
        name: fullName,
        firstName,
        lastName,
        phone,
        email,
        passwordHash,
        // §151: הסיסמה נשמרת גם בגלוי, כדי שהמנהל יוכל למסור אותה
        // ללקוח שהתקשר ואמר "שכחתי".
        //
        // ⚠️ זו החלטה מודעת שמחליפה אבטחה בשירות. השיקול: הקהילה
        // סגורה, המנהל ממילא יכול לאפס סיסמה או להתחזות (§62),
        // והחלופה - "אאפס לך ותקבל מייל" - לא עובדת לרוב הלקוחות
        // כי אין להם מייל.
        //
        // ⚠️ ה-hash **נשאר** ומשמש להתחברות. הערך הגלוי הוא לתצוגה
        // בלבד, ולעולם אינו מושווה בכניסה.
        passwordPlain: data.password,
        defaultPointId: data.defaultPointId || null,
        // הסכמה חד-פעמית לקבלת מיילים שיווקיים (עדכוני מכירות וכו')
        // תיעוד timestamp חשוב לרגולציה (GDPR/CAN-SPAM) ולהוכחת הסכמה במחלוקת
        agreedToEmails: true,
        agreedToEmailsAt: new Date(),
        // §22: תיעוד ההסכמה לתנאי השימוש - ההוכחה שתידרש במחלוקת
        agreedToTerms: true,
        agreedToTermsAt: new Date(),
        termsVersion: TERMS_VERSION,
      },
    });

  // §167: סגירת פניות טלפוניות פתוחות של אותו מספר.
  //
  // 🐛 בלי זה ההודעה נשארת "חדשה" לנצח: customerId עליה נקבע
  // ברגע השיחה, ומתקשר שלא היה רשום אז מקבל null - ואף אחד לא
  // מחבר בין השניים אחר כך. המנהל היה רואה בקשה, לוחץ "הקם
  // לקוח", ומקבל "כבר קיים".
  //
  // ⚠️ await ולא fire-and-forget: ב-Vercel הפונקציה מסתיימת עם
  // התשובה, ועבודה ברקע נקטעת.
  // ⚠️ בלי השמה למשתנה: התוצאה אינה בשימוש, ו-noUnusedLocals
  // ב-tsconfig היה מכשיל את ה-build. הסגירה עצמה חשובה, הספירה
  // רק ללוג.
  await closeOpenRequestsForPhone(prisma, phone, customer.id);

    // §121: הפקת קוד כניסה גם בהרשמה עצמית.
    //
    // 🐛 הפער שנסגר: הרשמה באתר שמרה סיסמה בלבד. הלקוח נכנס איתה
    // בהצלחה, אבל:
    //   • בכרטיס שלו אצל המנהל היה כתוב "אין קוד"
    //   • בטלפון, אפשרות "שמיעת קוד הכניסה" לא הייתה זמינה לו
    //   • המנהל היה צריך להפיק ידנית כדי שיוכל להשתמש בטלפון
    //
    // עכשיו לכל לקוח יש קוד מרגע ההרשמה, בלי קשר לאיך נרשם.
    // הסיסמה שבחר ממשיכה לעבוד - הקוד הוא דרך **נוספת**, לא חלופה.
    //
    // ⚠️ לא חוסם: כשל בהפקה לא יפיל הרשמה שכבר הצליחה.
    await ensureLoginCode(prisma, customer.id);

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
