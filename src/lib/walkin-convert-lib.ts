// ═══════════════════════════════════════════════════════════════
// §398: 🚶➜👤 המרת מזדמן ללקוח רשום + הזמנה רגילה
// ═══════════════════════════════════════════════════════════════
// מזדמן (WalkinOrder) היה רשומה צדדית: בלי חשבון לקוח, בלי מספר
// הזמנה, ומחוץ לרוב המסכים. בפעם הבאה שהאדם הגיע — נרשם שוב, והמנהל
// ראה "₪260 ממזדמנים" בלי לדעת של מי.
//
// ✅ ההמרה:
//   1. מוצאים לקוח קיים לפי טלפון (כל הווריאציות — §71), אחרת לפי
//      מייל. לא נמצא → מקימים לקוח מזומן חדש בנקודה.
//   2. יוצרים הזמנה רגילה במכירה, עם המשקלים שנמכרו (agentEnteredWeight
//      — העמלה נשמרת), המחיר שנגבה, ומסומנת "נמסרה".
//   3. התשלום עובר כמו שהיה: מזומן שהנציג קיבל → agentCashAmount של
//      הנציג (נשאר בחשבונו), אשראי במסוף/העברה/אונליין שהתקבלו → שולם,
//      ומה שלא התקבל → לגבייה.
//   4. המזדמן נמחק — באותה טרנזקציה. אין מצב ביניים שבו הוא נספר
//      פעמיים (פעם כמזדמן ופעם כהזמנה) בעמלה או במזומן.
//
// ⚠️ הסכומים לא משתנים: עמלה (אותם ק"ג באותו תעריף), מזומן אצל הנציג
// (אותו סכום, עכשיו כהזמנה), והכנסה. משתנה רק המקום שבו הם מופיעים —
// עכשיו בכל המסכים הרגילים, תחת שם הלקוח.
//
// ⚠️ בלי דמי טיפול ובלי קיזוז יתרת זכות/חוב: הלקוח כבר שילם סכום
// מסוים בחלוקה, וההזמנה חייבת לשקף בדיוק אותו סכום.

import bcrypt from "bcryptjs";
import crypto from "crypto";
import { prisma } from "@/lib/prisma";
import { normalizePhone, isValidPhone, phoneCandidates, cleanName } from "@/lib/identity";
import { ensureLoginCode } from "@/lib/login-code";
import { closeOpenRequestsForPhone } from "@/lib/close-requests-lib";
import { recalculateAgentSummary } from "@/lib/agent-summary-lib";

export type ConvertOptions = {
  /** טלפון שהוזן עכשיו (למזדמן בלי טלפון, או תיקון) */
  phone?: string | null;
  /** נקודה שנבחרה עכשיו (למזדמן ישן בלי נקודה) */
  pointId?: string | null;
  /** אישור מפורש להקים לקוח בלי טלפון ובלי מייל */
  allowNoPhone?: boolean;
  /** מי ביצע — לתיעוד ביומן התשלומים */
  actorLabel: string;
  /**
   * נקודות שמותר לבחור (נציג — הנקודות שלו). null = הכל (מנהל).
   */
  allowedPointIds: string[] | null;
};

export type ConvertResult =
  | {
      ok: true;
      walkinNumber: number;
      orderId: string;
      orderNumber: number;
      customerId: string;
      customerName: string;
      /** true = נמצא לקוח קיים (לפי טלפון/מייל), false = הוקם חדש */
      customerExisted: boolean;
      total: number;
      paid: boolean;
    }
  | {
      ok: false;
      code: "NOT_FOUND" | "NEEDS_PHONE" | "INVALID_PHONE" | "NEEDS_POINT" | "FORBIDDEN_POINT";
      error: string;
      walkinNumber?: number;
      points?: { id: string; name: string; city: string | null }[];
    };

const r2 = (n: number) => Math.round(n * 100) / 100;

