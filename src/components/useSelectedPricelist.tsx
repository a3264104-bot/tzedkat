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
// §399: רשימת המכירות — נשמרת לזמן הגלישה (sessionStorage)
const LIST_CACHE_KEY = "tzidkat.pricelists.slim.v1";
export const ALL_SALES = "__all__";
// §396: 🔁 צבירה לפי סוג — "כל הרגילות" / "כל השבועיות"
export const ALL_REGULAR = "__regular__";
export const ALL_WEEKLY = "__weekly__";

type Pricelist = {
  id: string;
  name: string;
  status: string;
  /** §396: שבוע מתוך סדרה שבועית */
  weekly?: boolean;
};

/** §396: האם הבחירה היא צבירה (כל / רגילות / שבועיות) ולא מכירה אחת */
export function isAggregateSelection(sel: string): boolean {
  return sel === ALL_SALES || sel === ALL_REGULAR || sel === ALL_WEEKLY;
}

/**
 * §396: הבחירה → פרמטרים לשאילתה.
 *
 * ⚠️ מקום אחד: כל מסך ששולח pricelistId משתמש בזה, כדי ש"כל
 * השבועיות" יגיע לשרת כ-saleKind=WEEKLY ולא כמזהה שאינו קיים.
 */
export function applySaleSelection(q: URLSearchParams, sel: string): void {
  if (!sel || sel === ALL_SALES) return;
  if (sel === ALL_REGULAR) q.set("saleKind", "REGULAR");
  else if (sel === ALL_WEEKLY) q.set("saleKind", "WEEKLY");
  else q.set("pricelistId", sel);
}

/** §396: תיאור הבחירה לכותרת המסך */
export function saleSelectionLabel(
  sel: string,
  lists: Pricelist[] | null
): string {
  if (sel === ALL_SALES) return "כל המכירות";
  if (sel === ALL_REGULAR) return "כל המכירות הרגילות";
  if (sel === ALL_WEEKLY) return "כל המכירות השבועיות 🔁";
  return lists?.find((p) => p.id === sel)?.name ?? "";
}

export function useSelectedPricelist(options?: {
  /** מסכים שתומכים ב"כל המכירות" — הדשבורד, הזיכויים */
  allowAll?: boolean;
}) {
  const [lists, setLists] = useState<Pricelist[] | null>(null);
  const [selected, setSelectedState] = useState<string>("");

  // טעינת הרשימה + שחזור הבחירה
  //
  // §399: ⚡ **בלי להמתין לרשימה בכל מעבר מסך.**
  //
  // כל מסך (דשבורד, הזמנות, תשלומים, זיכויים) טען קודם את רשימת
  // המכירות, ורק אחרי שהיא חזרה התחיל לטעון את הנתונים עצמם — שתי
  // המתנות ברצף בכל כניסה. עכשיו הרשימה נשמרת לזמן הגלישה: המסך
  // מתחיל מיד עם מה שנשמר, והרשימה מתרעננת ברקע.
  //
  // ⚠️ slim=1: הבורר צריך 4 שדות. הרשימה המלאה (כל העמודות + ספירות
  // הזמנות/מוצרים/נקודות לכל מכירה) נשארת למסך המכירות עצמו.
  useEffect(() => {
    let cancelled = false;

    const resolve = (arr: Pricelist[], keepCurrent: boolean) => {
      setLists(arr);
      // ⚠️ שחזור: מה שנשמר, אם עדיין קיים. אחרת — הפעילה.
      // אחרת — הראשונה. אחרת — כלום.
      const saved =
        typeof window !== "undefined" ? localStorage.getItem(KEY) : null;
      const savedValid =
        saved && isAggregateSelection(saved)
          ? !!options?.allowAll
          : arr.some((p) => p.id === saved);
      if (saved && savedValid) {
        // ברענון ברקע — לא נוגעים בבחירה שכבר מוצגת (אחרת המסך נטען פעמיים)
        if (!keepCurrent) setSelectedState(saved);
        else setSelectedState((cur) => cur || saved);
        return;
      }
      // §396: ברירת המחדל — המכירה הרגילה הפעילה, לא שבוע
      const active =
        arr.find((p) => p.status === "ACTIVE" && !p.weekly) ??
        arr.find((p) => p.status === "ACTIVE");
      const fallback = active?.id ?? arr[0]?.id ?? "";
      setSelectedState(fallback);
      if (fallback && typeof window !== "undefined") {
        localStorage.setItem(KEY, fallback);
      }
    };

    // 1) מה שנשמר בגלישה הזו — מיד
    let hadCache = false;
    try {
      const raw = sessionStorage.getItem(LIST_CACHE_KEY);
      const cached = raw ? (JSON.parse(raw) as Pricelist[]) : null;
      if (Array.isArray(cached) && cached.length > 0) {
        hadCache = true;
        resolve(cached, false);
      }
    } catch {
      // אין אחסון / נתון פגום — ממשיכים לרשת
    }

    // 2) רענון מהשרת (ברקע אם היה מטמון)
    fetch("/api/admin/pricelists?slim=1", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((rows: any[] | null) => {
        if (cancelled) return;
        if (!Array.isArray(rows)) {
          if (!hadCache) setLists([]);
          return;
        }
        const arr = rows.map((p) => ({
          id: p.id,
          name: p.name,
          status: p.status,
          weekly: !!p.weeklySeriesId,
        }));
        try {
          sessionStorage.setItem(LIST_CACHE_KEY, JSON.stringify(arr));
        } catch {
          // לא קריטי
        }
        resolve(arr, hadCache);
      })
      .catch(() => {
        if (!cancelled && !hadCache) setLists([]);
      });

    return () => {
      cancelled = true;
    };
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
      {allowAll && (
        <>
          <option value={ALL_SALES}>כל המכירות</option>
          {/* §396: צבירה לפי סוג */}
          <option value={ALL_REGULAR}>כל המכירות הרגילות</option>
          {lists.some((p) => p.weekly) && (
            <option value={ALL_WEEKLY}>🔁 כל המכירות השבועיות</option>
          )}
        </>
      )}
      {/* §396: 🔁 קבוצות נפרדות — כדי שלא יתבלבלו רגילות ושבועיות */}
      <optgroup label="מכירות רגילות">
        {lists
          .filter((p) => !p.weekly)
          .map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
              {p.status === "ACTIVE" ? " · פעילה" : p.status === "CLOSED" ? " · סגורה" : ""}
            </option>
          ))}
      </optgroup>
      {lists.some((p) => p.weekly) && (
        <optgroup label="🔁 מכירות שבועיות">
          {lists
            .filter((p) => p.weekly)
            .map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
                {p.status === "ACTIVE" ? " · פעילה" : p.status === "CLOSED" ? " · סגורה" : ""}
              </option>
            ))}
        </optgroup>
      )}
    </select>
  );
}
