import { Resend } from "resend";
import { prisma } from "@/lib/prisma";
import { fmt } from "@/lib/pricing";

// מיילי §19 - נדרים פלוס. קובץ נפרד מ-lib/email.ts כדי לא לגעת בקיים,
// אבל מיישר את עצמו ל-pattern המדויק של email.ts:
//   - אותה כתובת שולח מאומתת ב-Resend (orders@tzidkat.com)
//   - lazy getResend() כדי שה-build לא ייכשל בהעדר API key
//   - בדיקת settings.sendEmailToCustomer לפני שליחה
//   - חתימת return {ok, error?} במקום throw
//   - baseTemplate של המותג (כתום-אדום + רקע צהוב)
//   - fmt() מ-pricing לפורמט מחירים
//
// שולח:
//   1. sendTokenSavedEmail          - אחרי אימות כרטיס מוצלח (הרשמה או עדכון)
//   2. sendCardUpdateNeededEmail    - אחרי כישלון חיוב בגלל טוקן פסול
//   3. sendChargeSucceededEmail     - אחרי חיוב אוטומטי מוצלח מתוך charge-route

const FROM_ADDRESS = "צדקת רבותינו <orders@tzidkat.com>";
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://tzidkat.com";

// יצירת client בתוך הפונקציות (לא ברמת module) כדי שה-build לא ייכשל כשאין API key
function getResend() {
  return new Resend(process.env.RESEND_API_KEY);
}

// קריאת הגדרות מערכת (singleton). אם אין - יוצרים עם ברירות מחדל.
async function getSettings() {
  let settings = await prisma.systemSettings.findUnique({ where: { id: "singleton" } });
  if (!settings) {
    settings = await prisma.systemSettings.create({ data: { id: "singleton" } });
  }
  return settings;
}

// עטיפת RTL אחידה - זהה לזו שב-lib/email.ts כדי שכל המיילים יראו זהים ללקוח
function baseTemplate(title: string, bodyHtml: string) {
  return `<div dir="rtl" lang="he" style="font-family:Arial,Helvetica,sans-serif;background:#fff8d8;padding:24px;">
    <div style="max-width:600px;margin:0 auto;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #eee;">
      <div style="background:#C0461E;color:#fff;padding:20px 24px;">
        <h1 style="margin:0;font-size:20px;">${title}</h1>
      </div>
      <div style="padding:24px;color:#27272A;">${bodyHtml}</div>
      <div style="padding:16px 24px;background:#f4f4f5;color:#888;font-size:12px;text-align:center;">
        צדקת רבותינו — עופות, בשר ודגים
      </div>
    </div>
  </div>`;
}

function escapeHtml(s: string): string {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// ═══════════════════════════════════════════════════════════════════
// 1. פרטי אשראי נשמרו - אחרי אימות 1₪ מוצלח (הרשמה ראשונה או עדכון כרטיס)
// ═══════════════════════════════════════════════════════════════════
export async function sendTokenSavedEmail(params: {
  to: string;
  customerName: string;
  last4: string;
  isCardUpdate: boolean;
}): Promise<{ ok: boolean; error?: string }> {
  try {
    const settings = await getSettings();
    if (!settings.sendEmailToCustomer) return { ok: true };

    const { to, customerName, last4, isCardUpdate } = params;

    const title = isCardUpdate ? "פרטי הכרטיס עודכנו" : "פרטי האשראי נשמרו";
    const subject = isCardUpdate
      ? "פרטי הכרטיס עודכנו בהצלחה - צדקת רבותינו"
      : "פרטי האשראי נשמרו בהצלחה - צדקת רבותינו";

    const last4Line = last4
      ? `<div style="background:#fff8d8;border-radius:10px;padding:12px 16px;margin:16px 0;text-align:center;">
           <strong>כרטיס אשראי המסתיים ב-${escapeHtml(last4)}</strong>
         </div>`
      : "";

    const explainer = isCardUpdate
      ? `הכרטיס הישן הוחלף. חיוב ההזמנה שהמתין יבוצע כעת בכרטיס החדש לאחר שהמנהל יסיים את השקילה.`
      : `פרטי האשראי שלך נשמרו בצורה מאובטחת עבור הזמנות עתידיות. לא תידרש להזין אותם שוב.`;

    const body = `
      <p>שלום ${escapeHtml(customerName)},</p>
      ${last4Line}
      <p style="font-size:15px;">${explainer}</p>
      <p style="color:#888;font-size:13px;margin-top:16px;">
        החיוב בפועל יתבצע רק לאחר שקילת ההזמנה וקביעת המחיר הסופי.
        תקבל/י מייל אישור נפרד כשהחיוב יבוצע.
      </p>`;

    await getResend().emails.send({
      from: FROM_ADDRESS,
      to,
      subject,
      html: baseTemplate(title, body),
    });
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: String(e?.message || e).slice(0, 500) };
  }
}

