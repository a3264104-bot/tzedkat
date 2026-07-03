import { Resend } from "resend";
import { prisma } from "@/lib/prisma";
import { fmt } from "@/lib/pricing";

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

type OrderItemLike = {
  productName: string;
  unit: string;
  isSingle: boolean;
  quantity: any;
  estimatedPrice: any;
  finalPrice?: any;
};

type OrderLike = {
  id: string;
  orderNumber: number;
  customerName: string;
  phone: string;
  phone2?: string | null;
  notes?: string | null;
  pointNameSnapshot?: string | null;
  deliveryDateSnapshot?: string | null;
  pricelistNameSnapshot?: string | null;
  estimatedTotal: any;
  finalTotal?: any;
  paymentLink?: string | null;
  items: OrderItemLike[];
};

function itemsRows(items: OrderItemLike[], useFinal = false) {
  return items
    .map((it) => {
      const price = useFinal && it.finalPrice != null ? it.finalPrice : it.estimatedPrice;
      return `<tr style="border-bottom:1px solid #eee;">
        <td style="padding:8px;text-align:right;">${it.productName}${it.isSingle ? " (בודדים)" : ""}</td>
        <td style="padding:8px;text-align:center;">${it.quantity} ${it.unit}</td>
        <td style="padding:8px;text-align:left;">${fmt(Number(price))}</td>
      </tr>`;
    })
    .join("");
}

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

/** מייל למנהל על הזמנה חדשה. מחזיר {ok} או {ok:false,error} ללא זריקת שגיאה. */
export async function sendAdminOrderNotification(
  order: OrderLike,
  customerEmail: string | null
): Promise<{ ok: boolean; error?: string }> {
  try {
    const settings = await getSettings();
    if (!settings.sendEmailToAdmin) return { ok: true };

    const adminLink = `${APP_URL}/admin/orders/${order.id}`;
    const waPhone = settings.adminWhatsappPhone
      ? settings.adminWhatsappPhone.replace(/\D/g, "").replace(/^0/, "972")
      : null;
    const waText = encodeURIComponent(
      `הזמנה חדשה #${order.orderNumber}\n${order.customerName} — ${order.phone}\n${order.pointNameSnapshot ?? ""}\nסה"כ משוער: ${fmt(Number(order.estimatedTotal))}`
    );

    const body = `
      <p style="font-size:16px;"><strong>הזמנה חדשה #${order.orderNumber}</strong></p>
      <table style="width:100%;font-size:14px;margin-bottom:16px;">
        <tr><td style="padding:4px 0;color:#666;">לקוח:</td><td><strong>${order.customerName}</strong></td></tr>
        <tr><td style="padding:4px 0;color:#666;">טלפון:</td><td dir="ltr" align="right">${order.phone}</td></tr>
        ${order.phone2 ? `<tr><td style="padding:4px 0;color:#666;">טלפון נוסף:</td><td dir="ltr" align="right">${order.phone2}</td></tr>` : ""}
        ${customerEmail ? `<tr><td style="padding:4px 0;color:#666;">מייל:</td><td dir="ltr" align="right">${customerEmail}</td></tr>` : ""}
        <tr><td style="padding:4px 0;color:#666;">נקודה:</td><td>${order.pointNameSnapshot ?? ""}</td></tr>
        ${order.deliveryDateSnapshot ? `<tr><td style="padding:4px 0;color:#666;">תאריך חלוקה:</td><td>${order.deliveryDateSnapshot}</td></tr>` : ""}
        ${order.notes ? `<tr><td style="padding:4px 0;color:#666;">הערות:</td><td>${order.notes}</td></tr>` : ""}
      </table>
      <table style="width:100%;border-collapse:collapse;font-size:14px;">
        <thead><tr style="background:#FFE000;">
          <th style="padding:8px;text-align:right;">מוצר</th>
          <th style="padding:8px;text-align:center;">כמות</th>
          <th style="padding:8px;text-align:left;">משוער</th>
        </tr></thead>
        <tbody>${itemsRows(order.items)}</tbody>
      </table>
      <p style="font-size:16px;margin-top:16px;text-align:left;"><strong>סה"כ משוער: ${fmt(Number(order.estimatedTotal))}</strong></p>
      <div style="margin-top:20px;">
        <a href="${adminLink}" style="display:inline-block;background:#C0461E;color:#fff;padding:10px 20px;border-radius:8px;text-decoration:none;">
          פתיחת ההזמנה בניהול
        </a>
        ${waPhone ? `<a href="https://wa.me/${waPhone}?text=${waText}" style="display:inline-block;background:#25D366;color:#fff;padding:10px 20px;border-radius:8px;text-decoration:none;margin-right:8px;">וואטסאפ</a>` : ""}
      </div>`;

    await getResend().emails.send({
      from: FROM_ADDRESS,
      to: settings.adminEmail,
      subject: `הזמנה חדשה #${order.orderNumber} - ${order.customerName}`,
      html: baseTemplate(`הזמנה חדשה #${order.orderNumber}`, body),
    });
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: String(e?.message || e).slice(0, 500) };
  }
}

