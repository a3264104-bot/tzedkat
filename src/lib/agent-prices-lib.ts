// ═══════════════════════════════════════════════════════════════
// מחיר שמור לנציג במוצר נסתר (מועדף / לא פעיל)
// ═══════════════════════════════════════════════════════════════
// הנציג קובע פעם אחת "אני מוכר ראש ב-45", וזה ממולא לבד בכל פעם
// שהוא מוסיף את המוצר ללקוח — בהזמנה חדשה, בהוספה להזמנה קיימת
// ובתוספת. לכל נציג המחיר שלו; נציג אחר לא רואה ולא מושפע.
//
// ⚠️ המחיר השמור הוא **ברירת מחדל** בלבד: מחיר שהנציג הקליד בהזמנה
// גובר עליו. והוא עובר את אותה בדיקה של §119 — לא מתחת למחירון.
// אם המחירון עלה מעל המחיר השמור, נופלים למחירון (המחיר השמור לא
// חוסם הזמנה).

import { prisma } from "@/lib/prisma";
import { validateAgentPrice } from "@/lib/commission-lib";

/** מוצר "נסתר" — כזה שהנציג רשאי לתמחר בעצמו (§119/§170) */
export function isHiddenProduct(p: { isFavorite?: boolean | null; isActive?: boolean | null }) {
  return !!p.isFavorite || p.isActive === false;
}

export async function loadAgentPrices(
  agentId: string | null | undefined,
  productIds?: string[]
): Promise<Map<string, number>> {
  const m = new Map<string, number>();
  if (!agentId) return m;
  const rows = await prisma.agentProductPrice.findMany({
    where: { agentId, ...(productIds ? { productId: { in: productIds } } : {}) },
    select: { productId: true, price: true },
  });
  for (const r of rows) m.set(r.productId, Number(r.price));
  return m;
}

/** המחיר השמור, אם הוא תקף מול מחיר המחירון הנוכחי. אחרת null. */
export function usableSavedPrice(saved: number | undefined, listPrice: number): number | null {
  if (saved == null) return null;
  return validateAgentPrice(saved, listPrice).ok ? saved : null;
}
