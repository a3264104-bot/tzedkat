"use client";

// §396: 🔁 "סגור שבוע" — לנציג ולמנהל.
//
// השבוע מתחלף לבד כשכל ההזמנות נמסרו. הכפתור הזה למקרה שלקוח לא
// הגיע לאסוף: ההזמנות שלא נמסרו נשארות בשבוע הישן (לשקילה, חיוב
// או ביטול), והשבוע הבא נפתח מיד.

import { useState } from "react";

export function CloseWeekButton({
  pricelistId,
  weekName,
  undelivered,
  className,
}: {
  pricelistId: string;
  weekName: string;
  undelivered: number;
  className?: string;
}) {
  const [busy, setBusy] = useState(false);

  async function close() {
    if (
      !window.confirm(
        `לסגור את "${weekName}"?\n\n` +
          (undelivered > 0
            ? `${undelivered} הזמנות טרם סומנו כנמסרו. הן יישארו בשבוע הישן — אפשר להמשיך לשקול, לחייב או לבטל אותן שם.\n\n`
            : "") +
          "השבוע הבא ייפתח מיד."
      )
    )
      return;
    setBusy(true);
    try {
      const res = await fetch("/api/agent/weekly-close", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pricelistId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "הסגירה נכשלה");
      window.location.reload();
    } catch (e: any) {
      alert(e?.message || "שגיאה");
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      onClick={close}
      disabled={busy}
      className={
        className ??
        "text-xs font-bold bg-orange-600 hover:bg-orange-700 text-white rounded-lg px-3 py-1.5 disabled:opacity-50"
      }
    >
      {busy ? "סוגר…" : "סגור שבוע ופתח את הבא"}
    </button>
  );
}