/** אמצעי התשלום של המזדמן → שדות התשלום בהזמנה */
function mapPayment(
  method: string,
  received: boolean
): { paid: boolean; orderMethod: string | null; label: string } {
  switch (method) {
    case "CASH":
      return { paid: received, orderMethod: received ? "CASH" : null, label: "מזומן" };
    case "CARD_TERMINAL":
      return {
        paid: received,
        orderMethod: received ? "CARD_TERMINAL" : null,
        label: "אשראי במסוף",
      };
    case "TRANSFER":
      return {
        paid: received,
        orderMethod: received ? "BANK_TRANSFER" : null,
        label: "העברה בנקאית",
      };
    case "ONLINE":
    case "CARD_ONLINE":
      return { paid: received, orderMethod: received ? "ONLINE" : null, label: "אשראי אונליין" };
    default:
      return { paid: received, orderMethod: received ? "MANUAL" : null, label: method };
  }
}

/**
 * כמות בהזמנה. במזדמן נשמר רק משקל — וכמות בהזמנה רגילה היא
 * קרטונים (או ק"ג/יחידות בבודדים). בלי ההבחנה הזו "סיכום מכירה"
 * היה מציג 9.5 קרטונים במקום קרטון אחד של 9.5 ק"ג.
 */
function quantityFor(
  p: { saleType: string | null; priceType: string | null; avgWeightPerUnit: any },
  weight: number,
  isSingle: boolean
): number {
  if (isSingle) return weight; // בודדים: ק"ג או יחידות — הכמות היא המשקל/הספירה
  const isPackaged = p.saleType === "UNIT" || p.saleType === "PACKAGE";
  if (!isPackaged) return weight; // נמכר לפי ק"ג
  if (p.priceType === "PER_KG") {
    const avg = p.avgWeightPerUnit != null ? Number(p.avgWeightPerUnit) : 0;
    return avg > 0 ? Math.max(1, Math.round(weight / avg)) : 1;
  }
  return weight; // מחיר ליחידה — "משקל" במזדמן הוא מספר היחידות
}

