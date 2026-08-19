import { NextResponse } from "next/server";
import crypto from "crypto";
import { prisma } from "@/lib/prisma";
import { Resend } from "resend";

const FROM_ADDRESS = "צדקת רבותינו <orders@tzidkat.com>";

export async function POST(req: Request) {
  try {
    const { email } = await req.json();
    const normalizedEmail = String(email || "").trim().toLowerCase();

    if (!normalizedEmail) {
      return NextResponse.json({ error: "יש להזין כתובת מייל" }, { status: 400 });
    }

    const customer = await prisma.customer.findUnique({ where: { email: normalizedEmail } });

    // חשוב: לא חושפים אם המייל קיים או לא (מניעת חיפוש חשבונות) - תמיד מחזירים הודעת הצלחה זהה.
    // אם הלקוח קיים, שולחים בפועל; אם לא, פשוט לא קורה כלום בשקט.
    //
    // §146: מעקב פנימי - לא נחשף ללקוח, אבל נרשם בלוג כדי שאפשר
    // יהיה לאתר למה מייל לא הגיע.
    let internalStatus = "no-account";

    if (customer) {
      internalStatus = "sent";

      // §146: 🐛 לקוח לא פעיל קיבל קישור איפוס והתחבר - אבל אינו
      // יכול להזמין. הוא היה מגיע למסך ריק בלי להבין למה.
      if (customer.isActive === false) {
        internalStatus = "inactive-account";
        console.warn(
          `[forgot-password] inactive account requested reset: ${normalizedEmail}`
        );
      } else {
        const token = crypto.randomBytes(32).toString("hex");
        const expiry = new Date(Date.now() + 60 * 60 * 1000); // שעה אחת

        await prisma.customer.update({
          where: { id: customer.id },
          data: { resetToken: token, resetTokenExpiry: expiry },
        });

        const resetUrl = `${process.env.NEXT_PUBLIC_APP_URL || "https://tzidkat.com"}/reset-password?token=${token}`;

        // §146: 🐛 הבאג המרכזי - RESEND_API_KEY חסר.
        //
        // `new Resend(undefined)` **אינו זורק שגיאה**. הוא נוצר
        // בשקט, וקריאת send נכשלת - אבל ה-catch למטה בולע גם
        // אותה. התוצאה: הלקוח רואה "נשלח בהצלחה", בלוג יש שורה
        // אחת עמומה, ואיש לא יודע שהמפתח חסר.
        //
        // ⚠️ בדיקה מפורשת לפני השליחה: היא הופכת כשל שקט לשגיאה
        // שאפשר לאתר בלוג תוך שנייה.
        if (!process.env.RESEND_API_KEY) {
          internalStatus = "no-api-key";
          console.error(
            "[forgot-password] RESEND_API_KEY is missing - email NOT sent to " +
              normalizedEmail
          );
        } else {
          try {
            const resend = new Resend(process.env.RESEND_API_KEY);
            const result = await resend.emails.send({
              from: FROM_ADDRESS,
              to: normalizedEmail,
              subject: "איפוס סיסמה — צדקת רבותינו",
              html: `
            <div dir="rtl" lang="he" style="font-family:Arial,sans-serif;background:#fff8d8;padding:24px;">
              <div style="max-width:480px;margin:0 auto;background:#fff;border-radius:16px;padding:24px;border:1px solid #eee;">
                <h2 style="color:#27272A;">איפוס סיסמה</h2>
                <p>קיבלנו בקשה לאיפוס הסיסמה לחשבונך. הקישור תקף לשעה אחת בלבד.</p>
                <a href="${resetUrl}" style="display:inline-block;background:#C0461E;color:#fff;padding:12px 24px;border-radius:10px;text-decoration:none;margin:16px 0;">
                  לאיפוס הסיסמה
                </a>
                <p style="color:#555;font-size:13px;margin-top:12px;">
                  הקישור לא עובד? ניתן להתחבר גם עם מספר הטלפון וקוד הכניסה
                  שקיבלת. אם אין לך קוד — ניתן לפנות לנציג והוא ימסור לך אותו.
                </p>
                <p style="color:#888;font-size:13px;">אם לא ביקשת איפוס סיסמה, אפשר להתעלם מהודעה זו.</p>
              </div>
            </div>`,
            });

            // §146: ⚠️ Resend מחזיר שגיאה **בגוף התשובה** ולא זורק
            // אותה. `await send()` מצליח גם כשהמייל נדחה - למשל
            // מכסה יומית שנגמרה או דומיין לא מאומת.
            //
            // בלי הבדיקה הזו, כשל כזה נראה בדיוק כמו הצלחה.
            if ((result as any)?.error) {
              internalStatus = "resend-error";
              console.error(
                `[forgot-password] Resend rejected email to ${normalizedEmail}:`,
                (result as any).error
              );
            } else {
              console.log(
                `[forgot-password] sent to ${normalizedEmail} id=${(result as any)?.data?.id ?? "?"}`
              );
            }
          } catch (mailErr) {
            // כשל בשליחת מייל לא אמור לחשוף מידע למשתמש - רק לוג בצד שרת
            internalStatus = "send-threw";
            console.error("forgot-password email send failed:", mailErr);
          }
        }
      }
    } else {
      // §146: מייל שאינו במערכת. נרשם בלוג כי זה התרחיש הנפוץ
      // ביותר - לקוח שנרשם בטלפון בלבד, או שהקליד כתובת אחרת
      // מזו שרשומה אצלו.
      console.warn(`[forgot-password] no account for: ${normalizedEmail}`);
    }

    return NextResponse.json({
      ok: true,
      // ⚠️ ההודעה זהה בכל המקרים - היא לא חושפת אם החשבון קיים.
      //
      // §146: נוספה הפניה לקוד הכניסה. לקוח שנרשם בטלפון בלבד לא
      // יקבל מייל **לעולם**, והודעה שמבטיחה לו מייל שולחת אותו
      // לחכות לחינם ואז להתקשר.
      message:
        "אם קיים חשבון עם כתובת המייל הזו, נשלח אליו קישור לאיפוס סיסמה. " +
        "לא קיבלת מייל? ייתכן שלא רשומה אצלנו כתובת מייל עבורך — " +
        "ניתן להתחבר עם מספר הטלפון וקוד הכניסה, או לפנות לנציג.",
      // בסביבת פיתוח בלבד - לאבחון מהיר. בייצור לא נחשף.
      ...(process.env.NODE_ENV !== "production" ? { _debug: internalStatus } : {}),
    });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "שגיאת שרת" }, { status: 500 });
  }
}