// ═══════════════════════════════════════════════════════════════════
// 2. נדרש עדכון כרטיס - אחרי כישלון חיוב מ-charge-route
// ═══════════════════════════════════════════════════════════════════
export async function sendCardUpdateNeededEmail(params: {
  to: string;
  customerName: string;
  orderNumber: number;
  finalTotal: number;
  reason?: string;
}): Promise<{ ok: boolean; error?: string }> {
  try {
    const settings = await getSettings();
    if (!settings.sendEmailToCustomer) return { ok: true };

    const { to, customerName, orderNumber } = params;

    const body = `
      <p>שלום ${escapeHtml(customerName)},</p>
      <div style="background:#fef2f2;border-radius:10px;padding:16px;margin:16px 0;border-right:4px solid #C0461E;">
        <p style="margin:0;color:#991b1b;font-weight:600;">
          חיוב הזמנה #${orderNumber} לא הצליח.
        </p>
        <p style="margin:8px 0 0 0;color:#7f1d1d;font-size:14px;">
          ייתכן שהכרטיס פג-תוקף, בוטל, או שקיימת בעיה אחרת מול חברת האשראי.
        </p>
      </div>
      <p>כדי להשלים את החיוב, יש להזין כרטיס אשראי חדש באזור האישי:</p>
      <div style="text-align:center;margin:20px 0;">
        <a href="${APP_URL}/account" 
           style="display:inline-block;background:#C0461E;color:#fff;padding:12px 32px;border-radius:10px;text-decoration:none;font-size:16px;">
          כניסה לאזור האישי
        </a>
      </div>
      <p style="color:#888;font-size:13px;">
        לאחר הזנת כרטיס חדש, החיוב יבוצע אוטומטית. אם יש שאלות, ניתן לפנות אלינו.
      </p>`;

    await getResend().emails.send({
      from: FROM_ADDRESS,
      to,
      subject: `נדרש עדכון כרטיס אשראי להזמנה #${orderNumber} - צדקת רבותינו`,
      html: baseTemplate(`נדרש עדכון כרטיס - #${orderNumber}`, body),
    });
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: String(e?.message || e).slice(0, 500) };
  }
}

