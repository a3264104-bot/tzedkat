"use client";

// §81: טבלת המשקלים המרוכזת.
//
// ═══════════════════════════════════════════════════════════════
// למה נבנתה מחדש
// ═══════════════════════════════════════════════════════════════
// הטבלה הקודמת הייתה רשימה שטוחה: שורה לכל *פריט*. לקוח עם 6
// מוצרים תפס 6 שורות, ובנקודה עם 100 לקוחות זה 600 שורות גלילה.
// הנציג עמד בחלוקה עם הטלפון ביד וחיפש איפה הוא נמצא.
//
// כאן: **שורה לכל לקוח**, ועמודה לכל מוצר. הנציג רואה את כל
// ההזמנה של הלקוח בשורה אחת, ממלא, ועובר לבא.
//
// ═══════════════════════════════════════════════════════════════
// מניעת ההפסד — זו המטרה האמיתית
// ═══════════════════════════════════════════════════════════════
// משקל שלא מולא אינו "שדה ריק" אלא כסף שלא נגבה: קרטון שריר
// שנשכח הוא הפסד של כ-1,900 ש"ח בשורה אחת. לכן:
//
//   • תא ריק צועק - רקע אדום, מסגרת, ואנימציה
//   • מונה קבוע בראש המסך: "חסרים X משקלים"
//   • סגירת המכירה חסומה כל עוד יש חסר
//   • 0 הוא ערך **תקף** ומולא במפורש - "הלקוח לא קיבל" שונה
//     מ"שכחתי למלא", ורק ההבחנה הזו מאפשרת לחסום את השני.

import { useEffect, useMemo, useRef, useState } from "react";
// §339: עריכת מחיר במוצר מועדף
import FavoritePriceEditor from "@/components/FavoritePriceEditor";
// §332: טופס הכרטיס — נפתח מהבורר בטבלה
import { UpdateCardModal } from "@/components/UpdateCardButton";
// §200: תאריכים בשעון ישראל — השרת רץ ב-UTC
import { fmtDateTime } from "@/lib/date-lib";
import type { Order, OrderItem, AvailableProduct } from "./AgentSaleClient";
import { fmt } from "@/lib/pricing";
// §128: תצוגת יחידות - מקור אחד לכל המערכת
import { formatItemQty } from "@/lib/order-display";

type Props = {
  orders: Order[];
  availableProducts: AvailableProduct[];
  productWeightsFromNotes: Record<string, number>;
  productWeightsUsed: Record<string, number>;
  readOnly?: boolean;
  /**
   * §262: נעילה **לכל הזמנה בנפרד**.
   *
   * 🐛 קודם הטבלה כולה ננעלה כשהנציג סגר סיכום, והוא לא יכול
   * היה לתקן משקל של לקוח שהגיע אחר כך.
   *
   * ⚠️ הנעילה הנכונה היא החיוב: כל עוד לא נגבה כסף, תיקון הוא
   * לגיטימי. אחרי החיוב הוא יוצר פער בין מה שנגבה למה שרשום.
   */
  isOrderLocked?: (order: any) => boolean;
  onItemUpdate: (orderId: string, itemId: string, updates: Partial<OrderItem>) => void;
  onNeedsReload: () => void;
  /** §81: דיווח על מספר המשקלים החסרים - לחסימת סגירת המכירה */
  onMissingCountChange?: (count: number) => void;
  /** §322: הרשאות — הבורר מוצג רק למי שיש לו את שתיהן */
  canUpdateCards?: boolean;
  canSetCash?: boolean;
};

type Cell = {
  itemId: string;
  orderId: string;
  productName: string;
  isSingle: boolean;
  isCancelled: boolean;
  ordered: string;
  /**
   * §137: מוצר שנמכר ביחידות ולא נשקל.
   *
   * "בקר טחון 500 ג'" הוא saleType=UNIT - המשקל ידוע מראש
   * ומודפס על האריזה. דרישה לשקול אותו היא עבודה מיותרת בחלוקה,
   * והיא גם חוסמת את סגירת המכירה על לא כלום.
   */
  noWeighing: boolean;
  orderedQty: number;
  unitPrice: number;
  /** §339: מוצר מועדף — ניתן לשנות מחיר עד החיוב */
  isFavorite?: boolean;
  agentSetPrice?: number | null;
  estimatedWeight: number | null;
  agentEnteredWeight: number | null;
};

type CustomerRow = {
  orderId: string;
  orderNumber: number;
  customerName: string;
  phone: string;
  /** productId -> תא. לקוח שלא הזמין מוצר מסוים פשוט לא יופיע כאן */
  cells: Cell[];
  total: number;
  missing: number;
  /** §103: מתי הנציג סימן שסיים. null = טרם טופל. */
  agentClosedAt: string | null;
  // §130: מצב התשלום - לסימון מזומן מהטבלה
  paymentStatus: string | null;
  /**
   * §314: אופן התשלום של הלקוח — CASH / CREDIT.
   *
   * בלעדיו סימון המזומן הוצג בכל שורה, כולל לקוחות אשראי.
   * הנציג בחלוקה ראה אותו וחשב שצריך לגבות במקום - בזמן
   * שהכרטיס עומד להיות מחויב אוטומטית.
   */
  customerPaymentPreference?: string | null;
  /** §322: לבורר אמצעי התשלום */
  customerId?: string;
  hasCard?: boolean;
  /** §323: סימון מסירה — הלקוח הגיע ולקח */
  deliveredAt?: string | null;
  /** §332: אמצעי התשלום **של ההזמנה** — גובר על העדפת הלקוח */
  orderPaymentMethod?: string | null;
  finalTotal: number | null;
};

