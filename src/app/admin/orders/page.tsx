"use client";

// רשימת ההזמנות למנהל.
//
// 🆕 נוסף פילטר מכירה - בלי הקשר של מכירה, רשימה שמערבבת עשרות מכירות
//    חסרת משמעות. ברירת המחדל היא המכירה הפעילה.

import { useEffect, useState } from "react";
// §380: בורר מכירה מרכזי
import {
  useSelectedPricelist,
  PricelistSelector,
  // §396: צבירה לפי סוג (רגילות / שבועיות)
  applySaleSelection,
  isAggregateSelection,
  saleSelectionLabel,
} from "@/components/useSelectedPricelist";
import Link from "next/link";
import { api, download } from "@/lib/client";
import { STATUS_LABELS, STATUS_ORDER, fmt } from "@/lib/pricing";

// §48: שלב ההזמנה בשרשרת העבודה - תווית אחת שאומרת "איפה זה עומד",
// במקום שהמנהל יפענח שילוב של status + paymentStatus + deliveredAt.
//
// הסדר הוא סדר העבודה בפועל: שקילה -> תשלום -> מוכן -> נמסר.
type Stage = {
  key: string;
  label: string;
  color: string;
  /** האם זו משימה שממתינה למנהל, או מצב המתנה */
  isTask: boolean;
};

function orderStage(o: any): Stage {
  if (o.status === "CANCELLED")
    return { key: "cancelled", label: "בוטלה", color: "bg-zinc-200 text-zinc-500", isTask: false };
  if (o.deliveredAt)
    return { key: "delivered", label: "נמסרה", color: "bg-green-100 text-green-700", isTask: false };
  if (o.status === "READY_FOR_PICKUP")
    return {
      key: "ready",
      label: "מוכנה — ממתינה ללקוח",
      color: "bg-purple-100 text-purple-700",
      isTask: false,
    };
  if (o.paymentStatus === "PAID")
    return {
      key: "needsReady",
      label: "שולמה — לסמן מוכנה",
      color: "bg-emerald-100 text-emerald-800",
      isTask: true,
    };
  if (o.paymentStatus === "FAILED" || o.paymentStatus === "CARD_UPDATE_NEEDED")
    return { key: "payFailed", label: "חיוב נכשל", color: "bg-red-100 text-red-700", isTask: true };
  if (o.finalTotal != null)
    return {
      key: "needsPay",
      label: "ממתינה לתשלום",
      color: "bg-orange-100 text-orange-700",
      isTask: true,
    };
  return {
    key: "needsWeigh",
    label: "ממתינה לשקילה",
    color: "bg-amber-100 text-amber-800",
    isTask: true,
  };
}

const STAGE_ORDER = ["needsWeigh", "needsPay", "payFailed", "needsReady", "ready", "delivered"];


type Pricelist = { id: string; name: string; status: string };

// §24: מקור ההזמנה - מאיפה היא הגיעה בפועל.
// WEB לא מקבל תגית: זו ברירת המחדל וזה רק היה מרעיש את הטבלה.
const SOURCE_LABELS: Record<string, string> = {
  PHONE: "טלפון",
  EXCEL: "אקסל",
  AGENT: "נציג",
  ADMIN: "מנהל",
  // §398: מזדמן שהומר ללקוח
  WALKIN: "מזדמן",
};
const SOURCE_COLORS: Record<string, string> = {
  PHONE: "bg-indigo-100 text-indigo-700",
  EXCEL: "bg-green-100 text-green-700",
  AGENT: "bg-teal-100 text-teal-700",
  ADMIN: "bg-zinc-200 text-zinc-700",
  WALKIN: "bg-violet-100 text-violet-700",
};


