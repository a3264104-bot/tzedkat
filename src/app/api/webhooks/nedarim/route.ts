import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { sendPaymentConfirmedEmail } from "@/lib/email";
import { sendTokenSavedEmail } from "@/lib/nedarim-emails";
import { PAYMENT_METHOD_LABELS } from "@/lib/pricing";

// webhook שנדרים פלוס קוראים אחרי כל עסקה מוצלחת.
// param1 = customerId (אימות הרשמה) או orderId (תשלום הזמנה).
// param2 = "registration" | "order"
//
// חשוב (לפי תיעוד DebitCard.aspx): נדרים משתמשים בשם השדה "Tokef" לתוקף כרטיס
// בפורמט MMYY (למשל "1228" = דצמבר 2028). לכן Tokef מופיע ראשון ברשימת ה-fallbacks
// לחיפוש cardExpiry.

export async function POST(req: Request) {
  try {
    // קוראים את הגוף הגולמי פעם אחת, ומנתחים לפי סוג התוכן
    const rawText = await req.text();
    const contentType = req.headers.get("content-type") || "";

    let data: Record<string, string> = {};
    // ניסיון JSON
    if (contentType.includes("application/json")) {
      try {
        data = JSON.parse(rawText);
      } catch {
        // ליפול חזרה ל-urlencoded
      }
    }
    // אם לא JSON או שהניתוח נכשל - מנסים form-urlencoded
    if (Object.keys(data).length === 0 && rawText.includes("=")) {
      for (const pair of rawText.split("&")) {
        const [k, v] = pair.split("=");
        if (k) data[decodeURIComponent(k.trim())] = decodeURIComponent((v ?? "").trim());
      }
    }

    // ===== לוג מפורט - זה מה שנחפש ב-Vercel Logs =====
    console.log("=== NEDARIM WEBHOOK RECEIVED ===");
    console.log("content-type:", contentType);
    console.log("raw body:", rawText);
    console.log("parsed keys:", Object.keys(data).join(", "));
    console.log("parsed data:", JSON.stringify(data));
    console.log("================================");

    // ═══════════════════════════════════════════════════════════════
    // === RAW DUMP: כל מה שנדרים שלחו, בלי הנחות ===
    // ═══════════════════════════════════════════════════════════════
    console.log("[webhook] ╔══════════════════════════════════════════════");
    console.log("[webhook] ║ FULL PAYLOAD RAW DUMP");
    console.log("[webhook] ╚══════════════════════════════════════════════");
    console.log("[webhook] Full JSON:", JSON.stringify(data, null, 2));
    console.log("[webhook] ─── All keys with types & values ───");
    for (const [k, v] of Object.entries(data)) {
      const type = typeof v;
      console.log(`[webhook]   ${k}: (${type}) "${String(v)}"`);
    }

    // ═══ חיפוש חכם של מזהי כרטיס - לפי דפוסי שם ═══
    console.log("[webhook] ─── Potential identifier fields (heuristic) ───");
    const identifierCandidates: Record<string, string> = {};
    for (const [k, v] of Object.entries(data)) {
      const kLower = k.toLowerCase();
      const isIdCandidate =
        kLower.includes("token") ||
        kLower.includes("uid") ||
        (kLower.includes("id") && !kLower.includes("mid") && !kLower.includes("void")) ||
        kLower.includes("saved") ||
        kLower.includes("keva") ||
        (kLower.includes("card") && !kLower.includes("compagny"));
      if (isIdCandidate && v !== null && v !== undefined && String(v).trim() !== "" && String(v).trim() !== "0") {
        identifierCandidates[k] = String(v);
        console.log(`[webhook]   🔑 CANDIDATE: ${k} = "${String(v)}"`);
      }
    }
    console.log("[webhook] Total identifier candidates:", Object.keys(identifierCandidates).length);
    console.log("[webhook] ╚══════════════════════════════════════════════");
    // ═══════════════════════════════════════════════════════════════

    // חיפוש הטוקן - קפדני: רק שדות ששמם מכיל "token" נשמרים כטוקן לחיובים עתידיים.
    // TransactionId, UID, KevaId, ClientId וכד' אינם טוקן אלא אם התיעוד מאשר במפורש.
    // עדיף להיתקע ולגלות שנדרים לא מחזירים טוקן, מאשר לשמור מזהה שאי אפשר להשתמש בו לחיוב.
    const explicitTokenFields = Object.keys(identifierCandidates).filter((k) =>
      k.toLowerCase().includes("token")
    );

    let token = "";
    let tokenSource = "";
    if (explicitTokenFields.length > 0) {
      const chosen = explicitTokenFields[0];
      token = identifierCandidates[chosen];
      tokenSource = chosen;
      console.log(`[webhook] ✅ Explicit token found: ${chosen} = ${token.substring(0, 6)}...`);
    } else {
      console.log(`[webhook] ⚠️ No explicit token field (name containing "token") found in response.`);
      console.log(`[webhook] ⚠️ Customer will NOT be marked as verified.`);
    }

    // חיפוש גמיש של 4 ספרות אחרונות
    // נדרים משתמשים ב-"LastNum" לפי התיעוד של DebitCard
    const last4 =
      data["LastNum"] ||
      data["Last4Digits"] ||
      data["last4"] ||
      data["Last4"] ||
      data["CardSuffix"] ||
      (data["CardNumber"] ? String(data["CardNumber"]).slice(-4) : "") ||
      "";

    // חיפוש תוקף כרטיס - "Tokef" הוא השם הרשמי לפי תיעוד DebitCard
    // פורמט: MMYY (למשל "1228" = דצמבר 2028)
    const cardExpiry =
      data["Tokef"] ||
      data["tokef"] ||
      data["CardValidity"] ||
      data["Validity"] ||
      data["CardExpiry"] ||
      data["Expiry"] ||
      data["ExpDate"] ||
      data["ExpiryDate"] ||
      "";

    // ניסיון ראשוני: param1/param2 כפי שאמורים לחזור מנדרים
    let param1 = data["param1"] || data["Param1"] || "";
    let param2 = data["param2"] || data["Param2"] || "";

    // Fallback: לפעמים נדרים לא מחזירים את Param1/Param2, אבל כן מחזירים את
    // Comments שהוגדר על ידינו בפורמט "customer:<id>" או "customer:<id>|type:<type>".
    // חיפוש customerId מ-Comments אם param1 ריק.
    if (!param1) {
      const comments = String(data["Comments"] || data["comments"] || data["Comment"] || "");
      const customerMatch = comments.match(/customer:([A-Za-z0-9]+)/);
      if (customerMatch) {
        param1 = customerMatch[1];
        console.log(`[webhook] param1 recovered from Comments: ${param1}`);
      }
      // Fallback ל-param2: אם יש Groupe שקבענו, ניקח ממנו
      if (!param2) {
        const groupe = String(data["Groupe"] || data["groupe"] || "").toLowerCase();
        if (groupe === "registration") {
          param2 = "registration";
        } else if (groupe === "order") {
          param2 = "order";
        }
      }
    }

    const amount = parseFloat(data["Amount"] || data["amount"] || data["Sum"] || "0");
    const transactionId =
      data["TransactionId"] ||
      data["Numero"] ||
      data["numero"] ||
      data["Asmachta"] ||
      data["asmachta"] ||
      "";

    if (!param1) {
      console.log("WEBHOOK ERROR: missing param1");
      return NextResponse.json({ error: "missing param1", receivedKeys: Object.keys(data) }, { status: 400 });
    }

    // === אימות הרשמה (חיוב 1₪) ===
    if (param2 === "registration" || !param2) {
      const customer = await prisma.customer.findUnique({ where: { id: param1 } });
      if (!customer) {
        console.log("WEBHOOK ERROR: customer not found for id", param1);
        return NextResponse.json({ error: "customer not found" }, { status: 404 });
      }

      const isCardUpdate = !!customer.paymentToken;

      // עדכון פרטי הכרטיס אצל הלקוח.
      // cardNeedsUpdate מתאפס תמיד כאשר נשמר טוקן חדש.
      await prisma.customer.update({
        where: { id: param1 },
        data: {
          paymentToken: token || null,
          cardLast4: last4 || null,
          cardExpiry: cardExpiry || null,
          cardVerifiedAt: new Date(),
          cardNeedsUpdate: false,
        },
      });

      // §19: קידום הזמנות של הלקוח שממתינות לטוקן.
      let promotedCount = 0;
      if (token) {
        const pendingOrders = await prisma.order.findMany({
          where: {
            customerId: param1,
            paymentStatus: { in: ["PENDING", "PAYMENT_PENDING", "CARD_UPDATE_NEEDED"] },
          },
          select: { id: true, paymentStatus: true, finalTotal: true },
        });

        for (const o of pendingOrders) {
          const nextStatus =
            o.finalTotal !== null && o.finalTotal !== undefined
              ? "READY_TO_CHARGE"
              : "TOKEN_CREATED";
          await prisma.order.update({
            where: { id: o.id },
            data: { paymentStatus: nextStatus },
          });
          promotedCount++;
        }
      }

      console.log(
        `WEBHOOK OK (registration): customer=${param1} tokenSaved=${!!token} tokenSource=${tokenSource || "none"} last4=${last4 || "none"} tokef=${cardExpiry || "none"} cardUpdate=${isCardUpdate} promotedOrders=${promotedCount}`
      );

      // מייל §19 ללקוח
      if (customer.email && token) {
        const mailResult = await sendTokenSavedEmail({
          to: customer.email,
          customerName: customer.name,
          last4: last4 || customer.cardLast4 || "",
          isCardUpdate,
        });
        if (!mailResult.ok) {
          console.error("sendTokenSavedEmail failed:", mailResult.error);
        }
      }

      return NextResponse.json({
        ok: true,
        type: "registration",
        tokenSaved: !!token,
        tokefSaved: !!cardExpiry,
        cardUpdate: isCardUpdate,
        promotedOrders: promotedCount,
      });
    }

    // === תשלום הזמנה ===
    // ענף זה נשאר תואם למה שהיה - חיוב מיידי מלא (לא flow §19).
    // ל-flow החדש של §19, החיוב מתבצע ב-charge-route.ts, לא כאן.
    if (param2 === "order") {
      const order = await prisma.order.findUnique({
        where: { id: param1 },
        include: { customer: true },
      });
      if (!order) {
        console.log("WEBHOOK ERROR: order not found for id", param1);
        return NextResponse.json({ error: "order not found" }, { status: 404 });
      }
      if (order.paymentStatus === "PAID") {
        console.log("WEBHOOK: order already paid", param1);
        return NextResponse.json({ ok: true, type: "order", note: "already paid" });
      }

      const customer = order.customer;

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
        ...(token && !customer.paymentToken
          ? [
              prisma.customer.update({
                where: { id: customer.id },
                data: {
                  paymentToken: token,
                  cardLast4: last4 || customer.cardLast4,
                  cardExpiry: cardExpiry || customer.cardExpiry,
                },
              }),
            ]
          : []),
      ]);

      console.log(`WEBHOOK OK (order): order=${param1} amount=${amount}`);

      // מייל אישור תשלום ללקוח (לא חוסם)
      if (customer.email) {
        const fullOrder = await prisma.order.findUnique({
          where: { id: param1 },
          include: { items: true },
        });
        if (fullOrder) {
          await sendPaymentConfirmedEmail(
            fullOrder as any,
            customer.email,
            PAYMENT_METHOD_LABELS["ONLINE"]
          ).catch(() => null);
        }
      }

      return NextResponse.json({ ok: true, type: "order" });
    }

    console.log("WEBHOOK ERROR: unknown param2:", param2);
    return NextResponse.json({ error: "unknown param2", param2 }, { status: 400 });
  } catch (e) {
    console.error("nedarim webhook exception:", e);
    return NextResponse.json({ error: "server error" }, { status: 500 });
  }
}

// נדרים עשויים לשלוח GET לבדיקת זמינות
export async function GET() {
  return NextResponse.json({ ok: true, endpoint: "nedarim webhook alive" });
}
