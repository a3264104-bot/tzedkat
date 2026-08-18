// ═══════════════════════════════════════════════════════════════
// §113: מחזור החיים של המכירה
// ═══════════════════════════════════════════════════════════════
// הפער שנסגר: הסטטוס במסד הוא DRAFT / ACTIVE / CLOSED / DONE, וזה
// מכסה **רק את שלב ההזמנות**. אחרי הסגירה יש עוד ארבעה שלבים
// אמיתיים - הזמנה מהספק, קליטת סחורה, חלוקה, וחיוב - ולמנהל לא
// היה שום מסך שאומר איפה המכירה עומדת.
//
// ⚠️ החלטת תכנון: השלב **מחושב מהנתונים** ולא נשמר כשדה.
//
// שדה שמור היה נכון רק כל עוד מישהו זוכר לעדכן אותו, ואחרי חודש
// היה מציג "בחלוקה" למכירה שהסתיימה מזמן. חישוב מהנתונים תמיד
// משקף את המציאות: אם יש משקלים חסרים, המכירה בחלוקה - נקודה.

export type SaleStageKey =
  | "draft"
  | "ordering"
  | "closed_pending_supplier"
  | "awaiting_goods"
  | "distributing"
  | "charging"
  | "done";

export type SaleStage = {
  key: SaleStageKey;
  label: string;
  /** מה המנהל צריך לעשות עכשיו */
  action: string | null;
  /** מיקום בציר (1-6), לתצוגת התקדמות */
  index: number;
};

const STAGE_ORDER: SaleStageKey[] = [
  "draft",
  "ordering",
  "closed_pending_supplier",
  "awaiting_goods",
  "distributing",
  "charging",
  "done",
];

export type SaleFacts = {
  status: string;
  closeDate: Date | null;
  orderCount: number;
  /** כמה מוצרים תוכננו להזמנה מהספק */
  supplierPlanCount: number;
  /** כמה מוצרים נקלטו בפועל (יש להם רשומת קליטה עם משקל) */
  deliveredProductCount: number;
  /** פריטים שטרם נשקלו */
  missingWeights: number;
  /** הזמנות שטרם חויבו/שולמו */
  unpaidOrders: number;
};

export function computeSaleStage(f: SaleFacts): SaleStage {
  const key = resolveKey(f);
  const index = STAGE_ORDER.indexOf(key);
  return { key, index, ...STAGE_LABELS[key] };
}

function resolveKey(f: SaleFacts): SaleStageKey {
  if (f.status === "DRAFT") return "draft";

  // מקבל הזמנות: פעיל, ומועד הסגירה טרם חלף.
  //
  // ⚠️ closeDate נבדק ולא רק status: המערכת חוסמת הזמנות אוטומטית
  // לפי התאריך גם כשהסטטוס נשאר ACTIVE, ולכן מכירה שהתאריך שלה
  // עבר **אינה** מקבלת הזמנות בפועל - גם אם איש לא לחץ "סגור".
  const closedByDate = !!f.closeDate && new Date() > f.closeDate;
  if (f.status === "ACTIVE" && !closedByDate) return "ordering";

  // מכאן: ההזמנות סגורות. השלב נגזר ממה שכבר בוצע.
  if (f.supplierPlanCount === 0) return "closed_pending_supplier";
  if (f.deliveredProductCount === 0) return "awaiting_goods";
  if (f.missingWeights > 0) return "distributing";
  if (f.unpaidOrders > 0) return "charging";
  return "done";
}

