import { Resend } from "resend";
import { prisma } from "@/lib/prisma";
import { fmt } from "@/lib/pricing";

// מייל עדכון הזמנה (§17)
// נשלח ללקוח כאשר ההזמנה שלו עודכנה - למשל: שינוי פריטים, שינוי נקודת חלוקה,
// שינוי תאריך חלוקה, הוספה/הסרה של מוצרים ע"י המנהל.
//
// נפרד מ-lib/email.ts כדי לא לגעת בקיים. מיישר את עצמו לאותו pattern:
//   - כתובת שולח: orders@tzidkat.com
//   - lazy getResend()
//   - בדיקת settings.sendEmailToCustomer
//   - החזרת {ok, error?}
//   - baseTemplate של המותג

const FROM_ADDRESS = "צדקת רבותינו <orders@tzidkat.com>";

function getResend() {
  return new Resend(process.env.RESEND_API_KEY);
}

async function getSettings() {
  let settings = await prisma.systemSettings.findUnique({ where: { id: "singleton" } });
  if (!settings) {
    settings = await prisma.systemSettings.create({ data: { id: "singleton" } });
  }
  return settings;
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

function escapeHtml(s: string): string {
  return String(s)
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
  estimatedPrice: any;
  finalPrice?: any;
};

type OrderLike = {
  id: string;
  orderNumber: number;
  customerName: string;
  pointNameSnapshot?: string | null;
  deliveryDateSnapshot?: string | null;
  estimatedTotal: any;
  finalTotal?: any;
  notes?: string | null;
  items: OrderItemLike[];
};

function itemsTable(items: OrderItemLike[]): string {
  const useFinal = items.some((i) => i.finalPrice != null);
  const rows = items
    .map((it) => {
      const price = useFinal && it.finalPrice != null ? it.finalPrice : it.estimatedPrice;
      return `<tr style="border-bottom:1px solid #eee;">
        <td style="padding:8px;text-align:right;">${escapeHtml(it.productName)}${it.isSingle ? " (בודדים)" : ""}</td>
        <td style="padding:8px;text-align:center;">${it.quantity} ${escapeHtml(it.unit)}</td>
        <td style="padding:8px;text-align:left;">${fmt(Number(price))}</td>
      </tr>`;
    })
    .join("");
  const priceHeader = useFinal ? "מחיר" : "משוער";
  return `<table style="width:100%;border-collapse:collapse;font-size:14px;margin:12px 0;">
    <thead><tr style="background:#FFE000;">
      <th style="padding:8px;text-align:right;">מוצר</th>
      <th style="padding:8px;text-align:center;">כמות</th>
      <th style="padding:8px;text-align:left;">${priceHeader}</th>
    </tr></thead>
    <tbody>${rows}</tbody>
  </table>`;
}

/**
 * מייל עדכון הזמנה - נשלח ללקוח כשההזמנה שלו עודכנה.
 * ה-updateReason הוא טקסט קצר שמתאר מה השתנה (למשל "המנהל שינה את רשימת המוצרים").
 */
export async function sendOrderUpdatedEmail(
  order: OrderLike,
  customerEmail: string,
  updateReason?: string
): Promise<{ ok: boolean; error?: string }> {
  try {
    const settings = await getSettings();
    if (!settings.sendEmailToCustomer) return { ok: true };

    const useFinal = order.finalTotal != null;
    const displayTotal = useFinal ? order.finalTotal : order.estimatedTotal;
    const totalLabel = useFinal ? "לתשלום" : 'סה"כ משוער';

    const body = `
      <p>שלום ${escapeHtml(order.customerName)},</p>
      <div style="background:#eff6ff;border-radius:10px;padding:14px;margin:16px 0;border-right:4px solid #2563eb;">
        <p style="margin:0;color:#1e40af;font-weight:600;">
          ההזמנה שלך <strong>#${order.orderNumber}</strong> עודכנה
        </p>
        ${
          updateReason
            ? `<p style="margin:6px 0 0 0;color:#1e40af;font-size:14px;">${escapeHtml(updateReason)}</p>`
            : ""
        }
      </div>

      <p style="font-size:15px;">להלן הסיכום המעודכן של ההזמנה:</p>

      ${itemsTable(order.items)}

      <p style="font-size:16px;text-align:left;">
        <strong>${totalLabel}: ${fmt(Number(displayTotal))}</strong>
      </p>

      ${
        order.pointNameSnapshot
          ? `<p>📍 נקודת חלוקה: <strong>${escapeHtml(order.pointNameSnapshot)}</strong></p>`
          : ""
      }
      ${
        order.deliveryDateSnapshot
          ? `<p>🗓 תאריך חלוקה: <strong>${escapeHtml(order.deliveryDateSnapshot)}</strong></p>`
          : ""
      }
      ${
        order.notes
          ? `<p style="color:#666;font-size:13px;">הערות: ${escapeHtml(order.notes)}</p>`
          : ""
      }

      ${
        !useFinal
          ? `<div style="background:#fff8d8;border-radius:10px;padding:14px;margin-top:16px;">
               <p style="color:#9A3412;font-size:13px;margin:0;">
                 <strong>שים לב:</strong> המחיר המוצג הוא מחיר משוער בלבד. 
                 המחיר הסופי ייקבע לאחר שקילה בפועל, ותקבל/י מייל אישור נפרד.
               </p>
             </div>`
          : ""
      }

      <p style="color:#888;font-size:12px;margin-top:20px;">
        אם יש שאלות לגבי העדכון, ניתן להשיב למייל זה או לפנות אלינו.
      </p>`;

    await getResend().emails.send({
      from: FROM_ADDRESS,
      to: customerEmail,
      subject: `הזמנה #${order.orderNumber} עודכנה - צדקת רבותינו`,
      html: baseTemplate(`הזמנה #${order.orderNumber} עודכנה`, body),
    });
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: String(e?.message || e).slice(0, 500) };
  }
}
