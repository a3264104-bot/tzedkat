"use client";

// §70: הוספת מוצר במסך ההזמנה של הנציג.
//
// עוטף דק סביב AddOrderItem: הדף עצמו הוא server component ולא יכול
// להחזיק onAdd, ולכן החיבור ל-API והרענון יושבים כאן.

import { AddOrderItem, type AddableProduct } from "@/components/AddOrderItem";
import { useRouter } from "next/navigation";

export function AgentAddItemPanel({
  orderId,
  products,
  singleSurcharge,
}: {
  orderId: string;
  products: AddableProduct[];
  singleSurcharge: number;
}) {
  const router = useRouter();
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
              //
              // §334: 🐛 **agentSetPrice נזרק בדרך.**
              //
              // AddOrderItem מציג שדה מחיר במוצר מועדף (§119)
              // ושולח את הערך ב-onAdd. הפאנל הזה קיבל אותו
              // ופשוט לא העביר לשרת - כלומר הנציג הקליד מחיר,
              // ראה אישור, והלקוח חויב לפי המחירון.
              //
              // ⚠️ והשרת מאמת: רק מוצר מועדף, ורק העלאה (§119).
              // אין כאן פתח לנציג לקבוע מחיר שרירותי.
              agentSetPrice: item.agentSetPrice ?? null,
            }),
          });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error || "שגיאה בהוספה");
          // §334: router.refresh ולא reload.
          //
          // ⚠️ reload() טוען את כל העמוד מחדש - כולל התמונות
          // וה-JS. refresh() מושך רק את הנתונים, והנציג לא
          // מאבד את מקומו בגלילה.
          router.refresh();
        }}
      />
    </div>
  );
}
