"use client";

// §126: מסך הזיכויים.
//
// ═══════════════════════════════════════════════════════════════
// למה הוא קיים
// ═══════════════════════════════════════════════════════════════
// כל נציג רשאי לזכות לקוח בכל סכום, בלי תקרה ובלי אישור מראש.
// הפיקוח היחיד הוא שהמנהל יראה - וכדי שיראה, צריך מסך.
//
// עד היום היה רק מספר מצטבר בבקרת המכירה ("קוזזו 145 ש\"ח"), בלי
// מי, כמה ולמה. ולא הייתה שום דרך לדעת לאיזה לקוח יש יתרה פתוחה.

import { useEffect, useState } from "react";
// §200: תאריכים בשעון ישראל — השרת רץ ב-UTC
import { fmtDate } from "@/lib/date-lib";
import { api } from "@/lib/client";
import { fmt } from "@/lib/pricing";

type Credit = {
  orderId: string;
  orderNumber: number;
  customerName: string;
  phone: string | null;
  amount: number;
  reason: string | null;
  byName: string;
  at: string | null;
  pointName: string | null;
  saleName: string | null;
  asBalance: boolean;
};

type Balance = {
  customerId: string;
  name: string;
  phone: string | null;
  balance: number;
  note: string | null;
  at: string | null;
};

type Delivery = {
  orderId: string;
  orderNumber: number;
  customerName: string;
  phone: string | null;
  fee: number;
  address: string | null;
  note: string | null;
  byName: string;
  pointName: string | null;
  paid: boolean;
};

type Data = {
  // §134: משלוחים - רשימת עבודה ליום החלוקה
  deliveries: Delivery[];
  deliveryTotals: { count: number; totalFees: number };
  credits: Credit[];
  balances: Balance[];
  byAgent: { name: string; count: number; total: number }[];
  totals: {
    totalCredited: number;
    creditCount: number;
    totalOpenBalance: number;
    balanceCount: number;
  };
};

