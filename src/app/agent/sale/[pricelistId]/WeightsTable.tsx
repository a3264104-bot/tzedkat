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
  onItemUpdate: (orderId: string, itemId: string, updates: Partial<OrderItem>) => void;
  onNeedsReload: () => void;
  /** §81: דיווח על מספר המשקלים החסרים - לחסימת סגירת המכירה */
  onMissingCountChange?: (count: number) => void;
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
  finalTotal: number | null;
};

export function WeightsTable({
  orders,
  availableProducts,
  readOnly,
  onItemUpdate,
  onNeedsReload,
  onMissingCountChange,
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
            if (noWeighing) total += it.quantity * it.unitPrice;
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
        if (!cell.noWeighing && cell.agentEnteredWeight === null) {
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
              <th className="sticky right-0 z-10 bg-zinc-100 text-right px-3 py-2 min-w-[140px] border-l-2 border-zinc-300 text-[11px] font-bold text-zinc-600">
                שם הלקוח
              </th>
              {/* §141: כותרות גנריות - שם המוצר יושב בתא עצמו.
                  כך אין עמודה ריקה ללקוח שלא הזמין את המוצר. */}
              {Array.from({ length: maxItems }, (_, i) => (
                <th
                  key={i}
                  className="px-2 py-2 min-w-[110px] border-l border-zinc-200 text-[10px] font-bold text-zinc-500"
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
                            readOnly={readOnly}
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
                                  readOnly={readOnly}
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

                <td className="px-2 py-2 border-l border-zinc-200 text-center">
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
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setVal(cell.agentEnteredWeight !== null ? String(cell.agentEnteredWeight) : "");
  }, [cell.agentEnteredWeight]);

  // null ולא 0: "לא מולא" ו"מולא 0" הם שני מצבים שונים לגמרי, וזו
  // כל ההבחנה שמאפשרת לחסום סגירת מכירה על שכחה.
  // §137: מוצר יחידה - אין מה לשקול, ולכן אין "חסר".
  const isMissing = !cell.noWeighing && cell.agentEnteredWeight === null;
  const lineTotal =
    cell.agentEnteredWeight !== null ? cell.agentEnteredWeight * cell.unitPrice : 0;

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
        onNeedsReload();
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
      <div
        className="text-[10px] font-bold text-brand-slatedark leading-tight truncate"
        title={cell.productName}
      >
        {cell.productName}
      </div>
      <div className="text-[9px] text-zinc-500 leading-none">{cell.ordered}</div>

      {/* §137: מוצר שנמכר ביחידות - המשקל ידוע מהאריזה, ואין
          שדה למלא. הצגת שדה ריק הייתה גורמת לנציג לחפש משקולת
          למשהו שכתוב עליו 500 גרם. */}
      {cell.noWeighing ? (
        <div className="w-full text-center text-[10px] text-zinc-500 bg-zinc-50 border border-zinc-200 rounded py-1">
          יחידות · לא נשקל
        </div>
      ) : (
      <input
        ref={inputRef}
        id={cellId}
        type="number"
        inputMode="decimal"
        step="0.01"
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
        placeholder={cell.estimatedWeight ? `~${cell.estimatedWeight}` : "משקל"}
        // ⚠️ תא חסר צועק: אדום מלא + מסגרת עבה + פעימה. משקל שנשכח
        // הוא כסף שלא נגבה, ולכן הוא לא יכול להיראות כמו שדה רגיל.
        className={`w-full text-center font-bold text-sm rounded py-1 border-2 transition-colors ${
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