export async function convertWalkinToCustomer(
  walkinId: string,
  opts: ConvertOptions
): Promise<ConvertResult> {
  const w = await prisma.walkinOrder.findUnique({
    where: { id: walkinId },
    include: {
      items: {
        include: {
          product: {
            select: {
              unit: true,
              saleType: true,
              priceType: true,
              avgWeightPerUnit: true,
            },
          },
        },
      },
      agent: {
        select: {
          id: true,
          name: true,
          agentPointId: true,
          agentPoints: { select: { pointId: true } },
        },
      },
      pricelist: { select: { name: true, deliveryDateText: true } },
    },
  });
  if (!w) return { ok: false, code: "NOT_FOUND", error: "המזדמן לא נמצא (אולי כבר הומר)" };

  // ─── טלפון ───
  const rawPhone = (opts.phone ?? "").trim() || (w.customerPhone ?? "").trim();
  const phone = rawPhone ? normalizePhone(rawPhone) : "";
  if (phone && !isValidPhone(phone)) {
    return {
      ok: false,
      code: "INVALID_PHONE",
      error: `מספר הטלפון "${rawPhone}" אינו תקין`,
      walkinNumber: w.walkinNumber,
    };
  }
  const email = (w.customerEmail ?? "").trim().toLowerCase() || null;
  if (!phone && !email && !opts.allowNoPhone) {
    return {
      ok: false,
      code: "NEEDS_PHONE",
      error: "אין טלפון — הזן טלפון כדי שהלקוח יזוהה בפעם הבאה",
      walkinNumber: w.walkinNumber,
    };
  }

  // ─── נקודה ───
  const agentPointIds =
    w.agent.agentPoints.length > 0
      ? w.agent.agentPoints.map((a) => a.pointId)
      : w.agent.agentPointId
        ? [w.agent.agentPointId]
        : [];
  const chosen = (opts.pointId ?? "").trim() || null;
  if (chosen && opts.allowedPointIds && !opts.allowedPointIds.includes(chosen)) {
    return {
      ok: false,
      code: "FORBIDDEN_POINT",
      error: "הנקודה שנבחרה אינה משויכת אליך",
      walkinNumber: w.walkinNumber,
    };
  }
  const pointId =
    chosen ?? w.pointId ?? (agentPointIds.length === 1 ? agentPointIds[0] : null);
  if (!pointId) {
    const ids = opts.allowedPointIds ?? (agentPointIds.length > 0 ? agentPointIds : null);
    const points = await prisma.deliveryPoint.findMany({
      where: ids ? { id: { in: ids } } : { isActive: true },
      select: { id: true, name: true, city: true },
      orderBy: { name: "asc" },
    });
    return {
      ok: false,
      code: "NEEDS_POINT",
      error: "המזדמן נרשם בלי נקודה — יש לבחור לאיזו נקודה הוא שייך",
      walkinNumber: w.walkinNumber,
      points,
    };
  }
  const point = await prisma.deliveryPoint.findUnique({
    where: { id: pointId },
    select: { id: true, name: true, customDeliveryDateText: true },
  });
  if (!point) {
    return { ok: false, code: "NEEDS_POINT", error: "הנקודה לא נמצאה", walkinNumber: w.walkinNumber };
  }

  // ─── לקוח קיים? ───
  let existing: { id: string; name: string; phone: string | null } | null = null;
  if (phone) {
    existing = await prisma.customer.findFirst({
      where: { phone: { in: phoneCandidates(phone) } },
      select: { id: true, name: true, phone: true },
    });
  }
  let emailFree = !!email;
  if (!existing && email) {
    const byEmail = await prisma.customer.findUnique({
      where: { email },
      select: { id: true, name: true, phone: true },
    });
    // מייל של לקוח אחר כשהטלפון לא תאם — זה הוא, אם אין לנו טלפון.
    // עם טלפון שונה: לא מצמידים (אולי בן משפחה עם מייל משותף), ולא
    // שומרים את המייל על הלקוח החדש (unique).
    if (byEmail) {
      if (!phone) existing = byEmail;
      emailFree = false;
    }
  }

  // ─── תשלום ───
  const pay = mapPayment(w.paymentMethod, w.paymentReceived);
  const total = r2(Number(w.totalAmount));
  const when = w.createdAt;
  const agentLabel = `נציג: ${w.agent.name}`;

  // ─── פריטים ───
  const itemsData = w.items.map((it) => {
    const weight = Number(it.weight);
    const price = r2(Number(it.totalPrice));
    const perKg = it.product.priceType === "PER_KG" || it.product.saleType === "WEIGHT";
    return {
      productId: it.productId,
      productName: it.productName,
      unit: it.product.unit,
      isSingle: it.isSingle,
      quantity: quantityFor(it.product, weight, it.isSingle),
      unitPrice: Number(it.unitPrice),
      estimatedPrice: price,
      estimatedWeight: perKg ? weight : null,
      actualWeight: weight,
      finalWeight: weight,
      finalPrice: price,
      weightParts: [weight],
      agentEnteredWeight: weight,
      agentEnteredById: w.agentId,
      agentNote: it.note ?? null,
    };
  });

  const noteParts = [`🚶 הומר ממזדמן #${w.walkinNumber} (${pay.label})`];
  if (w.paymentNote) noteParts.push(`פרטי תשלום: ${w.paymentNote}`);
  if (!pay.paid) noteParts.push(`אמצעי תשלום שנבחר בחלוקה: ${pay.label} — טרם התקבל`);

  const passwordHash = existing
    ? null
    : await bcrypt.hash(crypto.randomBytes(24).toString("base64"), 10);

  const res = await prisma.$transaction(async (tx) => {
    // המזדמן עדיין קיים? (שתי לחיצות במקביל — רק אחת ממירה)
    const still = await tx.walkinOrder.findUnique({ where: { id: w.id }, select: { id: true } });
    if (!still) return null;

    const customer = existing
      ? existing
      : await tx.customer.create({
          data: {
            name: cleanName(w.customerName) || w.customerName,
            phone: phone || null,
            email: emailFree ? email : null,
            passwordHash: passwordHash!,
            passwordPlain: null,
            role: "CUSTOMER",
            isActivated: false,
            isActive: true,
            createdByAgentId: w.agentId,
            defaultPointId: point.id,
            hasSeenOrderIntro: true,
            // הסכמה לדיוור — רק מהלקוח עצמו (כמו בהקמה ע"י נציג)
            agreedToEmails: false,
            agreedToEmailsAt: null,
            // קנה בחלוקה בלי כרטיס — לקוח מזומן. הוספת כרטיס מחזירה לאשראי.
            paymentPreference: "CASH",
          },
          select: { id: true, name: true, phone: true },
        });

    const order = await tx.order.create({
      data: {
        pricelistId: w.pricelistId,
        pointId: point.id,
        customerId: customer.id,
        placedByAgentId: w.agentId,
        source: "WALKIN",
        pointNameSnapshot: point.name,
        deliveryDateSnapshot:
          point.customDeliveryDateText || w.pricelist.deliveryDateText || null,
        pricelistNameSnapshot: w.pricelist.name,
        customerName: customer.name,
        phone: customer.phone ?? phone ?? "",
        notes: w.notes,
        internalNotes: noteParts.join(" · "),
        // נמכר ונמסר במקום
        status: pay.paid ? "COMPLETED" : "FINAL_PRICE_SET",
        estimatedTotal: total,
        finalTotal: total,
        finalPriceSetAt: when,
        finalPriceSetBy: agentLabel,
        deliveredAt: when,
        deliveredByAgentId: w.agentId,
        deliveredNote: "מזדמן — נמכר ונמסר בחלוקה",
        agentClosedAt: when,
        agentClosedById: w.agentId,
        paymentStatus: pay.paid ? "PAID" : total > 0 ? "READY_TO_CHARGE" : "PENDING",
        paymentMethod: pay.orderMethod,
        amountPaid: pay.paid ? total : null,
        paidAt: pay.paid ? when : null,
        // ⚠️ "נציג: <שם>" — כך המזומן נשאר בחשבון הנציג (§397), בדיוק
        // כמו כשהיה מזדמן. רק במזומן: אשראי/העברה הם כסף של העסק.
        receivedByUserId: pay.paid
          ? w.paymentMethod === "CASH"
            ? agentLabel
            : opts.actorLabel
          : null,
        manualPaymentNote: w.paymentNote,
        // §398: המזומן אצל הנציג שרשם את המזדמן — בדיוק כמו קודם
        ...(pay.paid && w.paymentMethod === "CASH"
          ? { agentCashAmount: total, agentCashById: w.agentId }
          : {}),
        createdAt: when,
        items: { create: itemsData },
      },
      select: { id: true, orderNumber: true },
    });

    if (pay.paid) {
      await tx.paymentAuditLog.create({
        data: {
          orderId: order.id,
          action: "WALKIN_CONVERTED",
          amountPaid: total,
          finalTotalAtTime: total,
          paymentMethod: pay.orderMethod ?? "MANUAL",
          receivedByUserId: w.paymentMethod === "CASH" ? agentLabel : opts.actorLabel,
          note: `הומר ממזדמן #${w.walkinNumber} ע"י ${opts.actorLabel}`,
        },
      });
    }

    await tx.walkinOrder.delete({ where: { id: w.id } });
    return { customer, order };
  });

  if (!res) return { ok: false, code: "NOT_FOUND", error: "המזדמן כבר הומר" };

  // אחרי הטרנזקציה — לא חוסמים (§121/§167)
  if (!existing) {
    await ensureLoginCode(prisma, res.customer.id).catch(() => null);
    if (phone) await closeOpenRequestsForPhone(prisma, phone, res.customer.id).catch(() => null);
  }
  // העמלה: אותם ק"ג — עכשיו מההזמנה ולא מהמזדמן
  await recalculateAgentSummary(w.pricelistId, w.agentId).catch((e) =>
    console.error("[walkin-convert] recalc failed:", e)
  );

  return {
    ok: true,
    walkinNumber: w.walkinNumber,
    orderId: res.order.id,
    orderNumber: res.order.orderNumber,
    customerId: res.customer.id,
    customerName: res.customer.name,
    customerExisted: !!existing,
    total,
    paid: pay.paid,
  };
}
