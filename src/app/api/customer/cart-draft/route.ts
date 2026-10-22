// 🛒 סל שלא נשלח — נשמר תוך כדי בחירה במסך ההזמנה (לקוח בלבד).
// POST { pricelistId, items: [{ productId, isSingle, name, qty, unit }] }
//   → שמירה/עדכון (סל ריק = מחיקה)
//
// משמש לשני דברים:
//   1. תזכורת אחת במייל ("התחלת להזמין ולא שלחת") — /api/cron/cart-reminders
//   2. כשהלקוח חוזר למסך ההזמנה — המוצרים שבחר כבר בסל (order/page.tsx)
// נמחק כשנוצרת הזמנה (POST /api/orders).
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

type WebCartItem = { productId: string; isSingle: boolean; name: string; qty: number; unit: string };

export async function POST(req: Request) {
  const session = await auth();
  const user = session?.user as any;
  // רק לקוח שמזמין לעצמו — לא נציג/מנהל שמזמין עבור לקוח, ולא התחזות
  if (!user?.id || user.role !== "CUSTOMER" || user.impersonatorId) {
    return NextResponse.json({ ok: true, skipped: true });
  }
  const b = await req.json().catch(() => ({}));
  const pricelistId = String(b?.pricelistId || "");
  if (!pricelistId) return NextResponse.json({ error: "missing sale" }, { status: 400 });

  const items: WebCartItem[] = Array.isArray(b?.items)
    ? b.items
        .slice(0, 60)
        .map((i: any) => ({
          productId: String(i?.productId || "").slice(0, 40),
          isSingle: !!i?.isSingle,
          name: String(i?.name || "").slice(0, 80),
          qty: Number(i?.qty) || 0,
          unit: String(i?.unit || "").slice(0, 20),
        }))
        .filter((i: WebCartItem) => i.productId && i.name && i.qty > 0)
    : [];

  const customerId = String(user.id);
  if (items.length === 0) {
    await prisma.webCart.deleteMany({ where: { customerId, pricelistId } });
    return NextResponse.json({ ok: true, cleared: true });
  }

  await prisma.webCart.upsert({
    where: { customerId_pricelistId: { customerId, pricelistId } },
    create: { customerId, pricelistId, itemCount: items.length, itemsJson: JSON.stringify(items) },
    // ⚠️ עדכון הסל לא מאפס reminderSentAt — תזכורת אחת למכירה, לא אחת לכל שינוי
    update: { itemCount: items.length, itemsJson: JSON.stringify(items) },
  });
  return NextResponse.json({ ok: true });
}
