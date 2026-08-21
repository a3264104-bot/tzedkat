"use client";

// §24: בקשות פתיחת חשבון מהמערכת הטלפונית.
//
// המסך משרת גם מנהל וגם נציג:
//   מנהל - רואה את כל הבקשות, משייך נציג, משנה נקודה
//   נציג - רואה רק את הנקודות שלו, מסמן יצירת קשר
//
// עקרון מרכזי: "הושלם" נקבע לפי paymentToken אמיתי ולא לפי סטטוס
// שמישהו לחץ. הסטטוס יכול להיות לא מעודכן; הטוקן לא משקר.
//
// §56: נוספה מחיקת בקשה.
// למה מחיקה כאן מותרת, בניגוד ללקוח: בקשה שלא הבשילה אינה נושאת
// היסטוריה - אין הזמנות, אין חיובים, אין תעודות. השארתה ברשימה רק
// גורמת לחזור אליה שוב ושוב. לקוח אמיתי לעומת זאת מושבת ולא נמחק.

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { api } from "@/lib/client";
import { UpdateCardButton } from "@/components/UpdateCardButton";
// §164: הקמת לקוח ישירות מההודעה
import { AdminAddCustomerButton } from "@/components/AdminAddCustomerButton";

type PhoneMessage = {
  id: string;
  phone: string;
  customerName: string | null;
  customerId: string | null;
  /**
   * §165: לקוח שנמצא **לפי הטלפון**, ולא רק דרך customerId.
   *
   * 🐛 הפער: customerId נקבע ברגע השיחה. מתקשר שלא היה רשום אז
   * מקבל null - **ונשאר null לנצח**, גם אחרי שהוקם לו חשבון
   * במסלול אחר (נציג, מסך הלקוחות, הרשמה עצמית).
   *
   * התוצאה: המנהל ראה בקשה "חדשה", לחץ "הקם לקוח", וקיבל
   * "הלקוח כבר קיים". 6 מתוך 9 ההודעות הפתוחות היו כאלה.
   */
  existingCustomer: { id: string; name: string } | null;
  pointName: string | null;
  kind: string;
  status: string;
  transcript: string | null;
  adminNote: string | null;
  createdAt: string;
};

type Row = {
  id: string;
  customerId: string;
  customerName: string;
  phone: string;
  email: string | null;
  pointId: string;
  pointName: string;
  pointCity: string | null;
  assignedAgentId: string | null;
  status: string;
  contactedAt: string | null;
  completedAt: string | null;
  failReason: string | null;
  note: string | null;
  createdAt: string;
  hasToken: boolean;
  cardLast4: string | null;
  daysWaiting: number;
  /** §56: האם ללקוח יש הזמנות - מחיקה חסומה אם כן */
  orderCount?: number;
};

const STATUS_LABELS: Record<string, string> = {
  NEW: "חדש",
  ASSIGNED: "שויך לנציג",
  CONTACTED: "יצרו קשר",
  COMPLETED: "הושלם",
  FAILED: "ממתין לחזרה",
};

const STATUS_COLORS: Record<string, string> = {
  NEW: "bg-red-100 text-red-700",
  ASSIGNED: "bg-blue-100 text-blue-700",
  CONTACTED: "bg-amber-100 text-amber-800",
  COMPLETED: "bg-emerald-100 text-emerald-700",
  FAILED: "bg-zinc-200 text-zinc-600",
};

