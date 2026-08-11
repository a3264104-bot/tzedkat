// §32: יצירה אוטומטית של הודעה קולית במקביל למייל.
//
// הבעיה: לקוח שנרשם בטלפון לרוב אין לו מייל. כל עדכון שהמנהל שולח
// ("החלוקה נדחתה לשעה 18:00", תזכורת יום לפני) פשוט לא מגיע אליו.
//
// הפתרון: בכל פעם שנשלח מייל, נוצרת אוטומטית הודעה מקבילה שתוקרא
// בטלפון - עם אותו סינון (מכירה + נקודה) ועם תפוגה.
//
// למה זה כאן ולא בכל route בנפרד: כדי שלא יהיה מקום אחד ששולח מייל
// ושוכח את הטלפון.

import { prisma } from "@/lib/prisma";

/**
 * תפוגה אוטומטית בסוף יום החלוקה.
 *
 * ⚠️ קריטי: הודעה "החלוקה מחר" שממשיכה להישמע ביום החלוקה עצמו הופכת
 * לשקר ומבלבלת. ברירת המחדל היא סוף היום שבו החלוקה מתרחשת - אחרי
 * זה ההודעה מפסיקה להישמע מעצמה בלי שאף אחד צריך לזכור לכבות.
 */
export function expiryForDelivery(deliveryDate: Date | null): Date {
  const base = deliveryDate ? new Date(deliveryDate) : new Date();
  base.setHours(23, 59, 59, 999);
  // תאריך שכבר עבר (או חסר) - תפוגה בעוד 24 שעות, כדי שהודעה לא
  // תישאר תקועה לנצח
  if (base.getTime() < Date.now()) {
    return new Date(Date.now() + 24 * 60 * 60 * 1000);
  }
  return base;
}

/**
 * יצירת הודעה קולית שתוקרא למתקשרים.
 *
 * @param replaceKind אם מסופק, הודעות קודמות שמתחילות באותו טקסט
 *                    יכובו. מונע מצב שבו שתי תזכורות סותרות נשמעות
 *                    אחת אחרי השנייה.
 */
export async function createPhoneAnnouncement(params: {
  pricelistId: string;
  text: string;
  pointId?: string | null;
  expiresAt?: Date | null;
  createdBy?: string | null;
  replaceKind?: string;
}): Promise<{ ok: boolean; id?: string; error?: string }> {
  const { pricelistId, pointId = null, createdBy = null, replaceKind } = params;
  const text = String(params.text ?? "").trim().slice(0, 450);

  if (!pricelistId || !text) {
    return { ok: false, error: "חסרה מכירה או תוכן" };
  }

  try {
    if (replaceKind) {
      await prisma.phoneAnnouncement.updateMany({
        where: {
          pricelistId,
          pointId,
          isActive: true,
          text: { startsWith: replaceKind },
        },
        data: { isActive: false },
      });
    }

    const created = await prisma.phoneAnnouncement.create({
      data: {
        pricelistId,
        pointId,
        text,
        expiresAt: params.expiresAt ?? null,
        createdBy,
        isActive: true,
      },
      select: { id: true },
    });
    return { ok: true, id: created.id };
  } catch (e: any) {
    // לא זורקים: כישלון ביצירת ההודעה הקולית לא צריך להפיל שליחת
    // מיילים שכבר הצליחה.
    console.error("[announcement] create failed:", e);
    return { ok: false, error: String(e?.message ?? e).slice(0, 300) };
  }
}
