// ═══════════════════════════════════════════════════════════════
// §162: אימות ייחודיות של טלפון נוסף
// ═══════════════════════════════════════════════════════════════
// התרחיש שזה מונע: הבעל רשום עם 052, ורוצים להוסיף את הנייד של
// האישה (050) כטלפון נוסף - אבל היא כבר רשומה בעצמה עם 050.
//
// בלי הבדיקה, המערכת הייתה מאפשרת את זה, ואז:
//   • מתקשר מ-050 מתאים לשתי רשומות
//   • ה-IVR (§161) דוחה זיהוי מרובה
//   • **האישה שומעת "לא רשום" למרות שהיא רשומה**
//
// זו תקלה שקשה מאוד לאבחן בדיעבד: הכל נראה תקין בכרטיסים, ורק
// השיחה נכשלת. הבדיקה כאן הופכת אותה לשגיאה מיידית וברורה.
//
// ⚠️ למה לא @unique בסכמה: זה היה חוסם גם מקרים לגיטימיים, כמו
// טלפון בית משותף שאיש אינו רשום איתו כלקוח. הבדיקה כאן חוסמת
// רק את ההתנגשות האמיתית - מספר שכבר משמש **לזיהוי** של מישהו.

import { normalizePhone } from "@/lib/identity";

export type PhoneConflict = {
  ok: false;
  error: string;
  conflictWith: { id: string; name: string; field: "phone" | "phone2" };
};

/**
 * §162: בודק שטלפון נוסף אינו תפוס.
 *
 * @param excludeCustomerId - הלקוח שעורכים כרגע. בלעדיו, עריכה
 *   של לקוח שכבר יש לו את המספר הייתה נחסמת מול עצמו.
 */
export async function validatePhone2(
  prisma: any,
  phone2Raw: string | null | undefined,
  excludeCustomerId?: string | null
): Promise<{ ok: true; value: string | null } | PhoneConflict> {
  const raw = String(phone2Raw ?? "").trim();
  if (!raw) return { ok: true, value: null };

  const normalized = normalizePhone(raw);
  if (!normalized) {
    return {
      ok: false,
      error: "מספר הטלפון הנוסף אינו תקין",
      conflictWith: { id: "", name: "", field: "phone2" },
    };
  }

  const clash = await prisma.customer.findFirst({
    where: {
      OR: [{ phone: normalized }, { phone2: normalized }],
      ...(excludeCustomerId ? { NOT: { id: excludeCustomerId } } : {}),
    },
    select: { id: true, name: true, phone: true, phone2: true, isActive: true },
  });

  if (clash) {
    // ⚠️ ההודעה אומרת **מי** מחזיק במספר. "המספר תפוס" בלבד היה
    // משאיר את המנהל לחפש ידנית, וזו בדיוק העבודה שהמערכת
    // אמורה לחסוך.
    const asMain = clash.phone === normalized;
    return {
      ok: false,
      error: asMain
        ? `המספר ${normalized} כבר רשום כטלפון הראשי של ${clash.name}. ` +
          `הוספתו כאן תמנע זיהוי בטלפון משני הלקוחות.`
        : `המספר ${normalized} כבר משמש כטלפון נוסף אצל ${clash.name}. ` +
          `הוספתו כאן תמנע זיהוי בטלפון משני הלקוחות.`,
      conflictWith: {
        id: clash.id,
        name: clash.name,
        field: asMain ? "phone" : "phone2",
      },
    };
  }

  return { ok: true, value: normalized };
}
