import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/guard";
import { requireAgent } from "@/lib/agent-guard";
import { resolvePaymentStatusFromAmount, PAYMENT_METHOD_LABELS } from "@/lib/pricing";
import { sendPaymentConfirmedEmail } from "@/lib/email";

// סימון תשלום מזומן - פעולה נפרדת ומבוקרת (לא דרך ה-PATCH הכללי של ההזמנה).
// כללים (לפי המפרט): חובה finalTotal קיים מראש; חובה receivedBy; אם amountPaid < finalTotal
// מסומן PARTIALLY_PAID; שווה -> PAID; כל מקרה נרשם ב-PaymentAuditLog שלא נמחק לעולם.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  // ═══════════════════════════════════════════════════════════
  // §91: גם נציג רשאי לסמן תשלום מזומן
  // ═══════════════════════════════════════════════════════════
  // 🐛 הפער שנסגר: הפעולה הייתה למנהל בלבד. אבל מי שמקבל את הכסף
  // בפועל הוא **הנציג בחלוקה** - ולא הייתה לו שום דרך לסמן זאת.
  // התוצאה: הלקוח שילם במזומן, אף אחד לא סימן, והכרטיס שלו חויב
  // בערב. תשלום כפול, ושיחת טלפון לא נעימה.
  //
  // ⚠️ בכוונה **כל** נציג, ולא רק בעל agentCanCharge: ההרשאה הזו
  // מגבילה *הוצאת* כסף מהלקוח. סימון מזומן עושה את ההפך - הוא
  // מונע חיוב. חסימה כאן הייתה יוצרת בדיוק את התשלום הכפול
  // שהמנגנון בא למנוע.
  //
  // ההגבלה שכן נשמרת: נציג רשאי רק בהזמנות של נקודותיו.
  const admin = await requireAdmin();
  let actorLabel: string;
  let agentPointIds: string[] | null = null;
  // §398: מי קיבל את הכסף ביד — נציג (ואיזה) או המנהל
  let agentActorId: string | null = null;

  if (admin.ok) {
    actorLabel =
      admin.session?.user?.email ?? admin.session?.user?.name ?? "unknown";
  } else {
    const agent = await requireAgent();
    if (!agent.ok) return agent.res;
    if (!agent.isAdmin && agent.agentPointIds.length === 0) {
      return NextResponse.json(
        { error: "אין לך נקודת חלוקה משויכת. פנה למנהל." },
        { status: 403 }
      );
    }
    actorLabel = `נציג: ${agent.agent.name}`;
    agentPointIds = agent.isAdmin ? null : agent.agentPointIds;
    agentActorId = agent.isAdmin ? null : agent.agent.id;
  }

  const b = await req.json().catch(() => ({}));
  const note: string | null = b.note ?? null;
  const receivedByUserId = actorLabel;

  const order = await prisma.order.findUnique({ where: { id } });
  if (!order) return NextResponse.json({ error: "הזמנה לא נמצאה" }, { status: 404 });

  // §398: "שילם את כל היתרה" — השרת מחשב, לא המסך. סימון מרוכז
  // שלח את הסכום שנטען בדף; אם ההזמנה נשקלה מחדש בינתיים, נרשם
  // סכום ישן (חלקי מוסתר, או יותר ממה שמגיע).
  const amountPaid =
    b.payRemaining === true && order.finalTotal != null
      ? Number(order.finalTotal)
      : Number(b.amountPaid);
  if (!amountPaid || amountPaid <= 0) {
    return NextResponse.json({ error: "יש להזין סכום תקין שהתקבל" }, { status: 400 });
  }

  // §91: נציג - רק הזמנות של נקודותיו
  if (agentPointIds && !agentPointIds.includes(order.pointId)) {
    return NextResponse.json(
      { error: "אין הרשאה - ההזמנה לא באחת מהנקודות שלך" },
      { status: 403 }
    );
  }

  // לא ניתן לסמן תשלום מזומן לפני שקיים מחיר סופי
  if (order.finalTotal === null) {
    return NextResponse.json(
      {
        error:
          "יש לשקול ולקבוע מחיר סופי לפני סימון תשלום. סימון לפני שקילה היה קובע סכום שאינו מה שהלקוח באמת חייב.",
      },
      { status: 400 }
    );
  }
  if (order.paymentStatus === "PAID") {
    return NextResponse.json({ error: "ההזמנה כבר מסומנת כשולמה" }, { status: 400 });
  }
  // §398: חיוב אשראי באמצע / הזמנה שהוחזרה — סימון מזומן עכשיו היה
  // גובה פעמיים (החיוב עלול להצליח שנייה אחרי).
  if (order.paymentStatus === "CHARGING") {
    return NextResponse.json(
      { error: "ההזמנה נמצאת כרגע בחיוב אשראי. המתן לתוצאה לפני סימון מזומן." },
      { status: 409 }
    );
  }
  if (order.paymentStatus === "REFUNDED") {
    return NextResponse.json({ error: "ההזמנה זוכתה — לא ניתן לסמן עליה תשלום" }, { status: 400 });
  }
  // §398: הזמנה שבוטלה, או שהיתרה שלה כבר הועברה לחוב הלקוח — סימון
  // כאן היה גובה את אותו כסף פעמיים (החוב נשאר ונגבה שוב בהבאה).
  if (order.status === "CANCELLED") {
    return NextResponse.json({ error: "ההזמנה בוטלה — לא ניתן לסמן עליה תשלום" }, { status: 400 });
  }
  if (order.paymentStatus === "DEBT_CARRIED") {
    return NextResponse.json(
      {
        error:
          "היתרה של ההזמנה הזו כבר הועברה לחוב הלקוח בסגירת המכירה. את התשלום רושמים במסך חובות הלקוחות.",
      },
      { status: 400 }
    );
  }
  // §398: 🐛 המסך מחשב "מצטבר = מה שמוצג + מה שהביא עכשיו". אם מישהו
  // סימן תשלום בינתיים, המצטבר שנשלח קטן מהאמת — וחלק מהמזומן שהנציג
  // קיבל היה נעלם. המסך שולח מה הוא ראה, ואם זה השתנה — 409.
  if (b.expectedPrevPaid !== undefined && b.expectedPrevPaid !== null) {
    const seen = Math.round(Number(b.expectedPrevPaid) * 100) / 100;
    const now = Math.round(Number(order.amountPaid ?? 0) * 100) / 100;
    if (Math.abs(seen - now) > 0.005) {
      return NextResponse.json(
        {
          error: `בינתיים נרשם תשלום נוסף בהזמנה (שולם עד כה ${now.toFixed(2)} ש"ח). רענן את המסך והזן שוב.`,
        },
        { status: 409 }
      );
    }
  }

  // §398: 💵 כמה מזומן נכנס **עכשיו** (amountPaid הוא מצטבר).
  const prevPaid = Number(order.amountPaid ?? 0);
  const increment = Math.round((amountPaid - prevPaid) * 100) / 100;
  if (increment <= 0) {
    return NextResponse.json(
      {
        error: `כבר נרשם תשלום של ${prevPaid.toFixed(2)} ש"ח בהזמנה. הסכום שמזינים הוא הסה"כ ששולם — כולל מה שכבר שולם.`,
      },
      { status: 400 }
    );
  }
  // ⚠️ מזומן של נציג אחר כבר בהזמנה — לא מערבבים שני נציגים
  // בשדה אחד (הכסף של הראשון היה עובר לחשבון של השני).
  const prevAgentCash = Number(order.agentCashAmount ?? 0);
  if (
    agentActorId &&
    prevAgentCash > 0 &&
    order.agentCashById &&
    order.agentCashById !== agentActorId
  ) {
    return NextResponse.json(
      { error: "חלק מהתשלום בהזמנה נגבה ע\"י נציג אחר. פנה למנהל לסימון היתרה." },
      { status: 409 }
    );
  }

  const finalTotal = Number(order.finalTotal);
  const resolved = resolvePaymentStatusFromAmount(amountPaid, finalTotal);
  // OVERPAID מטופל כ"שולם" לצורך paymentStatus (האזהרה כבר הוצגה ללקוח בצד הלקוח לפני אישור)
  const paymentStatus = resolved === "PARTIALLY_PAID" ? "PARTIALLY_PAID" : "PAID";

  // חובה הערה אם שולם פחות מהסכום הסופי (גם נאכף כאן, לא רק ב-UI)
  if (resolved === "PARTIALLY_PAID" && !note) {
    return NextResponse.json(
      { error: "סכום נמוך מהמחיר הסופי - חובה להוסיף הערה" },
      { status: 400 }
    );
  }

  // §398: עדכון מותנה — שתי לחיצות במקביל (או סימון מרוכז + סימון
  // בודד) לא ירשמו את אותו מזומן פעמיים. אם ההזמנה השתנתה מאז
  // שקראנו אותה — נכשלים, והמשתמש מרענן.
  const res = await prisma.order.updateMany({
    where: {
      id,
      paymentStatus: order.paymentStatus,
      amountPaid: order.amountPaid,
    },
    data: {
      paymentStatus,
      paymentMethod: "CASH",
      amountPaid,
      paidAt: new Date(),
      receivedByUserId,
      manualPaymentNote: note,
      // §398: הכסף אצל מי שקיבל אותו
      ...(agentActorId
        ? {
            agentCashAmount: Math.round((prevAgentCash + increment) * 100) / 100,
            agentCashById: agentActorId,
          }
        : {
            adminCashAmount:
              Math.round((Number(order.adminCashAmount ?? 0) + increment) * 100) / 100,
          }),
    },
  });
  if (res.count === 0) {
    return NextResponse.json(
      { error: "ההזמנה עודכנה בינתיים (אולי סומנה כבר). רענן את המסך ובדוק." },
      { status: 409 }
    );
  }
  const updated = await prisma.order.findUnique({ where: { id } });

  await prisma.paymentAuditLog.create({
    data: {
      orderId: id,
      action: "MANUAL_CASH_PAYMENT",
      amountPaid,
      finalTotalAtTime: finalTotal,
      paymentMethod: "CASH",
      receivedByUserId,
      note,
    },
  });

  // מייל אישור תשלום ללקוח - רק אם שולם במלואו (לא בתשלום חלקי) ויש ללקוח מייל.
  // לא חוסם: כשל מייל לא מפיל את סימון התשלום.
  if (paymentStatus === "PAID") {
    const fullOrder = await prisma.order.findUnique({
      where: { id },
      include: { items: true, customer: true },
    });
    if (fullOrder?.customer?.email) {
      await sendPaymentConfirmedEmail(
        fullOrder as any,
        fullOrder.customer.email,
        PAYMENT_METHOD_LABELS["CASH"]
      ).catch(() => null);
    }
  }

  return NextResponse.json(updated);
}