export function WeightsTable({
  orders,
  availableProducts,
  readOnly,
  isOrderLocked,
  onItemUpdate,
  onNeedsReload,
  onMissingCountChange,
  // §322: הרשאות — לבורר אמצעי התשלום בשורה
  canUpdateCards = false,
  canSetCash = false,
}: Props) {
  // ─── עמודות: כל המוצרים שהוזמנו בפועל ───
  // לא כל הקטלוג - רק מה שמישהו הזמין. מוצר שאיש לא הזמין הוא
  // עמודה ריקה שגוזלת רוחב מסך יקר.
  //
  // הסדר לפי כמות המזמינים: המוצרים הנפוצים משמאל, קרוב לשם
  // הלקוח, כדי שהנציג ימלא את רובם בלי גלילה אופקית.
  // §141: כמה עמודות צריך - לפי הלקוח העמוס ביותר.
  //
  // 🐛 המבנה הקודם: עמודה קבועה לכל מוצר שהוזמן בנקודה. עשרים
  // לקוחות שכל אחד לקח מוצר אחר = עשרים עמודות, גלילה אינסופית
  // ימינה ושמאלה, ורוב הטבלה ריקה.
  //
  // עכשיו: **כל תא הוא פריט**. שם המוצר בתוך התא, והפריטים של
  // כל לקוח צמודים משמאל בלי רווחים. לקוח שהזמין 2 פריטים תופס
  // 2 תאים, ולא 2 מתוך 20.
  // §332: 💳 טופס הכרטיס — נפתח מהבורר כשאין ללקוח כרטיס.
  //
  // ⚠️ המודל ברמת הטבלה ולא בתא: הוא ברוחב מלא, ותא בטבלה צרה
  // לא יכול להכיל אותו.
  //
  // ⚠️ ה-hook כאן, לפני כל תנאי — §283/§305 חזרו על עצמם פעמיים
  // ביום אחד כי הוא הוצב ליד הקוד שמשתמש בו.
  const [cardFor, setCardFor] = useState<{
    customerId: string;
    name: string;
  } | null>(null);

  const maxItems = useMemo(() => {
    // §246: הגנה מפני orders שאינו מערך.
    //
    // ⚠️ טעינה חלקית או session שפג מחזירים undefined, ורכיב
    // שקורס מפיל את **כל** מסך המכירה - הנציג נשאר בלי טבלת
    // משקלים באמצע חלוקה.
    //
    // ⚠️ מחזיר 1 ולא []: ה-useMemo הזה מחשב את **מספר** העמודות
    // המקסימלי, ומערך ריק כאן שבר את Array.from למטה.
    if (!Array.isArray(orders)) return 1;

    let m = 1;
    for (const o of orders) {
      const n = o.items.filter((i) => !i.isCancelled).length;
      if (n > m) m = n;
    }
    // §177: 🐛 "ריבוע לבן גדול" - כל השורות קיבלו את מספר
    // העמודות של **הלקוח העמוס ביותר**.
    //
    // עם חציון של 3 פריטים ולקוח אחד עם 8, כל שאר השורות קיבלו
    // 5 תאים ריקים - בלוק לבן ענק שנראה כמו שדות למילוי.
    //
    // ⚠️ עכשיו לפי האחוזון ה-90: רוב הלקוחות ממלאים את השורה,
    // והחריגים גולשים לשורה שנייה (מטופל למטה). זה בדיוק מה
    // שנעשה בדף המודפס ב-§140, ומאותה סיבה.
    const counts = orders
      .map((o) => o.items.filter((i) => !i.isCancelled).length)
      .filter((n) => n > 0)
      .sort((a, b) => a - b);
    if (counts.length === 0) return 1;
    // ⚠️ ceil-1 ולא floor: עם 10 לקוחות, floor נותן אינדקס 9
    // שהוא האיבר האחרון - כלומר המקסימום, ולא האחוזון.
    const p90 = counts[Math.max(0, Math.ceil(counts.length * 0.9) - 1)];
    // ⚠️ מינימום 2: עמודה אחת נראית כמו רשימה ולא כמו טבלה.
    return Math.max(2, Math.min(p90, 8));
  }, [orders]);

  // ─── שורות: לקוח אחד לשורה ───
  const rows = useMemo<CustomerRow[]>(() => {
    return orders
      .filter((o) => o.items.some((i) => !i.isCancelled))
      .map((o) => {
        const cells: Cell[] = [];
        let total = 0;
        let missing = 0;
        for (const it of o.items) {
          if (it.isCancelled) continue;
          const w = it.agentEnteredWeight;

          // §137: מוצר שנמכר ביחידות אינו נשקל.
          //
          // 🐛 הבאג: הטבלה דרשה משקל **מכל פריט**, בלי לבדוק אם
          // המוצר בכלל נמכר לפי משקל. "בקר טחון 500 ג'" הוא
          // saleType=UNIT - המשקל מודפס על האריזה. הנציג נדרש
          // לשקול אותו, וסגירת המכירה נחסמה על לא כלום.
          //
          // ⚠️ saleType בלבד. מוצר שנמכר ביחידות נמכר ביחידות -
          // אין מצב שהוא נשקל, ותנאי נוסף רק היה מבלבל.
          const noWeighing = it.product?.saleType === "UNIT";

          // null = לא מולא. 0 = מולא במפורש ("לא קיבל").
          if (w === null || w === undefined) {
            // ⚠️ מוצר יחידה: אין משקל בכוונה, ולכן הוא **אינו**
            // נספר כחסר - אבל הסכום שלו כן צריך להיכנס.
            //
            // 🐛 הענף הישן היה `else total += w * price`, ובמוצר
            // יחידה w הוא null - כלומר הסכום שלו נעלם מסה"כ
            // ההזמנה. הלקוח היה מחויב פחות ממה שהזמין.
            // §268: אם הנציג הזין כמות בפועל - היא גוברת.
            if (noWeighing) {
              const actual = w ?? it.quantity;
              total += actual * it.unitPrice;
            }
            else missing++;
          } else {
            total += w * it.unitPrice;
          }
          cells.push({
            itemId: it.id,
            orderId: o.id,
            productName: it.productName,
            isSingle: it.isSingle,
            isCancelled: it.isCancelled,
            // §128: 🐛 שני באגים כאן.
            //
            // 1. "קרטון" היה מקודד: מוצר שנמכר ביחידות (בקר טחון,
            //    כבד) הוצג לנציג כקרטון, והוא היה שוקל את הדבר
            //    הלא נכון.
            //
            // 2. `קרטון + "ים"` נותן "קרטוןים" - האות הסופית לא
            //    טופלה. formatItemQty מטפל בשניהם.
            noWeighing,
            ordered: formatItemQty({
              isSingle: it.isSingle,
              quantity: it.quantity,
              unit: it.unit,
            }),
            orderedQty: it.quantity,
            unitPrice: it.unitPrice,
            // §339: לעריכת מחיר מותאם מהטבלה
            isFavorite: !!(it as any).isFavorite,
            agentSetPrice: (it as any).agentSetPrice ?? null,
            estimatedWeight: it.estimatedWeight,
            agentEnteredWeight: w ?? null,
          });
        }
        return {
          orderId: o.id,
          orderNumber: o.orderNumber,
          customerName: o.customerName,
          phone: o.phone,
          cells,
          total,
          missing,
          agentClosedAt: (o as any).agentClosedAt ?? null,
          // §314: אופן התשלום — לסינון סימון המזומן
          customerPaymentPreference:
            (o as any).customerPaymentPreference ?? null,
          // §322: לבורר אמצעי התשלום
          customerId: (o as any).customerId ?? "",
          hasCard: !!(o as any).hasCard,
          // §323: סימון מסירה — היה רק בכרטיסים
          deliveredAt: (o as any).deliveredAt ?? null,
          // §332: אמצעי התשלום של ההזמנה
          orderPaymentMethod: (o as any).paymentMethod ?? null,
          paymentStatus: (o as any).paymentStatus ?? null,
          finalTotal: (o as any).finalTotal ?? null,
        };
      });
  }, [orders]);

  const totalMissing = rows.reduce((s, r) => s + r.missing, 0);
  const closedCount = rows.filter((r) => r.agentClosedAt).length;

  // §118: התא החסר הראשון - לקפיצה ישירה. סורק לפי סדר התצוגה,
  // כך שהנציג עובר על החסרים בסדר הגיוני ולא קופץ אחורה וקדימה.
  const firstMissing = useMemo(() => {
    for (const r of rows) {
      if (r.missing === 0) continue;
      for (const cell of r.cells) {
        // §268: יחידות נספרות כמו משקל.
        //
        // ⚠️ קודם הן דולגו לגמרי ("אין מה לשקול"), ולכן הזמנה
        // של נקניקים בלבד הוצגה כ"הושלמה" בלי שאיש אישר כמות.
        if (cell.agentEnteredWeight === null) {
          return {
            cellId: `w-${cell.itemId}`,
            customerName: r.customerName,
            productName: cell.productName,
          };
        }
      }
    }
    return null;
  }, [rows]);
  const grandTotal = rows.reduce((s, r) => s + r.total, 0);

  useEffect(() => {
    onMissingCountChange?.(totalMissing);
  }, [totalMissing, onMissingCountChange]);

  return (
    <div className="bg-white rounded-2xl border border-zinc-200 shadow-sm overflow-hidden">
      {/* ─── פס מצב דביק ─── */}
      {/* דביק בכוונה: הנציג גולל בין 100 לקוחות, והמספר החסר חייב
          להישאר מול העיניים כל הזמן. */}
      <div
        className={`sticky top-0 z-20 px-4 py-2.5 border-b-2 flex items-center justify-between gap-3 flex-wrap ${
          totalMissing > 0
            ? "bg-red-50 border-red-300"
            : "bg-emerald-50 border-emerald-300"
        }`}
      >
        <div className="flex items-center gap-2">
          {totalMissing > 0 ? (
            <>
              <span className="text-xl">⚠️</span>
              <div>
                <div className="font-extrabold text-red-800 text-sm">
                  חסרים {totalMissing} משקלים
                </div>
                <div className="text-[11px] text-red-700">
                  לא ניתן לסגור את המכירה עד שכולם ימולאו. לא קיבל סחורה? הזן 0.
                </div>
                {/* §118: קפיצה אל החסר הראשון.
                    "חסרים 7" בלי דרך למצוא אותם הוא תסכול: בטבלה
                    של 100 שורות ו-12 עמודות, הנציג גולל ומחפש
                    תאים אדומים במקום לעבוד. */}
                {firstMissing && (
                  <button
                    type="button"
                    onClick={() => {
                      const el = document.getElementById(firstMissing.cellId);
                      el?.scrollIntoView({ behavior: "smooth", block: "center", inline: "center" });
                      (el as HTMLInputElement | null)?.focus();
                    }}
                    className="mt-1 text-[11px] font-bold bg-red-600 text-white rounded-lg px-2.5 py-1"
                  >
                    ← קפוץ אל {firstMissing.customerName} · {firstMissing.productName}
                  </button>
                )}
              </div>
            </>
          ) : (
            <>
              <span className="text-xl">✓</span>
              <div className="font-extrabold text-emerald-800 text-sm">
                כל המשקלים מולאו
              </div>
            </>
          )}
        </div>
        <div className="flex items-center gap-3">
          {/* §103: כמה לקוחות כבר טופלו - הנציג רואה את ההתקדמות
              שלו במבט אחד, בלי לספור שורות. */}
          <div className="text-xs font-bold text-zinc-600">
            טופלו {closedCount} מתוך {rows.length}
          </div>
          <div className="text-sm font-bold text-brand-slatedark">
            סה״כ: {fmt(grandTotal)}
          </div>
        </div>
      </div>

      <div className="px-4 py-2 bg-zinc-50 border-b border-zinc-200 text-[10px] text-zinc-500">
        Tab/Enter = השדה הבא · השמירה אוטומטית · לחיצה על שם הלקוח פותחת את ההזמנה המלאה
      </div>

      {/* ─── הטבלה ─── */}
      <div className="overflow-x-auto">
        {/* §177: 🐛 "ריבוע לבן גדול בצד שמאל".
            
            הטבלה הייתה בלי w-full, ולכן תפסה רק את רוחב התוכן.
            במסך רחב עם 3-4 עמודות נשאר שטח לבן ענק מצד שמאל,
            שנראה כמו חלק מהטבלה שלא נטען.
            
            ⚠️ min-w-full ולא w-full: כשיש הרבה עמודות הטבלה
            **חייבת** לגלוש, ו-w-full היה דוחס אותן. min-w-full
            נותן את שניהם - ממלא את הרוחב כשצר, וגולש כשצריך. */}
        <table className="min-w-full text-sm border-collapse">
          <thead>
            <tr className="bg-zinc-100 border-b-2 border-zinc-300">
              {/* עמודת הלקוח קפואה - היא נקודת הייחוס בגלילה אופקית */}
              {/* §269: 📱 עמודת השם צרה יותר בנייד.
                  
                  🐛 140px + 110px לכל מוצר = **2 עמודות** במסך
                  של 375px. לקוח עם 4 מוצרים דרש גלילה של שני
                  מסכים, והנציג איבד את מקומו באמצע.
                  
                  ⚠️ 96px בנייד: מספיק לשם משפחה, שזה מה שהנציג
                  מזהה לפיו ממילא. */}
              <th className="sticky right-0 z-10 bg-zinc-100 text-right px-2 md:px-3 py-2 min-w-[96px] md:min-w-[140px] border-l-2 border-zinc-300 text-[11px] font-bold text-zinc-600">
                שם הלקוח
              </th>
              {/* §141: כותרות גנריות - שם המוצר יושב בתא עצמו.
                  כך אין עמודה ריקה ללקוח שלא הזמין את המוצר. */}
              {Array.from({ length: maxItems }, (_, i) => (
                <th
                  key={i}
                  // §269: 84px בנייד — שדה של 4-5 ספרות + תווית.
                  className="px-1 md:px-2 py-2 min-w-[84px] md:min-w-[110px] border-l border-zinc-200 text-[10px] font-bold text-zinc-500"
                >
                  פריט {i + 1}
                </th>
              ))}
              {/* §177: w-full על העמודה הזו - היא סופגת את הרוחב
                  העודף, כך שהעמודות הקבועות לא נמתחות. */}
              <th className="w-full px-3 py-2 min-w-[90px] border-l border-zinc-200 text-[11px] font-bold text-zinc-600">
                סה״כ הזמנה
              </th>
              {/* §103: עמודת הסימון - קפואה בקצה, כי זו הפעולה
                  שהנציג מחפש אחרי שסיים למלא את השורה. */}
              {/* §130: תשלום. הלקוח מביא מזומן בחלוקה, והנציג
                  חייב לסמן **בזמן אמת** - אחרת הכרטיס יחויב בערב
                  והוא ישלם פעמיים.
                  
                  ⚠️ בטבלה ולא רק בכרטיס ההזמנה: כאן הנציג עובד
                  בפועל, ומעבר בין מסכים על כל לקוח לא יקרה. */}
              <th className="px-3 py-2 min-w-[90px] border-l border-zinc-200 text-[11px] font-bold text-zinc-600">
                תשלום
              </th>
              {/* §323: 📦 מסירה — היה רק בכרטיסים.
                  
                  הנציג שעובד בטבלה (רובם, בחלוקה) לא סימן מסירה
                  כלל, והמונה "0 מתוך 34 נמסרו" נשאר אפס.
                  
                  ⚠️ שני סימונים שונים: "טופל" = סיימתי לשקול.
                  "נמסר" = הלקוח הגיע ולקח. הזמנה יכולה להיות
                  שקולה ולא נמסרה, ולהפך. */}
              <th className="px-2 py-2 min-w-[60px] border-l border-zinc-200 text-[11px] font-bold text-zinc-600">
                נמסר
              </th>
              <th className="sticky left-0 z-10 bg-zinc-100 px-3 py-2 min-w-[80px] border-r-2 border-zinc-300 text-[11px] font-bold text-zinc-600">
                טופל
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr
                key={r.orderId}
                className={`border-b border-zinc-200 ${
                  r.missing > 0 ? "bg-red-50/40" : "hover:bg-zinc-50"
                }`}
              >
                <td className="sticky right-0 z-10 bg-inherit px-3 py-2 border-l-2 border-zinc-300 align-middle">
                  {/* §177: 🐛 השם היה קישור בלי שום סימן שהוא כזה.
                      
                      הנציג שרצה להוסיף מוצר להזמנה לא ידע שצריך
                      ללחוץ על השם, ומה מסתתר מאחוריו. עכשיו יש
                      חץ וטקסט מפורש.
                      
                      ⚠️ הכפתור בתוך התא הדביק, ולכן הוא נשאר
                      גלוי גם כשגוללים את הטבלה הצידה - שם הנציג
                      נמצא רוב הזמן. */}
                  <a
                    href={`/agent/orders/${r.orderId}`}
                    className="font-bold text-brand-slatedark hover:text-brand-rust block leading-tight"
                  >
                    {r.customerName}
                  </a>
                  <div className="flex items-center gap-1.5 mt-0.5">
                    <span className="text-[10px] text-zinc-400">
                      #{r.orderNumber}
                    </span>
                    {!readOnly && (
                      <a
                        href={`/agent/orders/${r.orderId}`}
                        className="text-[10px] font-bold text-brand-rust hover:underline whitespace-nowrap"
                      >
                        ➕ הוספת מוצר
                      </a>
                    )}
                  </div>
                </td>

                {/* §141: הפריטים של הלקוח, צמודים משמאל.
                    
                    ⚠️ אין יותר "לא הזמין את המוצר" - התאים הריקים
                    הם רק מה שנשאר אחרי הפריטים שלו, ולא חורים
                    באמצע. לקוח שהזמין 2 פריטים רואה 2 תאים
                    מלאים ואת השאר ריקים - במקום 2 מתוך 20. */}
                {Array.from({ length: maxItems }, (_, i) => {
                  // §177: הפריט האחרון בעמודה האחרונה סופג את
                  // מה שגלש - כדי שפריט לא ייעלם מהמסך.
                  const isLast = i === maxItems - 1;
                  const overflow = isLast ? r.cells.slice(i) : [];
                  const cell = r.cells[i];
                  return (
                    <td
                      key={i}
                      // §177: 🐛 תא ריק נראה כמו "מרובע לבן מוזר".
                      //
                      // הוא קיבל את אותו border ורקע כמו תא עם
                      // תוכן, ולכן נראה כמו שדה שאפשר למלא - אבל
                      // אין בו כלום ואי אפשר ללחוץ עליו.
                      //
                      // ⚠️ אפור מלא ובלי גבול פנימי: רצף תאים ריקים
                      // מתמזג לבלוק אחד במקום להיראות כמו שורת
                      // שדות ריקים שמחכים למילוי.
                      className={`px-1 py-1 align-top ${
                        cell
                          ? "border-l border-zinc-200"
                          : "bg-zinc-100/70 border-l border-zinc-100"
                      }`}
                    >
                      {cell ? (
                        <>
                          <WeightCell
                            cellId={`w-${cell.itemId}`}
                            cell={cell}
                            // §262: נעול רק אם **ההזמנה הזו** שולמה
                            readOnly={readOnly || !!isOrderLocked?.(r)}
                            onItemUpdate={onItemUpdate}
                            onNeedsReload={onNeedsReload}
                          />
                          {/* §177: פריטים שגלשו מעבר לעמודות.
                              
                              ⚠️ מוצגים ולא נעלמים: לקוח עם 9 פריטים
                              בטבלה של 5 עמודות היה מאבד 4 מהם
                              מהמסך, והנציג לא היה יודע שהם קיימים. */}
                          {overflow.length > 1 &&
                            overflow.slice(1).map((c) => (
                              <div key={c.itemId} className="mt-1">
                                <WeightCell
                                  cellId={`w-${c.itemId}`}
                                  cell={c}
                                  readOnly={readOnly || !!isOrderLocked?.(r)}
                                  onItemUpdate={onItemUpdate}
                                  onNeedsReload={onNeedsReload}
                                />
                              </div>
                            ))}
                        </>
                      ) : null}
                    </td>
                  );
                })}

                <td
                  className={`px-3 py-2 border-l border-zinc-200 text-center font-extrabold ${
                    r.missing > 0 ? "text-zinc-400" : "text-brand-rust"
                  }`}
                >
                  {r.missing > 0 ? (
                    <span className="text-[11px] text-red-700 font-bold">
                      חסר {r.missing}
                    </span>
                  ) : (
                    fmt(r.total)
                  )}
                </td>

                {/* §314: 💵 סימון מזומן — **רק ללקוח מזומן**.
                    
                    הסימון הוצג בכל שורה, כולל אשראי. הנציג
                    בחלוקה ראה אותו על לקוח שכרטיסו שמור, וחשב
                    שצריך לגבות ממנו במקום.
                    
                    ואם סימן - הלקוח שילם פעמיים: במזומן לנציג,
                    ובכרטיס בחיוב האוטומטי.
                    
                    התא נשאר (כדי שהטבלה לא תישבר), והתוכן ריק. */}
                <td className="px-2 py-2 border-l border-zinc-200 text-center">
                  {/* §322: 🔀 בורר אמצעי תשלום בשורה.
                      
                      הצורך: הלקוח מגיע לחלוקה ואומר "אשלם
                      במזומן" - או להפך. הנציג היה צריך לצאת
                      לכרטיס הלקוח, לשנות, ולחזור.
                      
                      ⚠️ מוצג רק לנציג עם **שתי** ההרשאות: מי
                      שיכול רק כיוון אחד מקבל את הכפתור הישן,
                      שעושה בדיוק את זה.
                      
                      ⚠️ ומעבר לאשראי דורש כרטיס - בלעדיו
                      הלקוח נתקע בלי אמצעי גבייה. */}
                  {canUpdateCards && canSetCash ? (
                    <PayPrefToggle
                      orderId={r.orderId}
                      customerName={r.customerName}
                      // §332: מצב **ההזמנה**, עם נפילה להעדפת
                      // הלקוח כשלא סומן במפורש.
                      pref={
                        r.orderPaymentMethod === "MANUAL" ||
                        r.orderPaymentMethod === "CASH"
                          ? "CASH"
                          : r.orderPaymentMethod
                            ? "CREDIT"
                            : r.customerPaymentPreference
                      }
                      hasCard={r.hasCard}
                      readOnly={readOnly}
                      onDone={onNeedsReload}
                      onNeedCard={() =>
                        setCardFor({
                          customerId: r.customerId ?? "",
                          name: r.customerName,
                        })
                      }
                    />
                  ) : r.customerPaymentPreference === "CREDIT" ? (
                    <span className="text-[10px] text-zinc-300">—</span>
                  ) : (
                  <CashCell
                    orderId={r.orderId}
                    orderNumber={r.orderNumber}
                    customerName={r.customerName}
                    paymentStatus={r.paymentStatus}
                    finalTotal={r.finalTotal}
                    missing={r.missing}
                    readOnly={readOnly}
                    onDone={onNeedsReload}
                  />
                  )}
                </td>

                {/* §323: 📦 סימון מסירה — אותה פעולה של הכרטיסים. */}
                <td className="px-2 py-2 border-l border-zinc-200 text-center">
                  <DeliverCell
                    orderId={r.orderId}
                    customerName={r.customerName}
                    deliveredAt={r.deliveredAt}
                    readOnly={readOnly}
                    onDone={onNeedsReload}
                  />
                </td>

                <td className="sticky left-0 z-10 bg-inherit px-2 py-2 border-r-2 border-zinc-300 text-center">
                  <CloseOrderCheck
                    orderId={r.orderId}
                    orderNumber={r.orderNumber}
                    customerName={r.customerName}
                    missing={r.missing}
                    closedAt={r.agentClosedAt}
                    readOnly={readOnly}
                    onDone={onNeedsReload}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {rows.length === 0 && (
        <div className="p-8 text-center text-zinc-500 text-sm">
          אין הזמנות להזנה בנקודה זו.
        </div>
      )}

      {/* §332: 💳 טופס הכרטיס.
          
          נפתח מהבורר כשהנציג בוחר "אשראי" ללקוח בלי כרטיס -
          במקום הודעה ששולחת אותו למסך אחר.
          
          ⚠️ והכרטיס נשמר **לתמיד** (save-token מציב CREDIT),
          בניגוד לבחירת המזומן שהיא להזמנה בלבד. */}
      {cardFor && (
        <UpdateCardModal
          customerId={cardFor.customerId}
          hasCurrentCard={false}
          onSuccess={() => {
            setCardFor(null);
            onNeedsReload();
          }}
          onClose={() => setCardFor(null)}
        />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// תא בודד: כמות שהוזמנה, שדה משקל, וסכום
// ─────────────────────────────────────────────────────────────
function WeightCell({
  cell,
  cellId,
  readOnly,
  onItemUpdate,
  onNeedsReload,
}: {
  cell: Cell;
  cellId: string;
  readOnly?: boolean;
  onItemUpdate: (orderId: string, itemId: string, updates: Partial<OrderItem>) => void;
  onNeedsReload: () => void;
}) {
  const [val, setVal] = useState(
    cell.agentEnteredWeight !== null ? String(cell.agentEnteredWeight) : ""
  );

  // §301: 📦 **משבצת לכל קרטון.**
  //
  // הבעיה מהשטח: לקוח לקח 2 קרטונים, והנציג שוקל כל אחד בנפרד -
  // 12.4 ו-13.1. אבל יש רק משבצת אחת, ולכן הוא צריך לחבר בראש
  // או לרשום בצד. וזה בדיוק המקום שבו נופלות טעויות.
  //
  // ⚠️ הסכום הוא מה שנשמר: הפריט מחזיק משקל אחד, ופיצול שלו
  // במסד היה דורש מיגרציה ושינוי בכל מי שקורא אותו.
  //
  // ⚠️ ומי שכן שקל ביחד יכול למלא הכל במשבצת אחת ולהשאיר את
  // השנייה ריקה - הסכום זהה.
  //
  // ⚠️ רק קרטונים: בודדים לפי ק"ג הם שקילה אחת ("3 ק"ג פרגית"),
  // ופיצול היה מבלבל.
  const cartonCount =
    !cell.isSingle && !cell.noWeighing && cell.orderedQty > 1
      ? Math.min(Math.floor(cell.orderedQty), 6)
      : 1;

  // ⚠️ בטעינה הכל במשבצת הראשונה: המסד מחזיק סכום, לא פירוט.
  // הנציג רואה את מה שהזין ויכול לתקן.
  const [parts, setParts] = useState<string[]>(() => {
    const arr = Array(cartonCount).fill("");
    if (cell.agentEnteredWeight !== null) {
      arr[0] = String(cell.agentEnteredWeight);
    }
    return arr;
  });

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setVal(cell.agentEnteredWeight !== null ? String(cell.agentEnteredWeight) : "");
  }, [cell.agentEnteredWeight]);

  // null ולא 0: "לא מולא" ו"מולא 0" הם שני מצבים שונים לגמרי, וזו
  // כל ההבחנה שמאפשרת לחסום סגירת מכירה על שכחה.
  // §137: מוצר יחידה - אין מה לשקול, ולכן אין "חסר".
  // §268: יחידות שלא אושרו הן חסרות, כמו משקל שלא הוזן.
  //
  // ⚠️ הנציג חייב לאשר גם יחידות: "4 יח׳" ב-placeholder הוא
  // הצעה, לא אישור. בלי הזנה מפורשת אין לדעת אם קיבל 4 או 3.
  const isMissing = cell.agentEnteredWeight === null;
  const lineTotal =
    cell.agentEnteredWeight !== null ? cell.agentEnteredWeight * cell.unitPrice : 0;

  // §326: ביטול הפריט — אותה פעולה של הכרטיסים (§302).
  //
  // ⚠️ הפריט נשאר לתיעוד ויוצא מהחישוב, ולא נמחק.
  async function cancelItem() {
    if (
      !window.confirm(
        `לבטל את "${cell.productName}" מההזמנה?\n\nהפריט יוצא מהחישוב אך יישאר לתיעוד.`
      )
    )
      return;
    setSaving(true);
    try {
      const res = await fetch(`/api/agent/order-item/${cell.itemId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isCancelled: true }),
      });
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        throw new Error(e.error || "הביטול נכשל");
      }
      onNeedsReload();
    } catch (e: any) {
      alert(e?.message || "שגיאה");
    } finally {
      setSaving(false);
    }
  }

  async function save() {
    const raw = val.trim();

    // §141: 🐛 מחיקת משקל לא נשמרה.
    //
    // כאן היה `if (raw === "") return` - כלומר שדה שרוקן פשוט לא
    // נשלח לשרת. הנציג מחק, השדה נראה ריק, התא נשאר ירוק, וברגע
    // שהוא חזר למסך המשקל היה שם.
    //
    // זה חמור יותר מבאג תצוגה: הנציג חשב שהוא ביטל משקל שגוי,
    // והלקוח חויב לפיו.
    //
    // ⚠️ ההבחנה בין null ל-0 נשמרת: null = "טרם נשקל" (תא אדום),
    // 0 = "לא קיבל" (ערך תקף). מחיקה מחזירה ל-null.
    if (raw === "") {
      if (cell.agentEnteredWeight === null) return; // כבר ריק
      setSaving(true);
      try {
        const res = await fetch(`/api/agent/order-item/${cell.itemId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ agentEnteredWeight: null }),
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || "שגיאה");
        // §299: 🐛 **המחיקה טענה את כל המסך מחדש.**
        //
        // onNeedsReload() שולף 244 הזמנות ו-758 פריטים ממסד
        // באירלנד - 2-3 שניות. הנציג מחק תא, והמסך נתקע.
        //
        // ⚠️ ההזנה כבר עשתה את זה נכון (onItemUpdate), והמחיקה
        // פשוט נשארה מאחור. אותה פעולה, אותו עדכון.
        onItemUpdate(cell.orderId, cell.itemId, {
          agentEnteredWeight: null,
          actualWeight: json.item?.actualWeight ?? null,
        });
      } catch {
        setError(true);
        setVal(String(cell.agentEnteredWeight));
        setTimeout(() => setError(false), 1500);
      } finally {
        setSaving(false);
      }
      return;
    }

    const w = Number(raw);
    if (!Number.isFinite(w) || w < 0) {
      setError(true);
      setVal(cell.agentEnteredWeight !== null ? String(cell.agentEnteredWeight) : "");
      setTimeout(() => setError(false), 1500);
      return;
    }
    if (w === cell.agentEnteredWeight) return;

    setSaving(true);
    try {
      const res = await fetch(`/api/agent/order-item/${cell.itemId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agentEnteredWeight: w }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "שגיאה");
      // finalPrice אינו חלק מטיפוס OrderItem במסך הזה, וגם אין בו
      // צורך: הסכום המוצג נגזר מ-agentEnteredWeight × unitPrice.
      onItemUpdate(cell.orderId, cell.itemId, {
        agentEnteredWeight: json.item.agentEnteredWeight,
        actualWeight: json.item.actualWeight,
      });
    } catch {
      setError(true);
      setVal(cell.agentEnteredWeight !== null ? String(cell.agentEnteredWeight) : "");
      setTimeout(() => setError(false), 2000);
      onNeedsReload();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-0.5 min-w-[100px]">
      {/* §141: שם המוצר בתוך התא.
          
          במבנה הישן השם היה בכותרת העמודה, ולכן היה צריך עמודה
          לכל מוצר. עכשיו הוא כאן, והעמודות גנריות - מה שמאפשר
          לדחוס את הפריטים של כל לקוח משמאל בלי חורים.
          
          ⚠️ truncate ולא wrap: שם ארוך היה מותח את גובה כל
          השורה, ובטבלה של 40 לקוחות זה עמוד שלם של רווח מבוזבז.
          השם המלא ב-title. */}
      {/* §326: 🗑️ ביטול מוצר מהטבלה.
          
          הפעולה הייתה קיימת בכרטיסים ובמסכי ההזמנה - ולא כאן,
          במקום שבו הנציג עובד בפועל.
          
          ⚠️ לחיצה ארוכה על השם ולא כפתור: הטבלה צרה בנייד,
          וכפתור בכל תא היה גוזל את המקום של השדה עצמו.
          
          ⚠️ ולחיצה רגילה לא עושה כלום — ביטול בטעות בזמן
          גלילה הוא בדיוק מה שאסור שיקרה. */}
      <div
        onDoubleClick={() => {
          if (readOnly) return;
          cancelItem();
        }}
        title={`${cell.productName} · לחיצה כפולה לביטול`}
        className="text-[10px] font-bold text-brand-slatedark leading-tight truncate cursor-pointer"
      >
        {cell.productName}
      </div>
      <div className="text-[9px] text-zinc-500 leading-none flex items-center gap-1">
        <span>{cell.ordered}</span>
        {/* §339: ⭐ מחיר מותאם — כאן הנציג עובד בחלוקה.
            
            מעבר למסך ההזמנה על כל תיקון מחיר לא יקרה בזמן
            שלקוחות מחכים. */}
        <FavoritePriceEditor
          itemId={cell.itemId}
          productName={cell.productName}
          unitPrice={Number(cell.unitPrice)}
          agentSetPrice={
            cell.agentSetPrice != null ? Number(cell.agentSetPrice) : null
          }
          quantity={Number(cell.orderedQty)}
          isFavorite={!!cell.isFavorite}
          locked={!!readOnly}
        />
      </div>

      {/* §137: מוצר שנמכר ביחידות - המשקל ידוע מהאריזה, ואין
          שדה למלא. הצגת שדה ריק הייתה גורמת לנציג לחפש משקולת
          למשהו שכתוב עליו 500 גרם. */}
      {/* §268: 🐛 מוצר יחידות הציג טקסט במקום שדה.
          
          §141 הסתיר את השדה כי "אין מה לשקול" - נכון לגבי משקל,
          שגוי לגבי **כמות**. הלקוח הזמין 4 נקניקים ולקח 5, או
          קיבל 3 כי נגמר - ולנציג לא הייתה דרך לרשום את זה.
          
          התוצאה: הלקוח חויב על 4 בכל מקרה.
          
          ⚠️ **אותו שדה, אותה מכניקה**: finalPrice = כמות ×
          מחיר ליחידה, בדיוק כמו משקל × מחיר לק"ג. לא נדרש
          שינוי בשרת.
          
          ⚠️ מה שכן משתנה: step=1 (אין חצי נקניק), ותווית
          "יח׳" במקום "משקל". */}
      {/* §301: 📦 משבצת לכל קרטון.
          
          לקוח לקח 2 קרטונים, והנציג שוקל כל אחד בנפרד. משבצת
          אחת אילצה אותו לחבר בראש - ושם נופלות הטעויות.
          
          ⚠️ מי ששקל ביחד ממלא הכל בראשונה ומשאיר את השנייה
          ריקה. הסכום זהה. */}
      {cartonCount > 1 ? (
        <div className="flex flex-col gap-1">
          {parts.map((p, i) => (
            <div key={i} className="flex items-center gap-1">
              <span className="text-[9px] text-zinc-400 w-3 shrink-0">
                {i + 1}
              </span>
              <input
                type="number"
                inputMode="decimal"
                step={0.01}
                min={0}
                dir="ltr"
                disabled={readOnly || saving}
                value={p}
                onChange={(e) => {
                  const next = [...parts];
                  next[i] = e.target.value;
                  setParts(next);
                }}
                onBlur={() => {
                  // ⚠️ הסכום הוא מה שנשמר — הפריט מחזיק משקל אחד.
                  const sum = parts.reduce(
                    (a, x) => a + (Number(x) || 0),
                    0
                  );
                  const rounded = Math.round(sum * 100) / 100;
                  setVal(rounded > 0 ? String(rounded) : "");
                  // ⚠️ setTimeout כדי ש-val יתעדכן לפני save().
                  setTimeout(() => save(), 0);
                }}
                placeholder={`ק"ג`}
                className="w-full text-center font-bold text-base md:text-sm rounded py-1.5 md:py-1 border-2 border-zinc-200 focus:border-brand-rust"
              />
            </div>
          ))}
          {/* ⚠️ הסכום מוצג: הנציג רואה מה יישמר בלי לחבר בראש. */}
          {parts.some((p) => p !== "") && (
            <div className="text-[10px] text-center font-bold text-brand-rust">
              סה״כ{" "}
              {Math.round(
                parts.reduce((a, x) => a + (Number(x) || 0), 0) * 100
              ) / 100}
            </div>
          )}
        </div>
      ) : (
      <input
        ref={inputRef}
        id={cellId}
        type="number"
        inputMode="decimal"
        // §268: יחידות שלמות בלבד — אין חצי נקניק.
        step={cell.noWeighing ? 1 : 0.01}
        min={0}
        dir="ltr"
        disabled={readOnly || saving}
        value={val}
        onChange={(e) => setVal(e.target.value)}
        onBlur={save}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            (e.target as HTMLInputElement).blur();
          }
        }}
        // §268: התווית לפי סוג המוצר.
        //
        // ⚠️ "משקל" על נקניק היה מבלבל - הנציג היה מחפש משקולת.
        // הכמות שהוזמנה כרמז: הוא מזין רק אם השתנה.
        placeholder={
          cell.noWeighing
            ? `${cell.orderedQty} יח׳`
            : cell.estimatedWeight
              ? `~${cell.estimatedWeight}`
              : "משקל"
        }
        // ⚠️ תא חסר צועק: אדום מלא + מסגרת עבה + פעימה. משקל שנשכח
        // הוא כסף שלא נגבה, ולכן הוא לא יכול להיראות כמו שדה רגיל.
        // §269: 📱 התאמה למגע.
        //
        // ⚠️ py-2 בנייד ולא py-1: השדה היה ~28px גובה, והנציג
        // עם ידיים רטובות מהבשר מפספס אותו. 40px הוא המינימום
        // המומלץ למגע.
        //
        // ⚠️ text-base (16px) בנייד: אייפון **מזום את כל העמוד**
        // כשנכנסים לשדה עם טקסט קטן מ-16px, והנציג נשאר עם
        // תצוגה מוגדלת שהוא צריך לצבוט חזרה. בכל שדה. בכל לקוח.
        className={`w-full text-center font-bold text-base md:text-sm rounded py-2 md:py-1 border-2 transition-colors ${
          error
            ? "border-red-600 bg-red-100 text-red-800"
            : isMissing
              ? "border-red-500 bg-red-100 text-red-900 placeholder-red-400 animate-pulse"
              : "border-emerald-400 bg-emerald-50 text-emerald-900"
        } ${readOnly ? "opacity-60" : ""}`}
      />
      )}

      {/* הסכום שיצא למוצר הזה */}
      <div
        className={`text-[10px] font-bold leading-none ${
          isMissing ? "text-red-400" : "text-brand-rust"
        }`}
      >
        {saving ? "שומר…" : isMissing ? "—" : fmt(lineTotal)}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// §103: הוי"ו — סימון הנציג שסיים לטפל בלקוח
