// §62: קוד ההתחברות של הלקוח.
//
// ═══════════════════════════════════════════════════════════════
// למה הצפנה הפיכה ולא hash
// ═══════════════════════════════════════════════════════════════
// הדרישה התפעולית: לקוח מתקשר "שכחתי קוד", והמנהל פותח את הכרטיס
// ורואה מיד את הקוד הפעיל. bcrypt הוא חד-כיווני ולכן אינו מתאים -
// אי אפשר לשחזר ממנו את הקוד.
//
// הפתרון: AES-256-GCM עם מפתח ב-ENV. המנהל מקבל בדיוק את מה שביקש,
// אבל המפתח **אינו במסד**. אם דלף גיבוי או dump - התוקף מקבל ג'יבריש.
// עם עמודת טקסט גלוי הוא היה מקבל את כל קודי הלקוחות מיד, וכל אחד
// מהם מאפשר להיכנס ולהזמין על חשבון הכרטיס השמור בנדרים.
//
// GCM ולא CBC: הוא מאומת (authenticated) - שינוי של תו אחד בערך
// המוצפן גורם לפענוח להיכשל במקום להחזיר זבל שקט.
//
// ═══════════════════════════════════════════════════════════════
// הגדרה
// ═══════════════════════════════════════════════════════════════
// יש להגדיר ב-ENV (וב-Vercel):
//   AUTH_CODE_KEY=<64 תווי hex>
// יצירה:  node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
//
// ⚠️ החלפת המפתח הופכת את כל הקודים הקיימים לבלתי-קריאים. אין לשנות
// אותו בלי מיגרציה שמפענחת עם הישן ומצפינה מחדש עם החדש.

import crypto from "crypto";

const ALGO = "aes-256-gcm";
const PREFIX = "v1";

function getKey(): Buffer {
  const raw = (process.env.AUTH_CODE_KEY || "").trim();
  if (!raw) {
    throw new Error(
      "AUTH_CODE_KEY חסר. יש להגדיר מפתח של 64 תווי hex בסביבת ההרצה."
    );
  }
  const key = Buffer.from(raw, "hex");
  if (key.length !== 32) {
    throw new Error(
      `AUTH_CODE_KEY באורך לא תקין (${key.length} בייטים). נדרשים 32 בייטים = 64 תווי hex.`
    );
  }
  return key;
}

/** האם המפתח מוגדר ותקין - לבדיקת בריאות בלי לזרוק */
export function isCodeKeyConfigured(): boolean {
  try {
    getKey();
    return true;
  } catch {
    return false;
  }
}

