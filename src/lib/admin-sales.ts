// מכירות לבחירה במסכי המנהל שעובדים "על מכירה אחת" (הזמנה לספק, דפי
// חלוקה): פעילות וסגורות, ומה שהסתיים בחודש האחרון. החדשה קודם.
import { prisma } from "@/lib/prisma";

export type SaleOption = { id: string; name: string; status: string };

export async function adminSaleOptions(): Promise<SaleOption[]> {
  const monthAgo = new Date();
  monthAgo.setDate(monthAgo.getDate() - 30);
  return prisma.pricelist.findMany({
    where: {
      OR: [{ status: { in: ["ACTIVE", "CLOSED"] } }, { status: "DONE", deliveryDate: { gte: monthAgo } }],
    },
    orderBy: [{ deliveryDate: "desc" }, { createdAt: "desc" }],
    select: { id: true, name: true, status: true },
    take: 20,
  });
}

/** המכירה שנבחרה בכתובת, ואם אין — הפעילה הראשונה, ואם אין — הראשונה ברשימה */
export function pickSale(options: SaleOption[], requested?: string | null): SaleOption | null {
  return (
    options.find((o) => o.id === requested) ??
    options.find((o) => o.status === "ACTIVE") ??
    options[0] ??
    null
  );
}
