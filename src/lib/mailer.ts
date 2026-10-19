// ═══════════════════════════════════════════════════════════════
// שליחת מיילים — ספק אחד לכל האתר: Amazon SES, עם Resend כגיבוי
// ═══════════════════════════════════════════════════════════════
// הבעיה: Resend בחבילה החינמית מוגבל ל-100 מיילים ביום, משותף לכל
// המיילים. הודעה אחת ללקוחות (743 נמענים) שרפה את המכסה, וגם אישורי
// הזמנה, קבלות ושחזור סיסמה נעצרו עד למחרת.
//
// ✅ createMailer() מחזיר אובייקט עם **אותו ממשק כמו Resend**
// (emails.send / batch.send, ואותה צורת תשובה { data, error }), כך
// שכל מקום ששולח מייל רק מחליף את ה-client — הקוד ששולח לא משתנה.
//
// ⚙️ ההפעלה במשתנה סביבה, לא בקוד:
//   EMAIL_PROVIDER=ses  → שליחה דרך SES, ואם SES נכשל — דרך Resend
//   אחרת (ברירת מחדל)   → Resend בלבד, כמו קודם
// כך אפשר להחליף ספק (ולחזור) ב-Vercel בלי פריסה של קוד.
//
// ⚠️ מסירה לכתובת שחזרה או שסומנה כספאם: SES מנהל רשימת חסימה
// (account-level suppression list) לחזרות ולתלונות — מייל לכתובת כזו
// לא נשלח שוב. זו הדרישה של אמזון, והיא פעילה כברירת מחדל בחשבון.

import { Resend } from "resend";
import { SESv2Client, SendEmailCommand, type Attachment as SesAttachment } from "@aws-sdk/client-sesv2";

type MailAttachment = {
  filename?: string;
  /** תוכן הקובץ בזיכרון */
  content?: Buffer | Uint8Array | string;
  /** או כתובת להורדה (Resend מוריד בעצמו; ל-SES אנחנו מורידים) */
  path?: string;
  contentType?: string;
};

export type MailOptions = {
  from: string;
  to: string | string[];
  subject: string;
  html?: string;
  text?: string;
  replyTo?: string | string[];
  cc?: string | string[];
  bcc?: string | string[];
  attachments?: MailAttachment[];
  [key: string]: unknown;
};

export type MailError = { name: string; message: string; statusCode: number | null };
export type MailResult = { data: { id: string } | null; error: MailError | null };

const list = (v?: string | string[]) => (v == null ? undefined : Array.isArray(v) ? v : [v]);

function sesConfigured(): boolean {
  return !!(process.env.SES_REGION && process.env.SES_ACCESS_KEY_ID && process.env.SES_SECRET_ACCESS_KEY);
}

/** הספק שנבחר כרגע (לתצוגה וללוגים) */
export function emailProvider(): "ses" | "resend" {
  return process.env.EMAIL_PROVIDER === "ses" && sesConfigured() ? "ses" : "resend";
}

let sesClient: SESv2Client | null = null;
function getSes(): SESv2Client {
  if (!sesClient) {
    sesClient = new SESv2Client({
      region: process.env.SES_REGION,
      credentials: {
        accessKeyId: process.env.SES_ACCESS_KEY_ID!,
        secretAccessKey: process.env.SES_SECRET_ACCESS_KEY!,
      },
    });
  }
  return sesClient;
}

/**
 * ⚠️ שם שולח בעברית ("צדקת רבותינו <orders@…>") חייב קידוד MIME —
 * SES דוחה תווים שאינם ASCII בכותרת From.
 */
function encodeAddress(addr: string): string {
  const m = addr.match(/^\s*(.*?)\s*<([^>]+)>\s*$/);
  if (!m || !m[1] || !/[^\x00-\x7F]/.test(m[1])) return addr;
  const name = m[1].replace(/^"|"$/g, "");
  return `=?UTF-8?B?${Buffer.from(name, "utf8").toString("base64")}?= <${m[2]}>`;
}

async function toSesAttachments(atts: MailAttachment[] = []): Promise<SesAttachment[]> {
  const out: SesAttachment[] = [];
  for (const a of atts) {
    let bytes: Uint8Array;
    if (a.content != null) {
      bytes = typeof a.content === "string" ? Buffer.from(a.content, "utf8") : a.content;
    } else if (a.path) {
      const res = await fetch(a.path);
      if (!res.ok) throw Object.assign(new Error(`attachment download failed: ${res.status}`), { name: "AttachmentError" });
      bytes = new Uint8Array(await res.arrayBuffer());
    } else {
      continue;
    }
    out.push({
      RawContent: bytes,
      FileName: a.filename || "file",
      ContentDisposition: "ATTACHMENT",
      ...(a.contentType ? { ContentType: a.contentType } : {}),
    });
  }
  return out;
}

/** שגיאת SES → אותה צורה שהקוד הקיים מכיר מ-Resend (quotaErrorKind / isRateLimitError) */
function sesError(e: any): MailError {
  const name = String(e?.name || "SesError");
  const message = String(e?.message || e);
  // מכסה יומית ב-SES: LimitExceededException / "Daily message quota exceeded"
  if (/quota/i.test(message) || name === "LimitExceededException") {
    return { name: "daily_quota_exceeded", message: `SES: ${message}`, statusCode: 429 };
  }
  if (name === "TooManyRequestsException" || name === "ThrottlingException" || /rate exceeded/i.test(message)) {
    return { name: "rate_limit_exceeded", message: `SES: ${message}`, statusCode: 429 };
  }
  return { name, message: `SES: ${message}`, statusCode: Number(e?.$metadata?.httpStatusCode) || null };
}