/** מייל אישור ללקוח על קבלת ההזמנה (מחיר משוער בלבד). */
export async function sendCustomerOrderConfirmation(
  order: OrderLike,
  customerEmail: string
): Promise<{ ok: boolean; error?: string }> {
  try {
    const settings = await getSettings();
    if (!settings.sendEmailToCustomer) return { ok: true };

    const body = `
      <p>שלום ${order.customerName},</p>
      <p>הזמנתך התקבלה בהצלחה! מספר הזמנה: <strong>#${order.orderNumber}</strong></p>
      <table style="width:100%;border-collapse:collapse;font-size:14px;margin:16px 0;">
        <thead><tr style="background:#FFE000;">
          <th style="padding:8px;text-align:right;">מוצר</th>
          <th style="padding:8px;text-align:center;">כמות</th>
          <th style="padding:8px;text-align:left;">משוער</th>
        </tr></thead>
        <tbody>${itemsRows(order.items)}</tbody>
      </table>
      <p style="font-size:16px;text-align:left;"><strong>סה"כ משוער: ${fmt(Number(order.estimatedTotal))}</strong></p>
      ${order.pointNameSnapshot ? `<p>נקודת חלוקה: <strong>${order.pointNameSnapshot}</strong></p>` : ""}
      ${order.deliveryDateSnapshot ? `<p>תאריך חלוקה: <strong>${order.deliveryDateSnapshot}</strong></p>` : ""}
      <div style="background:#fff8d8;border-radius:10px;padding:14px;margin-top:16px;">
        <p style="color:#9A3412;font-size:13px;margin:0;">
          <strong>שים לב:</strong> המחיר המוצג הוא מחיר משוער בלבד. המחיר הסופי ייקבע לאחר שקילה בפועל.
          לאחר קביעת המחיר הסופי תקבל/י הודעה עם קישור לתשלום באתר.
        </p>
      </div>`;

    await getResend().emails.send({
      from: FROM_ADDRESS,
      to: customerEmail,
      subject: `אישור הזמנה #${order.orderNumber} - צדקת רבותינו`,
      html: baseTemplate("ההזמנה שלך התקבלה", body),
    });
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: String(e?.message || e).slice(0, 500) };
  }
}

/** מייל ללקוח: מחיר סופי נקבע + קישור לתשלום. */
export async function sendFinalPriceEmail(
  order: OrderLike,
  customerEmail: string
): Promise<{ ok: boolean; error?: string }> {
  try {
    const settings = await getSettings();
    if (!settings.sendEmailToCustomer) return { ok: true };

    const body = `
      <p>שלום ${order.customerName},</p>
      <p>המחיר הסופי להזמנה <strong>#${order.orderNumber}</strong> נקבע לאחר שקילה.</p>
      <table style="width:100%;border-collapse:collapse;font-size:14px;margin:16px 0;">
        <thead><tr style="background:#FFE000;">
          <th style="padding:8px;text-align:right;">מוצר</th>
          <th style="padding:8px;text-align:center;">כמות</th>
          <th style="padding:8px;text-align:left;">מחיר</th>
        </tr></thead>
        <tbody>${itemsRows(order.items, true)}</tbody>
      </table>
      <p style="font-size:18px;text-align:left;"><strong>לתשלום: ${fmt(Number(order.finalTotal))}</strong></p>
      ${
        order.paymentLink
          ? `<div style="text-align:center;margin-top:20px;">
               <a href="${order.paymentLink}" style="display:inline-block;background:#C0461E;color:#fff;padding:14px 32px;border-radius:10px;text-decoration:none;font-size:16px;">
                 לתשלום מאובטח ←
               </a>
             </div>`
          : ""
      }
      <p style="color:#888;font-size:12px;margin-top:16px;">התשלום מתבצע באתר בצורה מאובטחת.</p>`;

    await getResend().emails.send({
      from: FROM_ADDRESS,
      to: customerEmail,
      subject: `מחיר סופי להזמנה #${order.orderNumber} - נא להשלים תשלום`,
      html: baseTemplate(`מחיר סופי נקבע — #${order.orderNumber}`, body),
    });
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: String(e?.message || e).slice(0, 500) };
  }
}

/** מייל ללקוח: התשלום התקבל וההזמנה אושרה. */
export async function sendPaymentConfirmedEmail(
  order: OrderLike,
  customerEmail: string,
  paymentMethodLabel: string
): Promise<{ ok: boolean; error?: string }> {
  try {
    const settings = await getSettings();
    if (!settings.sendEmailToCustomer) return { ok: true };

    const body = `
      <p>שלום ${order.customerName},</p>
      <p>התשלום עבור הזמנה <strong>#${order.orderNumber}</strong> התקבל בהצלחה. תודה!</p>
      <div style="background:#dcfce7;border-radius:10px;padding:16px;margin:16px 0;text-align:center;">
        <p style="color:#15803d;font-size:16px;margin:0;"><strong>✓ שולם (${paymentMethodLabel})</strong></p>
        <p style="color:#15803d;font-size:14px;margin:4px 0 0;">${fmt(Number(order.finalTotal))}</p>
      </div>
      ${order.pointNameSnapshot ? `<p>נקודת חלוקה: <strong>${order.pointNameSnapshot}</strong></p>` : ""}
      ${order.deliveryDateSnapshot ? `<p>תאריך חלוקה: <strong>${order.deliveryDateSnapshot}</strong></p>` : ""}`;

    await getResend().emails.send({
      from: FROM_ADDRESS,
      to: customerEmail,
      subject: `אישור תשלום להזמנה #${order.orderNumber} - צדקת רבותינו`,
      html: baseTemplate("התשלום התקבל", body),
    });
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: String(e?.message || e).slice(0, 500) };
  }
}
