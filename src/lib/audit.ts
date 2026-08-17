// §62: יומן פעולות מנהל.
//
// כל פעולה רגישה נרשמת: צפייה בקוד, שינוי קוד, כניסה בשם משתמש,
// שינוי פרטי לקוח, השבתה.
//
// ⚠️ כלל ברזל: **קוד התחברות לעולם לא נכתב ליומן**, גם לא בשדה meta.
// היומן נגיש למנהלים ונשמר בגיבויים - אם הקוד היה מגיע אליו, כל
// ההצפנה ב-login-code.ts הייתה חסרת ערך. היומן מתעד ש*נצפה* קוד,
// לא מה הוא.
//
// הכתיבה לעולם לא חוסמת ולא מפילה את הפעולה עצמה: אם היומן נכשל,
// עדיף שהמנהל יסיים את מה שהתחיל מאשר שהמערכת תיתקע.

import { prisma } from "@/lib/prisma";

export type AuditAction =
  | "VIEW_CODE"
  | "SET_CODE"
  | "IMPERSONATE_START"
  | "IMPERSONATE_STOP"
  | "UPDATE_CUSTOMER"
  | "TOGGLE_ACTIVE"
  | "CHANGE_PAYMENT_PREF";

type AuditInput = {
  actorId: string;
  actorRole: string;
  actorName?: string | null;
  action: AuditAction;
  targetType?: string;
  targetId?: string | null;
  targetName?: string | null;
  /** פרטים לא-רגישים בלבד. אסור להעביר קודים או טוקנים. */
  meta?: Record<string, unknown> | null;
  req?: Request | null;
};

// שמות שדות שלעולם לא ייכתבו ליומן, גם אם הועברו בטעות ב-meta.
// הגנת עומק: הכלל הוא לא להעביר אותם מלכתחילה, אבל טעות אנוש בקוד
// קריאה לא צריכה להפוך לדליפת סוד בגיבוי.
const FORBIDDEN_META_KEYS = [
  "code",
  "logincode",
  "password",
  "passwordplain",
  "passwordhash",
  "token",
  "paymenttoken",
  "apivalid",
  "secret",
];

function sanitizeMeta(meta: Record<string, unknown> | null | undefined): string | null {
  if (!meta) return null;
  const clean: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(meta)) {
    if (FORBIDDEN_META_KEYS.includes(k.toLowerCase())) {
      clean[k] = "[redacted]";
      console.warn(`[audit] blocked sensitive key "${k}" from audit meta`);
      continue;
    }
    clean[k] = v;
  }
  try {
    return JSON.stringify(clean).slice(0, 4000);
  } catch {
    return null;
  }
}

function clientIp(req?: Request | null): string | null {
  if (!req) return null;
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return req.headers.get("x-real-ip");
}

export async function audit(input: AuditInput): Promise<void> {
  try {
    await prisma.adminAuditLog.create({
      data: {
        actorId: input.actorId,
        actorRole: input.actorRole,
        actorName: input.actorName ?? null,
        action: input.action,
        targetType: input.targetType ?? "Customer",
        targetId: input.targetId ?? null,
        targetName: input.targetName ?? null,
        meta: sanitizeMeta(input.meta),
        ip: clientIp(input.req),
        userAgent: input.req?.headers.get("user-agent")?.slice(0, 300) ?? null,
      },
    });
  } catch (e) {
    // לא זורקים: כשל ביומן לא מצדיק כשל בפעולה
    console.error("[audit] failed to write audit log:", e);
  }
}
