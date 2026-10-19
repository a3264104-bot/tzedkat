"use client";

// מסך /admin/broadcast - שליחת הודעה למספר לקוחות בבת אחת
// 3 מצבים: כולם / לפי נקודת חלוקה / בחירה ידנית

import { useEffect, useState, useMemo } from "react";
import {
  MAX_BROADCAST_ATTACHMENTS,
  type BroadcastAttachment,
} from "@/lib/broadcast-attachments";

type Point = { id: string; name: string; city: string | null };
type Customer = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  pointId: string | null;
  pointName: string | null;
  agreedToEmails: boolean;
};

export default function AdminBroadcastPage() {
  const [loading, setLoading] = useState(true);
  const [points, setPoints] = useState<Point[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);

  // תוכן ההודעה
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  // §32: האם ליצור גם הודעה קולית שתוקרא למתקשרים למערכת הטלפונית.
  // דלוק כברירת מחדל - רוב הברודקסטים הם עדכונים תפעוליים שרלוונטיים
  // גם ללקוחות הטלפוניים, שאין להם מייל בכלל.
  const [alsoPhone, setAlsoPhone] = useState(true);

  // §330: 🚚 תזכורת חלוקה — הועברה לכאן מסיכום המכירה.
  //
  // הכפתור ישב בסיכום המכירה, שהוא **דוח** ולא מסך פעולות.
  // שליחת מיילים היא פעולה, ומקומה במסך אחד - אחרת המנהל
  // מחפש אותה בשלושה מקומות.
  //
  // ⚠️ ובורר מכירה: בסיכום המכירה ההקשר היה מובן מאליו (אתה
  // בתוך מכירה), וכאן צריך לבחור.
  const [mailKind, setMailKind] = useState<"free" | "reminder">("free");
  const [sales, setSales] = useState<
    Array<{ id: string; name: string; deliveryDateText: string | null }>
  >([]);
  const [reminderSaleId, setReminderSaleId] = useState("");
  const [reminderPreview, setReminderPreview] = useState<{
    count: number;
    points: number;
  } | null>(null);
  const [sendingReminder, setSendingReminder] = useState(false);
  // §36: מתי ההודעה הקולית מפסיקה להישמע. חובה - הודעה כמו "החלוקה
  // נדחתה לשעה 18:00" שממשיכה להישמע מחרתיים היא שקר. במייל אין בעיה
  // כי הוא מגיע פעם אחת, אבל הודעה קולית נשמעת בכל שיחה.
  // ברירת מחדל: סוף היום הנוכחי.
  const [phoneExpiry, setPhoneExpiry] = useState(() => {
    const d = new Date();
    d.setHours(23, 59, 0, 0);
    // פורמט datetime-local: YYYY-MM-DDTHH:mm
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  });

  // §403: 📣 נוסח מוכן — "פתיחת מכירה". הטקסט מגיע **ממולא** (שם המכירה,
  // תאריכים) — המנהל לא רואה משתנים בסוגריים, ולא יכול לשבור אותם.
  const [launchSales, setLaunchSales] = useState<Array<{ id: string; name: string }>>([]);
  const [launchId, setLaunchId] = useState("");
  const [launchInfo, setLaunchInfo] = useState<{
    name: string;
    launchSentAt: string | null;
    launchSentCount: number;
    heardCount: number | null;
  } | null>(null);
  const [phoneText, setPhoneText] = useState("");
  const [launchLoading, setLaunchLoading] = useState(false);
  const [tplMsg, setTplMsg] = useState("");
  // §404: 📎 תמונה / PDF למייל
  const [attachments, setAttachments] = useState<BroadcastAttachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadErr, setUploadErr] = useState("");

  /** §404: העלאה מיד בבחירה — התמונה הגדולה מוקטנת קודם בדפדפן */
  async function addFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setUploadErr("");
    const room = MAX_BROADCAST_ATTACHMENTS - attachments.length;
    if (room <= 0) {
      setUploadErr(`אפשר לצרף עד ${MAX_BROADCAST_ATTACHMENTS} קבצים`);
      return;
    }
    setUploading(true);
    try {
      for (const original of Array.from(files).slice(0, room)) {
        const isPdf = original.type === "application/pdf";
        if (!isPdf && !original.type.startsWith("image/")) {
          throw new Error(`"${original.name}" — אפשר לצרף רק תמונה או PDF`);
        }
        const file = isPdf ? original : await shrinkImage(original);
        if (file.size > 4 * 1024 * 1024) {
          throw new Error(`"${original.name}" גדול מדי (מקסימום 4MB)`);
        }
        const form = new FormData();
        form.append("file", file);
        form.append("purpose", "broadcast");
        const res = await fetch("/api/admin/upload", { method: "POST", body: form });
        const d = await res.json().catch(() => ({}));
        if (!res.ok || !d.url) throw new Error(d.error || `ההעלאה נכשלה (${res.status})`);
        setAttachments((prev) => [
          ...prev,
          { url: d.url, filename: original.name, kind: d.kind === "pdf" ? "pdf" : "image" },
        ]);
      }
    } catch (e: any) {
      setUploadErr(e.message || "ההעלאה נכשלה");
    } finally {
      setUploading(false);
    }
  }

  // מצב הבחירה
  const [mode, setMode] = useState<"all" | "point" | "manual">("all");
  const [selectedPointIds, setSelectedPointIds] = useState<Set<string>>(new Set());
  const [selectedCustomerIds, setSelectedCustomerIds] = useState<Set<string>>(new Set());
  const [customerSearch, setCustomerSearch] = useState("");

  // מצב שליחה
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string; logId?: string | null } | null>(null);
  // שליחה חוזרת לנמענים שנכשלו בשליחה קודמת (מיומן השליחות: ?retryLog=<id>)
  const [retry, setRetry] = useState<{ logId: string; subject: string; count: number } | null>(null);

  useEffect(() => {
    let id = "";
    try {
      id = new URLSearchParams(window.location.search).get("retryLog") || "";
    } catch {
      // כתובת לא תקינה — שליחה רגילה
    }
    if (!id) return;
    fetch(`/api/admin/broadcast/logs/${id}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        const ids: string[] = (d.recipients ?? [])
          .filter((r: any) => r.status !== "SENT" && r.customerId)
          .map((r: any) => r.customerId);
        if (ids.length === 0) return;
        setMode("manual");
        setSelectedCustomerIds(new Set(ids));
        setAlsoPhone(false);
        if (d.subject) setSubject(d.subject);
        setRetry({ logId: id, subject: d.subject ?? "", count: ids.length });
      })
      .catch(() => {});
  }, []);

  // §330: המכירות הפעילות — לבורר התזכורת.
  //
  // ⚠️ רק ACTIVE ו-CLOSED: תזכורת חלוקה למכירה שהסתיימה היא
  // הודעה על משהו שכבר קרה.
  useEffect(() => {
    if (mailKind !== "reminder") return;
    fetch("/api/admin/pricelists", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : []))
      .then((rows: any[]) =>
        setSales(
          (Array.isArray(rows) ? rows : [])
            .filter((p) => p.status === "ACTIVE" || p.status === "CLOSED")
            .map((p) => ({
              id: p.id,
              name: p.name,
              deliveryDateText: p.deliveryDateText ?? null,
            }))
        )
      )
      .catch(() => setSales([]));
  }, [mailKind]);

  // §330: תצוגה מקדימה — כמה לקוחות יקבלו.
  //
  // ⚠️ לפני השליחה ולא אחריה: "נשלח ל-0 לקוחות" זו הפתעה
  // שאפשר למנוע.
  useEffect(() => {
    if (!reminderSaleId) {
      setReminderPreview(null);
      return;
    }
    fetch(`/api/admin/delivery-reminder?pricelistId=${reminderSaleId}`, {
      cache: "no-store",
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) =>
        setReminderPreview(
          d ? { count: d.count ?? 0, points: d.points ?? 0 } : null
        )
      )
      .catch(() => setReminderPreview(null));
  }, [reminderSaleId]);

  async function sendReminder() {
    if (!reminderSaleId) return;
    const n = reminderPreview?.count ?? 0;
    if (
      !window.confirm(
        `לשלוח תזכורת חלוקה ל-${n} לקוחות?\n\nכל אחד יקבל את הנקודה, התאריך והסכום שלו.`
      )
    )
      return;
    setSendingReminder(true);
    try {
      const res = await fetch("/api/admin/delivery-reminder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pricelistId: reminderSaleId }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || `שגיאה (${res.status})`);
      alert(`נשלחו ${d.sent ?? 0} תזכורות`);
    } catch (e: any) {
      alert(e?.message || "שגיאה");
    } finally {
      setSendingReminder(false);
    }
  }

  // §403: מכירות שאפשר להודיע על פתיחתן — פעילות, ללקוחות, לפני סגירה
  useEffect(() => {
    fetch("/api/admin/pricelists", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : []))
      .then((rows: any[]) => {
        const now = Date.now();
        setLaunchSales(
          (Array.isArray(rows) ? rows : [])
            .filter(
              (p) =>
                p.status === "ACTIVE" &&
                !p.agentOnly &&
                !(p.closeDate && new Date(p.closeDate).getTime() < now)
            )
            .map((p) => ({ id: p.id, name: p.name }))
        );
      })
      .catch(() => setLaunchSales([]));
    // §403: הגיעו מכפתור "📣 הודעת פתיחה" במסך המכירות
    try {
      const id = new URLSearchParams(window.location.search).get("launch");
      if (id) {
        setMailKind("free");
        applyLaunch(id);
      }
    } catch {
      // אין URL — לא קריטי
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** §403: בחירת "פתיחת מכירה" — ממלא כותרת, תוכן וטלפון מהנוסח הקבוע */
  async function applyLaunch(id: string) {
    setLaunchId(id);
    setTplMsg("");
    setResult(null);
    if (!id) {
      setLaunchInfo(null);
      return;
    }
    setLaunchLoading(true);
    try {
      const res = await fetch(`/api/admin/sale-launch?pricelistId=${encodeURIComponent(id)}`, {
        cache: "no-store",
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || "שגיאה בטעינת הנוסח");
      setSubject(d.filled.subject);
      setMessage(d.filled.email);
      setPhoneText(d.filled.phone);
      // שליחה חוזרת: רק הנוסח. הנמענים נשארים מי שנכשל, ובלי הודעה טלפונית חדשה
      if (retry) return;
      setAlsoPhone(true);
      setLaunchInfo({
        name: d.sale.name,
        launchSentAt: d.sale.launchSentAt,
        launchSentCount: d.sale.launchSentCount,
        heardCount: d.phoneAnnouncement ? d.phoneAnnouncement.heardCount : null,
      });
      // מכירה שבועית — רק הנקודות שלה. רגילה — כל הלקוחות.
      if (d.sale.weekly && Array.isArray(d.sale.pointIds)) {
        setMode("point");
        setSelectedPointIds(new Set<string>(d.sale.pointIds));
      } else {
        setMode("all");
      }
    } catch (e: any) {
      setResult({ ok: false, text: e.message || "שגיאה" });
      setLaunchId("");
      setLaunchInfo(null);
    } finally {
      setLaunchLoading(false);
    }
  }

  /** §403: שמירת הטקסט הנוכחי כנוסח הקבוע — השם והתאריכים יתחלפו לבד */
  async function saveLaunchTemplate() {
    setTplMsg("");
    try {
      const res = await fetch("/api/admin/sale-launch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pricelistId: launchId, subject, email: message, phone: phoneText }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || "שגיאה");
      setTplMsg("✓ נשמר. בפתיחת המכירה הבאה הטקסט יגיע כך — עם השם והתאריכים שלה.");
    } catch (e: any) {
      setTplMsg("⚠️ " + (e.message || "שגיאה"));
    }
  }

  useEffect(() => {
    fetch("/api/admin/broadcast/recipients")
      .then((r) => r.json())
      .then((data) => {
        setPoints(data.points || []);
        setCustomers(data.customers || []);
        setLoading(false);
      })
      .catch((e) => {
        console.error(e);
        setLoading(false);
      });
  }, []);

  // חישוב מספר הנמענים לפי המצב הנוכחי - סופרים רק את מי שאישר!
  // (הסינון בפועל בשליחה בשרת יוודא זאת שוב, זו רק תצוגה מדויקת למנהל)
  const recipientCount = useMemo(() => {
    const consented = customers.filter((c) => c.agreedToEmails);
    if (mode === "all") return consented.length;
    if (mode === "point") {
      if (selectedPointIds.size === 0) return 0;
      return consented.filter(
        (c) => c.pointId && selectedPointIds.has(c.pointId)
      ).length;
    }
    // manual: המנהל בחר לקוחות ידנית - אנחנו סופרים רק את המאושרים מתוך הבחירה
    return consented.filter((c) => selectedCustomerIds.has(c.id)).length;
  }, [mode, customers, selectedPointIds, selectedCustomerIds]);

  // נתונים סטטיסטיים לתצוגה למנהל
  const stats = useMemo(() => {
    const total = customers.length;
    const consented = customers.filter((c) => c.agreedToEmails).length;
    return { total, consented, notConsented: total - consented };
  }, [customers]);

  // סינון לקוחות לחיפוש (במצב manual)
  const filteredCustomers = useMemo(() => {
    if (!customerSearch.trim()) return customers;
    const q = customerSearch.trim().toLowerCase();
    return customers.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        (c.email && c.email.toLowerCase().includes(q)) ||
        (c.phone && c.phone.includes(q)) ||
        (c.pointName && c.pointName.toLowerCase().includes(q))
    );
  }, [customers, customerSearch]);

  function togglePoint(id: string) {
    const next = new Set(selectedPointIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedPointIds(next);
  }

  function toggleCustomer(id: string) {
    const next = new Set(selectedCustomerIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedCustomerIds(next);
  }

  function selectAllFiltered() {
    const next = new Set(selectedCustomerIds);
    filteredCustomers.forEach((c) => next.add(c.id));
    setSelectedCustomerIds(next);
  }

  function deselectAll() {
    setSelectedCustomerIds(new Set());
  }

  async function handleSend(force = false) {
    if (!subject.trim()) {
      alert("יש להזין כותרת");
      return;
    }
    if (alsoPhone && !launchId && !phoneExpiry) {
      alert("יש לקבוע מתי ההודעה הקולית מפסיקה להישמע");
      return;
    }
    if (!message.trim()) {
      alert("יש להזין תוכן הודעה");
      return;
    }
    if (recipientCount === 0) {
      alert("לא נבחרו נמענים");
      return;
    }

    if (launchId && alsoPhone && !phoneText.trim()) {
      alert("יש למלא את הנוסח שיוקרא בטלפון");
      return;
    }
    const confirmMsg =
      `לשלוח את ההודעה ל-${recipientCount} נמענים?\n\n` +
      `כותרת: ${subject}\n\n` +
      (launchId && alsoPhone ? `📞 בטלפון: כל מתקשר ישמע את ההודעה פעם אחת.\n\n` : "") +
      (attachments.length > 0 ? `📎 מצורפים: ${attachments.map((a) => a.filename).join(", ")}\n\n` : "") +
      `המשלוח יתבצע ברקע ועשוי לקחת כמה דקות (בהתאם למספר הנמענים).`;
    if (!force && !confirm(confirmMsg)) return;

    setSending(true);
    setResult(null);
    try {
      const res = await fetch("/api/admin/broadcast", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subject: subject.trim(),
          message: message.trim(),
          mode,
          pointIds: mode === "point" ? Array.from(selectedPointIds) : [],
          customerIds: mode === "manual" ? Array.from(selectedCustomerIds) : [],
          alsoPhone,
          phoneExpiry: alsoPhone && !launchId ? phoneExpiry : null,
          // §403: 📣 פתיחת מכירה
          // ⚠️ לא בשליחה חוזרת לנכשלים: היא הייתה מסמנת שוב "נשלחה הודעת פתיחה"
          // עם מספר הנמענים החלקי, ויוצרת הודעה טלפונית חדשה שכולם ישמעו שוב.
          ...(launchId && !retry ? { launchPricelistId: launchId, phoneText: phoneText.trim(), force } : {}),
          // §404: 📎
          attachments,
        }),
      });
      const data = await res.json();
      // §403: הודעת פתיחה כבר נשלחה למכירה הזו — לשאול לפני שליחה חוזרת
      if (res.status === 409 && data.code === "ALREADY_SENT") {
        setSending(false);
        if (confirm(`${data.error}\n\nלשלוח שוב לכולם?`)) return handleSend(true);
        return;
      }
      if (res.ok && data.ok) {
        setResult({
          ok: true,
          text: `נשלחו הוראות שליחה ל-${data.recipientCount} נמענים. המערכת שולחת ברקע.`,
          logId: data.logId ?? null,
        });
        setRetry(null);
        // מנקה את הטופס
        setSubject("");
        setMessage("");
        setPhoneText("");
        setAttachments([]);
        setLaunchId("");
        setLaunchInfo(null);
        setSelectedPointIds(new Set());
        setSelectedCustomerIds(new Set());
      } else {
        setResult({ ok: false, text: data.error || "שגיאה" });
      }
    } catch (e: any) {
      setResult({ ok: false, text: e.message || "שגיאת רשת" });
    } finally {
      setSending(false);
    }
  }

  if (loading) {
    return (
      <div dir="rtl" className="p-6 text-zinc-500">
        טוען נתונים...
      </div>
    );
  }

  return (
    <div dir="rtl" className="max-w-4xl mx-auto p-4 md:p-6 space-y-5">
      <div>
        <h1 className="text-2xl font-extrabold text-brand-slatedark">
          📧 שליחת הודעה ללקוחות
        </h1>
        <p className="text-sm text-zinc-500 mt-1">
          שולח מייל לכל הלקוחות הרשומים עם כתובת מייל.{" "}
          <a href="/admin/broadcast/history" className="font-bold text-brand-rust hover:underline">
            יומן שליחות ←
          </a>
        </p>
      </div>

      {retry && (
        <div className="rounded-2xl border-2 border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
          <p className="font-extrabold">🔁 שליחה חוזרת ל-{retry.count} נמענים שלא קיבלו את ההודעה</p>
          <p className="mt-1">
            מתוך: "{retry.subject}". הנמענים כבר מסומנים (רק מי שנכשל) — בחר את הנוסח
            (למשל נוסח הפתיחה של המכירה), צרף את הקובץ אם היה, ושלח. מי שכבר קיבל לא יקבל שוב,
            ולא תיווצר הודעה טלפונית חדשה.
          </p>
        </div>
      )}

      {/* §330: 🚚 בורר סוג המייל.
          
          התזכורת ישבה בסיכום המכירה - מסך שהוא **דוח**, לא מסך
          פעולות. המנהל חיפש שליחת מיילים בשלושה מקומות.
          
          ⚠️ ובורר מכירה: בסיכום ההקשר היה מובן מאליו (אתה בתוך
          מכירה), וכאן צריך לבחור. */}
      <div className="bg-white rounded-2xl border border-zinc-200 shadow-sm p-4 mb-3">
        <div className="text-xs font-bold text-zinc-500 mb-2">סוג המייל</div>
        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={() => setMailKind("free")}
            className={`py-2.5 rounded-xl border-2 font-bold text-sm transition-colors ${
              mailKind === "free"
                ? "border-brand-rust bg-brand-rust/10 text-brand-rust"
                : "border-zinc-200 text-zinc-500"
            }`}
          >
            ✉️ הודעה חופשית
          </button>
          <button
            onClick={() => setMailKind("reminder")}
            className={`py-2.5 rounded-xl border-2 font-bold text-sm transition-colors ${
              mailKind === "reminder"
                ? "border-violet-600 bg-violet-50 text-violet-700"
                : "border-zinc-200 text-zinc-500"
            }`}
          >
            🚚 תזכורת חלוקה
          </button>
        </div>

        {mailKind === "reminder" && (
          <div className="mt-3 pt-3 border-t border-zinc-100 space-y-2">
            <label className="text-xs font-bold text-zinc-500 block">
              לאיזו מכירה?
            </label>
            <select
              value={reminderSaleId}
              onChange={(e) => setReminderSaleId(e.target.value)}
              className="w-full px-3 py-2.5 border-2 border-zinc-300 rounded-lg text-sm font-bold"
            >
              <option value="">— בחר מכירה —</option>
              {sales.map((sl) => (
                <option key={sl.id} value={sl.id}>
                  {sl.name}
                  {sl.deliveryDateText ? ` · ${sl.deliveryDateText}` : ""}
                </option>
              ))}
            </select>

            {/* ⚠️ התצוגה המקדימה לפני השליחה: "נשלח ל-0 לקוחות"
                זו הפתעה שאפשר למנוע. */}
            {reminderPreview && (
              <div className="rounded-lg bg-violet-50 border border-violet-200 px-3 py-2 text-xs text-violet-900">
                <b>{reminderPreview.count} לקוחות</b> יקבלו תזכורת
                {reminderPreview.points > 0 && (
                  <span> · {reminderPreview.points} נקודות חלוקה</span>
                )}
                <div className="text-[11px] text-violet-800 mt-0.5">
                  כל אחד מקבל את הנקודה, התאריך והסכום שלו.
                </div>
              </div>
            )}

            <button
              onClick={sendReminder}
              disabled={!reminderSaleId || sendingReminder}
              className="w-full py-3 rounded-xl bg-violet-700 text-white font-bold disabled:opacity-40"
            >
              {sendingReminder ? "שולח..." : "🚚 שלח תזכורת חלוקה"}
            </button>
          </div>
        )}
      </div>

      {/* תוכן ההודעה */}
      {mailKind === "free" && (
      <div className="bg-white rounded-2xl border border-zinc-200 shadow-sm p-4 space-y-3">
        {/* §403: 📋 נוסח מוכן — ממלא את הטופס. בלי משתנים בסוגריים:
            הטקסט מגיע עם שם המכירה והתאריכים האמיתיים. */}
        <div className="rounded-xl bg-violet-50 border border-violet-200 p-3 space-y-1.5">
          <label className="text-xs font-bold text-violet-900 block">📋 להתחיל מנוסח מוכן</label>
          <select
            value={launchId}
            onChange={(e) => applyLaunch(e.target.value)}
            disabled={launchLoading}
            className="w-full px-3 py-2 border-2 border-violet-300 rounded-lg text-sm font-bold bg-white"
          >
            <option value="">— בלי נוסח (כותבים חופשי) —</option>
            {launchSales.map((sl) => (
              <option key={sl.id} value={sl.id}>
                📣 פתיחת מכירה: {sl.name}
              </option>
            ))}
          </select>
          {launchLoading && <p className="text-xs text-violet-700">ממלא…</p>}
          {launchId && launchInfo && !launchLoading && (
            <p className="text-xs text-violet-800 leading-relaxed">
              הטקסט מולא עם הפרטים של <b>{launchInfo.name}</b>. אפשר לשנות אותו לפני השליחה.
              {launchInfo.launchSentAt && (
                <span className="block text-amber-800 font-bold mt-0.5">
                  ⚠️ הודעת פתיחה למכירה הזו כבר נשלחה ({launchInfo.launchSentCount} נמענים).
                </span>
              )}
            </p>
          )}
        </div>

        <div>
          <label className="text-xs font-bold text-zinc-500 block mb-1">
            כותרת *
          </label>
          <input
            type="text"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder="עדכון מהמערכת"
            className="w-full px-3 py-2 border-2 border-zinc-300 rounded-lg focus:outline-none focus:border-brand-rust"
            maxLength={100}
          />
          <div className="text-[10px] text-zinc-400 mt-0.5 text-left">
            {subject.length}/100
          </div>
        </div>

        <div>
          <label className="text-xs font-bold text-zinc-500 block mb-1">
            תוכן ההודעה *
          </label>
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder={"שלום רב,\n\nהמכירה הבאה תיפתח ביום..."}
            rows={8}
            className="w-full px-3 py-2 border-2 border-zinc-300 rounded-lg focus:outline-none focus:border-brand-rust font-mono text-sm"
            maxLength={5000}
          />
          <div className="text-[10px] text-zinc-400 mt-0.5 text-left">
            {message.length}/5000 · שורות חדשות יישמרו במייל
          </div>
        </div>

        {/* §404: 📎 תמונה (מוצגת בתוך המייל) או PDF (מצורף) */}
        <div className="rounded-lg border border-dashed border-zinc-300 p-3 space-y-2">
          <div className="flex items-center gap-2 flex-wrap">
            <label
              className={`text-sm font-bold px-3 py-1.5 rounded-lg border-2 border-zinc-300 bg-white cursor-pointer hover:border-brand-rust ${
                uploading || attachments.length >= MAX_BROADCAST_ATTACHMENTS ? "opacity-50 pointer-events-none" : ""
              }`}
            >
              {uploading ? "מעלה…" : "📎 צרף תמונה או PDF"}
              <input
                type="file"
                accept="image/*,application/pdf"
                multiple
                className="hidden"
                onChange={(e) => {
                  addFiles(e.target.files);
                  e.target.value = "";
                }}
              />
            </label>
            <span className="text-[11px] text-zinc-500">
              עד {MAX_BROADCAST_ATTACHMENTS} קבצים, 4MB כל אחד · תמונה מוצגת בתוך המייל, PDF מצורף
            </span>
          </div>
          {uploadErr && <p className="text-xs text-red-700">{uploadErr}</p>}
          {attachments.length > 0 && (
            <div className="flex gap-2 flex-wrap">
              {attachments.map((a, i) => (
                <div
                  key={a.url}
                  className="relative border border-zinc-200 rounded-lg bg-zinc-50 p-1.5 flex items-center gap-2 max-w-[220px]"
                >
                  {a.kind === "image" ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={a.url} alt="" className="w-12 h-12 object-cover rounded" />
                  ) : (
                    <span className="w-12 h-12 flex items-center justify-center text-2xl bg-white rounded">📄</span>
                  )}
                  <a href={a.url} target="_blank" rel="noreferrer" className="text-xs text-brand-slatedark truncate underline">
                    {a.filename}
                  </a>
                  <button
                    type="button"
                    onClick={() => setAttachments((prev) => prev.filter((_, j) => j !== i))}
                    className="text-zinc-400 hover:text-red-600 text-lg leading-none px-1"
                    title="הסר"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* §32: הודעה קולית מקבילה. לקוחות שנרשמו בטלפון לרוב אין להם
            מייל, וזו הדרך היחידה שהעדכון יגיע אליהם. */}
        <label className="flex items-start gap-2.5 p-3 rounded-lg bg-amber-50 border border-amber-200 cursor-pointer">
          <input
            type="checkbox"
            checked={alsoPhone}
            onChange={(e) => setAlsoPhone(e.target.checked)}
            className="w-4 h-4 mt-0.5 shrink-0 accent-brand-rust"
          />
          <span className="min-w-0">
            <span className="block text-sm font-medium text-brand-slatedark">
              {launchId ? "📞 גם בטלפון — כל מתקשר ישמע פעם אחת" : "📞 גם כהודעה קולית למתקשרים"}
            </span>
            <span className="block text-xs text-zinc-600 mt-0.5">
              {launchId ? (
                <>
                  כל לקוח שיתקשר למערכת ישמע את ההודעה בשיחה הראשונה (גם אם עוד לא הזמין),
                  ומהשיחה הבאה — את התפריט הרגיל. נשמעת עד סגירת ההזמנות.
                  {launchInfo?.heardCount != null &&
                    ` כבר יש הודעת פתיחה פעילה (${launchInfo.heardCount} שמעו) — היא תוחלף.`}
                </>
              ) : (
                <>
                  ההודעה תוקרא בטלפון ללקוחות שהזמינו במכירה הפעילה. חשוב במיוחד
                  ללקוחות שנרשמו בטלפון ואין להם מייל.
                  {mode === "point" && " ההודעה תוקרא רק בנקודות שנבחרו."}
                </>
              )}
            </span>
          </span>
        </label>

        {/* §403: בפתיחת מכירה — נוסח קצר לטלפון (מוקרא), במקום תאריך תפוגה */}
        {alsoPhone && launchId && (
          <label className="block px-3">
            <span className="text-xs font-bold text-zinc-500">מה יוקרא בטלפון</span>
            <textarea
              value={phoneText}
              onChange={(e) => setPhoneText(e.target.value)}
              rows={2}
              maxLength={450}
              className="w-full mt-1 px-3 py-2 border-2 border-zinc-300 rounded-lg text-sm"
            />
          </label>
        )}

        {/* §403: 💾 שמירה כנוסח קבוע — בלי משתנים לערוך */}
        {launchId && (
          <div className="px-3 space-y-1">
            <button
              type="button"
              onClick={saveLaunchTemplate}
              className="text-xs font-bold text-violet-800 border border-violet-300 bg-white rounded-lg px-3 py-1.5 hover:bg-violet-50"
            >
              💾 שמור את הנוסח הזה לפתיחת המכירות הבאות
            </button>
            <p className="text-[11px] text-zinc-500">
              שם המכירה והתאריכים יתחלפו לבד בכל מכירה חדשה.
            </p>
            {tplMsg && <p className="text-xs font-bold text-violet-800">{tplMsg}</p>}
          </div>
        )}

        {alsoPhone && !launchId && (
          <label className="block px-3">
            <span className="text-xs font-bold text-zinc-500">
              עד מתי ההודעה תושמע בטלפון
            </span>
            <input
              type="datetime-local"
              value={phoneExpiry}
              onChange={(e) => setPhoneExpiry(e.target.value)}
              className="input mt-1 max-w-xs"
            />
            <p className="text-xs text-zinc-600 mt-1">
              אחרי מועד זה ההודעה מפסיקה להישמע אוטומטית. חשוב במיוחד בעדכונים
              על שעות — הודעה על שינוי בחלוקה של היום לא צריכה להישמע מחר.
            </p>
          </label>
        )}
      </div>
      )}

      {/* בחירת נמענים */}
      <div className="bg-white rounded-2xl border border-zinc-200 shadow-sm p-4 space-y-3">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="font-bold text-brand-slatedark">🎯 בחירת נמענים</div>
          <div
            className={`px-3 py-1 rounded-full text-xs font-bold ${
              recipientCount > 0
                ? "bg-emerald-100 text-emerald-800"
                : "bg-zinc-100 text-zinc-500"
            }`}
          >
            {recipientCount} נמענים נבחרו
          </div>
        </div>

        {/* מצבי בחירה */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
          <ModeButton
            active={mode === "all"}
            onClick={() => setMode("all")}
            icon="🌐"
            label="כל הלקוחות"
            hint={`${stats.consented} מאושרים / ${stats.total} רשומים`}
          />
          <ModeButton
            active={mode === "point"}
            onClick={() => setMode("point")}
            icon="📍"
            label="לפי נקודת חלוקה"
            hint="בחר נקודות"
          />
          <ModeButton
            active={mode === "manual"}
            onClick={() => setMode("manual")}
            icon="👤"
            label="בחירה ידנית"
            hint="לקוח אחר לקוח"
          />
        </div>

        {stats.notConsented > 0 && (
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs text-amber-900">
            ⚠️ יש {stats.notConsented} לקוחות שלא אישרו קבלת מיילים - הם מופיעים ברשימה אבל <strong>לא יקבלו את ההודעה</strong>.
            (מסומנים באדום בבחירה ידנית.)
          </div>
        )}

        {/* תת-בחירה לפי מצב */}
        {mode === "point" && (
          <div className="border-t border-zinc-200 pt-3">
            <div className="text-xs font-bold text-zinc-500 mb-2">
              בחר נקודות חלוקה:
            </div>
            {points.length === 0 ? (
              <p className="text-sm text-zinc-500">אין נקודות פעילות</p>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {points.map((p) => {
                  const count = customers.filter(
                    (c) => c.pointId === p.id
                  ).length;
                  return (
                    <label
                      key={p.id}
                      className={`flex items-center gap-2 p-2.5 rounded-lg border cursor-pointer transition-colors ${
                        selectedPointIds.has(p.id)
                          ? "bg-emerald-50 border-emerald-300"
                          : "bg-white border-zinc-200 hover:bg-zinc-50"
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={selectedPointIds.has(p.id)}
                        onChange={() => togglePoint(p.id)}
                        className="w-4 h-4 accent-emerald-600"
                      />
                      <div className="flex-1 min-w-0">
                        <div className="font-medium text-brand-slatedark text-sm truncate">
                          {p.name}
                        </div>
                        {p.city && (
                          <div className="text-xs text-zinc-500">{p.city}</div>
                        )}
                      </div>
                      <span className="text-xs text-zinc-400 shrink-0">
                        {count}
                      </span>
                    </label>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {mode === "manual" && (
          <div className="border-t border-zinc-200 pt-3 space-y-2">
            <div className="flex items-center gap-2 flex-wrap">
              <input
                type="search"
                value={customerSearch}
                onChange={(e) => setCustomerSearch(e.target.value)}
                placeholder="חיפוש לפי שם/מייל/טלפון/נקודה..."
                className="flex-1 min-w-[200px] px-3 py-2 border-2 border-zinc-300 rounded-lg focus:outline-none focus:border-brand-rust text-sm"
              />
              <button
                onClick={selectAllFiltered}
                className="text-xs px-3 py-2 bg-zinc-100 hover:bg-zinc-200 rounded-lg font-bold"
              >
                בחר את המסוננים ({filteredCustomers.length})
              </button>
              <button
                onClick={deselectAll}
                className="text-xs px-3 py-2 bg-zinc-100 hover:bg-zinc-200 rounded-lg font-bold"
              >
                נקה בחירה
              </button>
            </div>
            <div className="max-h-96 overflow-y-auto border border-zinc-200 rounded-lg">
              {filteredCustomers.length === 0 ? (
                <p className="text-center text-sm text-zinc-500 p-4">
                  לא נמצאו לקוחות
                </p>
              ) : (
                <div className="divide-y divide-zinc-100">
                  {filteredCustomers.map((c) => (
                    <label
                      key={c.id}
                      className={`flex items-center gap-2 p-2.5 cursor-pointer transition-colors ${
                        selectedCustomerIds.has(c.id)
                          ? c.agreedToEmails
                            ? "bg-emerald-50"
                            : "bg-red-50"
                          : "hover:bg-zinc-50"
                      } ${!c.agreedToEmails ? "opacity-70" : ""}`}
                    >
                      <input
                        type="checkbox"
                        checked={selectedCustomerIds.has(c.id)}
                        onChange={() => toggleCustomer(c.id)}
                        className="w-4 h-4 accent-emerald-600"
                      />
                      <div className="flex-1 min-w-0">
                        <div className="font-medium text-brand-slatedark text-sm truncate flex items-center gap-1.5">
                          {c.name}
                          {!c.agreedToEmails && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-100 text-red-700 font-bold shrink-0">
                              לא אישר
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-zinc-500 truncate">
                          {c.email}
                          {c.pointName && ` · 📍 ${c.pointName}`}
                        </div>
                      </div>
                    </label>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* כפתור שליחה + הודעת תוצאה */}
      <div className="bg-white rounded-2xl border border-zinc-200 shadow-sm p-4 space-y-3">
        <button
          onClick={() => handleSend(false)}
          disabled={sending || recipientCount === 0 || !subject.trim() || !message.trim()}
          className="w-full py-3 rounded-xl bg-brand-rust text-white font-bold hover:bg-[#a83a15] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          {sending ? "שולח..." : `📧 שלח ל-${recipientCount} נמענים`}
        </button>

        {result && (
          <div
            className={`rounded-lg p-3 text-sm font-medium ${
              result.ok
                ? "bg-emerald-50 border border-emerald-200 text-emerald-800"
                : "bg-red-50 border border-red-200 text-red-800"
            }`}
          >
            {result.ok ? "✅ " : "⚠️ "}
            {result.text}
            {/* יומן השליחות — שם רואים מי קיבל ומה נכשל */}
            {result.ok && (
              <a
                href={result.logId ? `/admin/broadcast/history?id=${result.logId}` : "/admin/broadcast/history"}
                className="block mt-1 font-bold underline"
              >
                למעקב: מי קיבל ←
              </a>
            )}
          </div>
        )}

        <p className="text-[11px] text-zinc-500 leading-relaxed">
          💡 השליחה מתבצעת בקצב מבוקר (8 מיילים כל שנייה) כדי לעמוד במגבלות של
          Resend. משלוח של 100 לקוחות ייקח כ-15 שניות; 1000 לקוחות ייקח כ-2.5 דקות.
        </p>
      </div>
    </div>
  );
}

function ModeButton({
  active,
  onClick,
  icon,
  label,
  hint,
}: {
  active: boolean;
  onClick: () => void;
  icon: string;
  label: string;
  hint: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`p-3 rounded-xl border-2 text-right transition-colors ${
        active
          ? "bg-brand-rust text-white border-brand-rust"
          : "bg-white text-brand-slatedark border-zinc-200 hover:bg-zinc-50"
      }`}
    >
      <div className="text-2xl mb-1">{icon}</div>
      <div className="font-bold text-sm">{label}</div>
      <div
        className={`text-xs mt-0.5 ${
          active ? "text-white/80" : "text-zinc-500"
        }`}
      >
        {hint}
      </div>
    </button>
  );
}

/**
 * §404: תמונה גדולה (צילום מהטלפון, 5-8MB) — מוקטנת בדפדפן לפני
 * ההעלאה: עד 1600px ברוחב, JPEG. במייל זה נראה זהה ונטען מהר.
 * קובץ קטן או GIF/SVG — עובר כמו שהוא.
 */
async function shrinkImage(file: File): Promise<File> {
  if (file.size <= 1.5 * 1024 * 1024 || /gif|svg/.test(file.type)) return file;
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, 1600 / bmp.width);
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bmp.width * scale);
    canvas.height = Math.round(bmp.height * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    const blob: Blob | null = await new Promise((r) => canvas.toBlob(r, "image/jpeg", 0.85));
    if (!blob || blob.size >= file.size) return file;
    const name = file.name.replace(/\.[^.]+$/, "") + ".jpg";
    return new File([blob], name, { type: "image/jpeg" });
  } catch {
    return file;
  }
}