async function sendViaSes(o: MailOptions): Promise<MailResult> {
  try {
    const attachments = await toSesAttachments(o.attachments);
    const res = await getSes().send(
      new SendEmailCommand({
        FromEmailAddress: encodeAddress(o.from),
        Destination: { ToAddresses: list(o.to), CcAddresses: list(o.cc), BccAddresses: list(o.bcc) },
        ReplyToAddresses: list(o.replyTo),
        Content: {
          Simple: {
            Subject: { Data: o.subject, Charset: "UTF-8" },
            Body: {
              ...(o.html ? { Html: { Data: o.html, Charset: "UTF-8" } } : {}),
              ...(o.text ? { Text: { Data: o.text, Charset: "UTF-8" } } : {}),
            },
            ...(attachments.length ? { Attachments: attachments } : {}),
          },
        },
      })
    );
    return { data: { id: res.MessageId || "ses" }, error: null };
  } catch (e) {
    return { data: null, error: sesError(e) };
  }
}

async function sendViaResend(o: MailOptions): Promise<MailResult> {
  const { data, error } = await new Resend(process.env.RESEND_API_KEY).emails.send(o as any);
  return {
    data: data?.id ? { id: data.id } : null,
    error: error ? { name: String((error as any).name || "resend_error"), message: String((error as any).message || error), statusCode: (error as any).statusCode ?? null } : null,
  };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** מייל בודד: SES, ניסיון חוזר על עומס, ואם עדיין נכשל — Resend */
async function sendOne(o: MailOptions): Promise<MailResult> {
  if (emailProvider() !== "ses") return sendViaResend(o);
  let r = await sendViaSes(o);
  for (let i = 1; r.error?.name === "rate_limit_exceeded" && i <= 3; i++) {
    await sleep(400 * i);
    r = await sendViaSes(o);
  }
  if (!r.error) return r;
  // ⚠️ גיבוי: מייל תפעולי (קבלה, שחזור סיסמה) עדיף שייצא דרך Resend
  // מאשר שלא ייצא בכלל.
  console.error(`[mailer] SES failed (${r.error.name}: ${r.error.message}) — falling back to Resend`);
  if (!process.env.RESEND_API_KEY) return r;
  const fb = await sendViaResend(o);
  return fb.error ? r : fb;
}

/**
 * הרבה מיילים (הודעות ללקוחות) — בקצב שמתאים ל-SES.
 *
 * ⚠️ בלי גיבוי ל-Resend כאן: הודעה ל-743 נמענים הייתה שורפת שוב את
 * המכסה היומית של Resend — בדיוק מה שהמעבר ל-SES בא למנוע.
 */
async function sendManyViaSes(payload: MailOptions[]) {
  const perSec = Math.max(1, Number(process.env.SES_MAX_PER_SEC) || 10);
  const data: { id: string }[] = [];
  const errors: { index: number; message: string }[] = [];
  let quota: MailError | null = null;
  const results: MailResult[] = new Array(payload.length);
  for (let i = 0; i < payload.length; i += perSec) {
    const started = Date.now();
    const chunk = payload.slice(i, i + perSec);
    await Promise.all(
      chunk.map(async (o, j) => {
        let r = await sendViaSes(o);
        for (let t = 1; r.error?.name === "rate_limit_exceeded" && t <= 3; t++) {
          await sleep(500 * t);
          r = await sendViaSes(o);
        }
        results[i + j] = r;
      })
    );
    if (results.slice(i, i + chunk.length).some((r) => r.error?.name === "daily_quota_exceeded")) {
      quota = results.slice(i, i + chunk.length).find((r) => r.error?.name === "daily_quota_exceeded")!.error;
      break;
    }
    const spent = Date.now() - started;
    if (i + perSec < payload.length && spent < 1000) await sleep(1000 - spent);
  }
  // נעצר על מכסה לפני שעבר על כולם — כמו Resend: שגיאה ברמת ה-batch
  if (quota && results.filter(Boolean).every((r) => r.error)) {
    return { data: null, error: quota };
  }
  results.forEach((r, i) => {
    if (!r) errors.push({ index: i, message: quota?.message || "not sent" });
    else if (r.error) errors.push({ index: i, message: `${r.error.name} · ${r.error.message}` });
    else data.push(r.data!);
  });
  return { data: { data, errors }, error: null };
}

/**
 * 🐛 רוב פונקציות המייל לא בודקות את התשובה (await …emails.send() בלי
 * לבדוק error), ולכן מייל שנדחה "נבלע" — כך נעלמו אישורי ההזמנה כשנגמרה
 * המכסה ב-Resend. עכשיו כל שליחה נרשמת בלוג: הצלחה בשורה קצרה, כישלון
 * כשגיאה עם הסיבה — גם אם הקוד שקרא לא בודק.
 */
async function sendOneLogged(o: MailOptions): Promise<MailResult> {
  const r = await sendOne(o);
  const to = list(o.to)?.join(",") ?? "";
  if (r.error) console.error(`[mailer] FAILED to=${to} subject="${o.subject}" ${r.error.name}: ${r.error.message}`);
  else console.log(`[mailer] sent via ${emailProvider()} to=${to} id=${r.data?.id}`);
  return r;
}

/** תחליף ל-new Resend(key) — אותו ממשק, הספק נבחר לפי EMAIL_PROVIDER */
export function createMailer() {
  return {
    emails: {
      send: (o: MailOptions) => sendOneLogged(o),
    },
    batch: {
      send: async (payload: MailOptions[], options?: { batchValidation?: "strict" | "permissive" }) => {
        if (emailProvider() === "ses") return sendManyViaSes(payload);
        return new Resend(process.env.RESEND_API_KEY).batch.send(payload as any, options as any) as any;
      },
    },
  };
}