// ─────────────────────────────────────────────────────────────
// למה זה נחוץ בנוסף למונה המשקלים החסרים: המונה אומר מה **חסר
// למערכת**; הוי"ו אומר מה **הנציג כבר בדק**. בחלוקה עם 100 לקוחות
// הנציג צריך לדעת איפה הוא נמצא, ולא רק אם נשארו שדות ריקים.
//
// אי אפשר לסמן הזמנה עם משקל חסר - השרת חוסם, וכאן הכפתור אפור
// עם הסבר. בלי החסימה הזו הוי"ו היה קישוט.
function CloseOrderCheck({
  orderId,
  orderNumber,
  customerName,
  missing,
  closedAt,
  readOnly,
  onDone,
}: {
  orderId: string;
  orderNumber: number;
  customerName: string;
  missing: number;
  closedAt: string | null;
  readOnly?: boolean;
  onDone: () => void;
}) {
  const [saving, setSaving] = useState(false);
  const closed = !!closedAt;

  async function toggle() {
    if (missing > 0 && !closed) {
      alert(
        `לא ניתן לסמן את ${customerName} כטופל.\n\nחסרים ${missing} משקלים בהזמנה #${orderNumber}.\n\nלקוח שלא קיבל פריט — יש להזין 0.`
      );
      return;
    }
    if (closed && !window.confirm(`לבטל את הסימון של ${customerName}?`)) return;

    setSaving(true);
    try {
      const res = await fetch(`/api/agent/orders/${orderId}/close`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ closed: !closed }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "שגיאה");
      onDone();
    } catch (e: any) {
      alert(e.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={saving || readOnly}
      title={
        closed
          ? `טופל ב-${fmtDateTime(closedAt!)}`
          : missing > 0
            ? `חסרים ${missing} משקלים`
            : "סמן כטופל"
      }
      className={`w-9 h-9 rounded-lg border-2 font-extrabold text-lg transition-colors disabled:opacity-50 ${
        closed
          ? "border-emerald-500 bg-emerald-500 text-white"
          : missing > 0
            ? "border-zinc-300 bg-zinc-100 text-zinc-300 cursor-not-allowed"
            : "border-emerald-400 bg-white text-emerald-500 hover:bg-emerald-50"
      }`}
    >
      {saving ? "…" : "✓"}
    </button>
  );
}

// ─────────────────────────────────────────────────────────────
// §130: סימון תשלום מזומן מתוך הטבלה
// ─────────────────────────────────────────────────────────────
// התרחיש: לקוח רשום כמשלם באשראי, אבל ביום החלוקה הביא מזומן.
// אם הנציג לא מסמן - הכרטיס יחויב בערב והלקוח ישלם פעמיים.
//
// ⚠️ למה כאן ולא רק בכרטיס ההזמנה: הנציג עובד בטבלה. מעבר למסך
// אחר על כל לקוח פשוט לא יקרה בחלוקה, והסימון יישכח.
//
// ⚠️ דורש מחיר סופי, כלומר שכל המשקלים של הלקוח מולאו. סימון
// לפני כן היה נועל סכום שאינו מה שהלקוח חייב.
function CashCell({
  orderId,
  orderNumber,
  customerName,
  paymentStatus,
  finalTotal,
  missing,
  readOnly,
  onDone,
}: {
  orderId: string;
  orderNumber: number;
  customerName: string;
  paymentStatus: string | null;
  finalTotal: number | null;
  missing: number;
  readOnly?: boolean;
  onDone: () => void;
}) {
  const [saving, setSaving] = useState(false);
  const paid = paymentStatus === "PAID" || paymentStatus === "PARTIALLY_PAID";

  if (paid) {
    return (
      <span className="text-[10px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded px-1.5 py-1 block">
        ✓ שולם
      </span>
    );
  }

  const blocked = missing > 0 || finalTotal == null;

  async function markCash() {
    if (blocked) {
      alert(
        missing > 0
          ? `יש להשלים את המשקלים של ${customerName} לפני סימון תשלום.\n\nחסרים ${missing} משקלים.`
          : "יש לקבוע מחיר סופי לפני סימון תשלום."
      );
      return;
    }
    if (
      !window.confirm(
        `${customerName} שילם ${finalTotal} ש"ח במזומן?\n\nההזמנה תסומן כשולמה והכרטיס לא יחויב.`
      )
    )
      return;

    setSaving(true);
    try {
      const res = await fetch(`/api/admin/orders/${orderId}/cash-payment`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          amountPaid: finalTotal,
          note: "שולם במזומן בחלוקה",
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "שגיאה");
      onDone();
    } catch (e: any) {
      alert(e.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <button
      type="button"
      onClick={markCash}
      disabled={saving || readOnly}
      title={
        blocked
          ? "יש להשלים משקלים לפני סימון תשלום"
          : `סמן שקיבלת ${finalTotal} ש"ח במזומן`
      }
      className={`w-full text-[10px] font-bold rounded border-2 py-1 transition-colors disabled:opacity-50 ${
        blocked
          ? "border-zinc-200 bg-zinc-50 text-zinc-300 cursor-not-allowed"
          : "border-amber-400 bg-white text-amber-800 hover:bg-amber-500 hover:text-white"
      }`}
    >
      {saving ? "…" : "💵 מזומן"}
    </button>
  );
}


// ═══════════════════════════════════════════════════════════════
// §322: בורר אמצעי תשלום בשורת הטבלה
// ═══════════════════════════════════════════════════════════════
// הצורך: הלקוח מגיע לחלוקה ואומר "אשלם במזומן" - או להפך. הנציג
// היה צריך לצאת לכרטיס הלקוח, לשנות שם, ולחזור לטבלה.
//
// ⚠️ מוצג רק לנציג עם **שתי** ההרשאות. מי שיכול רק כיוון אחד
// מקבל את הכפתור הישן, שעושה בדיוק את זה.
//
// ⚠️ ומעבר לאשראי דורש כרטיס שמור: בלעדיו הלקוח נשאר בלי אמצעי
// גבייה, ונתקע ברשימת הכשלים.
function PayPrefToggle({
  orderId,
  customerName,
  pref,
  hasCard,
  readOnly,
  onDone,
  onNeedCard,
}: {
  orderId: string;
  customerName: string;
  /** §332: המצב **של ההזמנה** — לא ההעדפה הקבועה של הלקוח */
  pref?: string | null;
  hasCard?: boolean;
  readOnly?: boolean;
  onDone: () => void;
  /** §332: אין כרטיס — פותחים את הטופס במקום להודיע */
  onNeedCard: () => void;
}) {
  const [busy, setBusy] = useState(false);
  // §329: עדכון אופטימי — כמו בסימון המסירה.
  const [localPref, setLocalPref] = useState<string | null>(null);
  const isCash = (localPref ?? pref) === "CASH";

  async function switchTo(next: "CASH" | "CREDIT") {
    if (!orderId || busy) return;

    // ⚠️ מעבר לאשראי בלי כרטיס - חוסמים כאן ולא נותנים לשרת
    // להחזיר שגיאה, כי ההודעה שלו גנרית והנציג בשטח צריך לדעת
    // מה לעשות.
    // §332: 💳 אין כרטיס — פותחים את הטופס במקום להודיע.
    //
    // 🐛 מה שהיה: הודעה "יש להזין מכרטיס הלקוח". הנציג בשטח
    // קרא, יצא למסך אחר, הזין, וחזר — שלושה מסכים לפעולה אחת.
    //
    // ⚠️ והכרטיס נשמר **לתמיד** ללקוח, בניגוד לבחירת המזומן
    // שהיא להזמנה בלבד. זו לא סתירה: כרטיס הוא אמצעי תשלום
    // של הלקוח, ומזומן הוא החלטה על הזמנה.
    if (next === "CREDIT" && !hasCard) {
      onNeedCard();
      return;
    }

    if (
      !window.confirm(
        next === "CASH"
          ? `להעביר את ${customerName} לתשלום במזומן?\n\nהגבייה תתבצע בחלוקה, והחיוב בכרטיס יפסיק.`
          : `להעביר את ${customerName} לתשלום באשראי?\n\nהכרטיס השמור יחויב אוטומטית.`
      )
    )
      return;

    // ⚠️ מיד, לפני הקריאה — הנציג רואה את התוצאה בלי המתנה.
    const prev = localPref ?? pref ?? null;
    setLocalPref(next);
    setBusy(true);
    try {
      // §332: 🎯 **ההזמנה הזו בלבד.**
      //
      // 🐛 הבורר שינה את paymentPreference של הלקוח — לתמיד.
      // לקוח שביקש מזומן פעם אחת נשאר מזומן גם בשבוע הבא,
      // והכרטיס שלו הפסיק להיות מחויב.
      const res = await fetch(`/api/agent/orders/${orderId}/payment-method`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paymentMethod: next }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || "השינוי נכשל");
      // ⚠️ אין onDone(): השינוי מוצג, ואין צורך לטעון 244
      // הזמנות בשביל תא אחד.
    } catch (e: any) {
      setLocalPref(prev);
      alert(e?.message || "שגיאה");
    } finally {
      setBusy(false);
    }
  }

  if (readOnly || !orderId) {
    return (
      <span className="text-[10px] font-bold text-zinc-500">
        {isCash ? "💵" : "💳"}
      </span>
    );
  }

  // ⚠️ שני כפתורים ולא select: בנייד עם ידיים רטובות, שטח מגע
  // גדול הוא ההבדל בין בחירה נכונה לטעות. ו-select דורש שתי
  // פעולות - פתיחה ובחירה.
  return (
    <div className="inline-flex rounded-lg overflow-hidden border border-zinc-300">
      <button
        onClick={() => switchTo("CASH")}
        disabled={busy || isCash}
        className={`px-1.5 py-1 text-[11px] font-bold transition-colors ${
          isCash
            ? "bg-amber-500 text-white"
            : "bg-white text-zinc-400 hover:bg-amber-50"
        }`}
        title="מזומן"
      >
        💵
      </button>
      <button
        onClick={() => switchTo("CREDIT")}
        disabled={busy || !isCash}
        className={`px-1.5 py-1 text-[11px] font-bold transition-colors border-r border-zinc-300 ${
          !isCash
            ? "bg-emerald-600 text-white"
            : "bg-white text-zinc-400 hover:bg-emerald-50"
        }`}
        title={hasCard ? "אשראי" : "אשראי — נדרש כרטיס"}
      >
        💳
      </button>
    </div>
  );
}


// ═══════════════════════════════════════════════════════════════
// §323: סימון מסירה מתוך הטבלה
// ═══════════════════════════════════════════════════════════════
// 🐛 הפעולה הייתה קיימת **רק בכרטיסים**. הנציג שעובד בטבלה -
// ורובם עובדים בטבלה בחלוקה - לא סימן מסירה כלל, והמונה
// "0 מתוך 34 נמסרו" נשאר אפס לאורך כל היום.
//
// ⚠️ הכלל: פעולה שקיימת בתצוגה אחת חייבת להיות בשנייה. מי
// שבוחר תצוגה לא אמור לוותר על יכולת.
//
// ⚠️ ושני סימונים שונים: "טופל" = סיימתי לשקול. "נמסר" = הלקוח
// הגיע ולקח. הזמנה יכולה להיות שקולה ולא נמסרה, ולהפך.
function DeliverCell({
  orderId,
  customerName,
  deliveredAt,
  readOnly,
  onDone,
}: {
  orderId: string;
  customerName: string;
  deliveredAt?: string | null;
  readOnly?: boolean;
  onDone: () => void;
}) {
  const [busy, setBusy] = useState(false);

  // §329: 🐌 **עדכון אופטימי במקום טעינה מלאה.**
  //
  // onDone() שולף 244 הזמנות ו-758 פריטים ממסד באירלנד - 2-3
  // שניות. הנציג לחץ "נמסר", והמסך נתקע.
  //
  // ⚠️ וזו אותה בעיה של §299 (הזנת משקל): פעולה נקודתית שגררה
  // רענון של הכל.
  //
  // ⚠️ המצב המקומי גובר: המשתמש רואה את התוצאה מיד, והשרת
  // מתעדכן ברקע. אם השמירה נכשלת - חוזרים אחורה.
  const [localDelivered, setLocalDelivered] = useState<boolean | null>(null);
  const delivered = localDelivered ?? !!deliveredAt;

  async function toggle() {
    // ⚠️ אישור רק בביטול: סימון מסירה הוא הפעולה השכיחה ביום
    // חלוקה, ואישור על כל לקוח מאמן ללחוץ בלי לקרוא.
    if (
      delivered &&
      !window.confirm(`לבטל את סימון המסירה של ${customerName}?`)
    )
      return;

    // ⚠️ מעדכנים **לפני** הקריאה: המסך מגיב מיד, וההמתנה
    // לשרת קורית ברקע.
    const next = !delivered;
    setLocalDelivered(next);
    setBusy(true);
    try {
      const res = await fetch(`/api/agent/orders/${orderId}/deliver`, {
        // §328: 🐛 PATCH ולא POST.
        //
        // ה-route מוגדר כ-PATCH (§21), ו-POST החזיר 405 עם גוף
        // ריק - ומכאן "Unexpected end of JSON input" במסך.
        //
        // ⚠️ העתקתי את הקריאה מ-OrderRow בלי לבדוק את השיטה.
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ delivered: !delivered }),
      });
      // ⚠️ catch על ה-json: תשובת 405 או 500 מגיעה בלי גוף,
      // ו-res.json() נופל עם "Unexpected end of JSON input" -
      // שגיאה שלא אומרת למשתמש כלום.
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || `שגיאה (${res.status})`);
      // ⚠️ אין onDone(): הסימון כבר מוצג, והמונה למעלה יתעדכן
      // ברענון הבא. טעינת 244 הזמנות עבור תא אחד היא בזבוז.
    } catch (e: any) {
      // ⚠️ חזרה אחורה: המשתמש ראה סימון שלא נשמר, וזה גרוע
      // יותר מהמתנה.
      setLocalDelivered(!next);
      alert(e?.message || "שגיאה");
    } finally {
      setBusy(false);
    }
  }

  if (readOnly) {
    return (
      <span className={delivered ? "text-emerald-600" : "text-zinc-300"}>
        {delivered ? "✓" : "—"}
      </span>
    );
  }

  return (
    <button
      onClick={toggle}
      disabled={busy}
      title={delivered ? "בטל סימון מסירה" : "סמן שנמסר ללקוח"}
      className={`w-7 h-7 rounded-lg font-bold text-sm transition-colors disabled:opacity-40 ${
        delivered
          ? "bg-emerald-600 text-white"
          : "bg-white border-2 border-zinc-300 text-zinc-300 hover:border-emerald-400"
      }`}
    >
      {busy ? "·" : delivered ? "✓" : "📦"}
    </button>
  );
}
