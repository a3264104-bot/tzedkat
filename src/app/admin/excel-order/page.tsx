"use client";

// §115: מסך ההזמנה דרך אקסל.
//
// שלושה שלבים במסך אחד: בחירת לקוח ומכירה -> הפקת קובץ / העלאת
// קובץ שחזר -> תצוגה מקדימה ואישור.
//
// ⚠️ התצוגה המקדימה אינה קישוט. קובץ שחזר מלקוח כמעט תמיד מכיל
// משהו לא צפוי - שורה שנמחקה, כמות בטקסט, מחיר שנערך - והמנהל
// חייב לראות מה נקלט ומה נדחה **לפני** שההזמנה נוצרת. לקוח
// שהזמין משהו שלא נקלט יגיע לחלוקה ויגלה שחסר לו.

import { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/client";
import { fmt } from "@/lib/pricing";

type Customer = { id: string; name: string; phone: string | null; pointName: string | null };
type Pricelist = { id: string; name: string; status: string; agentOnly?: boolean };

type PreviewItem = {
  productId: string;
  productName: string;
  unit: string;
  isSingle: boolean;
  quantity: number;
  unitPrice: number;
  estimatedPrice: number;
  priceChanged: boolean;
};
type Issue = { rowNumber: number; productName: string; reason: string };

type Preview = {
  customer: { id: string; name: string; phone: string | null; pointName: string | null };
  pricelist: { id: string; name: string; deliveryDateText: string | null };
  blockers: string[];
  signatureChecked: boolean;
  items: PreviewItem[];
  issues: Issue[];
  totals: { itemsTotal: number; orderFee: number; estimatedTotal: number };
};

export default function ExcelOrderPage() {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [lists, setLists] = useState<Pricelist[]>([]);
  const [query, setQuery] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [pricelistId, setPricelistId] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const l = await api("/api/admin/pricelists");
        const active = (Array.isArray(l) ? l : []).filter(
          (x: any) => x.status === "ACTIVE"
        );
        setLists(active);
        if (active.length === 1) setPricelistId(active[0].id);
      } catch {
        /* מוצג בשגיאה בפעולה הבאה */
      }
    })();
  }, []);

  useEffect(() => {
    const t = setTimeout(async () => {
      if (query.trim().length < 2) {
        setCustomers([]);
        return;
      }
      try {
        const d = await api(`/api/admin/customers?q=${encodeURIComponent(query)}`);
        setCustomers(Array.isArray(d) ? d.slice(0, 20) : []);
      } catch {
        setCustomers([]);
      }
    }, 300);
    return () => clearTimeout(t);
  }, [query]);

  const selectedCustomer = useMemo(
    () => customers.find((c) => c.id === customerId) ?? null,
    [customers, customerId]
  );

  function download() {
    if (!customerId || !pricelistId) {
      setError("יש לבחור לקוח ומכירה");
      return;
    }
    setError("");
    // ניווט ישיר - הדפדפן מטפל בהורדה, ואין צורך להחזיק את הקובץ
    // בזיכרון של הדף
    window.location.href = `/api/admin/excel-order?customerId=${customerId}&pricelistId=${pricelistId}`;
  }

  async function upload(file: File) {
    if (!customerId) {
      setError("יש לבחור לקוח לפני העלאת הקובץ");
      return;
    }
    setBusy(true);
    setError("");
    setMsg("");
    setPreview(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("customerId", customerId);
      const res = await fetch("/api/admin/excel-order", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "שגיאה בקריאת הקובץ");
      setPreview(data);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function confirm() {
    if (!preview) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/admin/excel-order", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customerId: preview.customer.id,
          pricelistId: preview.pricelist.id,
          rows: preview.items.map((i) => ({
            productId: i.productId,
            isSingle: i.isSingle,
            quantity: i.quantity,
          })),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "שגיאה ביצירת ההזמנה");
      setMsg(
        `נוצרה הזמנה #${data.orderNumber} עם ${data.itemCount} פריטים עבור ${preview.customer.name}`
      );
      setPreview(null);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main dir="rtl" className="p-4 sm:p-6 max-w-5xl mx-auto space-y-5">
      <div>
        <h1 className="text-2xl font-extrabold text-brand-slatedark">הזמנה דרך אקסל</h1>
        <p className="text-sm text-zinc-500 mt-1">
          מפיקים קובץ ללקוח, שולחים במייל, ומעלים אותו חזרה כשהוא ממולא.
        </p>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-300 text-red-800 rounded-lg p-3 text-sm">
          {error}
        </div>
      )}
      {msg && (
        <div className="bg-emerald-50 border border-emerald-300 text-emerald-800 rounded-lg p-3 text-sm font-bold">
          ✓ {msg}
        </div>
      )}

      {/* ─── 1. בחירה ─── */}
      <div className="card p-5 space-y-3">
        <p className="text-xs font-bold text-zinc-500">1. בחירת לקוח ומכירה</p>

        <div>
          <label className="text-xs text-zinc-600 block mb-1">חיפוש לקוח</label>
          <input
            className="input w-full"
            placeholder="שם או טלפון…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {customers.length > 0 && (
            <div className="mt-2 max-h-52 overflow-y-auto border border-zinc-200 rounded-lg divide-y divide-zinc-100">
              {customers.map((c) => (
                <button
                  key={c.id}
                  onClick={() => setCustomerId(c.id)}
                  className={`w-full text-right p-2.5 text-sm hover:bg-zinc-50 ${
                    customerId === c.id ? "bg-amber-50 font-bold" : ""
                  }`}
                >
                  {c.name}
                  <span className="text-xs text-zinc-500 mr-2" dir="ltr">
                    {c.phone}
                  </span>
                  {c.pointName && (
                    <span className="text-[11px] text-zinc-400 block">{c.pointName}</span>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>

        <div>
          <label className="text-xs text-zinc-600 block mb-1">מכירה</label>
          <select
            className="input w-full"
            value={pricelistId}
            onChange={(e) => setPricelistId(e.target.value)}
          >
            <option value="">— בחר מכירה —</option>
            {lists.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
                {l.agentOnly ? " (נציגים בלבד)" : ""}
              </option>
            ))}
          </select>
          {lists.length === 0 && (
            <p className="text-xs text-amber-700 mt-1">אין מכירה פעילה כרגע.</p>
          )}
        </div>
      </div>

      {/* ─── 2. הפקה / העלאה ─── */}
      <div className="grid sm:grid-cols-2 gap-4">
        <div className="card p-5">
          <p className="text-xs font-bold text-zinc-500 mb-2">2א. הפקת קובץ ללקוח</p>
          <p className="text-xs text-zinc-500 mb-3 leading-relaxed">
            הקובץ נוצר עם כל מוצרי המכירה, המחירים ונקודת החלוקה של הלקוח.
            אם כבר יש לו הזמנה — הכמויות יופיעו מלאות.
          </p>
          <button
            onClick={download}
            disabled={!customerId || !pricelistId}
            className="w-full py-2.5 rounded-xl bg-brand-slatedark text-white font-bold disabled:opacity-40"
          >
            ⬇️ הורדת קובץ
          </button>
        </div>

        <div className="card p-5">
          <p className="text-xs font-bold text-zinc-500 mb-2">2ב. העלאת קובץ שחזר</p>
          <p className="text-xs text-zinc-500 mb-3 leading-relaxed">
            אחרי שהלקוח מילא והחזיר. תוצג תצוגה מקדימה לפני שההזמנה נוצרת.
          </p>
          <label className="block">
            <input
              type="file"
              accept=".xlsx"
              disabled={!customerId || busy}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) upload(f);
                e.target.value = "";
              }}
              className="block w-full text-xs file:ml-2 file:py-2 file:px-3 file:rounded-lg file:border-0 file:bg-brand-rust file:text-white file:font-bold file:cursor-pointer disabled:opacity-40"
            />
          </label>
          {busy && <p className="text-xs text-zinc-500 mt-2">מעבד…</p>}
        </div>
      </div>

      {/* ─── 3. תצוגה מקדימה ─── */}
      {preview && (
        <div className="card p-5 space-y-4">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div>
              <p className="text-xs font-bold text-zinc-500">3. תצוגה מקדימה</p>
              <p className="font-extrabold text-brand-slatedark mt-0.5">
                {preview.customer.name}
              </p>
              <p className="text-xs text-zinc-500">
                {preview.pricelist.name}
                {preview.customer.pointName && ` · ${preview.customer.pointName}`}
              </p>
            </div>
            <div className="text-left">
              <div className="text-xs text-zinc-500">סה״כ משוער</div>
              <div className="text-xl font-extrabold text-brand-rust">
                {fmt(preview.totals.estimatedTotal)}
              </div>
            </div>
          </div>

          {/* חסימות - מונעות אישור */}
          {preview.blockers.length > 0 && (
            <div className="bg-red-50 border-2 border-red-300 rounded-xl p-3">
              <div className="font-bold text-red-800 text-sm mb-1">
                לא ניתן ליצור את ההזמנה
              </div>
              <ul className="list-disc pr-5 text-xs text-red-700 space-y-0.5">
                {preview.blockers.map((b, i) => (
                  <li key={i}>{b}</li>
                ))}
              </ul>
            </div>
          )}

          {/* ⚠️ שורות שנדחו - מוצגות תמיד ובבירור. זו הסיבה
              המרכזית שהתצוגה המקדימה קיימת. */}
          {preview.issues.length > 0 && (
            <div className="bg-amber-50 border-2 border-amber-300 rounded-xl p-3">
              <div className="font-bold text-amber-900 text-sm mb-1">
                ⚠️ {preview.issues.length} שורות לא נקלטו
              </div>
              <p className="text-[11px] text-amber-800 mb-2">
                כדאי לוודא מול הלקוח שהוא לא התכוון להזמין אותן.
              </p>
              <ul className="text-xs text-amber-900 space-y-1">
                {preview.issues.map((s, i) => (
                  <li key={i}>
                    <b>{s.productName}</b>
                    {s.rowNumber > 0 && ` (שורה ${s.rowNumber})`} — {s.reason}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {!preview.signatureChecked && (
            <p className="text-xs text-zinc-500 bg-zinc-50 border border-zinc-200 rounded-lg p-2.5">
              החתימות לא נבדקו (מפתח חתימה אינו מוגדר בשרת). הנתונים נקלטו לפי
              המזהים בלבד.
            </p>
          )}

          <div className="overflow-x-auto border border-zinc-200 rounded-lg">
            <table className="w-full text-sm">
              <thead className="bg-zinc-50 border-b border-zinc-200 text-[11px] text-zinc-600">
                <tr>
                  <th className="text-right p-2">מוצר</th>
                  <th className="p-2">יחידה</th>
                  <th className="p-2">כמות</th>
                  <th className="p-2">מחיר</th>
                  <th className="p-2">סה״כ</th>
                </tr>
              </thead>
              <tbody>
                {preview.items.map((it, i) => (
                  <tr key={i} className="border-b border-zinc-100">
                    <td className="p-2 font-medium">
                      {it.productName}
                      {it.isSingle && (
                        <span className="text-[10px] bg-amber-100 text-amber-800 rounded px-1 mr-1">
                          בודדים
                        </span>
                      )}
                    </td>
                    <td className="p-2 text-center text-xs text-zinc-500">{it.unit}</td>
                    <td className="p-2 text-center font-bold">{it.quantity}</td>
                    <td className="p-2 text-center text-xs">
                      {fmt(it.unitPrice)}
                      {/* המחיר בקובץ שונה מהמחירון - הקובץ ישן.
                          מתומחר לפי המחירון, והמנהל צריך לדעת. */}
                      {it.priceChanged && (
                        <span
                          className="text-[10px] text-amber-700 block"
                          title="המחיר בקובץ היה שונה — תומחר לפי המחירון הנוכחי"
                        >
                          עודכן
                        </span>
                      )}
                    </td>
                    <td className="p-2 text-center font-bold text-brand-rust">
                      {fmt(it.estimatedPrice)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {preview.totals.orderFee > 0 && (
            <p className="text-xs text-zinc-500 text-left">
              דמי טיפול: {fmt(preview.totals.orderFee)}
            </p>
          )}

          <div className="flex gap-2">
            <button
              onClick={() => setPreview(null)}
              disabled={busy}
              className="btn-ghost btn-sm flex-1"
            >
              ביטול
            </button>
            <button
              onClick={confirm}
              disabled={busy || preview.blockers.length > 0 || preview.items.length === 0}
              className="flex-1 py-3 rounded-xl bg-emerald-600 text-white font-bold disabled:opacity-40"
            >
              {busy ? "יוצר…" : `✓ צור הזמנה (${preview.items.length} פריטים)`}
            </button>
          </div>

          <p className="text-[11px] text-zinc-500 leading-relaxed">
            ⚠️ אם ללקוח כבר יש הזמנה במכירה הזו — היא <b>תוחלף</b> בזו שבקובץ.
            הזמנה ששולמה כבר לא ניתנת להחלפה.
          </p>
        </div>
      )}
    </main>
  );
}
