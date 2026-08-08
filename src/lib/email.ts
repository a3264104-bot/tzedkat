import { Resend } from "resend";
import { prisma } from "@/lib/prisma";
import { fmt } from "@/lib/pricing";
import { hebrewDateFull } from "@/lib/hebrew-date-lib";

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

// סינון HTML לפני הזרקה לתבנית. שמות לקוחות והערות הם טקסט חופשי
// שהמשתמש מזין, ובלי סינון תו כמו < שובר את מבנה המייל.
// זהה למימוש ב-nedarim-emails.ts.
function escapeHtml(s: unknown): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

type OrderItemLike = {
  productName: string;
  unit: string;
  isSingle: boolean;
  quantity: any;
  estimatedWeight?: any;
  actualWeight?: any;
  finalWeight?: any;
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

// חישוב תצוגת כמות נקייה - קרטון/בודדים במקום "יח'"
function qtyDisplay(it: OrderItemLike): string {
  const qty = Number(it.quantity);
  if (it.isSingle) {
    // בודדים = ק"ג או יחידות
    if (it.unit === "יחידה" || it.unit === "יחידות") {
      return qty === 1 ? "1 יחידה" : `${qty} יחידות`;
    }
    return `${qty} ק"ג`;
  }
  // קרטון
  return qty === 1 ? "1 קרטון" : `${qty} קרטונים`;
}

// חישוב תצוגת משקל - סופי או משוער
function weightDisplay(it: OrderItemLike): string {
  const final = it.finalWeight ?? it.actualWeight;
  if (final != null) {
    return `<strong>${Number(final).toFixed(2)} ק"ג</strong> (סופי)`;
  }
  if (it.estimatedWeight != null) {
    return `~${Number(it.estimatedWeight).toFixed(1)} ק"ג (משוער)`;
  }
  return it.isSingle ? `${Number(it.quantity)} ק"ג` : "—";
}

function itemsRows(items: OrderItemLike[], useFinal = false) {
  return items
    .map((it) => {
      const price = useFinal && it.finalPrice != null ? it.finalPrice : it.estimatedPrice;
      const qtyLabel = qtyDisplay(it);
      const wLabel = weightDisplay(it);
      const singleBadge = it.isSingle
        ? '<span style="background:#fef3c7;color:#92400e;padding:2px 6px;border-radius:4px;font-size:11px;font-weight:bold;margin-right:6px;">בודדים</span>'
        : '<span style="background:#fed7aa;color:#9a3412;padding:2px 6px;border-radius:4px;font-size:11px;font-weight:bold;margin-right:6px;">קרטון</span>';
      return `<tr style="border-bottom:1px solid #eee;">
        <td style="padding:10px;text-align:right;">
          <div><strong>${escapeHtml(it.productName)}</strong>${singleBadge}</div>
        </td>
        <td style="padding:10px;text-align:center;font-weight:bold;color:#3f3f46;">${qtyLabel}</td>
        <td style="padding:10px;text-align:center;font-size:12px;color:#71717a;">${wLabel}</td>
        <td style="padding:10px;text-align:left;font-weight:bold;">${fmt(Number(price))}</td>
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
        <tr><td style="padding:4px 0;color:#666;">לקוח:</td><td><strong>${escapeHtml(order.customerName)}</strong></td></tr>
        <tr><td style="padding:4px 0;color:#666;">טלפון:</td><td dir="ltr" align="right">${order.phone}</td></tr>
        ${order.phone2 ? `<tr><td style="padding:4px 0;color:#666;">טלפון נוסף:</td><td dir="ltr" align="right">${order.phone2}</td></tr>` : ""}
        ${customerEmail ? `<tr><td style="padding:4px 0;color:#666;">מייל:</td><td dir="ltr" align="right">${customerEmail}</td></tr>` : ""}
        <tr><td style="padding:4px 0;color:#666;">נקודה:</td><td>${escapeHtml(order.pointNameSnapshot ?? "")}</td></tr>
        ${order.deliveryDateSnapshot ? `<tr><td style="padding:4px 0;color:#666;">תאריך חלוקה:</td><td>${escapeHtml(order.deliveryDateSnapshot)}</td></tr>` : ""}
        ${order.notes ? `<tr><td style="padding:4px 0;color:#666;">הערות:</td><td>${escapeHtml(order.notes)}</td></tr>` : ""}
      </table>
      <table style="width:100%;border-collapse:collapse;font-size:14px;">
        <thead><tr style="background:#FFE000;">
          <th style="padding:8px;text-align:right;">מוצר</th>
          <th style="padding:8px;text-align:center;">כמות</th>
          <th style="padding:8px;text-align:center;">משקל</th>
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
      <p>שלום ${escapeHtml(order.customerName)},</p>
      <p>הזמנתך התקבלה בהצלחה! מספר הזמנה: <strong>#${order.orderNumber}</strong></p>
      <table style="width:100%;border-collapse:collapse;font-size:14px;margin:16px 0;">
        <thead><tr style="background:#FFE000;">
          <th style="padding:10px;text-align:right;">מוצר</th>
          <th style="padding:10px;text-align:center;">כמות</th>
          <th style="padding:10px;text-align:center;">משקל</th>
          <th style="padding:10px;text-align:left;">מחיר</th>
        </tr></thead>
        <tbody>${itemsRows(order.items)}</tbody>
      </table>
      <p style="font-size:16px;text-align:left;"><strong>סה"כ משוער: ${fmt(Number(order.estimatedTotal))}</strong></p>
      ${order.pointNameSnapshot ? `<p>נקודת חלוקה: <strong>${escapeHtml(order.pointNameSnapshot)}</strong></p>` : ""}
      ${order.deliveryDateSnapshot ? `<p>תאריך חלוקה: <strong>${escapeHtml(order.deliveryDateSnapshot)}</strong></p>` : ""}
      <div style="background:#fff8d8;border-radius:10px;padding:14px;margin-top:16px;">
        <p style="color:#9A3412;font-size:13px;margin:0;">
          <strong>שים לב:</strong> המחיר המוצג הוא מחיר משוער בלבד. המחיר הסופי ייקבע
          לאחר שקילה בפועל, והכרטיס השמור שלך יחויב בסכום הסופי באופן אוטומטי.
          נשלח לך אישור תשלום במייל לאחר החיוב.
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

/**
 * מייל ללקוח: מחיר סופי + קישור תשלום.
 *
 * ⚠️ שליחה ידנית בלבד — לא נשלח אוטומטית כשנקבע מחיר סופי.
 * הסיבה: החיוב במערכת אוטומטי מהכרטיס השמור, ולכן מייל שמבקש מהלקוח
 * "להשלים תשלום" בזמן שהמערכת עומדת לחייב אותו בעצמה הוא מבלבל ועלול
 * לגרום לתשלום כפול.
 *
 * המקום הנכון שלו: תזכורת יזומה מהמנהל במסך החובות, ללקוח שמסיבה כלשהי
 * לא חויב אוטומטית ונשאר חייב.
 */
export async function sendFinalPriceEmail(
  order: OrderLike,
  customerEmail: string
): Promise<{ ok: boolean; error?: string }> {
  try {
    const settings = await getSettings();
    if (!settings.sendEmailToCustomer) return { ok: true };

    const body = `
      <p>שלום ${escapeHtml(order.customerName)},</p>
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
  paymentMethodLabel: string,
  cardLast4?: string | null
): Promise<{ ok: boolean; error?: string }> {
  try {
    const settings = await getSettings();
    if (!settings.sendEmailToCustomer) return { ok: true };

    const body = `
      <p>שלום ${escapeHtml(order.customerName)},</p>
      <p>התשלום עבור הזמנה <strong>#${order.orderNumber}</strong> התקבל בהצלחה. תודה!</p>
      <div style="background:#dcfce7;border-radius:10px;padding:16px;margin:16px 0;text-align:center;">
        <p style="color:#15803d;font-size:16px;margin:0;"><strong>✓ שולם (${paymentMethodLabel})</strong></p>
        <p style="color:#15803d;font-size:14px;margin:4px 0 0;">${fmt(Number(order.finalTotal))}</p>
        ${
          cardLast4
            ? `<p style="color:#15803d;font-size:13px;margin:4px 0 0;" dir="ltr">כרטיס ****${cardLast4}</p>`
            : ""
        }
      </div>
      ${order.pointNameSnapshot ? `<p>נקודת חלוקה: <strong>${escapeHtml(order.pointNameSnapshot)}</strong></p>` : ""}
      ${order.deliveryDateSnapshot ? `<p>תאריך חלוקה: <strong>${escapeHtml(order.deliveryDateSnapshot)}</strong></p>` : ""}
      <p style="color:#888;font-size:12px;margin-top:16px;">
        ניתן לצפות בפרטי ההזמנה בכל עת ב<a href="${APP_URL}/account" style="color:#C0461E;">אזור האישי</a>.
      </p>`;

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
/**
 * מייל תזכורת לפני יום החלוקה.
 *
 * נשלח ידנית ע"י המנהל (כפתור בסיכום המכירה), ולא אוטומטית - למערכת אין
 * תשתית תזמון (cron), והמנהל ממילא יודע מתי הסחורה מגיעה.
 *
 * מציג תאריך עברי+לועזי מלא באותו פורמט שהלקוח רואה באתר, ולא "מחר" -
 * כי הלקוח שומר את המייל וחוזר אליו, ו"מחר" הופך לחסר משמעות.
 */
export async function sendDeliveryReminderEmail(params: {
  to: string;
  customerName: string;
  orderNumber: number;
  pointName: string;
  pointAddress?: string | null;
  deliveryHours?: string | null;
  deliveryDate: Date | string | null;
  deliveryDateText?: string | null;
  items?: OrderItemLike[];
  estimatedTotal?: number | null;
  finalTotal?: number | null;
}): Promise<{ ok: boolean; error?: string }> {
  try {
    const settings = await getSettings();
    if (!settings.sendEmailToCustomer) return { ok: true };

    const {
      to,
      customerName,
      orderNumber,
      pointName,
      pointAddress,
      deliveryHours,
      deliveryDate,
      deliveryDateText,
      items,
      estimatedTotal,
      finalTotal,
    } = params;

    // תאריך עברי+לועזי. אם אין deliveryDate תקין - נופלים לטקסט החופשי
    // של המחירון, כדי שהמייל לא ייצא בלי תאריך בכלל.
    const dateLine = hebrewDateFull(deliveryDate) || deliveryDateText || null;

    const amount = finalTotal != null ? finalTotal : estimatedTotal;
    const amountIsFinal = finalTotal != null;

    const body = `
      <p>שלום ${escapeHtml(customerName)},</p>
      <p>תזכורת: ההזמנה שלך <strong>#${orderNumber}</strong> ממתינה לאיסוף.</p>

      <div style="background:#fff8d8;border-radius:10px;padding:16px;margin:16px 0;border-right:4px solid #C0461E;">
        ${
          dateLine
            ? `<p style="margin:0 0 10px;font-size:16px;color:#9A3412;">
                 <strong>מועד החלוקה:</strong><br/>${escapeHtml(dateLine)}
               </p>`
            : ""
        }
        <p style="margin:0;font-size:15px;">
          <strong>נקודת חלוקה:</strong><br/>${escapeHtml(pointName)}
        </p>
        ${
          pointAddress
            ? `<p style="margin:8px 0 0;font-size:14px;color:#52525B;">כתובת: ${escapeHtml(pointAddress)}</p>`
            : ""
        }
        ${
          deliveryHours
            ? `<p style="margin:8px 0 0;font-size:14px;color:#52525B;"><strong>שעות החלוקה:</strong> ${escapeHtml(deliveryHours)}</p>`
            : ""
        }
      </div>

      ${
        items && items.length > 0
          ? `<p style="font-size:14px;color:#666;margin-top:20px;">פרטי ההזמנה שלך:</p>
             <table style="width:100%;border-collapse:collapse;font-size:14px;margin-bottom:12px;">
               <thead><tr style="background:#FFE000;">
                 <th style="padding:8px;text-align:right;">מוצר</th>
                 <th style="padding:8px;text-align:center;">כמות</th>
                 <th style="padding:8px;text-align:center;">משקל</th>
                 <th style="padding:8px;text-align:left;">מחיר</th>
               </tr></thead>
               <tbody>${itemsRows(items, amountIsFinal)}</tbody>
             </table>`
          : ""
      }

      ${
        amount != null
          ? `<p style="font-size:15px;text-align:left;">
               ${amountIsFinal ? "סכום ההזמנה" : "סכום משוער"}: <strong>${fmt(Number(amount))}</strong>
             </p>`
          : ""
      }

      <p style="color:#52525B;font-size:14px;">
        אין צורך להביא מזומן — החיוב מתבצע אוטומטית בכרטיס השמור.
      </p>

      <p style="color:#888;font-size:12px;margin-top:16px;">
        לפרטי ההזמנה המלאים ניתן להיכנס ל<a href="${APP_URL}/account" style="color:#C0461E;">אזור האישי</a>.
      </p>`;

    await getResend().emails.send({
      from: FROM_ADDRESS,
      to,
      subject: `תזכורת: חלוקת הזמנה #${orderNumber} — צדקת רבותינו`,
      html: baseTemplate("תזכורת לקראת החלוקה", body),
    });
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: String(e?.message || e).slice(0, 500) };
  }
}

export async function sendBroadcastEmail(
  customerName: string,
  customerEmail: string,
  subject: string,
  messageHtml: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const body = `
      <div style="padding: 8px 0;">
        <p style="font-size: 15px; color: #27272A; margin: 0 0 12px;">
          שלום ${customerName},
        </p>
        <div style="font-size: 14px; line-height: 1.7; color: #52525B;">
          ${messageHtml}
        </div>
        <p style="font-size: 13px; color: #71717A; margin-top: 20px;">
          בברכה,<br/>צדקת רבותינו
        </p>
      </div>
    `;

    const { data, error } = await getResend().emails.send({
      from: FROM_ADDRESS,
      to: customerEmail,
      subject,
      html: baseTemplate(subject, body),
    });

    if (error) {
      return { ok: false, error: String(error) };
    }
    if (!data?.id) {
      return { ok: false, error: "no message id" };
    }
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: String(e?.message || e) };
  }
}