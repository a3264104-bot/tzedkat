"use client";

// §91: עוטף client לכפתור סימון המזומן במסך ההזמנה של הנציג.
//
// הדף עצמו הוא server component ולא יכול להחזיק onDone, ולכן
// הרענון אחרי הסימון יושב כאן.

import { useRouter } from "next/navigation";
import { CashPaymentButton } from "@/components/CashPaymentButton";

export function AgentCashPanel({
  orderId,
  orderNumber,
  customerName,
  finalTotal,
  paymentStatus,
}: {
  orderId: string;
  orderNumber: number;
  customerName: string;
  finalTotal: number | null;
  paymentStatus: string | null;
}) {
  const router = useRouter();
  return (
    <CashPaymentButton
      orderId={orderId}
      customerName={`${customerName} (#${orderNumber})`}
      finalTotal={finalTotal}
      paymentStatus={paymentStatus}
      // refresh ולא reload: מרענן את הנתונים מהשרת בלי לאבד את
      // מיקום הגלילה, וכך הנציג ממשיך מאיפה שהיה
      onDone={() => router.refresh()}
    />
  );
}
