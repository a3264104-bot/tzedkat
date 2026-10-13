// §103: סימון "טופל" של הנציג על הזמנה.
//
// POST /api/agent/orders/[id]/close   { closed: true | false }
//
// ═══════════════════════════════════════════════════════════════
// למה זה נפרד מ"כל המשקלים מולאו"
// ═══════════════════════════════════════════════════════════════
// "כל המשקלים מולאו" הוא נתון שהמערכת מחשבת. זה הצהרה של אדם
// שעמד מול הלקוח וסיים. הזמנה יכולה להיות מלאה במשקלים בלי
// שהנציג בדק אותה, ולהפך.
//
// המנהל משדר לתשלום רק מה שסומן, ולכן הסימון הוא נקודת האחריות:
// הוא נושא שם ושעה, ולא ניתן לסמן הזמנה עם משקל חסר.

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAgent } from "@/lib/agent-guard";
// §400: סכום סופי לפני V — אותו חישוב של השקילה
import { recomputeOrderTotal } from "@/lib/order-total-lib";
import { MAX_CARTON_BOXES } from "@/lib/order-display";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const g = await requireAgent();
  if (!g.ok) return g.res;

  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const closed = body.closed !== false;

  // §382: 🔒 **הורדת V אחרי תשלום — חסומה.**
  //
  // V הוא "סיימתי לשקול". אחרי תשלום, הורדתו פותחת את המשקלים
  // לעריכה על סכום שכבר נגבה. אין סיבה לגיטימית לזה — לתיקון
  // יש זיכוי וחיוב נוסף.
  if (!closed) {
    const cur = await prisma.order.findUnique({
      where: { id },
      select: { paymentStatus: true },
    });
    const ps = cur?.paymentStatus;
    if (ps === "PAID" || ps === "PARTIALLY_PAID" || ps === "CHARGING") {
      return NextResponse.json(
        { error: "ההזמנה כבר שולמה — לא ניתן להסיר את הסימון." },
        { status: 400 }
      );
    }
  }

  const order = await prisma.order.findUnique({
    where: { id },
    select: {
      id: true,
      pointId: true,
      status: true,
      orderNumber: true,
      // §400: הזמנה ששולמה/בחיוב/הועברה לחוב — לא מחשבים מחדש
      paymentStatus: true,
      finalTotal: true,
    },
  });
  if (!order) {
    return NextResponse.json({ error: "הזמנה לא נמצאה" }, { status: 404 });
  }

  // אותה בדיקת שייכות כמו בשאר מסלולי הנציג. מערך ריק אצל נציג
  // פירושו "אין נקודות" ולא "בלי הגבלה" - ההבחנה שנשכחה ב-§70.
  if (!g.isAdmin) {
    if (g.agentPointIds.length === 0) {
      return NextResponse.json(
        { error: "אין לך נקודת חלוקה משויכת" },
        { status: 403 }
      );
    }
    if (!g.agentPointIds.includes(order.pointId)) {
      return NextResponse.json(
        { error: "אין הרשאה - ההזמנה לא באחת מהנקודות שלך" },
        { status: 403 }
      );
    }
  }

  if (closed) {
    // ⚠️ אי אפשר לסמן "טופל" עם משקל חסר.
    //
    // זו הנקודה שבה הסימון מקבל משמעות: אם היה אפשר לסמן הזמנה
    // חלקית, הוי"ו היה הופך לקישוט. משקל שלא מולא הוא כסף שלא
    // נגבה - קרטון שריר שנשכח הוא כ-1,900 ש"ח.
    //
    // null = לא מולא. 0 = מולא במפורש ("הלקוח לא קיבל") ותקף.
    //
    // §400: 🚨 **V עבר — והחיוב דילג על ההזמנה בשקט.**
    //
    // מה שקרה בשטח (ביתר, 3 לקוחות): ההזמנות סומנו V, אבל לא נקבע
    // להן סכום סופי — ולכן "חיוב לפי נקודה" לא כלל אותן, בלי שום
    // הודעה. הבדיקה כאן בדקה רק agentEnteredWeight, ושני מצבים עברו:
    //   • פריט עם משקל — אבל בלי finalPrice (משקל שנשמר במסלול אחר,
    //     למשל מכרטיס הלקוח, שלא חישב מחיר)
    //   • קרטונים: פירוט עם משבצות ריקות / פחות משבצות מקרטונים
    //   • מוצר ביחידות שלא אושר — לא נחשב "חסר", אבל גם לא תומחר
    //
    // ✅ עכשיו: V רק כשלכל פריט יש מחיר סופי, ולהזמנה יש סכום סופי.
    // מה שאפשר לתקן לבד — מתוקן (מחיר ממשקל קיים, יחידות כפי
    // שהוזמנו); מה שחסר באמת — נחסם עם שם הפריט.
    const items = await prisma.orderItem.findMany({
      where: { orderId: id, isCancelled: false },
      select: {
        id: true,
        productName: true,
        quantity: true,
        isSingle: true,
        unitPrice: true,
        agentSetPrice: true,
        agentEnteredWeight: true,
        actualWeight: true,
        finalPrice: true,
        weightParts: true,
        product: { select: { saleType: true } },
      },
    });

    const missingNames: string[] = [];
    const repairs: { id: string; data: Record<string, unknown> }[] = [];
    for (const it of items) {
      const price =
        it.agentSetPrice != null ? Number(it.agentSetPrice) : Number(it.unitPrice);
      const noWeighing = it.product?.saleType === "UNIT";
      const qty = Number(it.quantity);

      if (it.agentEnteredWeight == null) {
        if (noWeighing) {
          // §400: מוצר ביחידות שהנציג לא שינה — נמסר כפי שהוזמן.
          // V הוא ההצהרה "סיימתי עם הלקוח"; בלי זה הפריט נשאר בלי
          // מחיר וההזמנה כולה לא נגבית.
          //
          // ⚠️ מחיר שכבר נקבע (למשל ע"י המנהל) — לא נדרס.
          repairs.push({
            id: it.id,
            data: {
              agentEnteredWeight: it.actualWeight ?? qty,
              agentEnteredById: g.agent.id,
              ...(it.actualWeight == null ? { actualWeight: qty, finalWeight: qty } : {}),
              ...(it.finalPrice == null
                ? {
                    finalPrice:
                      Math.round(Number(it.actualWeight ?? qty) * price * 100) / 100,
                  }
                : {}),
            },
          });
          continue;
        }
        missingNames.push(it.productName);
        continue;
      }

      // §400: קרטונים — כל משבצת חייבת ערך (0 = לא לקח)
      //
      // ⚠️ גם בלי פירוט בכלל (משקל אחד על כמה קרטונים — נתון ישן, או
      // כמות שהוגדלה אחרי השקילה): הטבלה מציגה אותו במשבצת הראשונה
      // והשאר אדומות. בדיוק התמונה של התקלה — ולכן זה "חסר" עד שהנציג
      // מזין 0 במה שלא נלקח.
      const cartons = !it.isSingle && !noWeighing ? Math.floor(qty) : 1;
      const parts = Array.isArray(it.weightParts) ? (it.weightParts as unknown[]) : null;
      const boxes = Math.min(cartons, MAX_CARTON_BOXES);
      if (
        cartons > 1 &&
        (!parts ||
          parts.length < boxes ||
          parts.some((x) => x === null || x === undefined))
      ) {
        missingNames.push(`${it.productName} (חסר משקל לחלק מהקרטונים)`);
        continue;
      }

      if (it.finalPrice == null) {
        // יש משקל ואין מחיר — מחשבים מהמשקל השמור (תיקון מנהל גובר)
        const w = Number(it.actualWeight ?? it.agentEnteredWeight);
        repairs.push({
          id: it.id,
          data: {
            ...(it.actualWeight == null
              ? { actualWeight: w, finalWeight: w }
              : {}),
            finalPrice: Math.round(w * price * 100) / 100,
          },
        });
      }
    }

    if (missingNames.length > 0) {
      return NextResponse.json(
        {
          error: `לא ניתן לסמן כטופל: חסרים משקלים — ${missingNames.join(", ")}. לקוח שלא קיבל פריט או קרטון - יש להזין 0.`,
          code: "MISSING_WEIGHTS",
          missingCount: missingNames.length,
        },
        { status: 400 }
      );
    }

    // §355: ⚠️ **משקל חשוד — אזהרה, לא חסימה.**
    //
    // המצב מהשטח: הזמנה 578 נסגרה עם 21 ק"ג על 15 קרטונים שריר
    // (צפוי ~330), ו-0 על שריר הזרוע. שניהם עברו כי הם לא null.
    //
    // ⚠️ 0 הוא ערך תקף (§141: "הלקוח לא קיבל"), ולכן לא חוסמים.
    // אבל 0 על מוצר שנשקל, או משקל שנמוך מרבע מהצפוי, הוא כמעט
    // תמיד טעות — והנציג צריך לאשר במפורש.
    //
    // ⚠️ confirmSuspicious: הקליינט שולח true אחרי שהנציג אישר.
    // בלי זה — מחזירים את הרשימה ונותנים לו להחליט.
    if (!body.confirmSuspicious) {
      const items = await prisma.orderItem.findMany({
        where: {
          orderId: id,
          isCancelled: false,
          product: { saleType: { not: "UNIT" } },
        },
        select: {
          productName: true,
          quantity: true,
          isSingle: true,
          agentEnteredWeight: true,
          product: { select: { avgWeightPerUnit: true, saleType: true } },
        },
      });

      const suspicious = items
        .map((it) => {
          const w = Number(it.agentEnteredWeight ?? 0);
          const avg = Number(it.product?.avgWeightPerUnit ?? 0);
          const qty = Number(it.quantity);
          // ⚠️ הצפוי: קרטונים × משקל קרטון. בבודדים — הכמות עצמה
          // (היא כבר בק"ג).
          const expected =
            !it.isSingle && it.product?.saleType === "PACKAGE" && avg > 0
              ? qty * avg
              : qty;
          if (w === 0) return { name: it.productName, reason: "משקל 0" };
          if (expected > 0 && w < expected * 0.25)
            return {
              name: it.productName,
              reason: `${w} ק"ג מתוך ~${Math.round(expected)} צפוי`,
            };
          return null;
        })
        .filter((x): x is { name: string; reason: string } => x !== null);

      if (suspicious.length > 0) {
        return NextResponse.json(
          {
            code: "SUSPICIOUS_WEIGHTS",
            suspicious,
            error: "משקלים חשודים — נדרש אישור",
          },
          { status: 409 }
        );
      }
    }

    // §400: תיקונים (מחיר ממשקל קיים / יחידות כפי שהוזמנו) ואז חישוב
    // הסכום הסופי — בדיוק כמו אחרי שקילה בטבלה.
    //
    // ⚠️ לא בהזמנה ששולמה / בחיוב / שהועברה לחוב: חישוב מחדש שם היה
    // מקזז שוב את יתרת הזכות או החוב של הלקוח (מוחק אותם), ומשנה סכום
    // שכבר נגבה. שם רק בודקים שיש סכום.
    const moneyLocked = [
      "PAID",
      "PARTIALLY_PAID",
      "CHARGING",
      "DEBT_CARRIED",
      "REFUNDED",
    ].includes(order.paymentStatus ?? "");
    if (!moneyLocked) {
      for (const r of repairs) {
        await prisma.orderItem.update({ where: { id: r.id }, data: r.data });
      }
      await recomputeOrderTotal(id, g.agent.id);
    }
    const after = moneyLocked
      ? { finalTotal: order.finalTotal }
      : await prisma.order.findUnique({
          where: { id },
          select: { finalTotal: true },
        });
    if (after?.finalTotal == null) {
      return NextResponse.json(
        {
          error:
            "לא ניתן לסמן כטופל: לא נקבע להזמנה סכום סופי. בדוק שלכל פריט הוזן משקל, או פנה למנהל.",
          code: "NO_FINAL_TOTAL",
        },
        { status: 400 }
      );
    }
  }

  const updated = await prisma.order.update({
    where: { id },
    data: {
      agentClosedAt: closed ? new Date() : null,
      agentClosedById: closed ? g.agent.id : null,
    },
    select: { id: true, agentClosedAt: true },
  });

  console.log(
    `[agent-close] order #${order.orderNumber} ${closed ? "closed" : "reopened"} by agent=${g.agent.id}`
  );

  return NextResponse.json({
    ok: true,
    agentClosedAt: updated.agentClosedAt?.toISOString() ?? null,
  });
}
