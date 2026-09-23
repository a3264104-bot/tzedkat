"use client";

// §393: 💳 תג מצב החיוב — לנציג, בטבלת המשקלים ובכרטיסים.
//
// 🐛 הבעיה מהשטח: הנציג לא ידע אם האשראי של הלקוח עבר או לא.
// המצב הוצג רק בתוך עמוד ההזמנה הבודדת, ובמסך המכירה — שבו הנציג
// עובד בפועל — לא הופיע כלל. לקוח שהחיוב שלו נכשל נשאר בלי שאף
// אחד בשטח ירדוף אחריו.
//
// ✅ עכשיו כל הזמנה מציגה את מצב החיוב שלה, וכישלון בולט באדום
// עם הסיבה (ב-title) — כדי שהנציג יתקשר ללקוח.
//
// ⚠️ לא מציגים כלום כשאין מה לדווח (טרם חויב) — אחרת כל שורה
// מקבלת תג, והאדום מאבד את הבולטות שלו.

export const CHARGE_FAILED_STATUSES = ["FAILED", "CARD_UPDATE_NEEDED"];

export function isChargeFailed(status: string | null | undefined): boolean {
  return !!status && CHARGE_FAILED_STATUSES.includes(status);
}

export function ChargeStatusBadge({
  paymentStatus,
  lastChargeError,
  finalTotal,
  amountPaid,
  compact = false,
}: {
  paymentStatus: string | null | undefined;
  lastChargeError?: string | null;
  finalTotal?: number | null;
  amountPaid?: number | null;
  compact?: boolean;
}) {
  const base = `font-bold rounded border whitespace-nowrap ${
    compact ? "text-[10px] px-1.5 py-0.5" : "text-[11px] px-2 py-0.5"
  }`;

  switch (paymentStatus) {
    case "PAID":
      return (
        <span className={`${base} text-emerald-700 bg-emerald-50 border-emerald-200`}>
          ✓ שולם
        </span>
      );
    case "PARTIALLY_PAID": {
      const remaining =
        finalTotal != null && amountPaid != null
          ? Math.round((finalTotal - amountPaid) * 100) / 100
          : null;
      return (
        <span className={`${base} text-amber-800 bg-amber-50 border-amber-300`}>
          ◐ חלקי{remaining != null && remaining > 0 ? ` · נותר ₪${remaining}` : ""}
        </span>
      );
    }
    case "CHARGING":
      return (
        <span className={`${base} text-sky-700 bg-sky-50 border-sky-200`}>
          ⏳ בחיוב
        </span>
      );
    case "FAILED":
      return (
        <span
          className={`${base} text-white bg-red-600 border-red-700`}
          title={lastChargeError ? `סיבה: ${lastChargeError}` : "החיוב נכשל"}
        >
          ✗ אשראי לא עבר
        </span>
      );
    case "CARD_UPDATE_NEEDED":
      return (
        <span
          className={`${base} text-white bg-orange-600 border-orange-700`}
          title={lastChargeError ? `סיבה: ${lastChargeError}` : "הכרטיס נדחה — נדרש כרטיס חדש"}
        >
          ✗ כרטיס נדחה
        </span>
      );
    case "DEBT_CARRIED":
      return (
        <span className={`${base} text-zinc-700 bg-zinc-100 border-zinc-300`}>
          הועבר לחוב
        </span>
      );
    default:
      return null;
  }
}
