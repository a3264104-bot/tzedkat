"use client";

// כפתור חיוב לנציג - קורא לאותו endpoint מאובטח כמו המנהל (/api/admin/charge)
// ה-endpoint בעצמו בודק הרשאת AGENT (agentCanCharge + נקודה/יוצר)

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function AgentChargeButton({
  orderId,
  orderNumber,
  customerName,
  amount,
  cardLast4,
  enabled,
  disabledReason,
}: {
  orderId: string;
  orderNumber: number;
  customerName: string;
  amount: number;
  cardLast4: string | null;
  enabled: boolean;
  disabledReason: string | null;
}) {
  const router = useRouter();
  const [charging, setCharging] = useState(false);
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null);

  async function handleCharge() {
    const confirmMsg =
      `לחייב את הזמנה #${orderNumber}?\n\n` +
      `לקוח: ${customerName}\n` +
      `סכום: ₪${amount.toFixed(2)}\n` +
      `כרטיס: ${cardLast4 ? "****" + cardLast4 : "לא ידוע"}`;
    if (!confirm(confirmMsg)) return;

    setCharging(true);
    setMessage(null);
    try {
      const res = await fetch("/api/admin/charge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId }),
      });
      const data = await res.json();
      if (res.ok && data.ok) {
        setMessage({ text: `החיוב הצליח! ₪${amount.toFixed(2)}`, ok: true });
        setTimeout(() => router.refresh(), 1200);
      } else {
        setMessage({ text: data.error || "החיוב נכשל", ok: false });
      }
    } catch (e: any) {
      setMessage({ text: e.message || "שגיאת רשת", ok: false });
    } finally {
      setCharging(false);
    }
  }

  return (
    <div className="mt-2">
      <button
        onClick={handleCharge}
        disabled={!enabled || charging}
        className="w-full py-2.5 rounded-xl bg-emerald-600 text-white font-bold hover:bg-emerald-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
      >
        {charging ? "מחייב..." : "💳 חייב עכשיו"}
      </button>
      {!enabled && disabledReason && (
        <p className="text-[11px] text-zinc-500 mt-1 text-center">{disabledReason}</p>
      )}
      {message && (
        <div
          className={`mt-2 rounded-lg p-2 text-xs text-center font-medium ${
            message.ok
              ? "bg-emerald-50 text-emerald-800 border border-emerald-200"
              : "bg-red-50 text-red-800 border border-red-200"
          }`}
        >
          {message.text}
        </div>
      )}
    </div>
  );
}