const FILTERS = [
  { value: "open", label: "פתוחות" },
  { value: "all", label: "הכל" },
  { value: "NEW", label: "חדשות" },
  { value: "ASSIGNED", label: "שויכו" },
  { value: "CONTACTED", label: "יצרו קשר" },
  { value: "COMPLETED", label: "הושלמו" },
  { value: "FAILED", label: "ממתינים לחזרה" },
];

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("he-IL", {
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

export default function PhoneSignupsPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  // §164: טיפוס להודעות. היה any[], ולכן m.customerId ו-m.status
  // לא נבדקו בקומפילציה - שדה שגוי היה מתגלה רק בזמן ריצה.
  const [messages, setMessages] = useState<PhoneMessage[]>([]);
  const [isAgent, setIsAgent] = useState(false);
  // §164: נקודות החלוקה - נדרשות לטופס הקמת הלקוח.
  //
  // ⚠️ נטענות פעם אחת ולא בכל רענון: הן משתנות נדיר, והמסך
  // מתרענן אחרי כל פעולה.
  const [points, setPoints] = useState<
    { id: string; name: string; city: string | null }[]
  >([]);

  useEffect(() => {
    fetch("/api/admin/points")
      .then((r) => r.json())
      .then((d) => setPoints(Array.isArray(d) ? d : []))
      .catch(() => setPoints([]));
  }, []);
  const [filter, setFilter] = useState("open");
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [err, setErr] = useState("");
  // §166: הבקשה שנבחרה לדחייה - פותח את בורר הסיבות
  const [deferFor, setDeferFor] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setErr("");
    try {
      const qs = filter === "open" || filter === "all" ? "" : `?status=${filter}`;
      const res = await api(`/api/admin/phone-signups${qs}`);
      let list: Row[] = res.rows ?? [];
      // "פתוחות" = כל מה שעדיין דורש טיפול
      if (filter === "open") {
        list = list.filter((r) => r.status !== "COMPLETED" && r.status !== "FAILED");
      }
      setRows(list);
      setCounts(res.counts ?? {});
      setMessages(res.messages ?? []);
      setIsAgent(!!res.isAgent);
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => {
    load();
  }, [load]);

  async function act(id: string, action: string, extra?: Record<string, any>) {
    setBusyId(id);
    try {
      await api("/api/admin/phone-signups", {
        method: "PATCH",
        body: JSON.stringify({ id, action, ...extra }),
      });
      await load();
    } catch (e: any) {
      alert("שגיאה: " + e.message);
    } finally {
      setBusyId(null);
    }
  }

  // §56: מחיקת בקשה שלא הבשילה.
  //
  // האזהרה מפורטת בכוונה: המנהל צריך להבין *בדיוק* מה נמחק. אם
  // ללקוח כבר יש הזמנות, השרת יחסום - ואז ההשבתה במסך הלקוחות היא
  // הדרך הנכונה, כי שם יש היסטוריה לשמר.
  async function remove(r: Row) {
    const hasOrders = (r.orderCount ?? 0) > 0;
    const msg = hasOrders
      ? `ל-${r.customerName} יש כבר ${r.orderCount} הזמנות במערכת.\n\n` +
        `לא ניתן למחוק לקוח עם היסטוריה. במקום זאת אפשר לסמן אותו כלא ` +
        `פעיל במסך הלקוחות — ההיסטוריה נשמרת והוא מפסיק לקבל פניות.`
      : `למחוק את הבקשה של ${r.customerName}?\n\n` +
        `יימחקו הבקשה וחשבון הלקוח שנוצר עבורה.\n` +
        `אין לו הזמנות, ולכן לא הולך לאיבוד שום מידע.\n\n` +
        `הפעולה בלתי הפיכה.`;

    if (hasOrders) {
      alert(msg);
      return;
    }
    if (!confirm(msg)) return;

    setBusyId(r.id);
    try {
      await api("/api/admin/phone-signups", {
        method: "DELETE",
        body: JSON.stringify({ id: r.id }),
      });
      await load();
    } catch (e: any) {
      alert("שגיאה: " + e.message);
    } finally {
      setBusyId(null);
    }
  }

  const openCount = (counts.NEW ?? 0) + (counts.ASSIGNED ?? 0) + (counts.CONTACTED ?? 0);
  // §166: בקשות שנדחו וממתינות לחזרה
  const deferredCount = counts.FAILED ?? 0;

  // §164: 🐛 הודעות שטופלו נשארו ברשימה לנצח.
  //
  // בקשות ההרשמה כבר נעלמו מ"פתוחות" ברגע שנוסף כרטיס, אבל
  // ההודעות ("שיחזרו אליי") המשיכו להצטבר - גם אחרי שסומנו
  // כטופלו. אחרי חודש הרשימה הייתה בלתי שמישה, והמנהל הפסיק
  // להסתכל בה בכלל.
  //
  // ⚠️ אותו בורר סינון: "פתוחות" מציג רק NEW, ו"הכל"/"הושלמו"
  // מציג גם טופלו. כך יש דרך לחזור ולראות היסטוריה, בלי שהיא
  // תחסום את העבודה השוטפת.
  const visibleMessages =
    filter === "open"
      ? messages.filter((m) => m.status === "NEW")
      : filter === "all" || filter === "COMPLETED"
        ? messages
        : messages.filter((m) => m.status === "NEW");

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-extrabold text-brand-slatedark">
          בקשות פתיחת חשבון בטלפון
        </h1>
        <p className="text-sm text-brand-slate/60 mt-0.5">
          לקוחות שנרשמו במערכת הטלפונית וממתינים שנציג יצור קשר ויעדכן פרטי
          אשראי. עד אז הם לא יכולים להזמין.
        </p>
      </div>

      {/* §166: תזכורת על בקשות שנדחו.
          
          🐛 הפער: בקשה שסומנה "לא הושלם" נעלמה מ"פתוחות" - וזה
          נכון, אחרת הרשימה מתמלאת. אבל היא גם **נעלמה מהתודעה**:
          איש לא חזר אליהן, והלקוחות פשוט לא הצטרפו.
          
          ⚠️ הבאנר מוצג רק כשיש כאלה, ורק כשלא מסתכלים עליהן
          כרגע - אחרת הוא רעש כפול. */}
      {deferredCount > 0 && filter !== "FAILED" && (
        <button
          onClick={() => setFilter("FAILED")}
          className="w-full text-right card p-3 border-violet-300 bg-violet-50 hover:bg-violet-100 transition-colors"
        >
          <div className="flex items-center justify-between gap-2">
            <div>
              <div className="font-bold text-violet-900 text-sm">
                ⏳ {deferredCount} בקשות ממתינות לחזרה
              </div>
              <div className="text-xs text-violet-800 mt-0.5">
                לקוחות שיצרו איתם קשר ולא השלימו. שווה לחזור אליהם לפני
                המכירה הבאה.
              </div>
            </div>
            <span className="text-violet-700 text-xl shrink-0">←</span>
          </div>
        </button>
      )}

      {(openCount > 0 || messages.some((m) => m.status === "NEW")) && (
        <div className="card p-3 border-amber-300 bg-amber-50 text-sm text-amber-900">
          {openCount > 0 && <span>{openCount} בקשות ממתינות לטיפול. </span>}
          {messages.filter((m) => m.status === "NEW").length > 0 && (
            <span>
              {messages.filter((m) => m.status === "NEW").length} הודעות חדשות מהטלפון.
            </span>
          )}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <select
          className="input max-w-[200px]"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          aria-label="סינון לפי סטטוס"
        >
          {FILTERS.map((f) => (
            <option key={f.value} value={f.value}>
              {f.label}
            </option>
          ))}
        </select>
        <button onClick={load} className="btn-ghost btn-sm" disabled={loading}>
          רענן
        </button>
        {!loading && (
          <span className="text-sm text-brand-slate/60 mr-auto">
            {rows.length} בקשות
          </span>
        )}
      </div>

      {err && (
        <div className="card p-4 border-red-200 bg-red-50 text-sm text-red-800">
          שגיאה: {err}
        </div>
      )}

      {loading ? (
        <p className="text-zinc-500">טוען...</p>
      ) : rows.length === 0 ? (
        <div className="card p-6 text-center">
          <p className="font-medium text-brand-slatedark">אין בקשות</p>
          <p className="text-sm text-brand-slate/60 mt-1">
            {isAgent
              ? "אין בקשות פתוחות בנקודות שלך."
              : "בקשה נוצרת כשלקוח נרשם דרך המערכת הטלפונית."}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {rows.map((r) => {
            // הטוקן הוא מקור האמת - סטטוס יכול להיות לא מעודכן
            const done = r.hasToken;
            const stale = done && r.status !== "COMPLETED";
            return (
              <div
                key={r.id}
                className={`card p-4 ${
                  done
                    ? "border-emerald-300"
                    : r.daysWaiting >= 3
                      ? "border-amber-300"
                      : ""
                }`}
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-bold text-brand-slatedark">
                        {r.customerName}
                      </span>
                      <span
                        className={`badge ${
                          STATUS_COLORS[done ? "COMPLETED" : r.status] ?? "bg-zinc-100"
                        }`}
                      >
                        {STATUS_LABELS[done ? "COMPLETED" : r.status] ?? r.status}
                      </span>
                      {done && r.cardLast4 && (
                        <span className="text-xs text-emerald-700" dir="ltr">
                          ****{r.cardLast4}
                        </span>
                      )}
                      {!done && r.daysWaiting > 0 && (
                        <span
                          className={`text-xs ${
                            r.daysWaiting >= 3 ? "text-red-700 font-bold" : "text-zinc-500"
                          }`}
                        >
                          ממתין <bdi>{r.daysWaiting}</bdi> ימים
                        </span>
                      )}
                    </div>
                    <div className="text-sm text-zinc-600 mt-1" dir="ltr">
                      {r.phone}
                    </div>
                    <div className="text-xs text-zinc-500 mt-0.5">
                      📍 {r.pointName}
                      {r.pointCity && ` — ${r.pointCity}`}
                    </div>
                    {r.note && (
                      <div className="text-xs text-zinc-600 mt-1">הערה: {r.note}</div>
                    )}
                    {r.failReason && (
                      <div className="text-xs text-violet-800 bg-violet-50 border border-violet-200 rounded px-2 py-1 mt-1.5 inline-block">
                        ⏳ {r.failReason}
                        {/* §166: כמה זמן עבר - זה מה שקובע אם
                            שווה לחזור עכשיו. "לא ענה" מלפני יומיים
                            שונה מ"לא ענה" מלפני חודש. */}
                        {r.contactedAt && (
                          <span className="text-violet-600">
                            {" · "}
                            {Math.floor(
                              (Date.now() - new Date(r.contactedAt).getTime()) /
                                86400000
                            )}{" "}
                            ימים
                          </span>
                        )}
                      </div>
                    )}
                  </div>

                  <div className="text-xs text-zinc-400 shrink-0 text-left">
                    <div>נרשם: {fmtDate(r.createdAt)}</div>
                    {r.contactedAt && <div>יצרו קשר: {fmtDate(r.contactedAt)}</div>}
                  </div>
                </div>

                {stale && (
                  <p className="text-xs text-emerald-700 mt-2">
                    ללקוח כבר יש כרטיס שמור — הבקשה תיסגר אוטומטית.
                  </p>
                )}

                {!done && (
                  <div className="mt-3 pt-3 border-t border-zinc-100 flex flex-wrap gap-2">
                    <a href={`tel:${r.phone}`} className="btn-ghost btn-sm">
                      📞 חייג
                    </a>
                    {/* 🐛 תוקן: הקישור הוביל למסך הלקוחות, שבו אין בכלל
                        אפשרות לעדכן אשראי - הוא עורך שם/טלפון/הרשאות בלבד.
                        UpdateCardButton פותח את טופס נדרים המאובטח בשם הלקוח,
                        וזה בדיוק מה שהנציג צריך תוך כדי השיחה איתו. */}
                    <UpdateCardButton
                      customerId={r.customerId}
                      hasCurrentCard={r.hasToken}
                      cardLast4={r.cardLast4}
                      buttonLabel="💳 עדכון כרטיס"
                      buttonClassName="btn-primary btn-sm"
                      onSuccess={load}
                    />
                    <Link
                      // §109: פתיחה ישירה של כרטיס הלקוח.
                      //
                      // 🐛 מה שהיה: ?q=<טלפון> רק *מילא את החיפוש*.
                      // המנהל הגיע לרשימה, נאלץ לאתר את השורה
                      // ולפתוח אותה - בזמן שהמזהה המדויק כבר היה
                      // בידינו כאן (r.customerId).
                      //
                      // openCustomer פותח את מודל העריכה מיד; q נשאר
                      // כנפילה אם הלקוח לא נמצא (למשל נמחק).
                      href={`/admin/customers?openCustomer=${encodeURIComponent(
                        r.customerId
                      )}&q=${encodeURIComponent(r.phone)}`}
                      className="btn-ghost btn-sm"
                      title="לאיפוס סיסמה כדי שהלקוח יוכל להיכנס לאתר בעצמו"
                    >
                      כרטיס לקוח
                    </Link>
                    {r.status !== "CONTACTED" && (
                      <button
                        onClick={() => act(r.id, "contacted")}
                        disabled={busyId === r.id}
                        className="btn-ghost btn-sm"
                      >
                        סמן שיצרתי קשר
                      </button>
                    )}
                    {/* §166: דחייה לחזרה - עם סיבות מהירות.
                        
                        ⚠️ prompt חופשי גרם לנציג לכתוב "לא רצה" או
                        לוותר ולא לסמן בכלל. סיבות מוכנות הופכות את
                        זה ללחיצה אחת, וכך הבקשה באמת יוצאת
                        מהרשימה במקום להצטבר בה.
                        
                        ⚠️ "ממתין לחזרה" ולא "לא הושלם": זה לא סוף
                        הדרך - הבקשה חוזרת בבאנר, ואפשר לפתוח
                        אותה מחדש. */}
                    <button
                      onClick={() => setDeferFor(r.id)}
                      disabled={busyId === r.id}
                      className="btn-ghost btn-sm text-violet-700"
                    >
                      ⏳ ממתין לחזרה
                    </button>
                    <button
                      onClick={() => {
                        const note = prompt("הערה:", r.note || "");
                        if (note !== null) act(r.id, "note", { note });
                      }}
                      disabled={busyId === r.id}
                      className="btn-ghost btn-sm"
                    >
                      הערה
                    </button>
                    {/* §56: מחיקה. באדום ובקצה, כי היא בלתי הפיכה. */}
                    <button
                      onClick={() => remove(r)}
                      disabled={busyId === r.id}
                      className="btn-ghost btn-sm text-red-700 hover:bg-red-50 mr-auto"
                      title="מחיקת הבקשה וחשבון הלקוח שנוצר עבורה"
                    >
                      🗑 מחק בקשה
                    </button>
                  </div>
                )}

                {r.status === "FAILED" && (
                  <div className="mt-3 pt-3 border-t border-zinc-100 flex gap-2 flex-wrap">
                    {/* §166: חיוג ישיר גם כאן. זו כל מטרת המסך
                        הזה - לחזור אליהם, ובלי הכפתור המנהל היה
                        צריך להעתיק את המספר ידנית. */}
                    <a href={`tel:${r.phone}`} className="btn-ghost btn-sm">
                      📞 חייג
                    </a>
                    <button
                      onClick={() => act(r.id, "reopen")}
                      disabled={busyId === r.id}
                      className="btn-primary btn-sm"
                    >
                      ↻ החזר לטיפול
                    </button>
                    <button
                      onClick={() => remove(r)}
                      disabled={busyId === r.id}
                      className="btn-ghost btn-sm text-red-700 hover:bg-red-50 mr-auto"
                    >
                      🗑 מחק בקשה
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* §166: בורר סיבת הדחייה.
          
          ⚠️ הסיבה חשובה: היא מה שיגיד לך בעוד שבועיים למי שווה
          לחזור ולמי לא. "לא ענה" ו"לא מעוניין" הם שני עולמות. */}
      {deferFor && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-end sm:items-center justify-center p-0 sm:p-4">
          <div className="bg-white w-full max-w-sm sm:rounded-2xl rounded-t-2xl p-5 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="font-extrabold text-brand-slatedark">
                ⏳ העברה ל&quot;ממתין לחזרה&quot;
              </h3>
              <button
                onClick={() => setDeferFor(null)}
                className="text-zinc-400 text-2xl leading-none px-1"
              >
                ×
              </button>
            </div>
            <p className="text-xs text-zinc-500 leading-relaxed">
              הבקשה תצא מהרשימה הפתוחה ותופיע בתזכורת. אפשר לפתוח אותה
              מחדש בכל רגע.
            </p>
            <div className="space-y-2">
              {[
                "לא ענה לטלפון",
                "ביקש שנחזור אליו מאוחר יותר",
                "לא רצה להזין כרטיס כרגע",
                "לא מעוניין כרגע",
                "מספר טלפון שגוי",
              ].map((reason) => (
                <button
                  key={reason}
                  onClick={() => {
                    act(deferFor, "fail", { reason });
                    setDeferFor(null);
                  }}
                  className="w-full text-right px-3 py-2.5 rounded-lg border-2 border-zinc-200 hover:border-violet-400 hover:bg-violet-50 text-sm font-medium text-brand-slatedark transition-colors"
                >
                  {reason}
                </button>
              ))}
              <button
                onClick={() => {
                  const reason = prompt("סיבה אחרת:");
                  if (reason !== null && reason.trim()) {
                    act(deferFor, "fail", { reason: reason.trim() });
                    setDeferFor(null);
                  }
                }}
                className="w-full text-right px-3 py-2.5 rounded-lg border border-zinc-200 text-xs text-zinc-500"
              >
                סיבה אחרת…
              </button>
            </div>
          </div>
        </div>
      )}

      {/* §25: הודעות שלקוחות השאירו בשיחה.
          עד כה הן נכתבו ל-DB ואף אחד לא יכול היה לראות אותן. */}
      {visibleMessages.length > 0 && (
        <div className="pt-4 border-t border-zinc-200">
          <h2 className="text-lg font-bold text-brand-slatedark mb-1">
            הודעות מהטלפון
          </h2>
          <p className="text-sm text-brand-slate/60 mb-3">
            לקוחות שהשאירו הודעה או ביקשו שיחזרו אליהם
          </p>
          <div className="space-y-2">
            {visibleMessages.map((m) => (
              <div
                key={m.id}
                className={`card p-3 ${m.status === "NEW" ? "border-amber-300" : ""}`}
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-brand-slatedark" dir="ltr">
                        {m.phone}
                      </span>
                      {m.customerName && (
                        <span className="text-sm text-zinc-600">{m.customerName}</span>
                      )}
                      <span
                        className={`badge ${
                          m.status === "NEW"
                            ? "bg-amber-100 text-amber-800"
                            : "bg-zinc-100 text-zinc-500"
                        }`}
                      >
                        {m.status === "NEW" ? "חדש" : "טופל"}
                      </span>
                      {m.kind === "CALLBACK" && (
                        <span className="text-xs text-zinc-500">ביקש שיחזרו אליו</span>
                      )}
                    </div>
                    {m.transcript && (
                      <p className="text-sm text-zinc-700 mt-1">{m.transcript}</p>
                    )}
                    {m.adminNote && (
                      <p className="text-xs text-zinc-500 mt-1">הערה: {m.adminNote}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-xs text-zinc-400">{fmtDate(m.createdAt)}</span>
                    <a href={`tel:${m.phone}`} className="btn-ghost btn-sm">
                      📞
                    </a>
                    {/* §164: הקמת לקוח **מכאן**.
                        
                        🐛 מה שהיה: המנהל חוזר ללקוח שביקש שיחזרו
                        אליו, הלקוח מעוניין להירשם - ולא הייתה שום
                        דרך להקים אותו במקום. הוא נאלץ לעבור למסך
                        הלקוחות, ליצור, ואז לחזור לכאן לסמן כטופל.
                        
                        ⚠️ מוצג רק כשאין ללקוח חשבון (customerId
                        ריק). למי שכבר רשום זה היה מייצר כפילות. */}
                    {/* §165: לקוח שכבר קיים - קישור לכרטיס במקום
                        כפתור הקמה שייכשל. */}
                    {m.status === "NEW" && m.existingCustomer && (
                      <a
                        href={`/admin/customers?openCustomer=${encodeURIComponent(
                          m.existingCustomer.id
                        )}`}
                        className="btn-ghost btn-sm text-emerald-700 whitespace-nowrap"
                        title="הלקוח כבר קיים במערכת"
                      >
                        ✓ {m.existingCustomer.name}
                      </a>
                    )}
                    {m.status === "NEW" &&
                      !m.customerId &&
                      !m.existingCustomer &&
                      points.length > 0 && (
                      <AdminAddCustomerButton
                        points={points}
                        // §164: הטלפון כבר ידוע מההודעה
                        initialPhone={m.phone}
                        label="➕ הקם לקוח"
                        className="!px-2.5 !py-1 !text-xs"
                        onCreated={() => {
                          // ⚠️ סימון אוטומטי כטופל: המנהל הקים את
                          // הלקוח, וזו בדיוק הסיבה שהוא התקשר. השארת
                          // ההודעה פתוחה הייתה מייצרת עבודה כפולה.
                          act(m.id, "message_handled", {
                            note: "הוקם לקוח מההודעה",
                          });
                        }}
                      />
                    )}
                    {m.status === "NEW" && (
                      <button
                        onClick={() => {
                          const note = prompt("הערה (אופציונלי):");
                          act(m.id, "message_handled", note ? { note } : undefined);
                        }}
                        disabled={busyId === m.id}
                        className="btn-ghost btn-sm"
                      >
                        סמן כטופל
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
