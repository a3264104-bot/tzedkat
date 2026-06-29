import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { effectiveUnitPrice, lineEstimate } from "@/lib/pricing";

const schema = z.object({
  pricelistId: z.string(),
  pointId: z.string(),
  customerName: z.string().min(1),
  phone: z.string().min(1),
  phone2: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  items: z
    .array(
      z.object({
        productId: z.string(),
        isSingle: z.boolean(),
        quantity: z.number().positive(),
      })
    )
    .min(1),
});

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const data = schema.parse(body);

    const pricelist = await prisma.pricelist.findUnique({
      where: { id: data.pricelistId },
      include: {
        products: { include: { product: true } },
        points: { include: { point: true } },
      },
    });

    // המכירה חייבת להתקיים ולהיות פעילה
    if (!pricelist || pricelist.status !== "ACTIVE") {
      return NextResponse.json({ error: "המכירה אינה פעילה" }, { status: 400 });
    }

    // אם הוגדרה שעת סגירה ועברה — אי אפשר להזמין
    if (pricelist.closeDate && new Date() > new Date(pricelist.closeDate)) {
      return NextResponse.json(
        { error: "מועד ההרשמה למכירה זו הסתיים" },
        { status: 400 }
      );
    }

    // אם הוגדרה שעת פתיחה ועדיין לא הגיעה — אי אפשר להזמין
    if (pricelist.openDate && new Date() < new Date(pricelist.openDate)) {
      return NextResponse.json(
        { error: "ההרשמה למכירה זו טרם נפתחה" },
        { status: 400 }
      );
    }

    // נקודת החלוקה חייבת להשתתף במכירה הזו
    const plPoint = pricelist.points.find((x) => x.pointId === data.pointId);
    if (!plPoint) {
      return NextResponse.json(
        { error: "נקודת החלוקה אינה משתתפת במכירה זו" },
        { status: 400 }
      );
    }

    const surcharge = Number(pricelist.singleSurcharge);

    // build server-side priced items
    const itemsData = [];
    let estimatedTotal = 0;
    for (const item of data.items) {
      const pp = pricelist.products.find((x) => x.productId === item.productId);
      // המוצר חייב להשתתף במכירה וגם להיות פעיל
      if (!pp) return NextResponse.json({ error: "מוצר לא נמצא במחירון" }, { status: 400 });
      if (!pp.product.isActive)
        return NextResponse.json(
          { error: `המוצר "${pp.product.name}" אינו זמין להזמנה` },
          { status: 400 }
        );
      const base = Number(pp.price ?? pp.product.cartonPrice);
      const isSingle = item.isSingle && pp.product.allowSingles;
      const unitPrice = effectiveUnitPrice(base, isSingle, surcharge);
      const est = lineEstimate(unitPrice, item.quantity);
      estimatedTotal += est;
      itemsData.push({
        productId: pp.product.id,
        productName: pp.product.name,
        unit: pp.product.unit,
        isSingle,
        quantity: item.quantity,
        unitPrice,
        estimatedPrice: est,
      });
    }
    estimatedTotal = Math.round(estimatedTotal * 100) / 100;

    const order = await prisma.order.create({
      data: {
        pricelistId: data.pricelistId,
        pointId: data.pointId,
        // snapshot של מה שהלקוח ראה
        pointNameSnapshot: plPoint.point.name,
        deliveryDateSnapshot: pricelist.deliveryDateText ?? null,
        pricelistNameSnapshot: pricelist.name,
        customerName: data.customerName,
        phone: data.phone,
        phone2: data.phone2 || null,
        notes: data.notes || null,
        estimatedTotal,
        items: { create: itemsData },
      },
    });

    return NextResponse.json({ ok: true, orderNumber: order.orderNumber, id: order.id });
  } catch (e: any) {
    if (e?.issues) return NextResponse.json({ error: "נתונים שגויים" }, { status: 400 });
    console.error(e);
    return NextResponse.json({ error: "שגיאת שרת" }, { status: 500 });
  }
}

// list orders (admin only)
export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "לא מורשה" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const pointId = searchParams.get("pointId");
  const status = searchParams.get("status");
  const pricelistId = searchParams.get("pricelistId");

  const orders = await prisma.order.findMany({
    where: {
      ...(pointId ? { pointId } : {}),
      ...(status ? { status } : {}),
      ...(pricelistId ? { pricelistId } : {}),
    },
    include: { point: true, items: true },
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json(orders);
}
