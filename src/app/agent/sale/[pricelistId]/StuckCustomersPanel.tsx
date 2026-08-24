"use client";

// ═══════════════════════════════════════════════════════════════
// §211: לקוחות שתקועים בלי אמצעי תשלום
// ═══════════════════════════════════════════════════════════════
// 🐛 המצב מהשטח: לקוח מוגדר CREDIT אבל אין לו paymentToken.
// זה קורה כשנציג מסמן אותו כמזומן, ואז מחזיר לאשראי בלי להזין
// כרטיס - או כשלקוח נרשם ב-IVR ולא הושלם לו כרטיס.
//
// התוצאה: הוא **חסום בכל ערוץ** - אתר, טלפון, אקסל, ונציג. הוא
// לא יכול להזמין, ואף אחד לא יודע שהוא תקוע עד שהוא מתקשר לשאול.
//
// ⚠️ התיבה כאן ולא במסך נפרד: הנציג נמצא במסך המכירה רוב היום,
// וזה המקום היחיד שבו הוא באמת יראה את זה. מסך "לקוחות תקועים"
// שצריך לזכור להיכנס אליו לא ייפתח אף פעם.

import { useMemo, useState } from "react";
import { UpdateCardModal } from "@/components/UpdateCardButton";

export type StuckCustomer = {
  id: string;
  name: string;
  phone: string | null;
  orderNumber: number;
  orderId: string;
};

export function StuckCustomersPanel({
  orders,
  canUpdateCards,
  onFixed,
}: {
  orders: any[];
  /** §155/§211: הרשאת עדכון כרטיסים. בלעדיה מוצג הסבר בלבד. */
  canUpdateCards: boolean;
  onFixed?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [cardFor, setCardFor] = useState<StuckCustomer | null>(null);

  // ⚠️ CREDIT **ובלי** טוקן. לקוח מזומן תקין לגמרי ואינו כאן,
  // ולקוח עם כרטיס - גם.
  const stuck: StuckCustomer[] = useMemo(() => {
    const seen = new Set<string>();
    const out: StuckCustomer[] = [];
    // §246: 🐛 קריסה כש-orders אינו מערך.
    //
    // הרכיב נוסף היום (§211) לראש מסך המכירה. אם data.orders
    // מגיע undefined - טעינה חלקית, שגיאת רשת, session שפג -
    // `for...of` זורק, **וכל המסך נופל**: הנציג לא רואה טבלה,
    // לא יכול להזין משקלים, ולא מבין למה.
    //
    // ⚠️ רכיב שיושב בראש מסך קריטי חייב להיות עמיד: עדיף
    // שהתיבה לא תופיע מאשר שתפיל את מה שמתחתיה.
    if (!Array.isArray(orders)) return [];

    for (const o of orders) {
      const c = o.customer;
      if (!c) continue;
      if (c.paymentPreference === "CASH") continue;
      if (c.paymentToken) continue;
      if (seen.has(c.id)) continue;
      seen.add(c.id);
      out.push({
        id: c.id,
        name: c.name,
        phone: c.phone ?? null,
        orderNumber: o.orderNumber,
        orderId: o.id,
      });
    }
    return out;
  }, [orders]);

  if (stuck.length === 0) return null;

  return (
    <>
      <div className="rounded-xl border-2 border-red-400 bg-red-50 overflow-hidden mb-3">
        <button
          onClick={() => setOpen((v) => !v)}
          className="w-full px-4 py-3 flex items-center justify-between gap-3 text-right"
        >
          <div className="flex items-center gap-2.5 min-w-0">
            <span className="text-xl shrink-0">💳</span>
            <div className="min-w-0">
              <div className="font-extrabold text-red-900 text-sm">
                {stuck.length} לקוחות ללא אמצעי תשלום
              </div>
              {/* ⚠️ ההסבר קונקרטי: "בעיה בכרטיס" לא אומר לנציג מה
                  לעשות. "לא יוכלו לשלם בחלוקה" אומר. */}
              <div className="text-[11px] text-red-800 mt-0.5">
                מוגדרים כאשראי אך אין להם כרטיס שמור — לא ניתן לחייב אותם
              </div>
            </div>
          </div>
          <svg
            className={`w-5 h-5 text-red-400 shrink-0 transition-transform ${
              open ? "rotate-180" : ""
            }`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </button>

        {open && (
          <div className="border-t border-red-200 divide-y divide-red-100">
            {stuck.map((c) => (
              <div
                key={c.id}
                className="px-4 py-2.5 flex items-center justify-between gap-2 flex-wrap"
              >
                <div className="min-w-0">
                  <div className="font-bold text-brand-slatedark text-sm">
                    {c.name}
                  </div>
                  <div className="text-[11px] text-zinc-500" dir="ltr">
                    {c.phone} · #{c.orderNumber}
                  </div>
                </div>
                <div className="flex gap-1.5 shrink-0">
                  {c.phone && (
                    <a
                      href={`tel:${c.phone}`}
                      className="px-2.5 py-1.5 rounded-lg border-2 border-zinc-300 text-xs font-bold"
                    >
                      📞
                    </a>
                  )}
                  {/* §211: שתי דרכים לפתור, ושתיהן במקום.
                      
                      ⚠️ הכרטיס דורש הרשאה; המזומן דורש הרשאה
                      אחרת (§155). מי שאין לו אף אחת רואה הסבר
                      ולא כפתור מת. */}
                  {canUpdateCards ? (
                    <button
                      onClick={() => setCardFor(c)}
                      className="px-3 py-1.5 rounded-lg bg-blue-600 text-white text-xs font-bold"
                    >
                      💳 הזן כרטיס
                    </button>
                  ) : (
                    <a
                      href={`/agent/customer/${c.id}`}
                      className="px-3 py-1.5 rounded-lg border-2 border-blue-400 text-blue-700 text-xs font-bold"
                    >
                      כרטיס הלקוח ←
                    </a>
                  )}
                </div>
              </div>
            ))}
            <p className="px-4 py-2 text-[11px] text-red-800 bg-red-100/50 leading-relaxed">
              ⚠️ עד שיוזן כרטיס או שהלקוח יסומן כמשלם מזומן — לא ניתן לחייב
              אותו, והוא לא יוכל להזמין במכירה הבאה.
            </p>
          </div>
        )}
      </div>

      {/* ⚠️ onSuccess מרענן: אחרי שהכרטיס נשמר הלקוח צריך להיעלם
          מהרשימה, אחרת הנציג ינסה שוב. */}
      {cardFor && (
        <UpdateCardModal
          customerId={cardFor.id}
          hasCurrentCard={false}
          onSuccess={() => {
            setCardFor(null);
            onFixed?.();
          }}
          onClose={() => setCardFor(null)}
        />
      )}
    </>
  );
}
