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
    if (customer) {
      const token = crypto.randomBytes(32).toString("hex");
      const expiry = new Date(Date.now() + 60 * 60 * 1000); // שעה אחת

      await prisma.customer.update({
        where: { id: customer.id },
        data: { resetToken: token, resetTokenExpiry: expiry },
      });

      const resetUrl = `${process.env.NEXT_PUBLIC_APP_URL || "https://tzidkat.com"}/reset-password?token=${token}`;

      try {
        const resend = new Resend(process.env.RESEND_API_KEY);
        await resend.emails.send({
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
                <p style="color:#888;font-size:13px;">אם לא ביקשת איפוס סיסמה, אפשר להתעלם מהודעה זו.</p>
              </div>
            </div>`,
        });
      } catch (mailErr) {
        // כשל בשליחת מייל לא אמור לחשוף מידע למשתמש - רק לוג בצד שרת
        console.error("forgot-password email send failed:", mailErr);
      }
    }

    return NextResponse.json({
      ok: true,
      message: "אם קיים חשבון עם כתובת המייל הזו, נשלח אליו קישור לאיפוס סיסמה.",
    });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "שגיאת שרת" }, { status: 500 });
  }
}