/** מצפין קוד לאחסון. הפורמט: v1.<iv>.<tag>.<ciphertext> */
export function encryptCode(plain: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGO, getKey(), iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${PREFIX}.${iv.toString("hex")}.${tag.toString("hex")}.${enc.toString("hex")}`;
}

/**
 * מפענח קוד מאוחסן. מחזיר null במקום לזרוק - ערך פגום או מפתח שגוי
 * לא אמורים להפיל התחברות של כל המערכת, אלא רק להיכשל לאותו לקוח.
 */
export function decryptCode(stored: string | null | undefined): string | null {
  if (!stored) return null;
  const parts = stored.split(".");
  if (parts.length !== 4 || parts[0] !== PREFIX) return null;
  try {
    const [, ivHex, tagHex, dataHex] = parts;
    const decipher = crypto.createDecipheriv(
      ALGO,
      getKey(),
      Buffer.from(ivHex, "hex")
    );
    decipher.setAuthTag(Buffer.from(tagHex, "hex"));
    const dec = Buffer.concat([
      decipher.update(Buffer.from(dataHex, "hex")),
      decipher.final(),
    ]);
    return dec.toString("utf8");
  } catch {
    // אין לרשום כאן את הערך המוצפן - הוא סוד
    console.error("[login-code] decrypt failed (bad key or corrupted value)");
    return null;
  }
}

/**
 * השוואה בזמן קבוע. השוואת === רגילה נעצרת בתו הראשון שנבדל, וההפרש
 * בזמן מדיד - כך אפשר לחלץ קוד ספרה-ספרה במקום לנחש 10,000 צירופים.
 */
export function codesMatch(a: string | null, b: string | null): boolean {
  if (!a || !b) return false;
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  // timingSafeEqual זורק על אורכים שונים, ולכן משווים אורך בנפרד.
  // אורך הקוד אינו סוד משמעותי.
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * יצירת קוד אקראי.
 *
 * randomInt של crypto ולא Math.random: האחרון ניתן לחיזוי, ומי שראה
 * כמה קודים שנוצרו ברצף יכול לגזור את הבאים.
 *
 * קודים "חלשים" נדחים ונוצרים מחדש: כל הספרות זהות (1111), רצף עולה
 * או יורד (123456 / 4321). אלה הניחושים הראשונים של כל תוקף, והם גם
 * הקודים שלקוחות זוכרים ומשתפים.
 */
export function generateLoginCode(length = 6): string {
  if (length < 4 || length > 6) {
    throw new Error("אורך קוד חייב להיות בין 4 ל-6 ספרות");
  }
  for (let attempt = 0; attempt < 50; attempt++) {
    let code = "";
    for (let i = 0; i < length; i++) code += String(crypto.randomInt(0, 10));
    if (!isWeakCode(code)) return code;
  }
  // בטיחות: לא אמור לקרות, אבל עדיף קוד חלש מאשר לולאה אינסופית
  let fallback = "";
  for (let i = 0; i < length; i++) fallback += String(crypto.randomInt(0, 10));
  return fallback;
}

/** האם הקוד קל לניחוש */
export function isWeakCode(code: string): boolean {
  if (!/^\d+$/.test(code)) return false;
  const digits = code.split("").map(Number);
  // כל הספרות זהות
  if (digits.every((d) => d === digits[0])) return true;
  // רצף עולה או יורד ברציפות
  const ascending = digits.every((d, i) => i === 0 || d === digits[i - 1] + 1);
  const descending = digits.every((d, i) => i === 0 || d === digits[i - 1] - 1);
  return ascending || descending;
}

/** ולידציה של קוד שהוזן ידנית ע"י מנהל */
export function validateLoginCode(code: string): { ok: true } | { ok: false; error: string } {
  const c = String(code || "").trim();
  if (!/^\d+$/.test(c)) return { ok: false, error: "הקוד חייב להכיל ספרות בלבד" };
  if (c.length < 4 || c.length > 6) {
    return { ok: false, error: "הקוד חייב להיות באורך 4 עד 6 ספרות" };
  }
  if (isWeakCode(c)) {
    return {
      ok: false,
      error: "הקוד קל מדי לניחוש (ספרות זהות או רצף). יש לבחור קוד אחר.",
    };
  }
  return { ok: true };
}

// ═══════════════════════════════════════════════════════════════
// נירמול טלפון
// ═══════════════════════════════════════════════════════════════
// הטלפון הוא שם המשתמש, ולכן הנירמול הוא חלק מהאימות ולא נוחות.
// אותו אלגוריתם בדיוק כמו ב-register, ב-agent/customer-create
// וב-IVR: ספרות בלבד, וקידומת 972 מומרת ל-0 מקומי.
export function normalizeLoginPhone(raw: string): string {
  const digits = String(raw || "").replace(/\D/g, "");
  return digits.startsWith("972") ? "0" + digits.slice(3) : digits;
}

/** כל הווריאציות שכדאי לחפש לפיהן במסד (תאימות לרשומות ישנות) */
export function phoneCandidates(raw: string): string[] {
  const trimmed = String(raw || "").trim();
  const digits = trimmed.replace(/\D/g, "");
  const local = normalizeLoginPhone(trimmed);
  return Array.from(new Set([trimmed, digits, local])).filter((v) => v.length > 0);
}

// ═══════════════════════════════════════════════════════════════
// נעילה מפני ניחוש
// ═══════════════════════════════════════════════════════════════
// טלפון ידוע + קוד בן 6 ספרות = מיליון צירופים; בן 4 = עשרת אלפים
// בלבד, שנסרקים בדקות בלי נעילה. לכן זו אינה תוספת אופציונלית.
export const MAX_FAILED_ATTEMPTS = 5;
export const LOCK_MINUTES = 15;

export function isLocked(lockedUntil: Date | null | undefined): boolean {
  return !!lockedUntil && lockedUntil.getTime() > Date.now();
}

export function lockUntilDate(): Date {
  return new Date(Date.now() + LOCK_MINUTES * 60 * 1000);
}
