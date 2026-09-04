"use client";

// §359: כפתור שפותח את מודל הסיכום — למסכים שאינם הטבלה.
//
// ⚠️ עטיפה דקה: הטבלה מנהלת את ה-state בעצמה (הרבה שורות, מודל
// אחד). מסך ההזמנה הוא Server Component ולא יכול — ולכן הכפתור
// מנהל את ה-state שלו.

import { useState } from "react";
import OrderSummaryModal from "./OrderSummaryModal";

export default function SummaryButton({
  orderId,
  orderNumber,
  customerName,
  total,
}: {
  orderId: string;
  orderNumber: number;
  customerName: string;
  total: number;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="w-full flex items-center justify-between gap-2 rounded-xl px-3 py-2.5 border-2 border-zinc-300 bg-white hover:bg-zinc-50 transition-colors"
      >
        <div className="text-right">
          <div className="font-bold text-sm text-zinc-700">📄 סיכום חיוב ללקוח</div>
          <div className="text-[11px] text-zinc-500 mt-0.5">
            שליחה במייל, הורדה כתמונה, או העתקה לוואטסאפ
          </div>
        </div>
        <span className="text-zinc-400 shrink-0">←</span>
      </button>
      {open && (
        <OrderSummaryModal
          orderId={orderId}
          orderNumber={orderNumber}
          customerName={customerName}
          total={total}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
