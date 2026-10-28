"use client";

// 🏷️ המחירים השמורים של הנציג המחובר (/agent/my-prices), למילוי מראש
// בשדה "מחיר מותאם" כשבוחרים מוצר נסתר.

import { useEffect, useState } from "react";

export function useAgentSavedPrices(): Record<string, number> {
  const [prices, setPrices] = useState<Record<string, number>>({});
  useEffect(() => {
    let alive = true;
    fetch("/api/agent/my-prices", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!alive || !d?.products) return;
        const m: Record<string, number> = {};
        for (const p of d.products) if (p.savedPrice != null) m[p.id] = Number(p.savedPrice);
        setPrices(m);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);
  return prices;
}
