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
/**
 * §198: השם הנוכחי של הלקוח, לא ה-snapshot.
 *
 * 🐛 displayName(order) נשמר ברגע ההזמנה. אחרי שהמנהל תיקן שמות
 * (מסך השלמת השמות), מייל המחיר הסופי ותזכורת החלוקה המשיכו
 * לפנות ללקוח בשם הישן - "שלום ברכה" במקום "שלום ברכה כהן".
 *
 * ⚠️ נפילה ל-customerName אם הלקוח לא נשלף: כך קוראים שלא
 * עושים include על customer ממשיכים לעבוד בדיוק כמו קודם, בלי
 * להישבר. זו הסיבה שהתיקון כאן ולא בכל אחד מ-25 המקומות.
 */
function displayName(order: any): string {
  return order?.customer?.name || order?.customerName || "";
}

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
  // 🐛 תוקן: הקוד הניח שכל מה שאינו "בודדים" הוא קרטון, ומוצר ארוז
  // ("בקר טחון 500 ג'") הוצג ללקוח כ"2 קרטונים" במקום "2 יחידות".
  const u = (it.unit || "").trim();
  const packUnit = u && u !== 'ק"ג' ? u : "קרטון";
  return `${qty} ${pluralizeHe(packUnit, qty)}`;
}

