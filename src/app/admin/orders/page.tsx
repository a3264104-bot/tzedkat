"use client";

// רשימת ההזמנות למנהל.
//
// 🆕 נוסף פילטר מכירה - בלי הקשר של מכירה, רשימה שמערבבת עשרות מכירות
//    חסרת משמעות. ברירת המחדל היא המכירה הפעילה.

import { useEffect, useState } from "react";
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
};
const SOURCE_COLORS: Record<string, string> = {
  PHONE: "bg-indigo-100 text-indigo-700",
  EXCEL: "bg-green-100 text-green-700",
  AGENT: "bg-teal-100 text-teal-700",
  ADMIN: "bg-zinc-200 text-zinc-700",
};

const ALL = "__all__";

export default function OrdersPage() {
  const [orders, setOrders] = useState<any[]>([]);
  const [points, setPoints] = useState<any[]>([]);
  const [lists, setLists] = useState<Pricelist[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [fPricelist, setFPricelist] = useState("");
  const [fPoint, setFPoint] = useState("");
  const [fStatus, setFStatus] = useState("");
  // §39: חיפוש חופשי וסינון תשלום. שניהם מסוננים בצד הלקוח על הרשימה
  // שכבר נטענה - כך אין קריאת רשת בכל הקלדה, והתגובה מיידית.
  const [q, setQ] = useState("");
  const [fPay, setFPay] = useState("");
  // §48: סינון לפי שלב + בחירה מרובה לפעולה מרוכזת
  const [fStage, setFStage] = useState("");
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);

  // טעינת רשימת המכירות + ברירת מחדל (המכירה הפעילה)
  useEffect(() => {
    api("/api/admin/pricelists")
      .then((res: Pricelist[]) => {
        setLists(res);
        const active = res.find((l) => l.status === "ACTIVE");
        setFPricelist(active?.id ?? res[0]?.id ?? ALL);
      })
      .catch(() => {
        setLists([]);
        setFPricelist(ALL);
      });
  }, []);

  useEffect(() => {
    if (!fPricelist) return; // ממתינים לבחירת המכירה לפני הטעינה הראשונה

    let cancelled = false;
    async function load() {
      setLoading(true);
      const q = new URLSearchParams();
      if (fPricelist !== ALL) q.set("pricelistId", fPricelist);
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
      if (fPricelist !== ALL) qp.set("pricelistId", fPricelist);
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
    if (fPricelist && fPricelist !== ALL) q.set("pricelistId", fPricelist);
    if (fPoint) q.set("pointId", fPoint);
    return `/api/admin/export?${q.toString()}`;
  };

  const currentList = lists?.find((l) => l.id === fPricelist) ?? null;
  const hasSubFilter = !!fPoint || !!fStatus || !!q.trim() || !!fPay || !!fStage;

  // ספירת ההזמנות בכל שלב - מזינה את סרגל המשימות
  const stageCounts: Record<string, number> = {};
  for (const o of orders) {
    const st = orderStage(o);
    stageCounts[st.key] = (stageCounts[st.key] || 0) + 1;
  }

  // סינון מקומי: שלב + חיפוש חופשי + מצב תשלום
  const shown = orders.filter((o) => {
    if (fStage && orderStage(o).key !== fStage) return false;
    if (fPay === "PAID" && o.paymentStatus !== "PAID") return false;
    if (fPay === "UNPAID" && o.paymentStatus === "PAID") return false;
    const t = q.trim().toLowerCase();
    if (!t) return true;
    return (
      String(o.orderNumber).includes(t) ||
      (o.customerName || "").toLowerCase().includes(t) ||
      (o.phone || "").includes(t)
    );
  });

  // סיכום כספי של מה שמוצג - המנהל צריך לדעת כמה כסף מול העיניים
  const sumEst = shown.reduce((a, o) => a + Number(o.estimatedTotal || 0), 0);
  const sumFinal = shown.reduce((a, o) => a + Number(o.finalTotal || 0), 0);
  const unpaidCount = shown.filter((o) => o.paymentStatus !== "PAID").length;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold text-brand-slatedark">הזמנות</h1>
          <p className="text-sm text-brand-slate/60 mt-0.5">
            {fPricelist === ALL
              ? "מציג הזמנות מכל המכירות"
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
          זה משקף את העבודה בפועל: המנהל לא מסמן הזמנה בודדת, הוא
          מסמן את כל מי שרלוונטי בנקודה שהסחורה הגיעה אליה. */}
      {!loading && orders.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          <StageChip
            active={fStage === ""}
            onClick={() => {
              setFStage("");
              setSel(new Set());
            }}
            color="bg-brand-slatedark text-white"
          >
            הכל · {orders.length}
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
                color={st.isTask ? "bg-brand-rust text-white" : "bg-zinc-600 text-white"}
              >
                {st.isTask && "⚠ "}
                {st.label} · {count}
              </StageChip>
            );
          })}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {/* פילטר מכירה - הפילטר הראשי */}
        <select
          className="input max-w-[240px]"
          value={fPricelist}
          onChange={(e) => setFPricelist(e.target.value)}
          disabled={!lists}
          aria-label="סינון לפי מכירה"
        >
          {!lists && <option>טוען מכירות...</option>}
          {lists?.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
              {l.status === "ACTIVE" ? " • פעילה" : ""}
            </option>
          ))}
          {lists && <option value={ALL}>— כל המכירות —</option>}
        </select>

        <select
          className="input max-w-[180px]"
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
          className="input max-w-[180px]"
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
          className="input max-w-[150px]"
          value={fPay}
          onChange={(e) => setFPay(e.target.value)}
          aria-label="סינון לפי תשלום"
        >
          <option value="">תשלום: הכל</option>
          <option value="PAID">שולם</option>
          <option value="UNPAID">טרם שולם</option>
        </select>

        <input
          className="input max-w-[200px]"
          placeholder="חיפוש: שם, טלפון, מספר"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          aria-label="חיפוש בהזמנות"
        />

        {hasSubFilter && (
          <button
            onClick={() => {
              setFPoint("");
              setFStatus("");
              setQ("");
              setFPay("");
            }}
            className="btn-ghost btn-sm"
          >
            נקה סינון
          </button>
        )}

        {/* §231: 🐛 "252 הזמנות" מול "244" בבקרת מכירה.
            
            ההפרש הוא המבוטלות - אבל אף מסך לא אמר את זה, והמנהל
            שרואה שני מספרים שונים לאותה מכירה לא יודע במי לבטוח.
            
            ⚠️ הפירוט מוצג רק כשיש מבוטלות: במכירה בלי ביטולים
            "252 · 252 פעילות · 0 בוטלו" הוא רעש. */}
        {!loading && (
          <span className="text-sm text-brand-slate/60 mr-auto">
            <bdi>{shown.length}</bdi> הזמנות
            {shown.length !== orders.length && ` מתוך ${orders.length}`}
            {(() => {
              // ⚠️ נספר מתוך **כל** ההזמנות ולא מהמסוננות: המנהל
              // רוצה לדעת כמה בוטלו במכירה, לא כמה בוטלו בסינון
              // הנוכחי.
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
        )}
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
        <div className="table-wrap">
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
                  <td className="font-bold">{o.orderNumber}</td>
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
                      <span className="text-zinc-300 text-xs">אתר</span>
                    )}
                  </td>
                  <td className="text-zinc-500" dir="ltr">
                    {o.phone}
                  </td>
                  <td className="text-zinc-500">{o.point?.name ?? o.pointNameSnapshot ?? "—"}</td>
                  <td>{fmt(o.estimatedTotal)}</td>
                  <td>{o.finalTotal ? fmt(o.finalTotal) : "—"}</td>
                  <td>
                    {/* §48: תווית אחת שאומרת איפה ההזמנה עומדת, במקום
                        שהמנהל יפענח שילוב של status + paymentStatus +
                        deliveredAt בשלוש תגיות נפרדות. */}
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
      )}
    </div>
  );
}


// §48: שבב סינון בסרגל המשימות
function StageChip({
  active,
  onClick,
  color,
  children,
}: {
  active: boolean;
  onClick: () => void;
  color: string;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-colors ${
        active ? color + " shadow-sm" : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200"
      }`}
    >
      {children}
    </button>
  );
}
