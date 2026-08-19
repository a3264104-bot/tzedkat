// ═══════════════════════════════════════════════════════════════
// §119: חישוב עמלת הנציג
// ═══════════════════════════════════════════════════════════════
// מרוכז כאן בכוונה. החישוב הופיע בכמה מקומות (סיכום הנציג, דוח
// המנהל, חובות נציגים), ושינוי בכלל העסקי חייב לחול על כולם -
// אחרת המנהל והנציג רואים שני מספרים שונים ולשניהם יש הוכחה.

export type CommissionInput = {
  /** משקל בפועל שנמסר ללקוח */
  weight: number;
  /** מחיר המחירון ליחידה */
  unitPrice: number;
  /** מחיר שהנציג קבע בעצמו (מוצר מועדף בלבד). null = לא קבע. */
  agentSetPrice: number | null;
  isSingle: boolean;
  /** ברירת מחדל 1 ש"ח לק"ג */
  rateCarton: number;
  /** ברירת מחדל 4 ש"ח לק"ג בבודדים (כולל השקל) */
  rateSingles: number;
};

export type CommissionResult = {
  amount: number;
  /** "standard" = הכלל הרגיל. "custom" = הפרש המחיר שהנציג קבע. */
  kind: "standard" | "custom";
  /** לתצוגה: איך המספר התקבל */
  explain: string;
};

/**
 * ⚠️ שני מסלולים, ולעולם לא שניהם.
 *
 * **רגיל:** שקל לק"ג, ובבודדים 4 (השקל + 3).
 *
 * **מוצר מועדף שהנציג תמחר:** ההפרש בין "רצפת הנציג" למחיר שקבע.
 * רצפת הנציג = מחיר המחירון פחות השקל שתמיד שלו.
 *
 *     מחירון 129.90  ->  רצפה 128.90
 *     הנציג קבע 139.90  ->  עמלה 11 ש"ח לק"ג
 *
 * הנימוק לכך שזה **מחליף** ולא מתווסף: השקל וה-3 של בודדים כבר
 * מובלעים בהפרש. מי שהעלה מ-129.90 ל-139.90 לקח 11 ש"ח, ומתוכם
 * השקל שלו ממילא. הוספה נוספת הייתה תשלום כפול על אותו רווח.
 */
export function calcItemCommission(i: CommissionInput): CommissionResult {
  const w = Number(i.weight) || 0;
  if (w <= 0) {
    return { amount: 0, kind: "standard", explain: "לא נמסרה סחורה" };
  }

  const rateCarton = Number(i.rateCarton ?? 1);
  const rateSingles = Number(i.rateSingles ?? 4);

  // ─── מסלול המחיר המותאם ───
  if (i.agentSetPrice != null) {
    const set = Number(i.agentSetPrice);
    const list = Number(i.unitPrice);
    const floor = list - rateCarton; // רצפת הנציג

    // ⚠️ הגנה: מחיר נמוך מהרצפה היה מייצר עמלה שלילית, כלומר
    // הנציג "משלם" על המכירה. נופלים לכלל הרגיל במקום.
    if (set >= floor) {
      const perKg = set - floor;
      return {
        amount: Math.round(perKg * w * 100) / 100,
        kind: "custom",
        explain: `${set.toFixed(2)} פחות ${floor.toFixed(2)} = ${perKg.toFixed(2)} לק"ג × ${w}`,
      };
    }
  }

  // ─── הכלל הרגיל ───
  const rate = i.isSingle ? rateSingles : rateCarton;
  return {
    amount: Math.round(rate * w * 100) / 100,
    kind: "standard",
    explain: `${rate} לק"ג × ${w}${i.isSingle ? " (בודדים)" : ""}`,
  };
}

/**
 * §119: ולידציה של מחיר שהנציג מזין.
 *
 * ⚠️ **העלאה בלבד.** הורדת מחיר הייתה פוגעת בהכנסה של העמותה
 * ומייצרת עמלה שלילית לנציג. הכלל נאכף בשרת ולא רק בממשק.
 */
export function validateAgentPrice(
  setPrice: number,
  listPrice: number
): { ok: true } | { ok: false; error: string } {
  if (!Number.isFinite(setPrice) || setPrice <= 0) {
    return { ok: false, error: "יש להזין מחיר תקין" };
  }
  if (setPrice < listPrice) {
    return {
      ok: false,
      error: `לא ניתן לקבוע מחיר נמוך מהמחירון (${listPrice.toFixed(2)} ש"ח). ניתן רק להעלות.`,
    };
  }
  // תפיסת טעות הקלדה מובהקת - ספרה מיותרת
  if (setPrice > listPrice * 5) {
    return {
      ok: false,
      error: `המחיר גבוה פי 5 מהמחירון. יש לוודא שלא נפלה טעות הקלדה.`,
    };
  }
  return { ok: true };
}