// ריבוי בעברית. אות סופית חייבת להשתנות לפני הסיומת:
// "קרטון"+"ים" נותן "קרטוןים" שהוא שגוי.
function pluralizeHe(u: string, n: number): string {
  if (n <= 1) return u;
  if (u.endsWith("ה")) return u.slice(0, -1) + "ות";
  const finals: Record<string, string> = { "ם": "מ", "ן": "נ", "ץ": "צ", "ף": "פ", "ך": "כ" };
  const last = u.slice(-1);
  return (finals[last] ? u.slice(0, -1) + finals[last] : u) + "ים";
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
        : `<span style="background:#fed7aa;color:#9a3412;padding:2px 6px;border-radius:4px;font-size:11px;font-weight:bold;margin-right:6px;">${escapeHtml((it.unit || "").trim() && (it.unit || "").trim() !== 'ק"ג' ? (it.unit as string).trim() : "קרטון")}</span>`;
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
      `הזמנה חדשה #${order.orderNumber}\n${displayName(order)} — ${order.phone}\n${order.pointNameSnapshot ?? ""}\nסה"כ משוער: ${fmt(Number(order.estimatedTotal))}`
    );

    const body = `
      <p style="font-size:16px;"><strong>הזמנה חדשה #${order.orderNumber}</strong></p>
      <table style="width:100%;font-size:14px;margin-bottom:16px;">
        <tr><td style="padding:4px 0;color:#666;">לקוח:</td><td><strong>${escapeHtml(displayName(order))}</strong></td></tr>
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
      subject: `הזמנה חדשה #${order.orderNumber} - ${displayName(order)}`,
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
      <p>שלום ${escapeHtml(displayName(order))},</p>
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

    // §147: לקוח מזומן מקבל הוראה אחרת - כמה להביא ולאן, במקום
    // קישור תשלום שאין לו מה לעשות איתו.
    //
    // ⚠️ שתי דרכים לזהות: העדפת הלקוח, או שיטת התשלום שנקבעה על
    // ההזמנה עצמה (למשל תוספת שסומנה כמזומן ב-§120). מספיק שאחת
    // מהן מתקיימת.
    const isCashCustomer =
      (order as any)?.customer?.paymentPreference === "CASH" ||
      (order as any)?.paymentMethod === "CASH";

    // §147: לקוח עם כרטיס שמור **אינו** מתבקש לשלם.
    //
    // 🐛 מה שהיה: הנושא היה "נא להשלים תשלום" לכולם. לקוח אשראי
    // קרא את זה, לא הבין מה נדרש ממנו, וחשש שמשהו השתבש - בזמן
    // שהכרטיס שלו עומד להיות מחויב אוטומטית.
    //
    // ⚠️ שלושה מצבים, לא שניים:
    //   • מזומן          -> "נא להביא X לנקודה"
    //   • כרטיס שמור     -> "הכרטיס יחויב, אין צורך בפעולה"
    //   • בלי כרטיס      -> קישור תשלום (המצב היחיד שדורש פעולה)
    const hasStoredCard = !!(order as any)?.customer?.paymentToken;

    const body = `
      <p>שלום ${escapeHtml(displayName(order))},</p>
      <p>המחיר הסופי להזמנה <strong>#${order.orderNumber}</strong> נקבע לאחר שקילה.</p>
      <table style="width:100%;border-collapse:collapse;font-size:14px;margin:16px 0;">
        <thead><tr style="background:#FFE000;">
          <th style="padding:8px;text-align:right;">מוצר</th>
          <th style="padding:8px;text-align:center;">כמות</th>
          <th style="padding:8px;text-align:left;">מחיר</th>
        </tr></thead>
        <tbody>${itemsRows(order.items, true)}</tbody>
      </table>
      ${(() => {
        // §308: 🐛 **הטבלה הציגה פריטים בלבד, והסכום כלל עוד.**
        //
        // הלקוח ראה במייל פריטים ב-₪800 ו"לתשלום ₪838", ולא
        // הבין מאיפה ההפרש. באתר הוא ראה פירוט מלא - וזו בדיוק
        // אי-ההתאמה שדווחה.
        //
        // ⚠️ ההפרש מורכב מ: דמי טיפול, משלוח, חיוב נוסף - פחות
        // זיכוי ויתרת זכות. כולם קיימים על ההזמנה ולא הוצגו.
        //
        // ⚠️ מוצג רק מה שקיים: שורות ריקות של "משלוח ₪0" הן
        // רעש, והלקוח סורק מייל בשתי שניות.
        const o: any = order;
        const rows: string[] = [];
        const line = (label: string, val: number, color = "#333") =>
          `<tr>
            <td style="padding:6px 8px;color:${color};">${label}</td>
            <td style="padding:6px 8px;text-align:left;color:${color};">${
              val < 0 ? "-" : "+"
            }${fmt(Math.abs(val))}</td>
          </tr>`;

        const itemsSum = (o.items || []).reduce(
          (sum: number, it: any) =>
            sum + Number(it.finalPrice ?? it.estimatedPrice ?? 0),
          0
        );

        // ⚠️ דמי הטיפול נגזרים מההפרש ולא נשלפים: הם אינם על
        // ההזמנה כשדה נפרד, אלא כבר בתוך estimatedTotal (§245).
        const dlv =
          o.deliveryRequested && o.deliveryFee != null
            ? Number(o.deliveryFee)
            : 0;
        const extra = o.extraCharge != null ? Number(o.extraCharge) : 0;
        const credit = o.creditAmount != null ? Number(o.creditAmount) : 0;
        const bal =
          o.appliedCreditBalance != null ? Number(o.appliedCreditBalance) : 0;
        const debt = o.appliedDebt != null ? Number(o.appliedDebt) : 0;

        const known = itemsSum + dlv + extra + debt - credit - bal;
        const fee = Math.round((Number(o.finalTotal ?? 0) - known) * 100) / 100;

        if (Math.abs(fee) > 0.01) rows.push(line("דמי טיפול", fee));
        if (dlv > 0) rows.push(line("משלוח", dlv));
        if (extra > 0) rows.push(line("חיוב נוסף", extra));
        if (debt > 0) rows.push(line("חוב קודם", debt, "#b91c1c"));
        if (credit > 0) rows.push(line("זיכוי", -credit, "#15803d"));
        if (bal > 0) rows.push(line("יתרת זכות", -bal, "#15803d"));

        return rows.length
          ? `<table style="width:100%;border-collapse:collapse;font-size:14px;margin-top:4px;">
               <tbody>${rows.join("")}</tbody>
             </table>`
          : "";
      })()}
      <p style="font-size:18px;text-align:left;"><strong>לתשלום: ${fmt(Number(order.finalTotal))}</strong></p>
      ${
        // §147: לקוח מזומן מקבל הוראה אחרת לגמרי.
        //
        // 🐛 מה שהיה: המייל הציע לכולם "לתשלום מאובטח" עם קישור.
        // לקוח מזומן קיבל הודעה שלא רלוונטית לו - הוא משלם פיזית
        // בחלוקה, ואין לו מה ללחוץ.
        //
        // ⚠️ **זו כל מטרת המייל אצלו**: לדעת כמה להביא. לקוח
        // אשראי יגלה כשהכרטיס יחויב; מזומן פשוט יגיע בלי סכום.
        isCashCustomer
          ? `<div style="background:#fffbef;border:2px solid #d4a017;border-radius:12px;padding:16px;margin-top:20px;text-align:center;">
               <div style="font-weight:bold;color:#8b5a00;font-size:15px;">
                 💵 תשלום במזומן בחלוקה
               </div>
               <div style="color:#5a4a2a;font-size:14px;margin-top:6px;line-height:1.7;">
                 נא להביא <strong>${fmt(Number(order.finalTotal))}</strong> לנקודת החלוקה.
                 ${order.pointNameSnapshot ? `<br>📍 ${escapeHtml(order.pointNameSnapshot)}` : ""}
                 ${order.deliveryDateSnapshot ? `<br>📦 ${escapeHtml(order.deliveryDateSnapshot)}` : ""}
               </div>
             </div>
             <p style="color:#888;font-size:12px;margin-top:16px;">
               לאחר התשלום תקבלו אישור נוסף במייל.
             </p>`
          : hasStoredCard
            ? `<div style="background:#f0fdf4;border:2px solid #86efac;border-radius:12px;padding:16px;margin-top:20px;text-align:center;">
                 <div style="font-weight:bold;color:#15803d;font-size:15px;">
                   💳 אין צורך בפעולה מצדכם
                 </div>
                 <div style="color:#166534;font-size:14px;margin-top:6px;line-height:1.7;">
                   הכרטיס השמור יחויב בסכום זה, ותקבלו אישור במייל.
                 </div>
               </div>`
            : order.paymentLink
              ? `<div style="text-align:center;margin-top:20px;">
                   <a href="${order.paymentLink}" style="display:inline-block;background:#C0461E;color:#fff;padding:14px 32px;border-radius:10px;text-decoration:none;font-size:16px;">
                     לתשלום מאובטח ←
                   </a>
                 </div>
                 <p style="color:#888;font-size:12px;margin-top:16px;">התשלום מתבצע באתר בצורה מאובטחת.</p>`
              : `<p style="color:#888;font-size:12px;margin-top:16px;">
                   פרטי התשלום יימסרו בנפרד.
                 </p>`
      }`;

    await getResend().emails.send({
      from: FROM_ADDRESS,
      to: customerEmail,
      // ⚠️ הנושא משתנה לפי המצב. "נא להשלים תשלום" ללקוח שהכרטיס
      // שלו יחויב אוטומטית הוא מטעה - הוא פותח את המייל בדריכות
      // ומחפש מה נדרש ממנו.
      subject: isCashCustomer
        ? `סכום לתשלום בחלוקה — הזמנה #${order.orderNumber}`
        : hasStoredCard
          ? `המחיר הסופי להזמנה #${order.orderNumber}`
          : `מחיר סופי להזמנה #${order.orderNumber} - נא להשלים תשלום`,
      html: baseTemplate(
        isCashCustomer
          ? `הסכום לתשלום — #${order.orderNumber}`
          : `מחיר סופי נקבע — #${order.orderNumber}`,
        body
      ),
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
      <p>שלום ${escapeHtml(displayName(order))},</p>
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

      ${buildItemsTable(order)}

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
/**
 * §79: התראה על בקשת הרשמה חדשה מהמערכת הטלפונית.
 *
 * ═══════════════════════════════════════════════════════════════
 * הפער שנסגר
 * ═══════════════════════════════════════════════════════════════
 * לקוח שנרשם ב-IVR נוצר במסד, ונוצרה עבורו PhoneSignupRequest -
 * ואז שום דבר לא קרה. הבקשה ישבה במסך "בקשות מהטלפון" וחיכתה
 * שמישהו יפתח אותו במקרה. לקוח שהתקשר בערב יכול היה להמתין יום
 * שלם, בזמן שהוא חסום מלהזמין ומלהיכנס לאתר.
 *
 * ═══════════════════════════════════════════════════════════════
 * למי נשלח
 * ═══════════════════════════════════════════════════════════════
 * לנציגים המשויכים לנקודת החלוקה שהלקוח בחר - הם אלה שיטפלו -
 * ולמנהל כגיבוי. אם לנקודה אין נציג משויך, המנהל מקבל את זה
 * מודגש: אחרת הבקשה תיפול בין הכיסאות בדיוק כמו קודם.
 *
 * agentPoints הוא מקור האמת לשיוך (many-to-many), עם נפילה
 * ל-agentPointId הישן לנציגים שטרם הועברו.
 *
 * הכשל אינו חוסם: השיחה כבר הסתיימה והלקוח כבר נוצר. מייל שנכשל
 * מדווח בלוג בלבד - אין טעם להפיל הרשמה מוצלחת בגלל Resend.
 */
export async function sendPhoneSignupNotification(params: {
  customerName: string;
  phone: string;
  pointId: string;
  requestId: string;
}): Promise<{ ok: boolean; error?: string }> {
  try {
    const settings = await getSettings();

    const point = await prisma.deliveryPoint.findUnique({
      where: { id: params.pointId },
      select: { name: true, city: true },
    });

    // נציגי הנקודה - שני המקורות, בלי כפילויות
    const [linked, legacy] = await Promise.all([
      prisma.agentPoint.findMany({
        where: { pointId: params.pointId },
        select: { agent: { select: { id: true, name: true, email: true, role: true, isActive: true } } },
      }),
      prisma.customer.findMany({
        where: { agentPointId: params.pointId, role: "AGENT" },
        select: { id: true, name: true, email: true, role: true, isActive: true },
      }),
    ]);

    const byId = new Map<string, { name: string; email: string | null }>();
    for (const l of linked) {
      const a = l.agent;
      // מנהל משויך לנקודה אינו "הנציג האחראי" - הוא מקבל את המייל
      // ממילא ככתובת הניהול, ולא צריך להיספר פעמיים.
      if (a.role !== "AGENT" || a.isActive === false || !a.email) continue;
      byId.set(a.id, { name: a.name, email: a.email });
    }
    for (const a of legacy) {
      if (a.isActive === false || !a.email) continue;
      if (!byId.has(a.id)) byId.set(a.id, { name: a.name, email: a.email });
    }

    const agents = Array.from(byId.values());
    const pointLabel =
      (point?.name ?? "נקודה לא ידועה") + (point?.city ? ` — ${point.city}` : "");

    // וואטסאפ ישיר ללקוח - הפעולה הראשונה שהנציג יעשה ממילא
    const waPhone = params.phone.replace(/\D/g, "").replace(/^0/, "972");
    const waText = encodeURIComponent(
      `שלום ${params.customerName}, מדברים מצדקת רבותינו בנוגע לפתיחת החשבון שלך.`
    );
    const adminLink = `${APP_URL}/admin/phone-signups`;

    const body = `
      <p style="font-size:16px;"><strong>לקוח חדש נרשם דרך המערכת הטלפונית</strong></p>
      <table style="width:100%;font-size:14px;margin-bottom:16px;">
        <tr><td style="padding:4px 0;color:#666;width:110px;">שם:</td><td><strong>${escapeHtml(params.customerName)}</strong></td></tr>
        <tr><td style="padding:4px 0;color:#666;">טלפון:</td><td dir="ltr" align="right">${escapeHtml(params.phone)}</td></tr>
        <tr><td style="padding:4px 0;color:#666;">נקודת חלוקה:</td><td>${escapeHtml(pointLabel)}</td></tr>
      </table>

      <div style="background:#FEF3C7;border-right:4px solid #C0461E;padding:12px;border-radius:8px;font-size:14px;">
        <strong>עד שהחשבון יוקם, הלקוח חסום:</strong> אינו יכול להזמין ואינו יכול
        להיכנס לאתר. יש ליצור איתו קשר, להזין אמצעי תשלום (אשראי או סימון
        כלקוח מזומן), ולהפיק לו קוד כניסה בכרטיס הלקוח.
      </div>

      ${
        agents.length === 0
          ? `<div style="background:#FEE2E2;border:1px solid #FCA5A5;padding:12px;border-radius:8px;font-size:14px;margin-top:12px;">
               <strong>⚠️ אין נציג משויך לנקודה הזו.</strong> הבקשה לא תטופל
               על ידי איש עד שישויך נציג, או עד שתטפל בה ישירות.
             </div>`
          : `<p style="font-size:13px;color:#666;margin-top:12px;">
               נציגי הנקודה: ${escapeHtml(agents.map((a) => a.name).join(", "))}
             </p>`
      }

      <div style="margin-top:20px;">
        <a href="${adminLink}" style="display:inline-block;background:#C0461E;color:#fff;padding:10px 20px;border-radius:8px;text-decoration:none;">
          פתיחת רשימת הבקשות
        </a>
        <a href="https://wa.me/${waPhone}?text=${waText}" style="display:inline-block;background:#25D366;color:#fff;padding:10px 20px;border-radius:8px;text-decoration:none;margin-right:8px;">
          וואטסאפ ללקוח
        </a>
      </div>`;

    // כתובת הניהול תמיד, ונציגי הנקודה בנוסף. Set מונע כפילות אם
    // הנציג הוא גם כתובת הניהול.
    const recipients = Array.from(
      new Set([settings.adminEmail, ...agents.map((a) => a.email!)].filter(Boolean))
    );
    if (recipients.length === 0) {
      return { ok: false, error: "no recipients" };
    }

    await getResend().emails.send({
      from: FROM_ADDRESS,
      to: recipients,
      subject: `לקוח חדש מהטלפון — ${params.customerName} (${pointLabel})`,
      html: baseTemplate("לקוח חדש מהמערכת הטלפונית", body),
    });
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: String(e?.message || e).slice(0, 500) };
  }
}

/**
 * §118: פירוט הפריטים במייל אישור התשלום.
 *
 * ═══════════════════════════════════════════════════════════════
 * הפער שנסגר
 * ═══════════════════════════════════════════════════════════════
 * המייל הציג סכום בלבד. לקוח שהזמין חמישה מוצרים וקיבל ארבעה
 * ראה סכום נמוך מהצפוי, בלי שום הסבר - והניח שההזמנה שלו
 * פוספסה. השיחה הבאה הייתה אל הנציג.
 *
 * ⚠️ **הטבלה נצמדת להזמנה, לא למה שסופק.** מוצר שהוזמן ולא
 * הגיע **מופיע** ברשימה עם הסימון "לא סופק", ולא נעלם ממנה.
 * זו כל הנקודה: הלקוח צריך לראות שהמערכת יודעת שהוא הזמין את
 * זה, ושהמוצר פשוט לא היה - ולא שמישהו שכח אותו.
 *
 * הנציג רושם 0 בשקילה (§81 מחייב זאת), וה-0 הזה הופך כאן
 * להודעה מפורשת ללקוח.
 *
 * ⚠️ 0 מפורש שונה מ-null: null פירושו שטרם נשקל, ואז מוצג
 * "ממתין לשקילה" ולא "לא סופק". הבחנה חשובה - הודעה שגויה
 * שמוצר לא סופק, כשהוא בסך הכל טרם נשקל, גרועה מכלום.
 */
function buildItemsTable(order: any): string {
  const items: any[] = Array.isArray(order?.items) ? order.items : [];
  if (items.length === 0) return "";

  const rows = items
    .filter((it) => !it.isCancelled)
    .map((it) => {
      const w =
        it.actualWeight != null
          ? Number(it.actualWeight)
          : it.agentEnteredWeight != null
            ? Number(it.agentEnteredWeight)
            : null;
      const price = it.finalPrice != null ? Number(it.finalPrice) : null;
      const notSupplied = w !== null && w === 0;
      const pending = w === null;

      const qtyLabel = it.isSingle
        ? `${Number(it.quantity)} ${it.unit || 'ק"ג'}`
        : `${Number(it.quantity)} ${it.unit || "קרטון"}`;

      // שורה של מוצר שלא סופק - מוצגת מושתקת אך **נוכחת**
      const nameCell = notSupplied
        ? `<span style="color:#999;">${escapeHtml(it.productName)}</span>`
        : escapeHtml(it.productName);

      const statusCell = notSupplied
        ? `<span style="color:#b45309;font-weight:bold;">לא סופק</span>`
        : pending
          ? `<span style="color:#888;">ממתין לשקילה</span>`
          : `${w!.toFixed(2)} ק"ג`;

      const priceCell = notSupplied
        ? `<span style="color:#999;">—</span>`
        : price != null
          ? fmt(price)
          : `<span style="color:#888;">—</span>`;

      return `
        <tr style="${notSupplied ? "background:#fafafa;" : ""}">
          <td style="padding:6px 8px;border-bottom:1px solid #eee;">${nameCell}</td>
          <td style="padding:6px 8px;border-bottom:1px solid #eee;text-align:center;color:#666;font-size:13px;">${qtyLabel}</td>
          <td style="padding:6px 8px;border-bottom:1px solid #eee;text-align:center;font-size:13px;">${statusCell}</td>
          <td style="padding:6px 8px;border-bottom:1px solid #eee;text-align:center;font-weight:bold;">${priceCell}</td>
        </tr>`;
    })
    .join("");

  // §123: שורת הזיכוי.
  //
  // ⚠️ מוצגת **רק** אם ניתן זיכוי. לקוח שלא קיבל זיכוי לא רואה
  // שום אזכור לכך - לא "זיכוי: 0" ולא שורה ריקה. זו הייתה דרישה
  // מפורשת, והיא גם נכונה: אזכור של משהו שלא קרה רק מבלבל.
  const credit = order?.creditAmount != null ? Number(order.creditAmount) : 0;
  const creditRow =
    credit > 0
      ? `
        <tr style="background:#f0fdf4;">
          <td style="padding:8px;border-top:2px solid #86efac;font-weight:bold;color:#15803d;">
            זיכוי
            ${
              order.creditReason
                ? `<div style="font-weight:normal;font-size:12px;color:#166534;">${escapeHtml(
                    String(order.creditReason)
                  )}</div>`
                : ""
            }
          </td>
          <td style="padding:8px;border-top:2px solid #86efac;"></td>
          <td style="padding:8px;border-top:2px solid #86efac;"></td>
          <td style="padding:8px;border-top:2px solid #86efac;text-align:center;font-weight:bold;color:#15803d;">
            −${fmt(credit)}
          </td>
        </tr>`
      : "";

  // §124: יתרת זכות שקוזזה מהזמנות קודמות.
  //
  // ⚠️ שורה נפרדת מהזיכוי: creditAmount הוא זיכוי שניתן **בהזמנה
  // הזו**, ו-appliedCreditBalance הוא זיכוי **מהעבר** שקוזז בה.
  // מיזוג היה מונע מהלקוח להבין מאיפה כל סכום הגיע.
  const applied =
    order?.appliedCreditBalance != null ? Number(order.appliedCreditBalance) : 0;
  const balanceRow =
    applied > 0
      ? `
        <tr style="background:#eff6ff;">
          <td style="padding:8px;border-top:1px solid #bfdbfe;font-weight:bold;color:#1d4ed8;">
            יתרת זכות שקוזזה
            <div style="font-weight:normal;font-size:12px;color:#1e40af;">
              מזיכוי בהזמנה קודמת
            </div>
          </td>
          <td style="padding:8px;border-top:1px solid #bfdbfe;"></td>
          <td style="padding:8px;border-top:1px solid #bfdbfe;"></td>
          <td style="padding:8px;border-top:1px solid #bfdbfe;text-align:center;font-weight:bold;color:#1d4ed8;">
            −${fmt(applied)}
          </td>
        </tr>`
      : "";

  // §263: 💸 חוב מהעבר שנגבה בהזמנה זו.
  //
  // ⚠️ הלקוח **חייב** לראות את זה במייל: הוא מקבל חיוב גבוה
  // מהצפוי, ובלי השורה הזו הוא חושב שהמערכת טעתה.
  //
  // ⚠️ אדום ולא כחול: יתרת זכות מקטינה, חוב מגדיל. אותו צבע
  // לשניהם היה מבלבל בסריקה מהירה.
  const debtApplied =
    (order as any)?.appliedDebt != null ? Number((order as any).appliedDebt) : 0;
  const debtNote = (order as any)?.customer?.debtNote ?? "";
  const debtRow =
    debtApplied > 0
      ? `
        <tr style="background:#fef2f2;">
          <td style="padding:8px;border-top:1px solid #fecaca;font-weight:bold;color:#b91c1c;">
            חוב קודם
            ${
              debtNote
                ? `<div style="font-weight:normal;font-size:12px;color:#991b1b;">${debtNote}</div>`
                : ""
            }
          </td>
          <td style="padding:8px;border-top:1px solid #fecaca;"></td>
          <td style="padding:8px;border-top:1px solid #fecaca;"></td>
          <td style="padding:8px;border-top:1px solid #fecaca;text-align:center;font-weight:bold;color:#b91c1c;">
            +${fmt(debtApplied)}
          </td>
        </tr>`
      : "";

  // §134/§135: משלוח וחיוב נוסף - שורות שמוסיפות לסכום.
  //
  // ⚠️ כל שורה עם הסיבה שלה. לקוח שרואה סכום גבוה מהצפוי בלי
  // הסבר מתקשר לברר - וזו בדיוק השיחה שהפירוט נועד למנוע.
  const delivery =
    order?.deliveryRequested && order?.deliveryFee != null
      ? Number(order.deliveryFee)
      : 0;
  const extra = order?.extraCharge != null ? Number(order.extraCharge) : 0;

  const addRow = (label: string, sub: string, amount: number, color: string) => `
        <tr>
          <td style="padding:8px;border-top:1px solid #eee;font-weight:bold;color:${color};">
            ${label}
            ${sub ? `<div style="font-weight:normal;font-size:12px;color:#666;">${escapeHtml(sub)}</div>` : ""}
          </td>
          <td style="padding:8px;border-top:1px solid #eee;"></td>
          <td style="padding:8px;border-top:1px solid #eee;"></td>
          <td style="padding:8px;border-top:1px solid #eee;text-align:center;font-weight:bold;color:${color};">
            +${fmt(amount)}
          </td>
        </tr>`;

  const deliveryRow =
    delivery > 0
      ? addRow("משלוח", order.deliveryAddress ?? "", delivery, "#7c3aed")
      : "";
  const extraRow =
    extra > 0
      ? addRow("חיוב נוסף", order.extraChargeReason ?? "", extra, "#c2410c")
      : "";

  const anyNotSupplied = items.some(
    (it) =>
      !it.isCancelled &&
      (it.actualWeight != null ? Number(it.actualWeight) : it.agentEnteredWeight != null ? Number(it.agentEnteredWeight) : null) === 0
  );

  return `
    <div style="margin:18px 0;">
      <div style="font-weight:bold;font-size:14px;margin-bottom:6px;">פירוט ההזמנה</div>
      <table style="width:100%;border-collapse:collapse;font-size:14px;">
        <thead>
          <tr style="background:#f4f4f4;">
            <th style="padding:6px 8px;text-align:right;font-size:12px;color:#666;">מוצר</th>
            <th style="padding:6px 8px;text-align:center;font-size:12px;color:#666;">הוזמן</th>
            <th style="padding:6px 8px;text-align:center;font-size:12px;color:#666;">משקל בפועל</th>
            <th style="padding:6px 8px;text-align:center;font-size:12px;color:#666;">סכום</th>
          </tr>
        </thead>
        <tbody>${rows}${deliveryRow}${extraRow}${creditRow}${debtRow}${balanceRow}</tbody>
      </table>
      ${
        anyNotSupplied
          ? `<p style="background:#fffbeb;border-right:3px solid #d97706;padding:10px;margin-top:10px;font-size:13px;color:#92400e;">
               מוצר המסומן <strong>"לא סופק"</strong> הוזמן על ידך אך לא הגיע מהספק, ולכן לא חויבת עליו.
               ההזמנה שלך נקלטה במלואה — המוצר פשוט לא היה במלאי.
             </p>`
          : ""
      }
    </div>`;
}

/**
 * §124: הודעה ללקוח על יתרת זכות שנוצרה.
 *
 * נשלחת כשההזמנה כבר שולמה ולכן הזיכוי לא יכול להקטין את החיוב.
 * הלקוח צריך לדעת שני דברים: שמגיע לו כסף, ושהוא יקבל אותו
 * אוטומטית - בלי לפנות לאיש ובלי לזכור.
 */
export async function sendCreditBalanceEmail(params: {
  customerName: string;
  email: string;
  amount: number;
  reason: string;
  newBalance: number;
  orderNumber: number;
}): Promise<{ ok: boolean; error?: string }> {
  try {
    const settings = await getSettings();
    if (!settings.sendEmailToCustomer) return { ok: true };

    const body = `
      <p>שלום ${escapeHtml(params.customerName)},</p>
      <p>
        בעקבות בדיקה בהזמנה <strong>#${params.orderNumber}</strong> נזקפה
        לזכותך יתרה.
      </p>

      <div style="background:#f0fdf4;border:2px solid #86efac;border-radius:12px;padding:16px;margin:16px 0;text-align:center;">
        <div style="color:#15803d;font-size:14px;">יתרת הזכות שלך</div>
        <div style="color:#15803d;font-size:28px;font-weight:bold;margin:4px 0;">
          ${fmt(params.newBalance)}
        </div>
        <div style="color:#166534;font-size:13px;">
          תקוזז אוטומטית מההזמנה הבאה שלך
        </div>
      </div>

      <table style="width:100%;font-size:14px;margin-bottom:12px;">
        <tr>
          <td style="padding:4px 0;color:#666;width:100px;">זיכוי נוכחי:</td>
          <td><strong>${fmt(params.amount)}</strong></td>
        </tr>
        <tr>
          <td style="padding:4px 0;color:#666;">הסיבה:</td>
          <td>${escapeHtml(params.reason)}</td>
        </tr>
      </table>

      <p style="background:#f9fafb;border-right:3px solid #C0461E;padding:12px;font-size:13px;color:#444;">
        <strong>אין צורך לעשות דבר.</strong> בפעם הבאה שתזמינו, הסכום
        יקוזז אוטומטית מהחשבון — תראו אותו בסיכום ההזמנה ובחיוב.
      </p>

      <p style="color:#888;font-size:12px;margin-top:16px;">
        ניתן לראות את יתרת הזכות בכל עת ב<a href="${APP_URL}/account" style="color:#C0461E;">אזור האישי</a>.
      </p>`;

    await getResend().emails.send({
      from: FROM_ADDRESS,
      to: params.email,
      subject: `זוכית ב-${fmt(params.amount)} — יתרה להזמנה הבאה`,
      html: baseTemplate("נזקפה לזכותך יתרה", body),
    });
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: String(e?.message || e).slice(0, 500) };
  }
}

