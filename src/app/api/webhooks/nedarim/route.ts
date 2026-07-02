import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// webhook שנדרים פלוס קוראים אחרי כל עסקה מוצלחת.
// ה-URL הזה מוגדר כ-CallBack בפרמטרי ה-iframe.
// param1 = customerId (לאימות הרשמה) או orderId (לתשלום הזמנה).
// param2 = סוג המטרה: "registration" | "order"
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null);
    // נדרים שולחים לפעמים כ-form-urlencoded ולפעמים כ-JSON - תומכים בשניהם
    let data: Record<string, string> = {};
    if (body) {
      data = body;
    } else {
      const text = await req.text();
      for (const pair of text.split("&")) {
        const [k, v] = pair.split("=");
        if (k) data[decodeURIComponent(k)] = decodeURIComponent(v ?? "");
      }
    }

    const token = data["Token"] || data["token"] || "";
    const last4 = data["Last4Digits"] || data["last4"] || data["CardNumber"]?.slice(-4) || "";
    const param1 = data["param1"] || ""; // customerId או orderId
    const param2 = data["param2"] || ""; // "registration" | "order"
    const amount = parseFloat(data["Amount"] || data["amount"] || "0");
    const transactionId = data["TransactionId"] || data["Numero"] || data["numero"] || "";

    if (!param1) {
      return NextResponse.json({ error: "missing param1" }, { status: 400 });
    }

    // === אימות הרשמה (חיוב 1₪) ===
    if (param2 === "registration" || !param2) {
      const customer = await prisma.customer.findUnique({ where: { id: param1 } });
      if (!customer) {
        return NextResponse.json({ error: "customer not found" }, { status: 404 });
      }

      await prisma.customer.update({
        where: { id: param1 },
        data: {
          paymentToken: token || null,
          cardLast4: last4 || null,
          cardVerifiedAt: new Date(),
        },
      });

      return NextResponse.json({ ok: true, type: "registration" });
    }

    // === תשלום הזמנה ===
    if (param2 === "order") {
      const order = await prisma.order.findUnique({
        where: { id: param1 },
        include: { customer: true },
      });
      if (!order) {
        return NextResponse.json({ error: "order not found" }, { status: 404 });
      }
      if (order.paymentStatus === "PAID") {
        // כבר סומן כשולם - idempotent, מחזירים הצלחה בלי לכתוב שוב
        return NextResponse.json({ ok: true, type: "order", note: "already paid" });
      }

      // בודקים האם זו ההזמנה הראשונה שבה צריך לקזז 1₪
      const customer = order.customer;
      const verificationDeduction =
        !customer.creditVerificationCharged &&
        amount > 0 &&
        Number(order.finalTotal) > 1
          ? 1
          : 0;

      await prisma.$transaction([
        prisma.order.update({
          where: { id: param1 },
          data: {
            paymentStatus: "PAID",
            paymentMethod: "ONLINE",
            amountPaid: amount,
            paidAt: new Date(),
            paymentTransactionId: transactionId || null,
            paymentProvider: "nedarim_plus",
          },
        }),
        // אם קיזזנו 1₪ - נסמן שהאימות כבר נוצל
        ...(verificationDeduction > 0
          ? [
              prisma.customer.update({
                where: { id: customer.id },
                data: { creditVerificationCharged: true },
              }),
            ]
          : []),
        // אם הכרטיס שימש לתשלום - נשמור גם את הטוקן החדש אם חסר
        ...(token && !customer.paymentToken
          ? [
              prisma.customer.update({
                where: { id: customer.id },
                data: { paymentToken: token, cardLast4: last4 || customer.cardLast4 },
              }),
            ]
          : []),
      ]);

      return NextResponse.json({ ok: true, type: "order", deducted1nis: verificationDeduction > 0 });
    }

    return NextResponse.json({ error: "unknown param2" }, { status: 400 });
  } catch (e) {
    console.error("nedarim webhook error:", e);
    return NextResponse.json({ error: "server error" }, { status: 500 });
  }
}

// נדרים שולחים GET לפעמים לצורך בדיקת זמינות ה-endpoint
export async function GET() {
  return NextResponse.json({ ok: true });
}
