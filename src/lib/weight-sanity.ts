// ⚖️ בדיקת סבירות של משקל שהוזן — "האם אתה בטוח?"
//
// התרחישים מהשטח:
//   • 3 נקניקיות, ונקלד 30 (אפס מיותר)
//   • קרטון של ~22 ק"ג, ונקלד 2.350 במקום 23.50 (נקודה במקום הלא נכון)
//
// ⚠️ סטייה רגילה (קילו–שניים) לא שואלת: קרטונים באמת שוקלים פחות או
// יותר מהממוצע. שואלים רק מ-4 (ק"ג, או יחידות במוצר יחידה) ומעלה.
// ⚠️ 0 לא נבדק — "לא קיבל" הוא ערך מכוון.

export const WEIGHT_WARN_DIFF = 4;

const r = (n: number) => Math.round(n * 1000) / 1000;

/**
 * הערך הצפוי למשבצת אחת.
 *   • מוצר יחידה → הכמות שהוזמנה (ביחידות)
 *   • בודדים לפי ק"ג → הכמות שהוזמנה (בק"ג)
 *   • קרטון → ממוצע לקרטון; משבצת אחת לכמה קרטונים → ממוצע × כמות
 */
export function expectedForBox(opts: {
  noWeighing: boolean;
  isSingle: boolean;
  orderedQty: number;
  avgPerCarton?: number | null;
  boxes: number;
}): number | null {
  const q = Number(opts.orderedQty) || 0;
  if (opts.noWeighing || opts.isSingle) return q > 0 ? q : null;
  const avg = Number(opts.avgPerCarton) || 0;
  if (avg <= 0) return null;
  return opts.boxes > 1 ? avg : avg * Math.max(q, 1);
}

/** הודעת אזהרה, או null כשהערך סביר */
export function weightWarning(
  entered: number,
  expected: number | null,
  opts: { units: boolean; productName: string; box?: number }
): string | null {
  if (expected == null || !(expected > 0)) return null;
  if (!Number.isFinite(entered) || entered <= 0) return null;
  if (Math.abs(entered - expected) < WEIGHT_WARN_DIFF) return null;
  const u = opts.units ? "יח׳" : 'ק"ג';
  const where = opts.box ? ` (קרטון ${opts.box})` : "";
  const exp = opts.units ? `הוזמנו ${r(expected)} ${u}` : `המשקל הצפוי בערך ${r(expected)} ${u}`;
  return `⚠️ ${opts.productName}${where}\n\nהזנת ${r(entered)} ${u}, אבל ${exp}.\n\nהאם אתה בטוח?`;
}