/**
 * §133: תשובת הנציג להערת הלקוח.
 *
 * ⚠️ המייל מכיל את **שתי** הצדדים - ההערה והתשובה. לקוח שכתב
 * לפני יומיים לא זוכר מה שאל, ותשובה בלי ההקשר שלה מבלבלת.
 */
export async function sendAgentReplyEmail(params: {
  customerName: string;
  email: string;
  orderNumber: number;
  note: string;
  reply: string;
  agentName: string;
}): Promise<{ ok: boolean; error?: string }> {
  try {
    const settings = await getSettings();
    if (!settings.sendEmailToCustomer) return { ok: true };

    const body = `
      <p>שלום ${escapeHtml(params.customerName)},</p>
      <p>
        התקבלה תשובה להערה שהוספת להזמנה
        <strong>#${params.orderNumber}</strong>.
      </p>

      ${
        params.note
          ? `<div style="background:#f9fafb;border-right:3px solid #d1d5db;padding:12px;margin:12px 0;border-radius:0 8px 8px 0;">
               <div style="font-size:12px;color:#888;margin-bottom:4px;">ההערה שלך:</div>
               <div style="font-size:14px;color:#444;">${escapeHtml(params.note)}</div>
             </div>`
          : ""
      }

      <div style="background:#f0fdf4;border-right:3px solid #22c55e;padding:12px;margin:12px 0;border-radius:0 8px 8px 0;">
        <div style="font-size:12px;color:#15803d;margin-bottom:4px;">
          תשובת ${escapeHtml(params.agentName)}:
        </div>
        <div style="font-size:15px;color:#14532d;font-weight:500;">
          ${escapeHtml(params.reply)}
        </div>
      </div>

      <p style="color:#888;font-size:12px;margin-top:16px;">
        ניתן לראות את ההזמנה ואת התשובה ב<a href="${APP_URL}/account" style="color:#C0461E;">אזור האישי</a>.
      </p>`;

    await getResend().emails.send({
      from: FROM_ADDRESS,
      to: params.email,
      subject: `תשובה להערה שלך — הזמנה #${params.orderNumber}`,
      html: baseTemplate("התקבלה תשובה", body),
    });
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: String(e?.message || e).slice(0, 500) };
  }
}

