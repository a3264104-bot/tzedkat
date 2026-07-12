"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

// באנר התראה קטן שמוצג במעלה מסך הניהול (או בדשבורד) כשיש הזמנות שדורשות שקילה.
// - נסגר אוטומטית כשאין מה להראות
// - self-fetching (רץ אחת בכל render של דף)
// - קליק על הבאנר מעביר למסך המלא

type PendingWeightsData = {
  ordersCount: number;
  totalMissingItems: number;
};

export function PendingWeightsAlert() {
  const [data, setData] = useState<PendingWeightsData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/admin/pending-weights", { cache: "no-store" });
        if (!res.ok) return;
        const json = await res.json();
        if (!cancelled) {
          setData({
            ordersCount: json.ordersCount || 0,
            totalMissingItems: json.totalMissingItems || 0,
          });
        }
      } catch {
        // אל תפיל את הדף אם ה-endpoint נכשל
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading || !data || data.totalMissingItems === 0) return null;

  return (
    <Link
      href="/admin/pending-weights"
      className="block bg-amber-50 border border-amber-300 text-amber-900 rounded-xl px-4 py-3 hover:bg-amber-100 transition"
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="text-2xl" aria-hidden="true">
            ⚖️
          </span>
          <div>
            <div className="font-bold">
              חסרים משקלים ל-{data.totalMissingItems} מוצרים
            </div>
            <div className="text-sm text-amber-800">
              {data.ordersCount === 1
                ? "בהזמנה 1"
                : `ב-${data.ordersCount} הזמנות`}{" "}
              • לחץ להצגת הרשימה →
            </div>
          </div>
        </div>
        <span className="text-amber-700" aria-hidden="true">
          ←
        </span>
      </div>
    </Link>
  );
}
