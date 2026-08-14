"use client";

// רשימת ההזמנות למנהל.
//
// 🆕 נוסף פילטר מכירה - בלי הקשר של מכירה, רשימה שמערבבת עשרות מכירות
//    חסרת משמעות. ברירת המחדל היא המכירה הפעילה.
// 🐛 תוקן: statusColor הכיל סטטוסים ישנים שלא קיימים יותר (NEW/CONFIRMED/
//    PROCESSING/READY/DELIVERED), ולכן כל תגיות הסטטוס הוצגו בלי צבע.

import { useEffect, useState } from "react";
import Link from "next/link";
import { api, download } from "@/lib/client";
import { STATUS_LABELS, STATUS_ORDER, fmt } from "@/lib/pricing";

// צבעים לפי מחזור החיים האמיתי של הזמנה:
// PENDING_REVIEW -> FINAL_PRICE_SET -> PAYMENT_PENDING -> PAID -> READY_FOR_PICKUP -> COMPLETED
const statusColor: Record<string, string> = {
  PENDING_REVIEW: "bg-amber-100 text-amber-800",
  FINAL_PRICE_SET: "bg-blue-100 text-blue-700",
  PAYMENT_PENDING: "bg-orange-100 text-orange-700",
  PAID: "bg-emerald-100 text-emerald-700",
  READY_FOR_PICKUP: "bg-purple-100 text-purple-700",
  COMPLETED: "bg-green-100 text-green-700",
  CANCELLED: "bg-zinc-200 text-zinc-500",
};

type Pricelist = { id: string; name: string; status: string };

// §24: מקור ההזמנה - מאיפה היא הגיעה בפועל.
// WEB לא מקבל תגית: זו ברירת המחדל וזה רק היה מרעיש את הטבלה.
const SOURCE_LABELS: Record<string, string> = {
  PHONE: "טלפון",
  AGENT: "נציג",
  ADMIN: "מנהל",
};
const SOURCE_COLORS: Record<string, string> = {
  PHONE: "bg-indigo-100 text-indigo-700",
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

  const exportUrl = () => {
    const q = new URLSearchParams({ type: "orders" });
    if (fPricelist && fPricelist !== ALL) q.set("pricelistId", fPricelist);
    if (fPoint) q.set("pointId", fPoint);
    return `/api/admin/export?${q.toString()}`;
  };

  const currentList = lists?.find((l) => l.id === fPricelist) ?? null;
  const hasSubFilter = !!fPoint || !!fStatus || !!q.trim() || !!fPay;

  // סינון מקומי: חיפוש חופשי + מצב תשלום
  const shown = orders.filter((o) => {
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

        {!loading && (
          <span className="text-sm text-brand-slate/60 mr-auto">
            <bdi>{shown.length}</bdi> הזמנות
            {shown.length !== orders.length && ` מתוך ${orders.length}`}
          </span>
        )}
      </div>

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
                <th>#</th>
                <th>תאריך</th>
                <th>לקוח</th>
                <th>מקור</th>
                <th>טלפון</th>
                <th>נקודה</th>
                <th>משוער</th>
                <th>סופי</th>
                <th>סטטוס</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {shown.map((o) => (
                <tr key={o.id}>
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
                    <span className={`badge ${statusColor[o.status] ?? "bg-zinc-100 text-zinc-600"}`}>
                      {STATUS_LABELS[o.status] ?? o.status}
                    </span>
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