const STAGE_LABELS: Record<SaleStageKey, { label: string; action: string | null }> = {
  draft: {
    label: "טיוטה",
    action: "יש להוסיף מוצרים ונקודות, ואז להפעיל את המכירה",
  },
  ordering: {
    label: "מקבלת הזמנות",
    action: "הלקוחות מזמינים. אין פעולה נדרשת עד מועד הסגירה",
  },
  closed_pending_supplier: {
    label: "סגורה — לתכנון הזמנה מהספק",
    action: "יש לתכנן כמה להזמין מהספק לפי סך ההזמנות",
  },
  awaiting_goods: {
    label: "ממתינה לסחורה",
    action: "כשהסחורה תגיע — יש לקלוט אותה ולרשום כמות, משקל ועלות",
  },
  distributing: {
    label: "בחלוקה",
    action: "הנציגים שוקלים ומעדכנים משקלים בנקודות",
  },
  charging: {
    label: "לחיוב",
    action: "כל המשקלים הוזנו. יש להשלים את חיוב הכרטיסים",
  },
  done: {
    label: "הושלמה",
    action: null,
  },
};

// ═══════════════════════════════════════════════════════════════
// התאמת משקלים: מה שנקנה מול מה שחולק
// ═══════════════════════════════════════════════════════════════
// זו הבדיקה שמגלה היכן כסף נעלם. כל שלב בנפרד נראה תקין, והפער
// מתגלה רק בהשוואה: קנית 170 ק"ג, חילקת 163 - איפה השבעה?
//
// סיבות אפשריות לפער, וכולן לגיטימיות בנפרד:
//   • פחת טבעי (נוזלים, ניקוי)
//   • משקל חסר שלא הוזן (נתפס ממילא ב-§81)
//   • סחורה שלא הגיעה
//   • טעות בשקילה
//
// המערכת לא מנחשת מה הסיבה - היא רק מציפה את המספר, כי בלי
// שרואים אותו אי אפשר לשאול את השאלה בכלל.

export type ReconciliationRow = {
  productId: string;
  productName: string;
  cartonsOrdered: number | null;
  cartonsReceived: number;
  weightReceived: number;
  /** סך המשקל שנשקל ללקוחות במוצר הזה */
  weightDistributed: number;
  /** חיובי = נשאר עודף. שלילי = חולק יותר ממה שנקלט. */
  diff: number;
  diffPercent: number | null;
  costPerKg: number | null;
  /** עלות בפועל מהספק */
  totalCost: number | null;
  /** מה שנגבה מהלקוחות על המוצר הזה */
  revenue: number;
};

export function buildReconciliation(rows: ReconciliationRow[]) {
  const totals = rows.reduce(
    (acc, r) => {
      acc.weightReceived += r.weightReceived;
      acc.weightDistributed += r.weightDistributed;
      acc.cost += r.totalCost ?? 0;
      acc.revenue += r.revenue;
      // רק שורות שיש להן עלות נספרות בכיסוי - אחרת המרווח מטעה
      if (r.totalCost != null) acc.costedRows++;
      return acc;
    },
    { weightReceived: 0, weightDistributed: 0, cost: 0, revenue: 0, costedRows: 0 }
  );

  const diff = totals.weightReceived - totals.weightDistributed;

  return {
    ...totals,
    diff,
    diffPercent:
      totals.weightReceived > 0 ? (diff / totals.weightReceived) * 100 : null,
    margin: totals.revenue - totals.cost,
    // ⚠️ המרווח אמין רק אם הוזנה עלות לכל המוצרים. אחרת הוא נראה
    // גבוה מדי, והמנהל עלול להסיק מסקנה עסקית שגויה.
    marginReliable: totals.costedRows === rows.length && rows.length > 0,
  };
}

/**
 * סיווג חומרת הפער, להצגה ויזואלית.
 *
 * הספים נבחרו לפי אופי המוצר: בשר ועוף מאבדים נוזלים בטבעיות,
 * ופער של אחוז-שניים אינו חריג. מעל 5% זה כבר לא פחת - זה סימן
 * שמשהו לא נספר.
 */
export function diffSeverity(diffPercent: number | null): "ok" | "warn" | "bad" {
  if (diffPercent === null) return "ok";
  const abs = Math.abs(diffPercent);
  if (abs <= 2) return "ok";
  if (abs <= 5) return "warn";
  return "bad";
}
