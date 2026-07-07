import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { Resend } from "resend";

// GET: מוצרים פעילים למודול + האם המודול מופעל בכלל
export async function GET() {
  const settings = await prisma.systemSettings.findUnique({ where: { id: "singleton" } });
  const enabled = settings?.personalOrdersEnabled ?? false;
  if (!enabled) {
    return NextResponse.json({ enabled: false, products: [] });
  }
  const products = await prisma.personalProduct.findMany({
    where: { isActive: true },
    orderBy: { sortOrder: "asc" },
  });
  return NextResponse.json({ enabled: true, products });
}

// POST: שליחת בקשת הזמנה אישית (לקוחות מחוברים בלבד)
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "יש להתחבר כדי לשלוח בקשה" }, { status: 401 });
  }

  const settings = await prisma.systemSettings.findUnique({ where: { id: "singleton" } });
  if (!settings?.personalOrdersEnabled) {
    return NextResponse.json({ error: "שירות ההזמנות האישיות אינו פעיל כרגע" }, { status: 403 });
  }

  const customerId = (session.user as any).id as string;
  const customer = await prisma.customer.findUnique({ where: { id: customerId } });
  if (!customer) {
    return NextResponse.json({ error: "לקוח לא נמצא" }, { status: 404 });
  }

  const b = await req.json();
  const items: { productId: string; quantity: number }[] = Array.isArray(b.items) ? b.items : [];
  const valid = items.filter((it) => it.productId && Number(it.quantity) > 0);
  if (valid.length === 0) {
    return NextResponse.json({ error: "יש לבחור לפחות מוצר אחד עם כמות" }, { status: 400 });
  }

  // שליפת שמות המוצרים ל-snapshot
  const products = await prisma.personalProduct.findMany({
    where: { id: { in: valid.map((v) => v.productId) } },
  });
  const productMap = new Map(products.map((p) => [p.id, p]));

  const itemsData = valid
    .filter((v) => productMap.has(v.productId))
    .map((v) => {
      const product = productMap.get(v.productId)!;
      // אכיפת כמות מקסימלית בשרת (הגנה מפני עקיפת ה-client)
      let quantity = Number(v.quantity);
      if (product.maxQuantity != null && quantity > product.maxQuantity) {
        quantity = product.maxQuantity;
      }
      return {
        productId: v.productId,
        productName: product.name,
        quantity,
      };
    });

  const request = await prisma.personalRequest.create({
    data: {
      customerId,
      customerName: customer.name,
      phone: customer.phone || "",
      notes: b.notes || null,
      items: { create: itemsData },
    },
    include: { items: true },
  });

  // התראה למנהל (לא חוסמת)
  try {
    const adminEmail = settings.adminEmail;
    if (adminEmail && process.env.RESEND_API_KEY) {
      const resend = new Resend(process.env.RESEND_API_KEY);
      const itemsList = itemsData.map((it) => `${it.productName} × ${it.quantity}`).join("<br>");
      await resend.emails.send({
        from: "צדקת רבותינו <orders@tzidkat.com>",
        to: adminEmail,
        subject: `בקשת הזמנה אישית חדשה #${request.requestNumber}`,
        html: `
          <div dir="rtl" lang="he" style="font-family:Arial,sans-serif;padding:16px;">
            <h2>בקשת הזמנה אישית חדשה #${request.requestNumber}</h2>
            <p><b>לקוח:</b> ${customer.name} · ${customer.phone || "ללא טלפון"}</p>
            <p><b>מוצרים:</b><br>${itemsList}</p>
            ${b.notes ? `<p><b>הערות:</b> ${b.notes}</p>` : ""}
            <p style="color:#888;">יש ליצור קשר עם הלקוח לתיאום.</p>
          </div>`,
      });
    }
  } catch (e) {
    console.error("personal request admin notification failed:", e);
  }

  return NextResponse.json({ ok: true, requestNumber: request.requestNumber });
}
