// §23: תזכורת חלוקה ללקוחות — שליחה יזומה ע"י המנהל.
//
// GET  /api/admin/delivery-reminder?pricelistId=X&pointId=Y
//      תצוגה מקדימה: כמה לקוחות יקבלו, ומי בלי מייל. בלי לשלוח כלום.
// POST /api/admin/delivery-reminder
//      Body: { pricelistId, pointId? } — שליחה בפועל.
//
// למה GET נפרד: זה מייל לעשרות אנשים. המנהל צריך לראות למי הוא שולח
// לפני שהוא לוחץ, ולא לגלות אחרי.

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/guard";
import { sendDeliveryReminderEmail } from "@/lib/email";
import { sendVoiceMessage } from "@/lib/yemot-outgoing";
import {
  createPhoneAnnouncement,
  expiryForDelivery,
} from "@/lib/announcement-helper";
import { hebrewDateFull } from "@/lib/hebrew-date-lib";

// שליפת הנמענים. משותפת ל-GET ול-POST כדי שהתצוגה המקדימה תהיה
// בדיוק אותה רשימה שתישלח - בלי הפתעות.
async function getRecipients(pricelistId: string, pointId: string | null) {
  const pricelist = await prisma.pricelist.findUnique({
    where: { id: pricelistId },
    select: {
      id: true,
      name: true,
      deliveryDate: true,
      deliveryDateText: true,
    },
  });
  if (!pricelist) return { pricelist: null, rows: [], noEmail: 0 };

  const orders = await prisma.order.findMany({
    where: {
      pricelistId,
      status: { notIn: ["CANCELLED", "COMPLETED"] },
      ...(pointId ? { pointId } : {}),
    },
    include: {
      customer: { select: { email: true, name: true, phone: true } },
      point: { select: { name: true, address: true, deliveryHours: true } },
      items: { where: { isCancelled: false } },
    },
    orderBy: { orderNumber: "asc" },
  });

  // §29: לקוח בלי מייל *לא* מדולג - הוא מקבל צינתוק קולי עם אותו תוכן.
  // לקוחות שנרשמו בטלפון לרוב בלי מייל, ובלי זה הם לא היו מקבלים
  // תזכורת חלוקה בכלל.
  let noEmail = 0;
  const rows = [];
  for (const o of orders) {
    const email = o.customer?.email ?? null;
    if (!email) noEmail++;
    rows.push({
      email,
      phone: o.customer?.phone || o.phone || null,
      orderId: o.id,
      orderNumber: o.orderNumber,
      customerName: o.customer?.name || o.customerName,
      pointName: o.point?.name || o.pointNameSnapshot || "",
      pointAddress: o.point?.address || null,
      deliveryHours: o.point?.deliveryHours || null,
      items: o.items,
      finalTotal: o.finalTotal,
      estimatedTotal: o.estimatedTotal,
    });
  }

  return { pricelist, rows, noEmail };
}

export async function GET(req: Request) {
  const g = await requireAdmin();
  if (!g.ok) return g.res;

  const { searchParams } = new URL(req.url);
  const pricelistId = searchParams.get("pricelistId");
  const pointId = searchParams.get("pointId") || null;

  if (!pricelistId) {
    return NextResponse.json({ error: "יש לבחור מכירה" }, { status: 400 });
  }

  const { pricelist, rows, noEmail } = await getRecipients(pricelistId, pointId);
  if (!pricelist) {
    return NextResponse.json({ error: "מכירה לא נמצאה" }, { status: 404 });
  }

  return NextResponse.json({
    pricelistName: pricelist.name,
    // אם אין תאריך חלוקה, המייל יישלח בלי התאריך העברי - שווה להתריע מראש
    hasDeliveryDate: !!pricelist.deliveryDate,
    deliveryDateText: pricelist.deliveryDateText,
    recipientCount: rows.length,
    noEmailCount: noEmail,
    recipients: rows.map((r) => ({
      orderNumber: r.orderNumber,
      customerName: r.customerName,
      email: r.email,
      pointName: r.pointName,
    })),
  });
}