/**
 * §145: קובץ הזמנה באקסל ללקוח.
 *
 * נשלח אוטומטית כשמכירה מופעלת, ללקוחות שסומנו בכרטיס כרוצים
 * לקבל. הם ממלאים כמויות ומחזירים במייל.
 *
 * ⚠️ הקובץ מצורף כ-attachment ולא כקישור: לקוח שלא נוח לו עם
 * האתר גם לא ילחץ על קישור להורדה. הקובץ חייב להיות שם.
 */
export async function sendExcelOrderEmail(params: {
  customerName: string;
  email: string;
  saleName: string;
  deliveryDateText: string | null;
  closeDateText: string | null;
  fileBuffer: Buffer;
}): Promise<{ ok: boolean; error?: string }> {
  try {
    const settings = await getSettings();
    if (!settings.sendEmailToCustomer) return { ok: true };

    const body = `
      <p>שלום ${escapeHtml(params.customerName)},</p>
      <p>
        נפתחה הזמנה חדשה — <strong>${escapeHtml(params.saleName)}</strong>.
        מצורף קובץ להזמנה.
      </p>

      <div style="background:#fffbef;border:2px solid #d4a017;border-radius:12px;padding:16px;margin:16px 0;">
        <div style="font-weight:bold;color:#8b5a00;margin-bottom:8px;">
          איך מזמינים
        </div>
        <ol style="margin:0;padding-right:20px;color:#5a4a2a;font-size:14px;line-height:1.9;">
          <li>פותחים את הקובץ המצורף</li>
          <li>ממלאים כמות בעמודה <strong>&quot;כמות&quot;</strong> בלבד</li>
          <li>
            שומרים ושולחים את הקובץ בחזרה לכתובת:
            <a href="mailto:${escapeHtml(settings.adminEmail)}" style="color:#C0461E;font-weight:bold;">
              ${escapeHtml(settings.adminEmail)}
            </a>
          </li>
        </ol>
      </div>

      <table style="width:100%;font-size:14px;margin-bottom:12px;">
        ${
          params.deliveryDateText
            ? `<tr><td style="padding:4px 0;color:#666;width:110px;">תאריך חלוקה:</td><td><strong>${escapeHtml(params.deliveryDateText)}</strong></td></tr>`
            : ""
        }
        ${
          params.closeDateText
            ? `<tr><td style="padding:4px 0;color:#666;">מועד אחרון:</td><td><strong>${escapeHtml(params.closeDateText)}</strong></td></tr>`
            : ""
        }
      </table>

      <p style="background:#f9fafb;border-right:3px solid #C0461E;padding:12px;font-size:13px;color:#444;">
        <strong>⚖️ שימו לב:</strong> המחירים בקובץ משוערים. מוצרים הנמכרים
        לפי משקל נשקלים בחלוקה, והמחיר הסופי נקבע לפי המשקל בפועל.
      </p>

      <p style="color:#888;font-size:12px;margin-top:16px;">
        ניתן גם להזמין ישירות ב<a href="${APP_URL}/order" style="color:#C0461E;">אתר</a>
        או במערכת הטלפונית.
      </p>`;

    const safeName =
      params.saleName.replace(/[^\u0590-\u05FF\w\s-]/g, "").trim() || "order";

    await getResend().emails.send({
      from: FROM_ADDRESS,
      to: params.email,
      // §145: 🐛 replyTo חיוני כאן.
      //
      // orders@tzidkat.com היא כתובת שליחה בלבד - אין מאחוריה
      // תיבה. בלי replyTo, לקוח שלוחץ "השב" ומצרף את הקובץ
      // שולח אותו לחלל, והוא בטוח שהזמין.
      //
      // ⚠️ הכתובת נלקחת מההגדרות ולא מקודדת: אם תשנה אותה במסך
      // ההגדרות, גם היעד כאן משתנה - ולא תגלה חודש אחר כך
      // שהזמנות הלכו לכתובת ישנה.
      replyTo: settings.adminEmail,
      subject: `הזמנה חדשה: ${params.saleName} — קובץ למילוי`,
      html: baseTemplate("קובץ הזמנה", body),
      attachments: [
        {
          filename: `הזמנה-${safeName}.xlsx`,
          content: params.fileBuffer,
        },
      ],
    });
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: String(e?.message || e).slice(0, 500) };
  }
}

