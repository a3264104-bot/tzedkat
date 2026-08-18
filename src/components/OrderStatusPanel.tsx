"use client";

// §47: פאנל מצב ההזמנה - מחליף את שורת הכפתורים שהייתה.
//
// הבעיה שנפתרת:
//   1. כל הסטטוסים הוצגו ככפתורים שווי-ערך, והמנהל היה צריך לפענח
//      מתוך חמישה מה הצעד הנכון עכשיו.
//   2. deliveredAt (סימון מסירה) לא הופיע כאן כלל - רק הנציג יכול היה
//      לסמן, והמנהל לא ראה אם נמסר.
//   3. סימון מסירה לא שינה את status, ולכן הדשבורד המשיך לדרוש
//      "סמן מוכן לחלוקה" גם אחרי שההזמנה כבר נמסרה ללקוח.
//
// הפתרון: ציר התקדמות שמראה איפה ההזמנה עומדת, ו*פעולה אחת* בולטת -
// הצעד הבא בלבד. שאר האפשרויות זמינות אך לא צועקות.

import { useState } from "react";

type Props = {
  order: any;
  saving: boolean;
  onSetStatus: (status: string) => void;
  onMarkDelivered: () => void;
  onUndoDelivered: () => void;
  onCancel: () => void;
};

type Step = {
  key: string;
  label: string;
  done: boolean;
  blocked?: string;
};

