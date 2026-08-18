"use client";

// §70: הוספת מוצר במסך ההזמנה של הנציג.
//
// עוטף דק סביב AddOrderItem: הדף עצמו הוא server component ולא יכול
// להחזיק onAdd, ולכן החיבור ל-API והרענון יושבים כאן.

import { AddOrderItem, type AddableProduct } from "@/components/AddOrderItem";

export function AgentAddItemPanel({
  orderId,
  products,
  singleSurcharge,
}: {
  orderId: string;
  products: AddableProduct[];
  singleSurcharge: number;
}) {
  return (
    <div className="bg-white rounded-2xl border border-zinc-200 shadow-sm p-4">
      <AddOrderItem
        products={products}
        singleSurcharge={singleSurcharge}
        onAdd={async (item) => {
          const res = await fetch("/api/agent/order-item", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              orderId,
              productId: item.productId,
              quantity: item.quantity,
              isSingle: item.isSingle,
              // unitPrice לא נשלח - השרת גוזר אותו מהמחירון, כדי
              // שנציג לא יוכל לקבוע מחיר בעצמו.
            }),
          });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error || "שגיאה בהוספה");
          // רענון מלא: הפריט והסכום המעודכן מגיעים מהשרת ולא
          // מורכבים מחדש בקליינט.
          window.location.reload();
        }}
      />
    </div>
  );
}
