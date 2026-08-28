"use client";

// ═══════════════════════════════════════════════════════════════
// §315: ביטול פריט מהזמנה — כפתור משותף
// ═══════════════════════════════════════════════════════════════
// למה רכיב ולא קוד בכל מסך: הפעולה נדרשת בשלושה מקומות (כרטיסי
// הנציג, מסך ההזמנה של הנציג, מסך המנהל), ושלושה עותקים היו
// מתפצלים ביום שמישהו משנה אחד מהם.
//
// ⚠️ ביטול ולא מחיקה: הפריט נשאר לתיעוד ויוצא מהחישוב. אותה
// גישה של ביטול הזמנה (§47) - היסטוריה שנמחקת אי אפשר לשחזר.
//
// ⚠️ והחזרה אפשרית: לקוח שהתחרט לא דורש הקמה מחדש של הפריט.

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function CancelItemButton({
  itemId,
  productName,
  isCancelled,
  locked,
  compact,
}: {
  itemId: string;
  productName: string;
  isCancelled: boolean;
  /** §309: הזמנה נעולה אחרי שליחת המייל */
  locked?: boolean;
  /** תצוגה מוקטנת לרשימות צפופות */
  compact?: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function toggle() {
    // ⚠️ אישור רק בביטול: החזרה היא פעולה הפיכה שלא דורשת
    // עצירה, וכל אישור מיותר מאמן את המשתמש ללחוץ "אישור"
    // בלי לקרוא.
    if (
      !isCancelled &&
      !window.confirm(
        `לבטל את "${productName}" מההזמנה?\n\nהפריט יוצא מהחישוב אך יישאר לתיעוד.`
      )
    )
      return;

    setBusy(true);
    try {
      const res = await fetch(`/api/agent/order-item/${itemId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isCancelled: !isCancelled }),
      });
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        throw new Error(e.error || "הפעולה נכשלה");
      }
      // ⚠️ refresh ולא reload: המשתמש לא מאבד את מקומו במסך.
      router.refresh();
    } catch (e: any) {
      alert(e?.message || "שגיאה");
    } finally {
      setBusy(false);
    }
  }

  if (locked) return null;

  return (
    <button
      onClick={toggle}
      disabled={busy}
      title={isCancelled ? "החזר לחישוב" : "בטל פריט"}
      className={`shrink-0 rounded font-bold disabled:opacity-40 ${
        compact ? "text-[10px] px-1.5 py-0.5" : "text-xs px-2 py-1"
      } ${
        isCancelled
          ? "bg-emerald-100 text-emerald-700 hover:bg-emerald-200"
          : "bg-red-50 text-red-600 hover:bg-red-100"
      }`}
    >
      {busy ? "..." : isCancelled ? "↩ החזר" : "🗑️"}
    </button>
  );
}
