"use client";

// מסך ניהול תשלומים.
//
// 🆕 נוסף פילטר מכירה. ברירת המחדל היא *כל המכירות* בכוונה - בניגוד למסך
//    ההזמנות. הסיבה: חיובים שנכשלו במכירות קודמות הם בדיוק מה שהמסך אמור
//    לתפוס, ופילטר שמסתיר אותם כברירת מחדל היה מסתיר כסף שממתין לגבייה.

import { useEffect, useState, useCallback } from "react";
// §296: מקור אמת יחיד לפריסה
import { INSTALLMENT_OPTIONS } from "@/lib/installments-lib";
import { payStatusLabel, payStatusColor, payStatusNeedsAttention } from "@/lib/pay-status-lib";

// מבנה PayOrder כפי שמוחזר מ-/api/admin/payments
type PayOrder = {
  id: string;
  orderNumber: number;
  customerName: string;
  phone: string;
  paymentStatus: string;
  paymentMethod: string | null;
  estimatedTotal: number | null;
  finalTotal: number | null;
  /** §260: מספר התשלומים שהלקוח ביקש באתר */
  requestedInstallments?: number | null;
  amountPaid: number | null;
  paidAt: string | null;
  paymentTransactionId: string | null;
  chargeAttempts: number;
  lastChargeError: string | null;
  lastChargeAt: string | null;
  createdAt: string;
  updatedAt: string;
  pointNameSnapshot: string | null;
  deliveryDateSnapshot: string | null;
  customer: {
    id: string;
    name: string;
    email: string | null;
    phone: string | null;
    hasToken: boolean;
    cardLast4: string | null;
    cardExpiry: string | null;
    cardVerifiedAt: string | null;
    cardNeedsUpdate: boolean;
    creditVerificationCharged: boolean;
  };
};

type Message = { text: string; type: "success" | "error" };
type Pricelist = { id: string; name: string; status: string };

const ALL = "__all__";

// אפשרויות סינון סטטוס
const FILTER_OPTIONS: { value: string; label: string }[] = [
  // §258: 🐛 הבורר הציע סטטוסים שלא קיימים במערכת.
  //
  // "מוכן לחיוב" סינן לפי READY_TO_CHARGE - סטטוס שאף אחד לא
  // מסמן (§250). המנהל בחר בו, קיבל רשימה ריקה, והסיק שאין מה
  // לחייב - בזמן שהיו 4 הזמנות מוכנות.
  //
  // ⚠️ "ניתן לחייב עכשיו" מסנן לפי **מחיר סופי**, בדיוק כמו
  // הכפתור. מה שהבורר מבטיח הוא מה שהוא נותן.
  { value: "chargeable", label: "💳 ניתן לחייב עכשיו" },
  { value: "default", label: "פעולות פתוחות" },
  { value: "all", label: "כל הסטטוסים" },
  { value: "FAILED", label: "חיוב נכשל בלבד" },
  { value: "CARD_UPDATE_NEEDED", label: "נדרש עדכון כרטיס בלבד" },
  { value: "AWAITING_WEIGHING", label: "ממתין לשקילה בלבד" },
  { value: "PAID", label: "שולם בלבד" },
];

// אילו סטטוסים מאפשרים ללחוץ "חייב עכשיו"?
//
// §250: 🐛 **הכפתור לא הופיע אף פעם.**
//
// התנאי היה READY_TO_CHARGE בלבד - אבל **אין בקוד שום מקום
// שמסמן הזמנה בסטטוס הזה**. הוא נקרא ב-admin-charge ונבדק כאן,
// ואף אחד לא כותב אותו.
//
// התוצאה: 4 הזמנות עם מחיר סופי נתקעו ב-PENDING, והמנהל ראה
// אותן במסך התשלומים בלי שום דרך לחייב.
//
// ⚠️ הקריטריון האמיתי הוא **מחיר סופי + לא שולם**, לא סטטוס.
// מחיר סופי אומר שהשקילה הסתיימה ויש מה לגבות.
//
// ⚠️ READY_TO_CHARGE נשאר ברשימה לתאימות אחורה - אם בעתיד
// יתווסף קוד שמסמן אותו, הוא ימשיך לעבוד.
function canCharge(
  status: string,
  finalTotal?: number | null,
  paymentStatus?: string
): boolean {
  if (status === "READY_TO_CHARGE" || status === "FAILED") return true;

  // ⚠️ כבר שולם - אין מה לחייב שוב.
  if (paymentStatus === "PAID") return false;

  // ⚠️ ממתין לתשלום אונליין: הלקוח באמצע תהליך, וחיוב מקביל
  // היה גובה פעמיים.
  if (paymentStatus === "PAYMENT_PENDING") return false;

  return finalTotal != null && finalTotal > 0;
}

