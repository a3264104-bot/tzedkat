"use client";

import { useState } from "react";
// §200: תאריכים בשעון ישראל — השרת רץ ב-UTC
import { fmtDate } from "@/lib/date-lib";
import Link from "next/link";
import { STATUS_LABELS, fmt } from "@/lib/pricing";
import { formatItemQty } from "@/lib/order-display";
import { UpdateCardModal } from "@/components/UpdateCardButton";
// §263: רישום חוב ללקוח — אותו רכיב של המנהל
import { DebtPanel } from "@/components/DebtPanel";
import { AddOrderItem, type AddableProduct } from "@/components/AddOrderItem";

type Item = {
  id: string;
  productName: string;
  unit: string;
  // §128: נדרש לתצוגת יחידות נכונה. בלעדיו formatItemQty מניח
  // שהכל קרטונים, וזה בדיוק הבאג שחזר.
  isSingle: boolean;
  quantity: number;
  estimatedPrice: number;
  estimatedWeight: number | null;
  actualWeight: number | null;
  finalWeight: number | null;
  finalPrice: number | null;
  unitPrice: number;
};
type Order = {
  id: string;
  // §67: נדרש כדי להציג הוספת מוצר רק בהזמנות של המכירה הפעילה
  pricelistId: string | null;
  orderNumber: number;
  status: string;
  paymentStatus: string;
  pointName: string;
  createdAt: string;
  estimatedTotal: number;
  finalTotal: number | null;
  items: Item[];
};