export function OrderStatusPanel({
  order,
  saving,
  onSetStatus,
  onMarkDelivered,
  onUndoDelivered,
  onCancel,
}: Props) {
  const [showAll, setShowAll] = useState(false);

  const isCancelled = order.status === "CANCELLED";
  const isPaid = order.paymentStatus === "PAID";
  const hasFinalTotal = order.finalTotal !== null && order.finalTotal !== undefined;
  const isDelivered = !!order.deliveredAt;
  const isReady = order.status === "READY_FOR_PICKUP" || order.status === "COMPLETED";

  // ציר ההתקדמות. deliveredAt הוא מקור האמת למסירה - לא status,
  // כי הוא העובדה בשטח (הלקוח לקח) ולא סימון ידני.
  const steps: Step[] = [
    { key: "weighed", label: "נשקלה", done: hasFinalTotal },
    {
      key: "paid",
      label: "שולמה",
      done: isPaid,
      blocked: !hasFinalTotal ? "יש לקבוע מחיר סופי תחילה" : undefined,
    },
    {
      key: "ready",
      label: "מוכנה לחלוקה",
      done: isReady || isDelivered,
      blocked: !isPaid ? "יש להשלים תשלום תחילה" : undefined,
    },
    {
      key: "delivered",
      label: "נמסרה ללקוח",
      done: isDelivered,
      // §112: 🐛 כאן היה הבאג. זה היה השלב היחיד **בלי** blocked,
      // ולכן בתצוגה הוא נפל לענף "לא הושלם ולא חסום" = צהוב מודגש.
      // התוצאה: הזמנה חדשה לגמרי הציגה את שלב 1 ואת שלב 4 מודגשים
      // בו-זמנית, כאילו היא גם נשקלה וגם נמסרה.
      blocked: !isReady ? "יש לסמן כמוכנה לחלוקה תחילה" : undefined,
    },
  ];

  // הצעד הבא: הראשון שלא הושלם ואינו חסום
  const next = steps.find((s) => !s.done && !s.blocked);
  const blockedNext = steps.find((s) => !s.done && s.blocked);

  // §112: השלב הנוכחי מחושב לפי **מיקום** ולא לפי blocked.
  //
  // הצבע נגזר קודם מ-done/blocked בלבד, וכל שלב ששכחו לתת לו
  // blocked הודגש בטעות. עכשיו הכלל מפורש ואינו תלוי בכך שכל
  // שלב עתידי יזכור להגדיר חסימה: מודגש **רק** השלב הראשון
  // שטרם הושלם, וכל מה שאחריו אפור.
  const currentIndex = steps.findIndex((s) => !s.done);

  if (isCancelled) {
    return (
      <div className="card p-4 border-zinc-300 bg-zinc-50 no-print">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <p className="font-bold text-zinc-700">ההזמנה בוטלה</p>
            {order.internalNotes && (
              <p className="text-xs text-zinc-500 mt-0.5">{order.internalNotes}</p>
            )}
          </div>
          <button
            onClick={() => onSetStatus("PENDING_REVIEW")}
            disabled={saving}
            className="btn-ghost btn-sm"
          >
            שחזר הזמנה
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="card p-5 no-print space-y-4">
      {/* ציר ההתקדמות */}
      <div>
        <p className="text-xs font-bold text-zinc-500 mb-2">מצב ההזמנה</p>
        <div className="flex items-center gap-1">
          {steps.map((s, i) => (
            <div key={s.key} className="flex items-center flex-1 min-w-0">
              <div className="flex flex-col items-center flex-1 min-w-0">
                <div
                  className={`w-7 h-7 rounded-full grid place-items-center text-xs font-bold shrink-0 ${
                    s.done
                      ? "bg-emerald-500 text-white"
                      : i === currentIndex
                        ? // §112: מודגש רק השלב הנוכחי - אחד בלבד
                          "bg-amber-100 text-amber-700 ring-2 ring-amber-400"
                        : "bg-zinc-200 text-zinc-400"
                  }`}
                >
                  {s.done ? "✓" : i + 1}
                </div>
                <span
                  className={`text-[10px] mt-1 text-center truncate w-full ${
                    s.done
                      ? "text-emerald-700 font-bold"
                      : i === currentIndex
                        ? "text-amber-800 font-bold"
                        : "text-zinc-400"
                  }`}
                >
                  {s.label}
                </span>
              </div>
              {i < steps.length - 1 && (
                <div
                  className={`h-0.5 flex-1 -mt-4 ${
                    steps[i + 1].done ? "bg-emerald-400" : "bg-zinc-200"
                  }`}
                />
              )}
            </div>
          ))}
        </div>
      </div>

      {/* הפעולה הבאה - אחת בלבד, בולטת */}
      {isDelivered ? (
        <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-3 flex items-center justify-between gap-3 flex-wrap">
          <div>
            <p className="font-bold text-emerald-800 text-sm">ההזמנה נמסרה ללקוח ✓</p>
            <p className="text-xs text-emerald-700 mt-0.5">
              {new Date(order.deliveredAt).toLocaleString("he-IL")}
              {order.deliveredNote && ` · ${order.deliveredNote}`}
            </p>
          </div>
          <button onClick={onUndoDelivered} disabled={saving} className="btn-ghost btn-sm">
            בטל סימון מסירה
          </button>
        </div>
      ) : next ? (
        <div>
          <p className="text-xs text-zinc-500 mb-1.5">הצעד הבא</p>
          {next.key === "weighed" && (
            <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-3">
              יש להזין משקלים בטבלה למטה וללחוץ "שמירת שינויים" כדי לקבוע מחיר סופי.
            </p>
          )}
          {next.key === "paid" && (
            <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-3">
              יש להשלים את התשלום — בפאנל התשלום למטה.
            </p>
          )}
          {next.key === "ready" && (
            <button
              onClick={() => onSetStatus("READY_FOR_PICKUP")}
              disabled={saving}
              className="w-full py-3 rounded-xl bg-emerald-600 text-white font-bold hover:bg-emerald-700 shadow-sm disabled:opacity-50"
            >
              📦 סמן כמוכנה לחלוקה
            </button>
          )}
          {next.key === "delivered" && (
            <button
              onClick={onMarkDelivered}
              disabled={saving}
              className="w-full py-3 rounded-xl bg-emerald-600 text-white font-bold hover:bg-emerald-700 shadow-sm disabled:opacity-50"
            >
              ✓ סמן שנמסרה ללקוח
            </button>
          )}
        </div>
      ) : blockedNext ? (
        <p className="text-sm text-zinc-500 bg-zinc-50 border border-zinc-200 rounded-lg p-3">
          {blockedNext.blocked}
        </p>
      ) : null}

      {/* פעולות נוספות - מוסתרות עד שמבקשים */}
      <div className="pt-2 border-t border-zinc-100">
        <button
          onClick={() => setShowAll((v) => !v)}
          className="text-xs text-zinc-500 hover:text-brand-slatedark"
        >
          {showAll ? "הסתר" : "פעולות נוספות"} {showAll ? "▲" : "▼"}
        </button>

        {showAll && (
          <div className="mt-3 space-y-2">
            {/* סימון מסירה גם כשזה לא הצעד הבא - למקרה שהמנהל
                מסמן בדיעבד הזמנה שלא סומנה כמוכנה */}
            {!isDelivered && (
              <button
                onClick={onMarkDelivered}
                disabled={saving}
                className="btn-ghost btn-sm w-full"
              >
                ✓ סמן שנמסרה ללקוח
              </button>
            )}
            {isReady && !isDelivered && (
              <button
                onClick={() => onSetStatus("PENDING_REVIEW")}
                disabled={saving}
                className="btn-ghost btn-sm w-full"
              >
                בטל סימון "מוכנה לחלוקה"
              </button>
            )}

            {/* ביטול הזמנה. מוצג באדום ובנפרד כי זו פעולה הרסנית,
                ומכיל אזהרה מפורשת אם ההזמנה כבר חויבה. */}
            <button
              onClick={onCancel}
              disabled={saving}
              className="w-full py-2 rounded-lg border border-red-300 text-red-700 text-sm font-bold hover:bg-red-50 disabled:opacity-50"
            >
              ✗ בטל את ההזמנה
            </button>
            {isPaid && (
              <p className="text-[11px] text-red-700">
                ⚠️ ההזמנה כבר שולמה. ביטול לא מבצע החזר כספי אוטומטי — יש
                לטפל בהחזר מול נדרים בנפרד.
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