function fmtIls(n: number | null): string {
  if (n === null || n === undefined) return "—";
  return `${n.toFixed(2)} ₪`;
}

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    return d.toLocaleString("he-IL", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

export default function PaymentsPage() {
  const [orders, setOrders] = useState<PayOrder[]>([]);
  const [lists, setLists] = useState<Pricelist[] | null>(null);
  const [loading, setLoading] = useState(true);
  // §258: ברירת המחדל היא **מה שניתן לחייב**.
  //
  // ⚠️ המנהל נכנס למסך התשלומים כדי לחייב, לא כדי לסקור. רשימה
  // של 250 הזמנות שרובן ממתינות לשקילה קוברת את 4 שמוכנות.
  const [filter, setFilter] = useState<string>("chargeable");
  const [fPricelist, setFPricelist] = useState<string>(ALL);
  const [charging, setCharging] = useState<string | null>(null);

  // §260: 💳 **פריסה לתשלומים ברגע החיוב.**
  //
  // 🐛 המצב מהשטח: לקוחות מבקשים פריסה בטלפון, והמנהל צריך
  // לזכור מי ביקש כמה. הבורר קיים רק במסך ההזמנה הבודדת
  // (§189/§191) - כלומר לפתוח כל אחת בנפרד.
  //
  // ⚠️ ברירת המחדל היא **מה שהלקוח ביקש** (requestedInstallments)
  // מהאתר. המנהל רואה אותה ולא צריך לזכור.
  //
  // ⚠️ מפה לפי מזהה הזמנה: כל שורה שומרת את הבחירה שלה, ומעבר
  // בין שורות לא דורס.
  const [installments, setInstallments] = useState<Record<string, number>>({});

  // §261: 🔍 חיפוש לפי שם / טלפון / מספר הזמנה.
  //
  // ⚠️ סינון **מקומי** ולא בשרת: הרשימה כבר בזיכרון (עד 300),
  // וסיבוב למסד באירלנד על כל הקשה היה איטי ומיותר.
  const [q, setQ] = useState("");

  const instOf = (o: PayOrder) =>
    installments[o.id] ?? (o as any).requestedInstallments ?? 1;

  // §261: 💾 **הבחירה נשמרת מיד.**
  //
  // 🐛 בלי זה הבורר היה מקומי בלבד: המנהל בוחר 3 תשלומים, עובר
  // למסך אחר, וחוזר - והבחירה נעלמה. הוא היה צריך לזכור.
  //
  // ⚠️ עדכון אופטימי: המסך מתעדכן מיד, והשמירה רצה ברקע. אם
  // היא נכשלת - חוזרים אחורה ומודיעים.

  const [message, setMessage] = useState<Message | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);

  // §291: 🐛 **הפונקציה השתמשה ב-setMessage לפני שהוגדר.**
  //
  // saveInstallments ישבה מעל `const [message, setMessage]`.
  // ב-JavaScript הצהרת function עולה למעלה (hoisting), אבל
  // const לא - ולכן כל קריאה ל-setMessage בתוך ה-catch זרקה
  // ReferenceError.
  //
  // התוצאה: השמירה **כן** הצליחה בשרת, אבל אם משהו בדרך
  // נכשל, השגיאה נבלעה. וגרוע מזה - ה-catch עצמו קרס, וה-state
  // חזר אחורה בלי שהמנהל ידע.
  //
  // ⚠️ עכשיו הפונקציה **אחרי** כל ה-state שהיא נוגעת בו.
  async function saveInstallments(orderId: string, n: number, prev: number) {
    setInstallments((p) => ({ ...p, [orderId]: n }));
    try {
      const res = await fetch(`/api/admin/orders/${orderId}/installments`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ installments: n }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "שמירה נכשלה");
      }
      // §291: חיווי קצר שהשמירה עברה.
      //
      // ⚠️ בלעדיו המנהל בוחר, לא רואה כלום, ולא יודע אם נשמר -
      // בדיוק מה שקרה כאן: הוא יצא, חזר, וראה שהערך התאפס.
      setMessage({
        text: `נשמר: ${n === 1 ? "תשלום אחד" : `${n} תשלומים`}`,
        type: "success",
      });
    } catch (e: any) {
      // ⚠️ החזרה למצב הקודם: אם לא נשמר, המסך לא יכול להראות
      // ערך שאינו במסד - המנהל יחייב לפי מה שהוא רואה.
      setInstallments((p) => ({ ...p, [orderId]: prev }));
      setMessage({ text: e.message || "שמירת הפריסה נכשלה", type: "error" });
    }
  }

  // טעינת רשימת המכירות לבורר (ברירת המחדל נשארת "כל המכירות")
  useEffect(() => {
    fetch("/api/admin/pricelists", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : []))
      .then((res: Pricelist[]) => setLists(Array.isArray(res) ? res : []))
      .catch(() => setLists([]));
  }, []);

  const fetchOrders = useCallback(async () => {
    setLoading(true);
    setFetchError(null);
    try {
      const q = new URLSearchParams();
      if (filter !== "default") q.set("status", filter);
      if (fPricelist !== ALL) q.set("pricelistId", fPricelist);
      const qs = q.toString();
      const url = qs ? `/api/admin/payments?${qs}` : "/api/admin/payments";
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        setFetchError(err.error || `שגיאה ${res.status}`);
        setOrders([]);
        return;
      }
      const data = await res.json();
      setOrders(Array.isArray(data.orders) ? data.orders : []);
    } catch (e: any) {
      setFetchError(`שגיאת רשת: ${e.message || "לא ידוע"}`);
      setOrders([]);
    } finally {
      setLoading(false);
    }
  }, [filter, fPricelist]);

  useEffect(() => {
    fetchOrders();
  }, [fetchOrders]);

  async function handleCharge(order: PayOrder) {
    const amount = order.finalTotal;
    if (amount === null) {
      setMessage({ text: "אין מחיר סופי - לא ניתן לחייב", type: "error" });
      return;
    }

    const confirmMsg =
      `לחייב את הזמנה #${order.orderNumber}?\n\n` +
      `לקוח: ${order.customerName}\n` +
      `סכום סופי: ${fmtIls(amount)}\n` +
      `כרטיס: ${order.customer.cardLast4 ? "****" + order.customer.cardLast4 : "לא ידוע"}` +
      (instOf(order) > 1
        ? `\nתשלומים: ${instOf(order)} × ${fmtIls(
            Math.round((amount / instOf(order)) * 100) / 100
          )}`
        : "") +
      (order.customer.creditVerificationCharged ? "" : `\n\n(1₪ של האימות יקוזז מהסכום)`);

    if (!confirm(confirmMsg)) return;

    setCharging(order.id);
    setMessage(null);
    try {
      const res = await fetch("/api/admin/charge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orderId: order.id,
          // §260: הפריסה שנבחרה. השרת מקבל overrideInstallments
          // וגובר על מה ששמור בהזמנה.
          installments: instOf(order),
        }),
      });
      const data = await res.json();
      if (res.ok && data.ok) {
        setMessage({
          text: `הזמנה #${order.orderNumber} חויבה בהצלחה — ${fmtIls(data.amountCharged)}`,
          type: "success",
        });
      } else {
        setMessage({
          text: `חיוב הזמנה #${order.orderNumber} נכשל: ${data.error || "שגיאה לא ידועה"}`,
          type: "error",
        });
      }
    } catch (e: any) {
      setMessage({ text: `שגיאת רשת: ${e.message || "לא ידוע"}`, type: "error" });
    } finally {
      setCharging(null);
      await fetchOrders();
    }
  }

  const needAttentionCount = orders.filter((o) => payStatusNeedsAttention(o.paymentStatus)).length;

  // §258: כמה **באמת** ניתן לחייב עכשיו, וכמה כסף.
  //
  // ⚠️ המנהל רואה עשרות שורות ולא יודע כמה מהן רלוונטיות.
  // המספר הזה עונה על השאלה בלי לספור.
  // §261: הרשימה המסוננת.
  //
  // ⚠️ כל מילה בנפרד: "משה ניימן" ימצא גם "ניימן משה" - אותה
  // בעיה שתוקנה בחיפוש הלקוחות (§251).
  const words = q.trim().split(/\s+/).filter(Boolean);
  const shown =
    words.length === 0
      ? orders
      : orders.filter((o) => {
          const hay = [
            o.customerName ?? "",
            o.customer?.phone ?? "",
            String(o.orderNumber ?? ""),
          ]
            .join(" ")
            .toLowerCase();
          return words.every((w) => hay.includes(w.toLowerCase()));
        });

  const chargeable = orders.filter(
    (o) =>
      o.finalTotal != null &&
      !["PAID", "CHARGING", "PAYMENT_PENDING"].includes(o.paymentStatus)
  );
  const chargeableSum = chargeable.reduce(
    (sum, o) => sum + Number(o.finalTotal ?? 0),
    0
  );
  const currentList = lists?.find((l) => l.id === fPricelist) ?? null;

  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto">
      {/* כותרת + סיכום */}
      <div className="flex flex-wrap items-center justify-between gap-4 mb-4">
        <div>
          <h1 className="text-2xl font-bold text-brand-slatedark">💳 ניהול תשלומים</h1>
          <p className="text-sm text-zinc-500 mt-1">
            {fPricelist === ALL
              ? "חיוב הזמנות בכרטיס השמור — כל המכירות"
              : currentList
                ? `חיוב הזמנות במכירה: ${currentList.name}`
                : "חיוב הזמנות בכרטיס השמור"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => fetchOrders()}
            className="px-3 py-2 bg-white border border-zinc-300 rounded-lg text-sm hover:bg-zinc-50"
            disabled={loading}
          >
            🔄 רענן
          </button>
        </div>
      </div>

      {/* באנר הודעה */}
      {message && (
        <div
          className={`mb-4 rounded-lg p-3 text-sm ${
            message.type === "success"
              ? "bg-emerald-50 text-emerald-800 border border-emerald-200"
              : "bg-red-50 text-red-800 border border-red-200"
          }`}
        >
          <div className="flex items-start justify-between gap-3">
            <div>{message.text}</div>
            <button
              onClick={() => setMessage(null)}
              className="text-lg leading-none opacity-70 hover:opacity-100"
            >
              ✕
            </button>
          </div>
        </div>
      )}

      {/* פילטרים */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        {/* מכירה - ברירת מחדל "כל המכירות" בכוונה */}
        <select
          value={fPricelist}
          onChange={(e) => setFPricelist(e.target.value)}
          disabled={!lists}
          aria-label="סינון לפי מכירה"
          className="px-3 py-2 bg-white border border-zinc-300 rounded-lg text-sm max-w-[240px]"
        >
          <option value={ALL}>כל המכירות</option>
          {lists?.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
              {l.status === "ACTIVE" ? " • פעילה" : ""}
            </option>
          ))}
        </select>

        {/* §261: 🔍 חיפוש — **ראשון בשורה**.
            
            ⚠️ המנהל שמחפש לקוח ספציפי לא רוצה לסנן קודם לפי
            סטטוס. שדה החיפוש הוא הדבר הראשון שהעין מחפשת. */}
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="🔍 חיפוש: שם, טלפון או מספר הזמנה"
          className="flex-1 min-w-[200px] rounded-lg border-2 border-zinc-300 px-3 py-2 text-sm"
        />

        <select
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          aria-label="סינון לפי סטטוס תשלום"
          className="px-3 py-2 bg-white border border-zinc-300 rounded-lg text-sm"
        >
          {FILTER_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>

              {/* §258: 💳 כמה ניתן לחייב עכשיו.
          
          ⚠️ מוצג תמיד כשיש כאלה, בכל סינון: המנהל שנכנס למסך
          רוצה לדעת קודם כל "כמה עבודה יש לי", ורק אחר כך לצלול
          לרשימה. */}
      {chargeable.length > 0 && (
        <div className="rounded-xl border-2 border-emerald-300 bg-emerald-50 p-3 mb-3 flex items-center justify-between gap-3 flex-wrap">
          <div>
            <div className="font-extrabold text-emerald-900 text-sm">
              💳 {chargeable.length} הזמנות ניתנות לחיוב עכשיו
            </div>
            <div className="text-[11px] text-emerald-800 mt-0.5">
              סה״כ ₪
              {chargeableSum.toLocaleString("he-IL", {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })}
              {" · "}
              יש להן מחיר סופי וטרם שולמו
            </div>
          </div>
          {/* ⚠️ הכפתור רק כשלא כבר בסינון הזה - אחרת הוא לא
              עושה כלום ורק מבלבל. */}
          {/* §309: 📧 שליחת מייל לכל המוכנות.
              
              עם 244 הזמנות, שליחה אחת-אחת היא 244 לחיצות.
              
              ⚠️ והשליחה **נועלת** את המשקלים: הלקוח מחזיק בידו
              סכום, ושינוי אחריו יוצר פער - בדיוק מה שקרה
              בהזמנה 616. */}
          {/* §327: 💵 שליחה ללקוחות מזומן בלבד.
              
              הצורך: לקוח מזומן צריך לדעת כמה להביא לחלוקה - וזו
              התזכורת הכי חשובה. לקוח אשראי יחויב אוטומטית ממילא.
              
              ⚠️ כפתור נפרד ולא בורר: המנהל יודע מראש למי הוא
              שולח, ובורר היה מוסיף לחיצה לכל שליחה. */}
          <button
            onClick={async () => {
              const ids = chargeable.map((o) => o.id);
              if (
                !window.confirm(
                  `לשלוח מייל ללקוחות **מזומן** בלבד?\n\n` +
                    `כל אחד יקבל תזכורת כמה להביא לחלוקה.\n\n` +
                    `⚠️ אחרי השליחה לא ניתן לשנות משקלים בהזמנות האלה.`
                )
              )
                return;
              try {
                const res = await fetch("/api/admin/notify-batch", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    orderIds: ids,
                    paymentPreference: "CASH",
                  }),
                });
                const d = await res.json();
                if (!res.ok) throw new Error(d.error || "השליחה נכשלה");
                const lines = [`נשלחו ${d.sent} מיילים ללקוחות מזומן`];
                if (d.failed > 0) {
                  lines.push(`\n${d.failed} נכשלו:`);
                  (d.errors || []).forEach((e: any) =>
                    lines.push(`#${e.orderNumber}: ${e.error}`)
                  );
                }
                alert(lines.join("\n"));
                fetchOrders();
              } catch (e: any) {
                alert(e.message || "שגיאה");
              }
            }}
            className="shrink-0 px-3 py-1.5 rounded-lg bg-amber-600 text-white text-xs font-bold"
          >
            💵 מזומן בלבד
          </button>

          <button
            onClick={async () => {
              const ids = chargeable.map((o) => o.id);
              if (
                !window.confirm(
                  `לשלוח מייל ל-${ids.length} לקוחות?\n\n` +
                    `כל אחד יקבל את הפירוט המלא והסכום הסופי שלו.\n\n` +
                    `⚠️ אחרי השליחה לא ניתן לשנות משקלים בהזמנות האלה.`
                )
              )
                return;
              try {
                const res = await fetch("/api/admin/notify-batch", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ orderIds: ids }),
                });
                const d = await res.json();
                if (!res.ok) throw new Error(d.error || "השליחה נכשלה");
                const lines = [`נשלחו ${d.sent} מיילים`];
                if (d.failed > 0) {
                  lines.push(`\n${d.failed} נכשלו:`);
                  (d.errors || []).forEach((e: any) =>
                    lines.push(`#${e.orderNumber}: ${e.error}`)
                  );
                }
                alert(lines.join("\n"));
                fetchOrders();
              } catch (e: any) {
                alert(e.message || "שגיאה");
              }
            }}
            className="shrink-0 px-3 py-1.5 rounded-lg bg-blue-700 text-white text-xs font-bold"
          >
            📧 שלח מייל לכולן
          </button>

          {filter !== "chargeable" && (
            <button
              onClick={() => setFilter("chargeable")}
              className="shrink-0 px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-bold"
            >
              הצג רק אותן ←
            </button>
          )}
        </div>
      )}
      {needAttentionCount > 0 && filter === "default" && (
          <span className="text-sm bg-red-100 text-red-700 px-2.5 py-1 rounded-full font-medium">
            ⚠️ {needAttentionCount} דורש פעולה
          </span>
        )}

        {!loading && (
          <span className="text-sm text-zinc-500 mr-auto">{orders.length} הזמנות</span>
        )}
      </div>

      {/* שגיאת טעינה */}
      {fetchError && (
        <div className="bg-red-50 text-red-800 border border-red-200 rounded-lg p-4 mb-4 text-sm">
          שגיאה בטעינת רשימת התשלומים: {fetchError}
        </div>
      )}

      {loading && <div className="text-center py-12 text-zinc-500">טוען...</div>}

      {/* מצב ריק */}
      {!loading && !fetchError && orders.length === 0 && (
        <div className="text-center py-12 bg-white rounded-xl border border-zinc-200">
          <p className="font-medium text-brand-slatedark">אין הזמנות בסינון הנוכחי</p>
          <p className="text-sm text-zinc-500 mt-1">
            {fPricelist !== ALL
              ? "נסה לבחור מכירה אחרת או להציג את כל המכירות."
              : "אין כרגע הזמנות שדורשות פעולת תשלום."}
          </p>
        </div>
      )}

      {/* רשימת הזמנות */}
      {!loading && orders.length > 0 && (
        <div className="space-y-3">
          {/* §261: חיווי כשהחיפוש מסתיר תוצאות.
              
              ⚠️ בלעדיו המנהל מחפש "כהן", רואה 2 שורות, ולא זוכר
              שיש עוד 40 מוסתרות. */}
          {q.trim() && shown.length !== orders.length && (
            <div className="text-xs text-zinc-500 mb-2">
              מציג {shown.length} מתוך {orders.length} · חיפוש: &quot;{q}&quot;
              <button
                onClick={() => setQ("")}
                className="mr-2 text-brand-rust underline font-bold"
              >
                נקה
              </button>
            </div>
          )}
          {shown.map((o) => (
            <OrderCard
              key={o.id}
              order={o}
              onCharge={() => handleCharge(o)}
              isCharging={charging === o.id}
              // §260: הפריסה שנבחרה לשורה זו
              currentInstallments={instOf(o)}
              onInstallmentsChange={(n) => saveInstallments(o.id, n, instOf(o))}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// כרטיס הזמנה בודדת
// ═══════════════════════════════════════════════════════════════════
function OrderCard({
  order,
  onCharge,
  isCharging,
  currentInstallments,
  onInstallmentsChange,
}: {
  order: PayOrder;
  onCharge: () => void;
  isCharging: boolean;
  /** §260: מספר התשלומים שנבחר לשורה הזו */
  currentInstallments: number;
  onInstallmentsChange: (n: number) => void;
}) {
  const statusLabel = payStatusLabel(order.paymentStatus);
  const statusColor = payStatusColor(order.paymentStatus);
  const showCharge = canCharge(order.paymentStatus, order.finalTotal, order.paymentStatus);
  const cardBlocked = order.customer.cardNeedsUpdate;
  const hasFinalTotal = order.finalTotal !== null;

  return (
    <div className="bg-white rounded-xl border border-zinc-200 p-4 shadow-sm">
      {/* שורה עליונה: מספר + סטטוס + זמן */}
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <div className="flex items-center gap-3">
          <span className="text-lg font-bold text-brand-slatedark">#{order.orderNumber}</span>
          <span className={`px-2.5 py-1 rounded-full text-xs font-medium ${statusColor}`}>
            {statusLabel}
          </span>
          {order.chargeAttempts > 0 && (
            <span className="text-xs text-zinc-500">ניסיונות: {order.chargeAttempts}</span>
          )}
        </div>
        <div className="text-xs text-zinc-500">עודכן: {fmtDate(order.updatedAt)}</div>
      </div>

      {/* שורת פרטים */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-sm">
        <div>
          <div className="text-xs text-zinc-500 mb-0.5">לקוח</div>
          <div className="font-medium">{order.customerName}</div>
          <div dir="ltr" className="text-zinc-600 text-xs text-right">
            {order.phone}
          </div>
          {order.customer.email && (
            <div dir="ltr" className="text-zinc-500 text-xs text-right truncate">
              {order.customer.email}
            </div>
          )}
        </div>

        <div>
          <div className="text-xs text-zinc-500 mb-0.5">מחיר</div>
          {hasFinalTotal ? (
            <div>
              <div className="font-medium text-brand-slatedark">
                סופי: {fmtIls(order.finalTotal)}
              </div>
              {order.amountPaid !== null && (
                <div className="text-xs text-emerald-700">שולם: {fmtIls(order.amountPaid)}</div>
              )}
            </div>
          ) : (
            <div className="text-zinc-500">
              משוער: {fmtIls(order.estimatedTotal)}
              <div className="text-xs text-amber-700 mt-0.5">טרם נקבע מחיר סופי</div>
            </div>
          )}
        </div>

        <div>
          <div className="text-xs text-zinc-500 mb-0.5">כרטיס שמור</div>
          {order.customer.hasToken ? (
            <div>
              <div className="font-medium" dir="ltr">
                {order.customer.cardLast4 ? `****${order.customer.cardLast4}` : "טוקן שמור"}
              </div>
              {order.customer.cardExpiry && (
                <div className="text-xs text-zinc-600" dir="ltr">
                  תוקף: {order.customer.cardExpiry}
                </div>
              )}
              {cardBlocked && (
                <div className="text-xs text-orange-700 font-medium mt-1">⚠️ נדרש עדכון</div>
              )}
            </div>
          ) : (
            <div className="text-zinc-500 text-xs">אין כרטיס שמור</div>
          )}
        </div>
      </div>

      {/* נקודה + תאריך חלוקה */}
      {(order.pointNameSnapshot || order.deliveryDateSnapshot) && (
        <div className="mt-3 pt-3 border-t border-zinc-100 flex flex-wrap gap-x-4 gap-y-1 text-xs text-zinc-600">
          {order.pointNameSnapshot && <div>📍 {order.pointNameSnapshot}</div>}
          {order.deliveryDateSnapshot && <div>🗓 {order.deliveryDateSnapshot}</div>}
        </div>
      )}

      {/* שגיאה אחרונה */}
      {order.lastChargeError && (
        <div className="mt-3 bg-red-50 border border-red-200 rounded-lg p-2.5 text-xs text-red-800">
          <div className="font-medium mb-0.5">
            שגיאת חיוב אחרונה{order.lastChargeAt ? ` (${fmtDate(order.lastChargeAt)})` : ""}:
          </div>
          <div className="font-mono">{order.lastChargeError}</div>
        </div>
      )}

      {/* §267: 🚨 **זה מה שהסתיר את הבורר.**
          
          showCharge עטף את **כל** הבלוק - גם את הבורר וגם את
          הכפתור. והוא false כשאין finalTotal, כלומר הבורר נעלם
          בדיוק בהזמנות שבהן צריך אותו: אלה שטרם נשקלו.
          
          רדפנו אחרי hasToken, אחרי הסטטוס, אחרי המטמון - והתנאי
          הזה ישב שמונה שורות מעל, עוטף הכל.
          
          ⚠️ עכשיו הבלוק תמיד מוצג, והכפתור לבדו מותנה. */}
      {(
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {/* §260: 💳 בורר פריסה — **ליד הכפתור**.
              
              ⚠️ בשורה ולא במסך נפרד: המנהל עובר על רשימה ומחייב
              אחת אחרי השנייה. פתיחת מסך לכל אחת הופכת 20 חיובים
              לחצי שעה.
              
              ⚠️ מוצג רק כשאפשר לחייב: בהזמנה בלי מחיר סופי הוא
              רעש. */}
          {/* §261: הבורר מוצג **לכל** הזמנה, לא רק למה שאפשר לחייב.
              
              🐛 לקוחות מבקשים פריסה בטלפון ימים לפני החיוב -
              לפעמים לפני שההזמנה נשקלה. המנהל צריך לרשום מיד,
              אחרת הוא יזכור חמישה ויפספס את השישי.
              
              ⚠️ תנאי אחד נשאר: לקוח מזומן או בלי כרטיס לא ייחויב
              באשראי, ובורר פריסה אצלו הוא רעש. */}
          {/* §265: 🐛 התנאי `hasToken` חסם את הבורר בפועל.
              
              הבדיקה במסד הראתה שלכל הלקוחות יש כרטיס - ובכל
              זאת הבורר לא הופיע. במקום להמשיך לרדוף אחרי הסיבה,
              התנאי הוסר.
              
              ⚠️ ואין בו צורך: הבורר **שומר בקשה**, לא מחייב.
              לקוח בלי כרטיס שיזין אחד בהמשך - הפריסה כבר תחכה
              לו. חסימה כאן מנעה בדיוק את מה שהתכונה נועדה לו:
              לרשום מראש ולא לזכור.
              
              ⚠️ הכפתור עצמו עדיין דורש כרטיס - שם החסימה נכונה. */}
          <div className="flex items-center gap-1.5">
            <label className="text-[11px] text-zinc-500">תשלומים:</label>
              <select
                value={currentInstallments}
                onChange={(e) => onInstallmentsChange(Number(e.target.value))}
                disabled={isCharging}
                className="rounded-lg border-2 border-zinc-300 px-2 py-1.5 text-sm font-bold"
              >
                {/* §296: מהספרייה — לא רשימה מקומית */}
                {INSTALLMENT_OPTIONS.map((n) => (
                  <option key={n} value={n}>
                    {n === 1 ? "תשלום אחד" : `${n} תשלומים`}
                  </option>
                ))}
              </select>
              {/* ⚠️ הסכום לתשלום מוצג מיד: המנהל אומר ללקוח
                  בטלפון כמה יירד כל חודש, בלי לחשב. */}
              {currentInstallments > 1 && order.finalTotal != null && (
                <span className="text-[11px] text-zinc-600">
                  ≈{" "}
                  {fmtIls(
                    Math.round((order.finalTotal / currentInstallments) * 100) /
                      100
                  )}
              </span>
            )}
          </div>
          {/* §267: הכפתור לבדו מותנה — הבורר מוצג תמיד. */}
          {showCharge && (
          <button
            onClick={onCharge}
            disabled={isCharging || cardBlocked || !hasFinalTotal || !order.customer.hasToken}
            className="px-4 py-2 bg-brand-rust text-white rounded-lg text-sm font-medium hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {isCharging ? "מחייב..." : "💳 חייב עכשיו"}
          </button>
          )}
          {cardBlocked && (
            <span className="text-xs text-orange-700">
              הכרטיס מסומן כדורש עדכון - לא ניתן לחייב עד שהלקוח יזין כרטיס חדש
            </span>
          )}
          {!hasFinalTotal && (
            <span className="text-xs text-amber-700">יש לקבוע מחיר סופי לפני חיוב</span>
          )}
          {!order.customer.hasToken && (
            <span className="text-xs text-zinc-600">אין כרטיס שמור ללקוח</span>
          )}
        </div>
      )}
    </div>
  );
}