export default function CreditsPage() {
  const [data, setData] = useState<Data | null>(null);
  const [lists, setLists] = useState<{ id: string; name: string }[]>([]);
  const [pricelistId, setPricelistId] = useState("");
  const [tab, setTab] = useState<"credits" | "balances" | "deliveries">("credits");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api("/api/admin/pricelists")
      .then((d) => setLists(Array.isArray(d) ? d : []))
      .catch(() => setLists([]));
  }, []);

  useEffect(() => {
    setLoading(true);
    const qs = pricelistId ? `?pricelistId=${pricelistId}` : "";
    api(`/api/admin/credits${qs}`)
      .then(setData)
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [pricelistId]);

  if (loading && !data) return <main className="p-6 text-zinc-500">טוען…</main>;
  if (!data) return <main className="p-6 text-red-600">שגיאה בטעינה</main>;

  const t = data.totals;

  return (
    <main dir="rtl" className="p-4 sm:p-6 max-w-5xl mx-auto space-y-5">
      <div>
        <h1 className="text-2xl font-extrabold text-brand-slatedark">
          זיכויים ויתרות זכות
        </h1>
        <p className="text-sm text-zinc-500 mt-1">
          מעקב אחרי זיכויים שנציגים נתנו, ואחרי יתרות שטרם קוזזו.
        </p>
      </div>

      <select
        className="input w-full sm:w-80"
        value={pricelistId}
        onChange={(e) => setPricelistId(e.target.value)}
      >
        <option value="">— כל המכירות —</option>
        {lists.map((l) => (
          <option key={l.id} value={l.id}>
            {l.name}
          </option>
        ))}
      </select>

      {/* ─── מספרי מפתח ─── */}
      <div className="grid grid-cols-2 gap-3">
        <div className="card p-4">
          <div className="text-xs text-zinc-500">זוכה במכירה</div>
          <div className="text-2xl font-extrabold text-amber-700">
            {fmt(t.totalCredited)}
          </div>
          <div className="text-[11px] text-zinc-500">{t.creditCount} זיכויים</div>
        </div>
        {/* ⚠️ יתרה פתוחה היא **התחייבות** - כסף שהעמותה חייבת
            ללקוחות ויקוזז בהזמנות הבאות. חשוב שהמנהל יראה את
            הסכום הכולל ולא רק פריטים בודדים. */}
        <div className="card p-4 border-2 border-blue-200 bg-blue-50/40">
          <div className="text-xs text-blue-700">יתרות פתוחות</div>
          <div className="text-2xl font-extrabold text-blue-800">
            {fmt(t.totalOpenBalance)}
          </div>
          <div className="text-[11px] text-blue-600">
            {t.balanceCount} לקוחות · יקוזז בהזמנה הבאה
          </div>
        </div>
      </div>

      {/* ─── ריכוז לפי נציג ─── */}
      {data.byAgent.length > 0 && (
        <div className="card p-4">
          <div className="text-xs font-bold text-zinc-500 mb-2">
            לפי מי שזיכה
          </div>
          <div className="space-y-1.5">
            {data.byAgent.map((a) => (
              <div key={a.name} className="flex justify-between items-center text-sm">
                <span className="text-brand-slatedark">
                  {a.name}
                  <span className="text-xs text-zinc-400 mr-1.5">
                    ({a.count})
                  </span>
                </span>
                <span className="font-bold text-amber-700">{fmt(a.total)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ─── טאבים ─── */}
      <div className="flex gap-1 border-b border-zinc-200">
        <button
          onClick={() => setTab("credits")}
          className={`px-4 py-2 text-sm font-bold border-b-2 -mb-px ${
            tab === "credits"
              ? "border-brand-rust text-brand-rust"
              : "border-transparent text-zinc-500"
          }`}
        >
          זיכויים ({data.credits.length})
        </button>
        {/* §134: משלוחים. הנציג מסמן, והמנהל צריך לראות כמה יש,
            לאן, וכמה כסף - זו רשימת עבודה ליום החלוקה. */}
        <button
          onClick={() => setTab("deliveries")}
          className={`px-4 py-2 text-sm font-bold border-b-2 -mb-px ${
            tab === "deliveries"
              ? "border-brand-rust text-brand-rust"
              : "border-transparent text-zinc-500"
          }`}
        >
          🚚 משלוחים ({data.deliveries?.length ?? 0})
        </button>
        <button
          onClick={() => setTab("balances")}
          className={`px-4 py-2 text-sm font-bold border-b-2 -mb-px ${
            tab === "balances"
              ? "border-brand-rust text-brand-rust"
              : "border-transparent text-zinc-500"
          }`}
        >
          יתרות פתוחות ({data.balances.length})
        </button>
      </div>

      {tab === "deliveries" ? (
        !data.deliveries || data.deliveries.length === 0 ? (
          <p className="text-zinc-500 text-sm p-4">אין משלוחים במכירה שנבחרה.</p>
        ) : (
          <>
            <div className="card p-4 mb-3">
              <div className="text-xs text-zinc-500">סה״כ דמי משלוח</div>
              <div className="text-2xl font-extrabold text-violet-700">
                {fmt(data.deliveryTotals.totalFees)}
              </div>
              <div className="text-[11px] text-zinc-500">
                {data.deliveryTotals.count} משלוחים
              </div>
            </div>
            <div className="card p-0 overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-zinc-50 border-b border-zinc-200 text-[11px] text-zinc-600">
                  <tr>
                    <th className="text-right p-2.5">לקוח</th>
                    <th className="p-2.5">טלפון</th>
                    <th className="text-right p-2.5">כתובת</th>
                    <th className="p-2.5">דמי משלוח</th>
                    <th className="p-2.5">סימן</th>
                  </tr>
                </thead>
                <tbody>
                  {data.deliveries.map((d) => (
                    <tr key={d.orderId} className="border-b border-zinc-100">
                      <td className="p-2.5">
                        <a
                          href={`/admin/orders/${d.orderId}`}
                          className="font-medium text-brand-slatedark hover:text-brand-rust"
                        >
                          {d.customerName}
                        </a>
                        <div className="text-[10px] text-zinc-400">
                          #{d.orderNumber}
                          {d.pointName ? ` · ${d.pointName}` : ""}
                        </div>
                      </td>
                      <td className="p-2.5 text-center text-xs text-zinc-600" dir="ltr">
                        {d.phone || "—"}
                      </td>
                      <td className="p-2.5 text-xs text-zinc-700">
                        {d.address || "—"}
                        {d.note && (
                          <div className="text-[10px] text-zinc-400">{d.note}</div>
                        )}
                      </td>
                      <td className="p-2.5 text-center font-bold text-violet-700">
                        {d.fee > 0 ? fmt(d.fee) : "—"}
                        {/* ⚠️ הזמנה ששולמה - דמי המשלוח לא נגבו בכרטיס */}
                        {d.paid && d.fee > 0 && (
                          <span className="block text-[9px] text-amber-600 font-normal">
                            שולם — לוודא גבייה
                          </span>
                        )}
                      </td>
                      <td className="p-2.5 text-center text-xs text-zinc-600">
                        {d.byName}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )
      ) : tab === "credits" ? (
        data.credits.length === 0 ? (
          // §231: 🐛 "אין זיכויים" נראה כמו תקלה.
          //
          // המנהל פותח מסך, רואה אפסים ו"אין נתונים", ולא יודע אם
          // המסך שבור או שפשוט מוקדם מדי בתהליך.
          //
          // ⚠️ ההסבר הופך "ריק" ל"עדיין לא" - וזה ההבדל בין
          // דיווח באג לבין להמשיך לעבוד.
          <div className="p-6 text-center">
            <p className="text-zinc-500 text-sm">אין זיכויים במכירה שנבחרה.</p>
            <p className="text-[11px] text-zinc-400 mt-1.5 leading-relaxed">
              זיכויים נוצרים כשנציג מזכה לקוח בחלוקה — למשל על פריט חסר או
              איכות. המסך יתמלא במהלך יום החלוקה.
            </p>
          </div>
        ) : (
          <div className="card p-0 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-zinc-50 border-b border-zinc-200 text-[11px] text-zinc-600">
                <tr>
                  <th className="text-right p-2.5">לקוח</th>
                  <th className="p-2.5">הזמנה</th>
                  <th className="p-2.5">סכום</th>
                  <th className="text-right p-2.5">סיבה</th>
                  <th className="p-2.5">מי זיכה</th>
                  <th className="p-2.5">מתי</th>
                </tr>
              </thead>
              <tbody>
                {data.credits.map((c) => (
                  <tr key={c.orderId} className="border-b border-zinc-100">
                    <td className="p-2.5">
                      <div className="font-medium text-brand-slatedark">
                        {c.customerName}
                      </div>
                      {c.pointName && (
                        <div className="text-[10px] text-zinc-400">{c.pointName}</div>
                      )}
                    </td>
                    <td className="p-2.5 text-center">
                      <a
                        href={`/admin/orders/${c.orderId}`}
                        className="text-brand-rust hover:underline text-xs"
                      >
                        #{c.orderNumber}
                      </a>
                    </td>
                    <td className="p-2.5 text-center font-bold text-amber-700">
                      {fmt(c.amount)}
                      {/* זיכוי על הזמנה ששולמה הפך ליתרה ולא הקטין
                          חיוב - הבחנה חשובה למנהל שבודק כסף */}
                      {c.asBalance && (
                        <span className="block text-[9px] text-blue-600 font-normal">
                          כיתרה
                        </span>
                      )}
                    </td>
                    <td className="p-2.5 text-xs text-zinc-600">{c.reason || "—"}</td>
                    <td className="p-2.5 text-center text-xs text-zinc-600">
                      {c.byName}
                    </td>
                    <td className="p-2.5 text-center text-[11px] text-zinc-400">
                      {c.at ? fmtDate(c.at) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      ) : data.balances.length === 0 ? (
        <p className="text-zinc-500 text-sm p-4">אין יתרות זכות פתוחות.</p>
      ) : (
        <div className="card p-0 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-zinc-50 border-b border-zinc-200 text-[11px] text-zinc-600">
              <tr>
                <th className="text-right p-2.5">לקוח</th>
                <th className="p-2.5">טלפון</th>
                <th className="p-2.5">יתרה</th>
                <th className="text-right p-2.5">סיבה</th>
                <th className="p-2.5">מתי</th>
              </tr>
            </thead>
            <tbody>
              {data.balances.map((b) => (
                <tr key={b.customerId} className="border-b border-zinc-100">
                  <td className="p-2.5 font-medium text-brand-slatedark">{b.name}</td>
                  <td className="p-2.5 text-center text-xs text-zinc-500" dir="ltr">
                    {b.phone || "—"}
                  </td>
                  <td className="p-2.5 text-center font-bold text-blue-700">
                    {fmt(b.balance)}
                  </td>
                  <td className="p-2.5 text-xs text-zinc-600">{b.note || "—"}</td>
                  <td className="p-2.5 text-center text-[11px] text-zinc-400">
                    {b.at ? fmtDate(b.at) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
