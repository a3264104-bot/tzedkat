// ═══════════════════════════════════════════════════════════════
// §202: תוקף כרטיס האשראי
// ═══════════════════════════════════════════════════════════════
// 🐛 הפער: cardExpiry נשמר בפורמט MMYY, אבל **אף אחד לא בדק
// אותו**. הכרטיס פג תוקף, הלקוח הזמין כרגיל, והתקלה התגלתה רק
// ברגע החיוב - כלומר אחרי החלוקה, כשהסחורה כבר אצלו.
//
// מה שקרה בפועל: nedarim-lib חוסם חיוב בלי Tokef תקין ומחזיר
// cardProblem=true. זו רשת ביטחון נכונה, אבל היא מגיעה **מאוחר
// מדי** - הרגע הנכון להגיד ללקוח הוא כשהוא מזמין.
//
// ⚠️ הכרטיס תקף עד **סוף** חודש התפוגה. כרטיס 08/26 עובד עד
// 31.08.2026 בחצות, ולא עד 01.08. חישוב שגוי כאן היה חוסם
// לקוחות חודש שלם לפני הזמן.

/** אזור הזמן של המערכת - התפוגה נמדדת בשעון ישראל */
const TZ = "Asia/Jerusalem";

export type ExpiryStatus =
  | { state: "valid"; monthsLeft: number }
  /** פג תוקף - אי אפשר לחייב */
  | { state: "expired"; label: string }
  /** פג בקרוב - עדיין אפשר לחייב, אבל צריך להתריע */
  | { state: "expiring"; monthsLeft: number; label: string }
  /** אין תוקף שמור - לא ניתן לדעת */
  | { state: "unknown" };

/**
 * §202: מנתח תוקף בפורמט MMYY.
 *
 * ⚠️ MMYY ולא MM/YY: זה מה ש-nedarim מחזירים ומה שנשמר במסד.
 * הפונקציה סלחנית לתווים מפרידים כדי שהיא תעבוד גם על קלט ידני.
 */
export function checkCardExpiry(
  cardExpiry: string | null | undefined,
  now: Date = new Date()
): ExpiryStatus {
  const raw = String(cardExpiry ?? "").replace(/\D/g, "");
  if (raw.length !== 4) return { state: "unknown" };

  const mm = parseInt(raw.slice(0, 2), 10);
  const yy = parseInt(raw.slice(2), 10);
  if (!(mm >= 1 && mm <= 12)) return { state: "unknown" };

  // ⚠️ שנתיים דו-ספרתיות: 26 = 2026. הנחה בטוחה - כרטיסים אינם
  // מונפקים ל-80 שנה קדימה.
  const year = 2000 + yy;

  // §202: 🐛 השוואת תאריכים מלאה נכשלה בסוף החודש.
  //
  // toLocaleString("en-US") מאבד את השניות והמילישניות, ולכן
  // 31.08 בשעה 23:00 יצא **אחרי** expiryEnd (23:59:59.999)
  // בגלל הפרש של שעות אזור הזמן. כרטיס תקף סומן כפג יום לפני.
  //
  // ⚠️ ההשוואה עכשיו ברמת **חודש** ולא ברמת מילישנייה: כרטיס
  // תקף עד סוף חודש התפוגה, וזו היחידה היחידה שמשנה כאן.
  const nowLocal = new Date(now.toLocaleString("en-US", { timeZone: TZ }));
  const nowYM = nowLocal.getFullYear() * 12 + nowLocal.getMonth(); // 0-based
  const expYM = year * 12 + (mm - 1);

  const label = `${String(mm).padStart(2, "0")}/${String(yy).padStart(2, "0")}`;

  // ⚠️ פג רק כשהחודש הנוכחי **מאוחר** מחודש התפוגה. באותו חודש
  // הכרטיס עדיין תקף - עד היום האחרון כולל.
  if (nowYM > expYM) return { state: "expired", label };

  const monthsLeft = expYM - nowYM;

  // ⚠️ סף של חודשיים: מספיק זמן ללקוח לחדש בלי לחץ, ולא מוקדם
  // מדי כדי שההתראה תהפוך לרעש שמתעלמים ממנו.
  if (monthsLeft <= 2) return { state: "expiring", monthsLeft, label };

  return { state: "valid", monthsLeft };
}

/** האם ניתן לחייב את הכרטיס הזה */
export function canChargeCard(cardExpiry: string | null | undefined): boolean {
  const s = checkCardExpiry(cardExpiry);
  // ⚠️ unknown **מותר**: כרטיסים ותיקים נשמרו בלי תוקף, וחסימה
  // שלהם הייתה מנתקת לקוחות קיימים בלי סיבה. נדרים יחזירו שגיאה
  // אם באמת יש בעיה.
  return s.state !== "expired";
}

/**
 * §202: הודעה ללקוח - קצרה ומדויקת.
 *
 * ⚠️ בלי מספר הכרטיס: ההודעה מוצגת במסכים ונשלחת במיילים.
 */
export function expiryMessage(cardExpiry: string | null | undefined): string | null {
  const s = checkCardExpiry(cardExpiry);
  if (s.state === "expired") {
    return `הכרטיס פג תוקף (${s.label}). יש להזין כרטיס חדש כדי שנוכל לחייב.`;
  }
  if (s.state === "expiring") {
    return s.monthsLeft <= 0
      ? `הכרטיס פג תוקף החודש (${s.label}). מומלץ לעדכן עכשיו.`
      : `הכרטיס פג תוקף בעוד ${s.monthsLeft} חודשים (${s.label}). מומלץ לעדכן.`;
  }
  return null;
}

/**
 * §202: נוסח להקראה בטלפון.
 *
 * ⚠️ בלי מספרים ובלי לוכסן: מנוע ההקראה של ימות מבטא "08/26"
 * כ"שמונה חלקי עשרים ושש", וזה לא מובן. הודעה מילולית עדיפה.
 */
export function expiryPhoneMessage(
  cardExpiry: string | null | undefined
): string | null {
  const s = checkCardExpiry(cardExpiry);
  if (s.state === "expired") {
    return "שים לב, תוקף כרטיס האשראי שלך פג. יש לעדכן כרטיס באתר או אצל הנציג, אחרת לא נוכל לחייב את ההזמנה";
  }
  if (s.state === "expiring") {
    return "שים לב, תוקף כרטיס האשראי שלך עומד לפוג בקרוב. מומלץ לעדכן אותו";
  }
  return null;
}