export async function POST(req: Request) {
  const g = await requireAdmin();
  if (!g.ok) return g.res;

  const body = await req.json().catch(() => ({}));
  const pricelistId = String(body.pricelistId || "").trim();
  const pointId = body.pointId ? String(body.pointId) : null;

  if (!pricelistId) {
    return NextResponse.json({ error: "יש לבחור מכירה" }, { status: 400 });
  }

  const { pricelist, rows, noEmail } = await getRecipients(pricelistId, pointId);
  if (!pricelist) {
    return NextResponse.json({ error: "מכירה לא נמצאה" }, { status: 404 });
  }
  if (rows.length === 0) {
    return NextResponse.json(
      { error: "אין לקוחות עם כתובת מייל בסינון הנוכחי" },
      { status: 400 }
    );
  }

  let sent = 0;
  let failed = 0;
  const errors: string[] = [];

  let voiceSent = 0;
  let voiceFailed = 0;
  let voiceSkipped = false;

  for (const r of rows) {
    // §29: לקוח בלי מייל מקבל צינתוק קולי עם אותו מידע.
    // התוכן מקוצר בכוונה - הקראה טלפונית ארוכה גורמת לניתוק,
    // ולכן רק מה שחייבים: מתי, איפה, ובאיזו שעה.
    if (!r.email) {
      if (!r.phone) {
        failed++;
        continue;
      }
      const dateText =
        hebrewDateFull(pricelist.deliveryDate) ?? pricelist.deliveryDateText ?? "";
      const voiceText = [
        `שלום ${r.customerName}`,
        `תזכורת, ההזמנה שלך מספר ${r.orderNumber} ממתינה לאיסוף`,
        dateText ? `מועד החלוקה ${dateText}` : "",
        r.pointName ? `בנקודת החלוקה ${r.pointName}` : "",
        r.pointAddress ? `בכתובת ${r.pointAddress}` : "",
        r.deliveryHours ? `בשעות ${r.deliveryHours}` : "",
        "תודה",
      ]
        .filter(Boolean)
        .join(", ");

      const vres = await sendVoiceMessage(r.phone, voiceText);
      if (vres.skipped) {
        voiceSkipped = true;
      } else if (vres.ok) {
        voiceSent++;
      } else {
        voiceFailed++;
        if (errors.length < 5) errors.push(`#${r.orderNumber} (קולי): ${vres.error}`);
      }
      continue;
    }

    const res = await sendDeliveryReminderEmail({
      to: r.email,
      customerName: r.customerName,
      orderNumber: r.orderNumber,
      deliveryDate: pricelist.deliveryDate,
      deliveryDateText: pricelist.deliveryDateText,
      pointName: r.pointName,
      pointAddress: r.pointAddress,
      deliveryHours: r.deliveryHours,
      items: r.items as any,
      // Prisma מחזיר Decimal לשדות כספיים (לדיוק), והתבנית מצפה למספר.
      // ההמרה כאן ולא בתבנית, כדי שהחוזה של פונקציית המייל יישאר נקי.
      finalTotal: r.finalTotal != null ? Number(r.finalTotal) : null,
      estimatedTotal: r.estimatedTotal != null ? Number(r.estimatedTotal) : null,
    });
    if (res.ok) {
      sent++;
    } else {
      failed++;
      if (errors.length < 5) errors.push(`#${r.orderNumber}: ${res.error}`);
    }
  }

  // §32: הודעה קולית מקבילה לכל מי שיתקשר.
  // המייל מגיע רק למי שיש לו כתובת; ההודעה הזו מבטיחה שגם לקוח
  // טלפוני יקבל את אותו עדכון כשיתקשר.
  //
  // התפוגה בסוף יום החלוקה: "החלוקה מחר" שממשיכה להישמע ביום החלוקה
  // עצמו היא שקר. אחרי המועד ההודעה נפסקת מעצמה.
  // §32: התאריך המלא בהודעה, לא "מחר".
  // "מחר" תלוי במתי הלקוח מתקשר: אם ההודעה נשלחה ביום ראשון והוא
  // מתקשר ביום שני, "מחר" הופך לשקר. תאריך מלא נכון תמיד.
  //
  // שם המכירה נכלל בכוונה: אם מתקיימות שתי מכירות בסמיכות, לקוח עם
  // הזמנות בשתיהן צריך לדעת על איזו מהן מדובר.
  const dateForVoice =
    hebrewDateFull(pricelist.deliveryDate) ?? pricelist.deliveryDateText ?? "";
  const annText = [
    `תזכורת ל${pricelist.name}`,
    dateForVoice ? `החלוקה תתקיים ב${dateForVoice}` : "מועד החלוקה מתקרב",
    pointId ? "" : "בנקודת החלוקה שלך",
    "לשמיעת כתובת הנקודה ושעות החלוקה, בחר בתפריט הראשי נקודת החלוקה שלך",
  ]
    .filter(Boolean)
    .join(". ");

  const annRes = await createPhoneAnnouncement({
    pricelistId,
    pointId,
    text: annText,
    expiresAt: expiryForDelivery(pricelist.deliveryDate),
    createdBy: g.session?.user?.email ?? null,
    // מכבה תזכורות קודמות *של אותה מכירה בלבד* - אחרת הלקוח שומע
    // גם את זו של אתמול. שם המכירה בתחילת הטקסט מבטיח שתזכורת של
    // מכירה אחרת לא תכובה בטעות.
    replaceKind: `תזכורת ל${pricelist.name}`,
  });

  console.log(
    `[delivery-reminder] ${g.session?.user?.email} sent for "${pricelist.name}": ${sent} mail, ${voiceSent} voice, ${failed} failed`
  );

  return NextResponse.json({
    ok: true,
    sent,
    failed,
    noEmail,
    // §29: סיכום נפרד לצינתוקים, כדי שהמנהל ידע שגם לקוחות בלי מייל קיבלו
    voiceSent,
    voiceFailed,
    voiceSkipped,
    // §32: האם נוצרה הודעה קולית למתקשרים
    announcementCreated: annRes.ok,
    errors,
  });
}