export function AgentCustomerClient({
  customerId,
  customerName,
  customerPhone,
  debtBalance = 0,
  debtNote,
  paymentPreference: initialPref,
  hasCard: initialHasCard,
  cardLast4: initialCardLast4,
  canUpdateCards,
  canSetCash = false,
  orders: initialOrders,
  canSetFinalPrice,
  canSendPaymentLink,
  activePricelistId,
  activeSales = [],
  singleSurcharge,
  availableProducts,
}: {
  customerId: string;
  customerName: string;
  customerPhone: string | null;
  /**
   * §263: חוב מהעבר.
   *
   * ⚠️ הנציג בשטח הוא זה שיודע מי חייב מה מהמכירה הקודמת, והוא
   * זה שהלקוח מדבר איתו. רישום שרק המנהל יכול לעשות היה אומר
   * שיחת טלפון על כל חוב.
   */
  debtBalance?: number;
  debtNote?: string | null;
  // §60: מצב התשלום של הלקוח
  paymentPreference: string;
  hasCard: boolean;
  cardLast4: string | null;
  canUpdateCards: boolean;
  /**
   * §288: הרשאה **נפרדת** להעברה למזומן.
   *
   * הבעיה: הכפתור היה מותנה ב-canUpdateCards - אותה הרשאה של
   * עדכון כרטיס אשראי. נציג שהוקם עם הרשאת מזומן בלבד
   * (agentCanCreateCashCustomers) הקים לקוח מזדמן, ואז לא
   * יכול היה להעביר אותו למזומן.
   *
   * §212 כבר יצר את ההפרדה הזו ב-AgentPaymentGate, והמסך הזה
   * פשוט לא עודכן.
   */
  canSetCash?: boolean;
  orders: Order[];
  canSetFinalPrice: boolean;
  canSendPaymentLink: boolean;
  // §67: הוספת מוצר להזמנה ישירות מכרטיס הלקוח
  activePricelistId: string | null;
  /** §111: כל המכירות הפעילות - כולל "לנציגים בלבד" */
  activeSales?: {
    id: string;
    name: string;
    agentOnly: boolean;
    deliveryDateText: string | null;
  }[];
  singleSurcharge: number;
  availableProducts: AddableProduct[];
}) {
  const [orders, setOrders] = useState(initialOrders);
  // §111: בורר המכירה לפתיחת הזמנה חדשה
  const [salePickerOpen, setSalePickerOpen] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  // משקלים בעריכה: { [itemId]: value }
  const [weights, setWeights] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");
  // §60: מצב התשלום - מתעדכן מקומית אחרי החלפה
  const [pref, setPref] = useState(initialPref);
  const [hasCard, setHasCard] = useState(initialHasCard);
  const [cardLast4, setCardLast4] = useState(initialCardLast4);
  const [showCardModal, setShowCardModal] = useState(false);
  const [prefSaving, setPrefSaving] = useState(false);
  const [prefMsg, setPrefMsg] = useState("");
  const [prefErr, setPrefErr] = useState("");

  // §60: מעבר לאשראי -> דרך הזנת כרטיס (save-token מציב CREDIT).
  // אם כבר יש כרטיס שמור, מספיק לקרוא ל-route ההחלפה.
  async function switchToCredit() {
    setPrefErr("");
    setPrefMsg("");
    if (!hasCard) {
      // אין כרטיס - פותחים את מסך ההזנה. save-token יעשה את ההחלפה.
      setShowCardModal(true);
      return;
    }
    setPrefSaving(true);
    try {
      const res = await fetch("/api/agent/customer-payment-pref", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ customerId, preference: "CREDIT" }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (data.needsCard) {
          setShowCardModal(true);
          return;
        }
        throw new Error(data.error || "שגיאה");
      }
      setPref("CREDIT");
      setPrefMsg("הלקוח הועבר לתשלום באשראי");
    } catch (e: any) {
      setPrefErr(e.message);
    } finally {
      setPrefSaving(false);
    }
  }

  // §60: מעבר למזומן. הטוקן לא נמחק - רק אופן הגבייה משתנה, וכך
  // חזרה לאשראי לא תדרוש הזנת כרטיס מחדש.
  async function switchToCash() {
    setPrefErr("");
    setPrefMsg("");
    if (
      !window.confirm(
        `להעביר את ${customerName} לתשלום במזומן?\nהגבייה תתבצע במזומן בחלוקה, והחיוב האוטומטי בכרטיס יפסיק.`
      )
    ) {
      return;
    }
    setPrefSaving(true);
    try {
      const res = await fetch("/api/agent/customer-payment-pref", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ customerId, preference: "CASH" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "שגיאה");
      setPref("CASH");
      setPrefMsg("הלקוח הועבר לתשלום במזומן");
    } catch (e: any) {
      setPrefErr(e.message);
    } finally {
      setPrefSaving(false);
    }
  }

  function setWeight(itemId: string, value: string) {
    setWeights((w) => ({ ...w, [itemId]: value }));
  }

  async function saveOrder(order: Order, setFinal: boolean) {
    setSaving(true);
    setMsg("");
    try {
      const items = order.items.map((it) => ({
        id: it.id,
        actualWeight: weights[it.id] ?? (it.actualWeight != null ? String(it.actualWeight) : ""),
      }));
      const res = await fetch(`/api/agent/orders/${order.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items, setFinalPrice: setFinal }),
      });
      const data = await res.json();
      if (!res.ok) {
        setMsg(data.error || "שגיאה");
        return;
      }
      // עדכון מקומי
      setOrders((prev) =>
        prev.map((o) =>
          o.id === order.id
            ? {
                ...o,
                status: data.status ?? o.status,
                paymentStatus: data.paymentStatus ?? o.paymentStatus,
                finalTotal: data.finalTotal != null ? Number(data.finalTotal) : o.finalTotal,
                items: data.items
                  ? data.items.map((it: any) => ({
                      id: it.id,
                      productName: it.productName,
                      unit: it.unit,
                      quantity: Number(it.quantity),
                      estimatedPrice: Number(it.estimatedPrice),
                      actualWeight: it.actualWeight != null ? Number(it.actualWeight) : null,
                      finalWeight: it.finalWeight != null ? Number(it.finalWeight) : null,
                      finalPrice: it.finalPrice != null ? Number(it.finalPrice) : null,
                      unitPrice: Number(it.unitPrice),
                    }))
                  : o.items,
              }
            : o
        )
      );
      setMsg(
        setFinal
          ? // §60: ללקוח מזומן לא נשלח לינק - ההודעה מכוונת לגבייה בשטח
            data._isCashCustomer
            ? "המחיר הסופי נקבע. 💵 לגבות במזומן בעת החלוקה."
            : canSendPaymentLink
              ? "המחיר הסופי נקבע ולינק התשלום נשלח ללקוח"
              : "המחיר הסופי נקבע. שליחת לינק התשלום תתבצע ע\"י המנהל."
          : "המשקלים נשמרו"
      );
    } catch {
      setMsg("שגיאת שרת");
    } finally {
      setSaving(false);
    }
  }

  return (
    <main dir="rtl" className="min-h-screen bg-[#faf6ec] pb-16">
      <header className="bg-brand-slatedark text-white">
        <div className="mx-auto max-w-lg px-4 py-3 flex items-center justify-between">
          <Link href="/agent" className="text-sm text-zinc-300">
            ← חזרה
          </Link>
          <div className="text-center">
            <div className="font-extrabold text-brand-yellow">{customerName}</div>
            {customerPhone && <div className="text-xs text-zinc-400">{customerPhone}</div>}
          </div>
          {/* §67: 🐛 כאן היה Link ריק ומוסתר (`invisible` עם href ריק) -
              שריד שלא הוביל לשום מקום. הוחלף בפעולה האמיתית שחסרה:
              פתיחת הזמנה חדשה ללקוח ישירות מכרטיסו, בלי לחזור לחיפוש. */}
          {/* §111: כשיש יותר ממכירה פעילה אחת, הכפתור נפתח לבורר.
              עם מכירה אחת - התנהגות זהה לקודם, בלי שלב מיותר. */}
          {activeSales.length > 1 ? (
            <button
              type="button"
              onClick={() => setSalePickerOpen(true)}
              className="shrink-0 text-xs font-bold bg-brand-yellow text-brand-slatedark px-3 py-1.5 rounded-lg hover:opacity-90"
            >
              🛒 הזמנה חדשה
            </button>
          ) : (
            <Link
              href={`/agent/order/${customerId}`}
              className="shrink-0 text-xs font-bold bg-brand-yellow text-brand-slatedark px-3 py-1.5 rounded-lg hover:opacity-90"
            >
              🛒 הזמנה חדשה
            </Link>
          )}
        </div>
      </header>

      <div className="mx-auto max-w-lg px-4 pt-5 space-y-3">
        {/* §60: מצב התשלום של הלקוח + החלפה מזומן/אשראי */}
        <div className="card p-4">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-3">
              <div
                className={`w-10 h-10 rounded-xl flex items-center justify-center text-xl shrink-0 ${
                  pref === "CASH" ? "bg-lime-100" : "bg-blue-50"
                }`}
              >
                {pref === "CASH" ? "💵" : "💳"}
              </div>
              <div>
                <div className="text-xs text-zinc-500">אופן תשלום</div>
                <div className="font-bold text-brand-slatedark text-sm">
                  {pref === "CASH" ? "מזומן בחלוקה" : "אשראי"}
                  {pref !== "CASH" && hasCard && cardLast4 && (
                    <span className="text-xs text-zinc-400 font-normal mr-1.5" dir="ltr">
                      ****{cardLast4}
                    </span>
                  )}
                  {pref !== "CASH" && !hasCard && (
                    <span className="text-[10px] bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded font-bold mr-1.5">
                      אין כרטיס שמור
                    </span>
                  )}
                </div>
              </div>
            </div>
            {/* §288: כל כיוון לפי ההרשאה שלו.
                
                מזומן ← אשראי  דורש canUpdateCards (הוא יזין כרטיס)
                אשראי ← מזומן  דורש canSetCash */}
            {(pref === "CASH" ? canUpdateCards : canSetCash) && (
              <button
                onClick={pref === "CASH" ? switchToCredit : switchToCash}
                disabled={prefSaving}
                className="text-xs font-bold text-brand-rust border border-brand-rust rounded-lg px-3 py-1.5 hover:bg-brand-rust hover:text-white transition-colors disabled:opacity-50"
              >
                {prefSaving
                  ? "מעדכן..."
                  : pref === "CASH"
                    ? "💳 העבר לאשראי"
                    : "💵 העבר למזומן"}
              </button>
            )}
          </div>
          {/* §263: 💸 רישום חוב מהעבר.
              
              ⚠️ ליד אמצעי התשלום, לא בתוך הזמנה: חוב שייך ללקוח
              ולא להזמנה מסוימת. הנציג פותח את כרטיס הלקוח ורואה
              את התמונה המלאה - כרטיס, אופן תשלום, וחוב. */}
          <div className="mt-3">
            <DebtPanel
              customerId={customerId}
              customerName={customerName}
              debtBalance={debtBalance}
              debtNote={debtNote}
              onDone={() => window.location.reload()}
            />
          </div>

          {pref === "CASH" && (
            <p className="text-[11px] text-zinc-500 mt-2">
              הגבייה מתבצעת במזומן בעת החלוקה. הלקוח לא יכול להזמין באתר
              בעצמו עד שיעבור לאשראי.
            </p>
          )}
          {/* §67: 🐛 פער שנסגר - עדכון כרטיס היה אפשרי רק כתוצר לוואי
              של מעבר ממזומן לאשראי. לקוח שכבר באשראי עם כרטיס פג-תוקף
              או שנחסם לא ניתן היה לעדכן מכאן כלל, והנציג נאלץ לפנות
              למנהל. עכשיו זו פעולה עצמאית. */}
          {/* §316: 🐛 `pref !== "CASH"` חסם את מי שהכי צריך.
              
              לקוח מזומן שרוצה לעבור לאשראי **חייב** להזין כרטיס -
              זו הדרך היחידה (save-token מעביר ל-CREDIT אוטומטית).
              והכפתור היה מוסתר ממנו בדיוק.
              
              ⚠️ הנציג נאלץ קודם להעביר ל"אשראי" (וזה נחסם בלי
              כרטיס), או לפנות למנהל.
              
              ⚠️ ההרשאה נשארת canUpdateCards - היא על **הפעולה**
              (הזנת כרטיס), לא על מצב הלקוח. */}
          {canUpdateCards && (
            <button
              onClick={() => setShowCardModal(true)}
              className="mt-2 w-full text-xs font-bold text-brand-rust border border-brand-rust rounded-lg py-2 hover:bg-brand-rust hover:text-white transition-colors"
            >
              💳{" "}
              {hasCard
                ? "החלפת כרטיס אשראי"
                : pref === "CASH"
                  ? "הזנת כרטיס (יעבור לאשראי)"
                  : "הזנת כרטיס אשראי"}
            </button>
          )}
          {prefMsg && <p className="text-emerald-700 text-xs mt-2">✓ {prefMsg}</p>}
          {prefErr && <p className="text-red-600 text-xs mt-2">{prefErr}</p>}
        </div>

        {msg && (
          <div className="card p-3 bg-green-50 border-green-200 text-sm text-green-800 font-medium">
            {msg}
          </div>
        )}

        {orders.length === 0 ? (
          <div className="card p-6 text-center text-zinc-500">אין הזמנות ללקוח זה</div>
        ) : (
          orders.map((o) => (
            <div key={o.id} className="card p-4">
              <button
                onClick={() => setOpenId(openId === o.id ? null : o.id)}
                className="w-full flex justify-between items-center text-right"
              >
                <div>
                  <div className="font-bold text-brand-slatedark">הזמנה #{o.orderNumber}</div>
                  <div className="text-xs text-zinc-400">
                    {fmtDate(o.createdAt)} · {o.pointName}
                  </div>
                </div>
                <div className="text-left">
                  <span className="badge bg-zinc-100 text-zinc-600">
                    {STATUS_LABELS[o.status] ?? o.status}
                  </span>
                  <div className="text-sm font-bold text-brand-rust mt-1">
                    {o.finalTotal != null ? fmt(o.finalTotal) : `~${fmt(o.estimatedTotal)}`}
                  </div>
                </div>
              </button>

              {openId === o.id && (
                <div className="mt-4 border-t pt-3 space-y-2">
                  {o.items.map((it) => (
                    <div key={it.id} className="flex items-center justify-between gap-2">
                      <div className="flex-1">
                        <div className="text-sm font-medium text-brand-slatedark">
                          {it.productName}
                        </div>
                        <div className="text-xs text-zinc-400">
                          {/* §128: 🐛 היה `{quantity} {unit}` גולמי -
                              בדיוק מה שההערה ב-order-display אוסרת.
                              פריט בודדים הוצג כ"5.5 קרטון", ומוצר
                              שנמכר ביחידות הוצג לפי unit של ההזמנה
                              שהיה עלול להיות שגוי. */}
                          {formatItemQty({
                            isSingle: it.isSingle,
                            quantity: it.quantity,
                            unit: it.unit,
                          })}{" "}
                          · {fmt(it.unitPrice)}/{it.unit}
                          {it.estimatedWeight != null && (
                            <span className="text-amber-600"> · משוער: {it.estimatedWeight} ק"ג</span>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-1">
                        <input
                          type="number"
                          step="0.1"
                          className="input w-20 text-center py-1"
                          placeholder="משקל"
                          value={
                            weights[it.id] ??
                            (it.actualWeight != null ? String(it.actualWeight) : "")
                          }
                          onChange={(e) => setWeight(it.id, e.target.value)}
                        />
                        <span className="text-xs text-zinc-400">ק"ג</span>
                      </div>
                    </div>
                  ))}

                  {/* §67: הוספת מוצר ישירות מכרטיס הלקוח.
                      🐛 קודם ההוספה הייתה זמינה רק במסך המכירה. נציג
                      שהגיע דרך כרטיס הלקוח - המסלול הטבעי כשלקוח
                      מתקשר - ראה משקלים בלבד.

                      מוצג רק בהזמנה של המכירה הפעילה ולפני שנקבע
                      מחיר סופי - אותן חסימות שיש ב-route, כדי
                      שהכפתור לא יופיע רק כדי להיכשל. */}
                  {activePricelistId &&
                    o.pricelistId === activePricelistId &&
                    o.finalTotal == null &&
                    availableProducts.length > 0 && (
                      <div className="pt-3">
                        <AddOrderItem
                          products={availableProducts}
                          singleSurcharge={singleSurcharge}
                          onAdd={async (item) => {
                            const res = await fetch("/api/agent/order-item", {
                              method: "POST",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({
                                orderId: o.id,
                                productId: item.productId,
                                quantity: item.quantity,
                                isSingle: item.isSingle,
                                // unitPrice לא נשלח - השרת גוזר מהמחירון
                              }),
                            });
                            const data = await res.json();
                            if (!res.ok) throw new Error(data.error || "שגיאה בהוספה");
                            // רענון מלא - הפריט החדש והסכום המעודכן
                            // מגיעים מהשרת ולא מורכבים כאן מחדש
                            window.location.reload();
                          }}
                        />
                      </div>
                    )}

                  <div className="flex gap-2 pt-3">
                    <button
                      onClick={() => saveOrder(o, false)}
                      disabled={saving}
                      className="btn-ghost btn-sm flex-1"
                    >
                      {saving ? "שומר..." : "שמירת משקלים"}
                    </button>
                    {canSetFinalPrice && (
                      <button
                        onClick={() => saveOrder(o, true)}
                        disabled={saving}
                        className="btn-primary btn-sm flex-1"
                      >
                        {pref === "CASH"
                          ? "קביעת מחיר סופי (מזומן)"
                          : canSendPaymentLink
                            ? "מחיר סופי + לינק תשלום"
                            : "קביעת מחיר סופי"}
                      </button>
                    )}
                  </div>
                  {!canSetFinalPrice && (
                    <p className="text-xs text-zinc-400 text-center">
                      קביעת מחיר סופי מתבצעת ע"י המנהל
                    </p>
                  )}
                </div>
              )}
            </div>
          ))
        )}
      </div>

      {/* §60: הזנת כרטיס במעבר מזומן->אשראי. save-token שומר טוקן,
          מחייב 1₪ לאימות ומציב paymentPreference=CREDIT בשרת - כאן רק
          משקפים את זה מקומית. last4 לא ידוע בלי רענון, לכן לא מוצג. */}
      {showCardModal && (
        <UpdateCardModal
          customerId={customerId}
          hasCurrentCard={hasCard}
          onClose={() => setShowCardModal(false)}
          onSuccess={() => {
            setShowCardModal(false);
            setHasCard(true);
            setCardLast4(null);
            setPref("CREDIT");
            setPrefMsg("הכרטיס נשמר והלקוח הועבר לתשלום באשראי");
          }}
        />
      )}

      {/* §111: בחירת המכירה שבה תיפתח ההזמנה.
          כאן גם התשובה ל"איך הנציג לא יכפיל": לכל מכירה מוצג אם
          ללקוח כבר יש בה הזמנה פתוחה, עם המספר וקישור ישיר אליה.
          הנציג רואה את זה **לפני** שהוא פותח חדשה, ולא אחרי. */}
      {salePickerOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-50 flex items-end sm:items-center justify-center p-4"
          onClick={() => setSalePickerOpen(false)}
        >
          <div
            className="bg-white rounded-2xl w-full max-w-md p-4 space-y-3 max-h-[80vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h3 className="font-extrabold text-brand-slatedark">
                באיזו מכירה לפתוח הזמנה?
              </h3>
              <button
                onClick={() => setSalePickerOpen(false)}
                className="text-zinc-400 text-xl leading-none px-2"
              >
                ×
              </button>
            </div>

            {activeSales.map((sl) => {
              const existing = orders.find(
                (o) =>
                  o.pricelistId === sl.id &&
                  o.status !== "CANCELLED" &&
                  o.status !== "COMPLETED"
              );
              return (
                <div
                  key={sl.id}
                  className={`border-2 rounded-xl p-3 ${
                    sl.agentOnly
                      ? "border-amber-300 bg-amber-50"
                      : "border-zinc-200 bg-white"
                  }`}
                >
                  <div className="flex items-center gap-2 flex-wrap mb-1">
                    <span className="font-bold text-brand-slatedark">{sl.name}</span>
                    {sl.agentOnly && (
                      <span className="text-[10px] font-bold bg-amber-200 text-amber-900 rounded px-1.5 py-0.5">
                        נציגים בלבד
                      </span>
                    )}
                  </div>
                  {sl.deliveryDateText && (
                    <div className="text-xs text-zinc-500 mb-2">
                      חלוקה: {sl.deliveryDateText}
                    </div>
                  )}

                  {existing ? (
                    <div className="bg-white border-2 border-orange-300 rounded-lg p-2.5">
                      <div className="text-xs font-bold text-orange-800 mb-1.5">
                        ⚠️ ללקוח כבר יש הזמנה פתוחה כאן — #{existing.orderNumber}
                      </div>
                      <div className="text-[11px] text-orange-700 leading-relaxed mb-2">
                        פתיחת הזמנה נוספת תיצור כפילות. עדיף להוסיף מוצרים
                        להזמנה הקיימת.
                      </div>
                      <div className="flex gap-2 items-center">
                        <button
                          onClick={() => {
                            setSalePickerOpen(false);
                            setOpenId(existing.id);
                          }}
                          className="flex-1 text-xs font-bold bg-orange-600 text-white rounded-lg py-2"
                        >
                          פתח את ההזמנה הקיימת
                        </button>
                        <Link
                          href={`/agent/order/${customerId}?sale=${sl.id}`}
                          className="text-xs text-zinc-500 underline py-2 px-1 shrink-0"
                        >
                          בכל זאת חדשה
                        </Link>
                      </div>
                    </div>
                  ) : (
                    <Link
                      href={`/agent/order/${customerId}?sale=${sl.id}`}
                      className="block text-center text-sm font-bold bg-brand-rust text-white rounded-lg py-2.5"
                    >
                      פתח הזמנה חדשה ←
                    </Link>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </main>
  );
}