// ═══════════════════════════════════════════════════════════════════
// 3. חיוב הצליח - אחרי חיוב אוטומטי מ-charge-route
// ═══════════════════════════════════════════════════════════════════
export async function sendChargeSucceededEmail(params: {
  to: string;
  customerName: string;
  orderNumber: number;
  amountCharged: number;
  transactionId?: string;
  pointName?: string;
  deliveryDate?: string;
  /**
   * §357: מזהה ההזמנה — לשליפת הפירוט המלא.
   *
   * 🐛 מה שהיה: המייל הציג סכום ומספר עסקה בלבד. ההנחה הייתה
   * שהלקוח כבר קיבל פירוט במייל "מחיר סופי" — אבל מאז §303
   * השליחה ההיא ידנית, ולא תמיד קורית.
   *
   * ⚠️ אופציונלי: קריאות קיימות ממשיכות לעבוד בלי פירוט.
   */
  orderId?: string;
}): Promise<{ ok: boolean; error?: string }> {
  try {
    const settings = await getSettings();
    if (!settings.sendEmailToCustomer) return { ok: true };

    const { to, customerName, orderNumber, amountCharged, transactionId, pointName, deliveryDate, orderId } = params;

    // §357: 🧾 **הפירוט המלא — אותה לוגיקה של §308 ו-§356.**
    //
    // שורה לכל פריט, ואז כל רכיב בשורה משלו: טיפול, משלוח, חיוב
    // נוסף, חוב — פחות זיכוי ויתרת זכות. מה שהלקוח רואה באתר
    // הוא מה שהוא רואה במייל.
    let breakdownHtml = "";
    if (orderId) {
      const order = await prisma.order.findUnique({
        where: { id: orderId },
        select: {
          finalTotal: true,
          deliveryRequested: true,
          deliveryFee: true,
          extraCharge: true,
          extraChargeReason: true,
          creditAmount: true,
          creditReason: true,
          appliedCreditBalance: true,
          appliedDebt: true,
          items: {
            where: { isCancelled: false },
            select: {
              productName: true,
              quantity: true,
              unit: true,
              isSingle: true,
              actualWeight: true,
              finalPrice: true,
              estimatedPrice: true,
            },
          },
        },
      });

      if (order && order.items.length > 0) {
        const itemRows = order.items
          .map((it) => {
            const w =
              it.actualWeight != null ? Number(it.actualWeight) : null;
            const price = Number(it.finalPrice ?? it.estimatedPrice ?? 0);
            const qtyText =
              w != null
                ? `${w.toFixed(2)} ק"ג`
                : `${Number(it.quantity)} ${escapeHtml(it.unit || "")}`;
            return `<tr>
              <td style="padding:6px 8px;border-bottom:1px solid #eee;">${escapeHtml(it.productName)}${it.isSingle ? ' <span style="font-size:11px;color:#b45309;">(בודדים)</span>' : ""}</td>
              <td style="padding:6px 8px;border-bottom:1px solid #eee;text-align:center;color:#666;">${qtyText}</td>
              <td style="padding:6px 8px;border-bottom:1px solid #eee;text-align:left;">${fmt(price)}</td>
            </tr>`;
          })
          .join("");

        const itemsSum = order.items.reduce(
          (s, it) => s + Number(it.finalPrice ?? it.estimatedPrice ?? 0),
          0
        );
        const dlv =
          order.deliveryRequested && order.deliveryFee != null
            ? Number(order.deliveryFee)
            : 0;
        const extra = order.extraCharge != null ? Number(order.extraCharge) : 0;
        const credit = order.creditAmount != null ? Number(order.creditAmount) : 0;
        const bal =
          order.appliedCreditBalance != null
            ? Number(order.appliedCreditBalance)
            : 0;
        const debt = order.appliedDebt != null ? Number(order.appliedDebt) : 0;
        const total = Number(order.finalTotal ?? amountCharged);
        // ⚠️ דמי הטיפול נגזרים מההפרש — הם לא שדה על ההזמנה.
        const fee =
          Math.round((total - (itemsSum + dlv + extra + debt - credit - bal)) * 100) /
          100;

        const line = (label: string, val: number, color = "#333") =>
          `<tr>
            <td colspan="2" style="padding:5px 8px;color:${color};">${label}</td>
            <td style="padding:5px 8px;text-align:left;color:${color};">${val < 0 ? "−" : "+"}${fmt(Math.abs(val))}</td>
          </tr>`;

        const extraRows: string[] = [];
        if (Math.abs(fee) > 0.01) extraRows.push(line("דמי הזמנה", fee));
        if (dlv > 0) extraRows.push(line("משלוח", dlv));
        if (extra > 0)
          extraRows.push(
            line(
              order.extraChargeReason
                ? `חיוב נוסף — ${escapeHtml(order.extraChargeReason)}`
                : "חיוב נוסף",
              extra
            )
          );
        if (debt > 0) extraRows.push(line("חוב ממכירה קודמת", debt, "#b91c1c"));
        if (credit > 0)
          extraRows.push(
            line(
              order.creditReason
                ? `זיכוי — ${escapeHtml(order.creditReason)}`
                : "זיכוי",
              -credit,
              "#15803d"
            )
          );
        if (bal > 0) extraRows.push(line("יתרת זכות", -bal, "#15803d"));

        breakdownHtml = `
          <table style="width:100%;border-collapse:collapse;font-size:14px;margin:16px 0;">
            <thead><tr style="background:#fff8d8;">
              <th style="padding:8px;text-align:right;">מוצר</th>
              <th style="padding:8px;text-align:center;">כמות</th>
              <th style="padding:8px;text-align:left;">מחיר</th>
            </tr></thead>
            <tbody>
              ${itemRows}
              ${extraRows.length ? `<tr><td colspan="3" style="padding:4px 8px;"></td></tr>${extraRows.join("")}` : ""}
            </tbody>
          </table>`;
      }
    }

    const details: string[] = [];
    if (pointName) {
      details.push(`<p>נקודת חלוקה: <strong>${escapeHtml(pointName)}</strong></p>`);
    }
    if (deliveryDate) {
      details.push(`<p>תאריך חלוקה: <strong>${escapeHtml(deliveryDate)}</strong></p>`);
    }
    if (transactionId) {
      details.push(
        `<p style="color:#888;font-size:12px;">מס' עסקה: <span style="font-family:monospace;">${escapeHtml(transactionId)}</span></p>`
      );
    }

    const body = `
      <p>שלום ${escapeHtml(customerName)},</p>
      <p>התשלום עבור הזמנה <strong>#${orderNumber}</strong> בוצע בהצלחה. תודה!</p>
      ${breakdownHtml}
      <div style="background:#dcfce7;border-radius:10px;padding:16px;margin:16px 0;text-align:center;">
        <p style="color:#15803d;font-size:16px;margin:0;"><strong>✓ חויב</strong></p>
        <p style="color:#15803d;font-size:18px;margin:4px 0 0;"><strong>${fmt(Number(amountCharged))}</strong></p>
      </div>
      ${details.join("\n")}`;

    await getResend().emails.send({
      from: FROM_ADDRESS,
      to,
      subject: `אישור חיוב להזמנה #${orderNumber} - צדקת רבותינו`,
      html: baseTemplate("התשלום התקבל", body),
    });
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: String(e?.message || e).slice(0, 500) };
  }
}