export default function OrdersPage() {
  const [orders, setOrders] = useState<any[]>([]);
  const [points, setPoints] = useState<any[]>([]);
  // §380: בורר מרכזי
  const { lists, selected: fPricelist, setSelected: setFPricelist } =
    useSelectedPricelist({ allowAll: true });
  const [loading, setLoading] = useState(true);
  const [fPoint, setFPoint] = useState("");
  const [fStatus, setFStatus] = useState("");
  // §39: חיפוש חופשי וסינון תשלום. שניהם מסוננים בצד הלקוח על הרשימה
  // שכבר נטענה - כך אין קריאת רשת בכל הקלדה, והתגובה מיידית.
  const [q, setQ] = useState("");
  const [fPay, setFPay] = useState("");
  // §48: סינון לפי שלב + בחירה מרובה לפעולה מרוכזת
  const [fStage, setFStage] = useState("");
  // סינון לפי ערוץ הזמנה (source) — מקומי, כמו החיפוש
  const [fSource, setFSource] = useState("");
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);

  // טעינת רשימת המכירות + ברירת מחדל (המכירה הפעילה)
  // §380: הרשימה והבחירה מגיעות מ-useSelectedPricelist — אין
  // טעינה נפרדת כאן.

  useEffect(() => {
    if (!fPricelist) return; // ממתינים לבחירת המכירה לפני הטעינה הראשונה

    let cancelled = false;
    async function load() {
      setLoading(true);
      const q = new URLSearchParams();
      applySaleSelection(q, fPricelist); // §396
      if (fPoint) q.set("pointId", fPoint);
      if (fStatus) q.set("status", fStatus);
      try {
        const [o, p] = await Promise.all([
          api(`/api/orders?${q.toString()}`),
          points.length ? Promise.resolve(points) : api("/api/admin/points"),
        ]);
        if (cancelled) return;
        setOrders(o);
        setPoints(p);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fPricelist, fPoint, fStatus]);

  // §48: פעולה מרוכזת. הפעולה נגזרת מהשלב שנבחר - אחרי סינון כל
  // השורות באותו מצב, ולכן יש פעולה אחת הגיונית עליהן.
  // ברירת מחדל: כל מה שמוצג. אם סומנו שורות - רק הן.
  async function runBulk(action: "READY" | "DELIVERED") {
    const ids = sel.size > 0 ? Array.from(sel) : shown.map((o) => o.id);
    if (ids.length === 0) return;

    const what = action === "READY" ? "כמוכנות לחלוקה" : "כנמסרו ללקוח";
    const scope =
      sel.size > 0
        ? `${ids.length} ההזמנות שנבחרו`
        : fPoint
          ? `כל ${ids.length} ההזמנות ב${points.find((p: any) => p.id === fPoint)?.name ?? "נקודה"}`
          : `כל ${ids.length} ההזמנות המוצגות`;
    if (!confirm(`לסמן ${scope} ${what}?`)) return;

    setBulkBusy(true);
    try {
      const res = await api("/api/admin/orders/bulk-status", {
        method: "POST",
        body: JSON.stringify({ orderIds: ids, action }),
      });
      let msg = `סומנו ${res.updated} הזמנות.`;
      if (res.skipped?.length > 0) {
        const lines = res.skipped
          .slice(0, 8)
          .map((x: any) => `#${x.orderNumber} - ${x.reason}`)
          .join("\n");
        msg += `\n\n${res.skipped.length} דולגו:\n${lines}`;
        if (res.skipped.length > 8) msg += `\n...ועוד ${res.skipped.length - 8}`;
      }
      alert(msg);
      setSel(new Set());
      const qp = new URLSearchParams();
      applySaleSelection(qp, fPricelist); // §396
      if (fPoint) qp.set("pointId", fPoint);
      if (fStatus) qp.set("status", fStatus);
      setOrders(await api(`/api/orders?${qp.toString()}`));
    } catch (e: any) {
      alert("שגיאה: " + e.message);
    } finally {
      setBulkBusy(false);
    }
  }

  const exportUrl = () => {
    const q = new URLSearchParams({ type: "orders" });
    applySaleSelection(q, fPricelist); // §396
    if (fPoint) q.set("pointId", fPoint);
    return `/api/admin/export?${q.toString()}`;
  };

  const currentList = lists?.find((l) => l.id === fPricelist) ?? null;
  const hasSubFilter = !!fPoint || !!fStatus || !!q.trim() || !!fPay || !!fStage || !!fSource;

  // הערוצים שקיימים בפועל ברשימה — לבורר הערוץ
  const sourceCounts: Record<string, number> = {};
  for (const o of orders) {
    const src = o.source || "WEB";
    sourceCounts[src] = (sourceCounts[src] || 0) + 1;
  }
  const sourcesPresent = Object.keys(sourceCounts);

  // ספירת ההזמנות בכל שלב - מזינה את סרגל המשימות
  const stageCounts: Record<string, number> = {};
  for (const o of orders) {
    const st = orderStage(o);
    stageCounts[st.key] = (stageCounts[st.key] || 0) + 1;
  }

  // סינון מקומי: שלב + חיפוש חופשי + מצב תשלום
  const shown = orders.filter((o) => {
    if (fStage && orderStage(o).key !== fStage) return false;
    if (fSource && (o.source || "WEB") !== fSource) return false;
    if (fPay === "PAID" && o.paymentStatus !== "PAID") return false;
    if (fPay === "UNPAID" && o.paymentStatus === "PAID") return false;
    // §273: חיפוש **רב-מילים**, כמו במסך הלקוחות (§251).
    //
    // 🐛 `includes` על המחרוזת כולה: חיפוש "משה ניימן" לא מצא
    // לקוח שנשמר "ניימן משה" - למרות ששתי המילים שם.
    //
    // ⚠️ כל מילה נבדקת בנפרד, וכולן חייבות להימצא. AND ולא OR:
    // "משה ניימן" עם OR היה מחזיר את כל המשהים במכירה.
    const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (words.length === 0) return true;
    const hay = [
      String(o.orderNumber ?? ""),
      o.customerName ?? "",
      o.phone ?? "",
    ]
      .join(" ")
      .toLowerCase();
    return words.every((w) => hay.includes(w));
  });

  // §273: מיון לפי **שם משפחה**.
  //
  // 🐛 הרשימה הייתה לפי מספר הזמנה - סדר כרונולוגי שאין לו
  // משמעות למי שמחפש לקוח. ברשימה של 252 הזמנות זה אומר לגלול.
  //
  // ⚠️ אותה נפילה של דף החלוקה (§233): lastName אם קיים, אחרת
  // המילה האחרונה בשם המלא. עובד גם על 386 שטרם פוצלו.
  const lastNameOf = (o: any): string => {
    // §235: שם המשפחה האמיתי של הלקוח קודם — זהה למסך הנציג
    if (o.customer?.lastName?.trim()) return o.customer.lastName.trim();
    const full = (o.customer?.name || o.customerName || "").trim();
    if (!full) return "";
    const parts = full.split(/\s+/);
    return parts.length > 1 ? parts[parts.length - 1] : full;
  };
  shown.sort((a, b) => {
    const r = lastNameOf(a).localeCompare(lastNameOf(b), "he");
    if (r !== 0) return r;
    // ⚠️ שם משפחה זהה - לפי השם המלא, כדי ששני "כהן" יופיעו
    // בסדר קבוע ולא ישתנו בכל רענון.
    return (a.customer?.name || a.customerName || "").localeCompare(b.customer?.name || b.customerName || "", "he");
  });

  // סיכום כספי של מה שמוצג - המנהל צריך לדעת כמה כסף מול העיניים
  const sumEst = shown.reduce((a, o) => a + Number(o.estimatedTotal || 0), 0);
  const sumFinal = shown.reduce((a, o) => a + Number(o.finalTotal || 0), 0);
  // §325: 💸 חוב קודם שנגבה — נכלל ב-finalTotal אך אינו הכנסה
  // מהמכירה הזו. מוצג בנפרד כדי שהסיכום לא יטעה בהצלבה מול
  // תעודות הספק.
  const sumDebt = shown.reduce(
    (a, o) => a + Number((o as any).appliedDebt || 0),
    0
  );
  const unpaidCount = shown.filter((o) => o.paymentStatus !== "PAID").length;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold text-brand-slatedark">הזמנות</h1>
          <p className="text-sm text-brand-slate/60 mt-0.5">
            {isAggregateSelection(fPricelist)
              ? `מציג הזמנות: ${saleSelectionLabel(fPricelist, lists)}`
              : currentList
                ? `מציג את המכירה: ${currentList.name}`
                : "בחר מכירה"}
          </p>
        </div>
        <button onClick={() => download(exportUrl())} className="btn-ghost btn-sm">
          ייצוא לאקסל
        </button>
      </div>

      {/* §48: סרגל המשימות. לא כפתורי פעולה אלא מסננים - "מה מחכה לי
          עכשיו". לחיצה מסננת את הטבלה, ואז מופיעה הפעולה הרלוונטית.
          ⚠️ בנייד: שורה אחת נגללת לרוחב, ולא חמש שורות של שבבים. */}
      {!loading && orders.length > 0 && (
        <div className="-mx-4 px-4 md:mx-0 md:px-0 overflow-x-auto [scrollbar-width:none]">
          <div className="flex gap-1.5 w-max md:w-auto md:flex-wrap">
            <StageChip
              active={fStage === ""}
              onClick={() => {
                setFStage("");
                setSel(new Set());
              }}
              count={orders.length}
            >
              הכל
            </StageChip>
            {STAGE_ORDER.map((key) => {
              const count = stageCounts[key] || 0;
              if (!count) return null;
              const sample = orders.find((o) => orderStage(o).key === key);
              const st = orderStage(sample);
              return (
                <StageChip
                  key={key}
                  active={fStage === key}
                  onClick={() => {
                    setFStage(fStage === key ? "" : key);
                    setSel(new Set());
                  }}
                  count={count}
                  task={st.isTask}
                >
                  {st.label}
                </StageChip>
              );
            })}
          </div>
        </div>
      )}

      {/* ─── חיפוש וסינון ─── */}
      <div className="card p-3 space-y-2.5">
        <div className="relative">
          <svg
            className="absolute right-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400 pointer-events-none"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2.5}
            aria-hidden="true"
          >
            <circle cx="11" cy="11" r="7" />
            <path strokeLinecap="round" d="M20 20l-3.5-3.5" />
          </svg>
          <input
            type="search"
            className="input !pr-10 !py-2.5"
            placeholder="חיפוש: שם, טלפון או מספר הזמנה"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            aria-label="חיפוש בהזמנות"
          />
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-5 gap-2">
          {/* פילטר מכירה - הפילטר הראשי */}
          {/* §380: רכיב אחד — הבחירה נשמרת בין המסכים. */}
          <div className="col-span-2 lg:col-span-1">
            <PricelistSelector
              lists={lists}
              selected={fPricelist}
              onChange={setFPricelist}
              allowAll
              className="input py-2 text-sm"
            />
          </div>

          <select
            className="input py-2 text-sm"
            value={fPoint}
            onChange={(e) => setFPoint(e.target.value)}
            aria-label="סינון לפי נקודת חלוקה"
          >
            <option value="">כל הנקודות</option>
            {points.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>

          <select
            className="input py-2 text-sm"
            value={fStatus}
            onChange={(e) => setFStatus(e.target.value)}
            aria-label="סינון לפי סטטוס"
          >
            <option value="">כל הסטטוסים</option>
            {STATUS_ORDER.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABELS[s]}
              </option>
            ))}
          </select>

          <select
            className="input py-2 text-sm"
            value={fPay}
            onChange={(e) => setFPay(e.target.value)}
            aria-label="סינון לפי תשלום"
          >
            <option value="">תשלום: הכל</option>
            <option value="PAID">שולם</option>
            <option value="UNPAID">טרם שולם</option>
          </select>

          {/* סינון לפי ערוץ — מקומי, על הרשימה שכבר נטענה */}
          <select
            className="input py-2 text-sm"
            value={fSource}
            onChange={(e) => setFSource(e.target.value)}
            aria-label="סינון לפי ערוץ הזמנה"
          >
            <option value="">כל הערוצים</option>
            {sourcesPresent.map((s) => (
              <option key={s} value={s}>
                {s === "WEB" ? "אתר" : SOURCE_LABELS[s] ?? s} · {sourceCounts[s]}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 pt-0.5">
          {/* §231: הפירוט מוצג רק כשיש מבוטלות */}
          {!loading ? (
            <span className="text-sm text-zinc-600">
              <bdi className="font-bold text-brand-slatedark tabular-nums">{shown.length}</bdi> הזמנות
              {shown.length !== orders.length && ` מתוך ${orders.length}`}
              {(() => {
                // ⚠️ נספר מתוך **כל** ההזמנות ולא מהמסוננות
                const cancelled = orders.filter(
                  (o: any) => o.status === "CANCELLED"
                ).length;
                if (cancelled === 0) return null;
                return (
                  <span className="text-zinc-400">
                    {" · "}
                    {orders.length - cancelled} פעילות · {cancelled} בוטלו
                  </span>
                );
              })()}
            </span>
          ) : (
            <span />
          )}
          {hasSubFilter && (
            <button
              onClick={() => {
                setFPoint("");
                setFStatus("");
                setQ("");
                setFPay("");
                setFSource("");
              }}
              className="text-sm font-bold text-brand-rust hover:underline"
            >
              נקה סינון
            </button>
          )}
        </div>
      </div>

      {/* §48: סרגל הפעולה. מופיע רק כשהסינון ממקד בשלב שיש עליו פעולה
          אחת ברורה - אחרת אין מה להציע. */}
      {!loading &&
        shown.length > 0 &&
        (fStage === "needsReady" || fStage === "ready") && (
          <div className="card p-3 border-brand-rust/40 bg-orange-50 flex flex-wrap items-center justify-between gap-3">
            <div className="text-sm">
              <span className="font-bold text-brand-slatedark">
                {sel.size > 0
                  ? `${sel.size} הזמנות נבחרו`
                  : `${shown.length} הזמנות מוצגות`}
              </span>
              {!fPoint && (
                <span className="text-xs text-brand-slate/70 mr-2">
                  · אפשר לסנן לנקודה אחת לפני הסימון
                </span>
              )}
              {fPoint && (
                <span className="text-xs text-brand-slate/70 mr-2">
                  · 📍 {points.find((p: any) => p.id === fPoint)?.name}
                </span>
              )}
            </div>
            <div className="flex gap-2">
              {sel.size > 0 && (
                <button onClick={() => setSel(new Set())} className="btn-ghost btn-sm">
                  נקה בחירה
                </button>
              )}
              {fStage === "needsReady" && (
                <button
                  onClick={() => runBulk("READY")}
                  disabled={bulkBusy}
                  className="btn-primary btn-sm bg-emerald-600 hover:bg-emerald-700"
                >
                  {bulkBusy ? "מסמן..." : "📦 סמן כמוכנות לחלוקה"}
                </button>
              )}
              {fStage === "ready" && (
                <button
                  onClick={() => runBulk("DELIVERED")}
                  disabled={bulkBusy}
                  className="btn-primary btn-sm bg-emerald-600 hover:bg-emerald-700"
                >
                  {bulkBusy ? "מסמן..." : "✓ סמן שנמסרו ללקוח"}
                </button>
              )}
            </div>
          </div>
        )}

      {!loading && shown.length > 0 && (
        <div className="card p-3 flex flex-wrap gap-x-6 gap-y-1 text-sm">
          <span>
            <span className="text-zinc-500">סה״כ משוער:</span>{" "}
            <strong>{fmt(sumEst)}</strong>
          </span>
          {sumFinal > 0 && (
            <span>
              <span className="text-zinc-500">סה״כ סופי:</span>{" "}
              <strong>{fmt(sumFinal)}</strong>
            {sumDebt > 0 && (
              <span className="text-[11px] text-zinc-500 block">
                כולל {fmt(sumDebt)} חוב קודם
              </span>
            )}
            </span>
          )}
          {unpaidCount > 0 && (
            <span className="text-amber-800">
              <bdi>{unpaidCount}</bdi> טרם שולמו
            </span>
          )}
        </div>
      )}

      {loading ? (
        <p className="text-zinc-500">טוען...</p>
      ) : shown.length === 0 ? (
        <div className="card p-6 text-center">
          <p className="text-brand-slatedark font-medium">אין הזמנות שתואמות לסינון</p>
          <p className="text-sm text-brand-slate/60 mt-1">
            {hasSubFilter
              ? "נסה לנקות את הסינון או לבחור מכירה אחרת."
              : "במכירה הזו עדיין אין הזמנות."}
          </p>
        </div>
      ) : (
        <>
        {/* ─── נייד: כרטיסים ─── */}
        <ul className="md:hidden space-y-2">
          {shown.map((o) => {
            const st = orderStage(o);
            const selectable = fStage === "needsReady" || fStage === "ready";
            return (
              <li key={o.id} className="card flex items-stretch overflow-hidden">
                {selectable && (
                  <label className="flex items-center px-3 border-l border-zinc-100 bg-zinc-50">
                    <input
                      type="checkbox"
                      className="w-5 h-5"
                      checked={sel.has(o.id)}
                      onChange={(e) => {
                        const next = new Set(sel);
                        if (e.target.checked) next.add(o.id);
                        else next.delete(o.id);
                        setSel(next);
                      }}
                      aria-label={`בחר הזמנה ${o.orderNumber}`}
                    />
                  </label>
                )}
                <Link
                  href={`/admin/orders/${o.id}`}
                  className="flex-1 min-w-0 p-3 active:bg-zinc-50 transition-colors"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-bold text-brand-slatedark truncate">{o.customerName}</p>
                      <p className="text-xs text-zinc-500 mt-0.5 truncate">
                        #{o.orderNumber} · {o.point?.name ?? o.pointNameSnapshot ?? "—"}
                      </p>
                    </div>
                    <span className={`badge ${st.color} whitespace-nowrap shrink-0`}>{st.label}</span>
                  </div>
                  <div className="flex items-center justify-between gap-2 mt-2 text-xs">
                    <span className="flex items-center gap-1.5 min-w-0 text-zinc-500">
                      {o.source && o.source !== "WEB" && (
                        <span className={`badge ${SOURCE_COLORS[o.source] ?? "bg-zinc-100 text-zinc-600"}`}>
                          {SOURCE_LABELS[o.source] ?? o.source}
                        </span>
                      )}
                      <span dir="ltr" className="truncate">{o.phone}</span>
                    </span>
                    <span className="shrink-0 tabular-nums">
                      {o.finalTotal ? (
                        <strong className="text-sm text-brand-slatedark">{fmt(o.finalTotal)}</strong>
                      ) : (
                        <span className="text-zinc-500">משוער {fmt(o.estimatedTotal)}</span>
                      )}
                    </span>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>

        {/* ─── דסקטופ: טבלה ─── */}
        <div className="table-wrap hidden md:block">
          <table className="admin">
            <thead>
              <tr>
                {/* §48: בחירה מרובה - מוצגת רק בשלבים שיש עליהם פעולה */}
                {(fStage === "needsReady" || fStage === "ready") && (
                  <th className="w-8">
                    <input
                      type="checkbox"
                      checked={shown.length > 0 && sel.size === shown.length}
                      onChange={(e) =>
                        setSel(e.target.checked ? new Set(shown.map((o) => o.id)) : new Set())
                      }
                      aria-label="בחר הכל"
                    />
                  </th>
                )}
                <th>#</th>
                <th>תאריך</th>
                <th>לקוח</th>
                <th>מקור</th>
                <th>טלפון</th>
                <th>נקודה</th>
                <th>משוער</th>
                <th>סופי</th>
                <th>מצב</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {shown.map((o) => (
                <tr key={o.id}>
                  {(fStage === "needsReady" || fStage === "ready") && (
                    <td>
                      <input
                        type="checkbox"
                        checked={sel.has(o.id)}
                        onChange={(e) => {
                          const next = new Set(sel);
                          if (e.target.checked) next.add(o.id);
                          else next.delete(o.id);
                          setSel(next);
                        }}
                        aria-label={`בחר הזמנה ${o.orderNumber}`}
                      />
                    </td>
                  )}
                  <td className="font-bold tabular-nums">{o.orderNumber}</td>
                  <td className="text-zinc-500 whitespace-nowrap">
                    {new Date(o.createdAt).toLocaleDateString("he-IL")}
                  </td>
                  <td className="font-medium">{o.customerName}</td>
                  <td>
                    {o.source && o.source !== "WEB" ? (
                      <span
                        className={`badge ${SOURCE_COLORS[o.source] ?? "bg-zinc-100 text-zinc-600"}`}
                      >
                        {SOURCE_LABELS[o.source] ?? o.source}
                      </span>
                    ) : (
                      <span className="text-zinc-400 text-xs">אתר</span>
                    )}
                  </td>
                  <td className="text-zinc-500" dir="ltr">
                    {o.phone}
                  </td>
                  <td className="text-zinc-500">{o.point?.name ?? o.pointNameSnapshot ?? "—"}</td>
                  <td className="tabular-nums">{fmt(o.estimatedTotal)}</td>
                  <td className="tabular-nums">{o.finalTotal ? fmt(o.finalTotal) : "—"}</td>
                  <td>
                    {/* §48: תווית אחת שאומרת איפה ההזמנה עומדת */}
                    {(() => {
                      const st = orderStage(o);
                      return (
                        <span className={`badge ${st.color} whitespace-nowrap`}>
                          {st.label}
                        </span>
                      );
                    })()}
                  </td>
                  <td>
                    <Link href={`/admin/orders/${o.id}`} className="btn-ghost btn-sm">
                      פתח
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        </>
      )}
    </div>
  );
}


// §48: שבב סינון בסרגל המשימות
function StageChip({
  active,
  onClick,
  count,
  task,
  children,
}: {
  active: boolean;
  onClick: () => void;
  count: number;
  task?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      className={`shrink-0 inline-flex items-center gap-2 px-3 py-2 text-sm font-bold rounded-full border transition-colors active:scale-[0.97] ${
        active
          ? "bg-brand-slatedark text-white border-brand-slatedark"
          : "bg-white text-brand-slatedark border-zinc-200 hover:border-zinc-300"
      }`}
    >
      {task && (
        <span
          className={`w-2 h-2 rounded-full ${active ? "bg-amber-300" : "bg-brand-rust"}`}
          aria-hidden="true"
        />
      )}
      <span className="whitespace-nowrap">{children}</span>
      <span
        className={`min-w-6 px-1.5 rounded-full text-xs tabular-nums text-center ${
          active ? "bg-white/20" : "bg-zinc-100 text-zinc-600"
        }`}
      >
        {count}
      </span>
    </button>
  );
}
