"use client";

// ═══════════════════════════════════════════════════════════════
// §380: בחירת מכירה — פעם אחת, לכל המסכים
// ═══════════════════════════════════════════════════════════════
// הבעיה: כל מסך מנהל (דשבורד, תשלומים, בקרה, סיכום, משקלים,
// זיכויים) מחזיק בורר משלו. המנהל בוחר "ראש השנה" בדשבורד, עובר
// לתשלומים — ומקבל שוב את ברירת המחדל.
//
// ⚠️ localStorage ולא URL: המנהל עובר בין מסכים דרך התפריט, ולא
// דרך קישורים עם פרמטרים. הבחירה חייבת לשרוד את המעבר.
//
// ⚠️ ברירת מחדל = המכירה הפעילה. ומי שבחר אחרת — הבחירה נשארת
// עד שמשנה, גם אחרי סגירת הדפדפן.

import { useEffect, useState, useCallback } from "react";

const KEY = "tzidkat.selectedPricelistId";
export const ALL_SALES = "__all__";

type Pricelist = { id: string; name: string; status: string };

export function useSelectedPricelist(options?: {
  /** מסכים שתומכים ב"כל המכירות" — הדשבורד, הזיכויים */
  allowAll?: boolean;
}) {
  const [lists, setLists] = useState<Pricelist[] | null>(null);
  const [selected, setSelectedState] = useState<string>("");

  // טעינת הרשימה + שחזור הבחירה
  useEffect(() => {
    fetch("/api/admin/pricelists", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : []))
      .then((rows: any[]) => {
        const arr = (Array.isArray(rows) ? rows : []).map((p) => ({
          id: p.id,
          name: p.name,
          status: p.status,
        }));
        setLists(arr);

        // ⚠️ שחזור: מה שנשמר, אם עדיין קיים. אחרת — הפעילה.
        // אחרת — הראשונה. אחרת — כלום.
        const saved =
          typeof window !== "undefined" ? localStorage.getItem(KEY) : null;
        const savedValid =
          saved === ALL_SALES
            ? !!options?.allowAll
            : arr.some((p) => p.id === saved);
        if (saved && savedValid) {
          setSelectedState(saved);
        } else {
          const active = arr.find((p) => p.status === "ACTIVE");
          const fallback = active?.id ?? arr[0]?.id ?? "";
          setSelectedState(fallback);
          if (fallback && typeof window !== "undefined") {
            localStorage.setItem(KEY, fallback);
          }
        }
      })
      .catch(() => setLists([]));
  }, [options?.allowAll]);

  const setSelected = useCallback((id: string) => {
    setSelectedState(id);
    if (typeof window !== "undefined") localStorage.setItem(KEY, id);
  }, []);

  const current = lists?.find((p) => p.id === selected) ?? null;

  return { lists, selected, setSelected, current };
}

// ═══════════════════════════════════════════════════════════════
// הבורר עצמו — רכיב אחד לכל המסכים
// ═══════════════════════════════════════════════════════════════
export function PricelistSelector({
  lists,
  selected,
  onChange,
  allowAll,
  className,
}: {
  lists: Pricelist[] | null;
  selected: string;
  onChange: (id: string) => void;
  allowAll?: boolean;
  className?: string;
}) {
  if (!lists) return null;
  return (
    <select
      value={selected}
      onChange={(e) => onChange(e.target.value)}
      className={
        className ??
        "rounded-lg border-2 border-zinc-300 bg-white px-3 py-1.5 text-sm font-bold text-brand-slatedark"
      }
    >
      {allowAll && <option value={ALL_SALES}>כל המכירות</option>}
      {lists.map((p) => (
        <option key={p.id} value={p.id}>
          {p.name}
          {p.status === "ACTIVE" ? " · פעילה" : p.status === "CLOSED" ? " · סגורה" : ""}
        </option>
      ))}
    </select>
  );
}
