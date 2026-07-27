// §15: משקלים ממתינים - כל הפריטים במכירות פעילות שעדיין ללא משקל
// המסך תומך בשני מצבי תצוגה:
//   - טבלה (ברירת מחדל): הזנה מהירה כמו Excel, Tab/Enter, שמירה אוטומטית
//   - כרטיסים: הצגה מקובצת לפי הזמנה, קישור למסך הזמנה מלא לפריטים מורכבים

import { prisma } from "@/lib/prisma";
import Link from "next/link";
import PendingWeightsClient from "./PendingWeightsClient";

export const dynamic = "force-dynamic";

export default async function AdminPendingWeightsPage() {
  // כל הפריטים ללא משקל במכירה פעילה (או שבחלוקה)
  const items = await prisma.orderItem.findMany({
    where: {
      order: {
        pricelist: { status: "ACTIVE" },
        status: { notIn: ["CANCELLED", "COMPLETED"] },
      },
      actualWeight: null,
      isCancelled: false,
      // רק פריטים שדורשים שקילה - saleType על המוצר עצמו
      product: {
        saleType: "WEIGHT",
      },
    },
    include: {
      order: {
        select: {
          id: true,
          orderNumber: true,
          pricelistId: true,
          pricelist: { select: { id: true, name: true } },
          customerName: true,
          phone: true,
          point: { select: { id: true, name: true } },
        },
      },
      product: {
        select: {
          id: true,
          name: true,
          unit: true,
          saleType: true,
          avgWeightPerUnit: true,
        },
      },
    },
    orderBy: [
      { order: { pricelistId: "asc" } },
      { order: { orderNumber: "asc" } },
    ],
  });

  // אם אין פריטים, מציגים הודעה נקייה
  if (items.length === 0) {
    return (
      <div dir="rtl" className="min-h-screen bg-brand-cream pb-20">
        <header className="bg-brand-yellow border-b-4 border-brand-rust/20">
          <div className="mx-auto max-w-5xl px-4 py-3 flex items-center justify-between">
            <Link href="/admin" className="text-brand-slate font-medium text-sm">
              ← ניהול
            </Link>
            <h1 className="font-extrabold text-brand-slatedark">⚖️ משקלים ממתינים</h1>
          </div>
        </header>
        <main className="mx-auto max-w-5xl px-4 py-8">
          <div className="bg-white rounded-2xl border border-zinc-200 p-8 text-center">
            <div className="text-4xl mb-3">✅</div>
            <p className="text-brand-slatedark font-semibold">אין משקלים ממתינים</p>
            <p className="text-xs text-zinc-500 mt-1">
              כל הפריטים במכירות הפעילות שוקלו. המסך יתעדכן אוטומטית כשיפתחו הזמנות חדשות.
            </p>
          </div>
        </main>
      </div>
    );
  }

  // המרה לפורמט serializable ל-Client Component
  const rows = items.map((it) => ({
    id: it.id,
    orderId: it.order.id,
    orderNumber: it.order.orderNumber,
    pricelistId: it.order.pricelistId || "",
    pricelistName: it.order.pricelist?.name || "—",
    customerName: it.order.customerName,
    phone: it.order.phone,
    pointName: it.order.point?.name || null,
    productName: it.productName || it.product.name,
    unit: it.unit,
    isSingle: it.isSingle,
    quantity: Number(it.quantity),
    unitPrice: Number(it.unitPrice),
    estimatedWeight: it.estimatedWeight ? Number(it.estimatedWeight) : null,
    estimatedPrice: Number(it.estimatedPrice),
    agentEnteredWeight: it.agentEnteredWeight ? Number(it.agentEnteredWeight) : null,
    agentNote: it.agentNote,
  }));

  return <PendingWeightsClient initialRows={rows} />;
}