/**
 * §159: התראה למנהל על ביטול הזמנה ע"י הלקוח.
 *
 * 🐛 הפער: הלקוח ביטל, קיבל מייל אישור - **והמנהל לא ידע כלום.**
 * ההזמנה נעלמה מהרשימה הפעילה, והסחורה שהוזמנה מהספק נשארה בלי
 * קונה. בחלוקה זה מתגלה כעודף שאין לו הסבר.
 *
 * ⚠️ נשלח גם לנציג של הנקודה: הוא זה שמכין את הסחורה, וביטול
 * שהוא לא יודע עליו הוא עבודה מיותרת ומקום שנשמר לחינם.
 */
export async function sendAdminCancellationAlert(
  order: any
): Promise<{ ok: boolean; error?: string }> {
  try {
    const settings = await getSettings();

    // ⚠️ הנציגים של הנקודה - הם מכינים את הסחורה בפועל.
    //
    // ⚠️ agentPoint הישן נכלל גם הוא: נציג שטרם הועבר למבנה
    // הרב-נקודתי היה נשמט מההתראה בלי שאיש ישים לב.
    const agents = order.pointId
      ? await prisma.customer.findMany({
          where: {
            role: "AGENT",
            isActive: true,
            // §270: `{ not: null }` אינו חוקי — not: "" מסנן שניהם.
            email: { not: "" },
            OR: [
              { agentPoints: { some: { pointId: order.pointId } } },
              { agentPointId: order.pointId },
            ],
          },
          select: { email: true },
        })
      : [];

    const recipients = Array.from(
      new Set([settings.adminEmail, ...agents.map((a) => a.email!)].filter(Boolean))
    );
    if (recipients.length === 0) return { ok: true };

    const items: any[] = Array.isArray(order?.items) ? order.items : [];
    const rows = items
      .filter((it) => !it.isCancelled)
      .map(
        (it) => `
        <tr>
          <td style="padding:5px 8px;border-bottom:1px solid #eee;">${escapeHtml(it.productName)}</td>
          <td style="padding:5px 8px;border-bottom:1px solid #eee;text-align:center;color:#666;font-size:13px;">
            ${Number(it.quantity)} ${escapeHtml(it.unit || "")}
          </td>
        </tr>`
      )
      .join("");

    const total =
      order.finalTotal != null
        ? Number(order.finalTotal)
        : Number(order.estimatedTotal ?? 0);

    // §159: הזמנה ששולמה - **מקרה קצה נדיר**.
    //
    // ⚠️ ברוב המקרים זה לא יקרה: הביטול חסום ברגע שנקבע finalTotal,
    // והחיוב תמיד בא אחריו. כלומר לקוח שחויב כבר לא יכול לבטל.
    //
    // המקרה היחיד שנשאר: נציג שסימן תשלום מזומן **לפני** שהמשקלים
    // הושלמו. שם paymentStatus הוא PAID אבל finalTotal עדיין null,
    // והביטול עובר.
    //
    // נדיר - ולכן ההתראה נשארת, אבל בלי באנר אדום שצועק על כל
    // ביטול רגיל.
    const wasPaid =
      order.paymentStatus === "PAID" || order.paymentStatus === "PARTIALLY_PAID";

    const body = `
      <p style="font-size:16px;">
        <strong>${escapeHtml(displayName(order) || "")}</strong> ביטל את הזמנה
        <strong>#${order.orderNumber}</strong>.
      </p>

      ${
        wasPaid
          ? `<div style="background:#fef2f2;border:2px solid #fca5a5;border-radius:12px;padding:14px;margin:14px 0;">
               <div style="font-weight:bold;color:#b91c1c;font-size:15px;">
                 ⚠️ ההזמנה סומנה כשולמה — יש לבדוק החזר
               </div>
               <div style="color:#7f1d1d;font-size:14px;margin-top:4px;">
                 סכום: <strong>${fmt(Number(order.amountPaid ?? total))}</strong>
                 <div style="font-size:12px;margin-top:4px;font-weight:normal;">
                   מקרה חריג — בדרך כלל ביטול נחסם אחרי שקילה. ייתכן שהנציג
                   סימן מזומן לפני שהמשקלים הושלמו.
                 </div>
               </div>
             </div>`
          : ""
      }

      <table style="width:100%;font-size:14px;margin:12px 0;">
        <tr>
          <td style="padding:4px 0;color:#666;width:110px;">טלפון:</td>
          <td dir="ltr" style="text-align:right;">${escapeHtml(order.phone || "—")}</td>
        </tr>
        <tr>
          <td style="padding:4px 0;color:#666;">נקודת חלוקה:</td>
          <td><strong>${escapeHtml(order.pointNameSnapshot || order.point?.name || "—")}</strong></td>
        </tr>
        ${
          order.deliveryDateSnapshot
            ? `<tr><td style="padding:4px 0;color:#666;">תאריך חלוקה:</td><td>${escapeHtml(order.deliveryDateSnapshot)}</td></tr>`
            : ""
        }
        <tr>
          <td style="padding:4px 0;color:#666;">סכום ההזמנה:</td>
          <td><strong>${fmt(total)}</strong></td>
        </tr>
      </table>

      ${
        rows
          ? `<div style="font-weight:bold;font-size:13px;margin-bottom:4px;">
               הפריטים שהתבטלו — המלאי משתחרר:
             </div>
             <table style="width:100%;border-collapse:collapse;font-size:14px;">
               <tbody>${rows}</tbody>
             </table>`
          : ""
      }

      <p style="color:#888;font-size:12px;margin-top:16px;">
        <a href="${APP_URL}/admin/orders" style="color:#C0461E;">לרשימת ההזמנות</a>
      </p>`;

    await getResend().emails.send({
      from: FROM_ADDRESS,
      to: recipients,
      subject: wasPaid
        ? `⚠️ בוטלה הזמנה ששולמה #${order.orderNumber} — ${displayName(order)}`
        : `בוטלה הזמנה #${order.orderNumber} — ${displayName(order)}`,
      html: baseTemplate("הזמנה בוטלה", body),
    });
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: String(e?.message || e).slice(0, 500) };
  }
}
