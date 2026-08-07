"use client";

// יומן ביקורת תשלומים - מסך קריאה בלבד.
//
// הטבלה PaymentAuditLog נכתבה בכל סימון תשלום מזומן מאז ומעולם, אבל לא
// הייתה שום דרך לראות אותה מהממשק. המסך הזה חושף אותה: מי קיבל, כמה,
// מתי, מול איזה מחיר סופי, ועם איזו הערה.

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { api } from "@/lib/client";
import { fmt, PAYMENT_METHOD_LABELS } from "@/lib/pricing";

type Row = {
  id: string;
  orderId: string;
  orderNumber: number | null;
  customerName: string | null;
  phone: string | null;
  pricelistId: string | null;
  pricelistName: string | null;
  pointName: string | null;
  orderDeleted: boolean;
  action: string;
  amountPaid: number;
  finalTotalAtTime: number;
  difference: number;
  paymentMethod: string;
  receivedByUserId: string;
  note: string | null;
  createdAt: string;
};

type Pricelist = { id: string; name: string; status: string };

const ALL = "__all__";

const ACTION_LABELS: Record<string, string> = {
  MANUAL_CASH_PAYMENT: "תשלום מזומן",
  REFUND: "החזר",
};

function fmtDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString("he-IL", {
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

export default function PaymentAuditPage() {
  const [data, setData] = useState<any>(null);
  const [lists, setLists] = useState<Pricelist[] | null>(null);
  const [fPricelist, setFPricelist] = useState(ALL);
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  useEffect(() => {
    api("/api/admin/pricelists")
      .then((res: Pricelist[]) => setLists(Array.isArray(res) ? res : []))
      .catch(() => setLists([]));
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setErr("");
    try {
      const params = new URLSearchParams();
      if (fPricelist !== ALL) params.set("pricelistId", fPricelist);
      if (q.trim()) params.set("q", q.trim());
      const qs = params.toString();
      setData(await api(`/api/admin/payment-audit${qs ? `?${qs}` : ""}`));
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setLoading(false);
    }
  }, [fPricelist, q]);

  // debounce קל על החיפוש כדי לא לירות בקשה בכל הקלדה
  useEffect(() => {
    const t = setTimeout(load, 300);
    return () => clearTimeout(t);
  }, [load]);

  const rows: Row[] = data?.rows ?? [];

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-extrabold text-brand-slatedark">יומן תשלומים</h1>
        <p className="text-sm text-brand-slate/60 mt-0.5">
          תיעוד קבוע של כל סימון תשלום ידני — מי קיבל, כמה, ומול איזה מחיר סופי.
          הרישומים אינם נמחקים.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <select
          className="input max-w-[240px]"
          value={fPricelist}
          onChange={(e) => setFPricelist(e.target.value)}
          disabled={!lists}
          aria-label="סינון לפי מכירה"
        >
          <option value={ALL}>כל המכירות</option>
          {lists?.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
              {l.status === "ACTIVE" ? " • פעילה" : ""}
            </option>
          ))}
        </select>

        <input
          className="input max-w-[240px]"
          placeholder="חיפוש: שם, טלפון, מס' הזמנה"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          aria-label="חיפוש ביומן"
        />

        {!loading && (
          <span className="text-sm text-brand-slate/60 mr-auto">
            {data?.count ?? 0} רישומים · {fmt(data?.totalAmount ?? 0)}
          </span>
        )}
      </div>

      {data?.partialCount > 0 && (
        <div className="card p-3 border-amber-300 bg-amber-50 text-sm text-amber-900">
          {data.partialCount} רישומים שבהם שולם פחות מהמחיר הסופי — מסומנים באדום בטבלה.
        </div>
      )}

      {err && (
        <div className="card p-4 border-red-200 bg-red-50 text-sm text-red-800">
          שגיאה בטעינת היומן: {err}
        </div>
      )}

      {loading ? (
        <p className="text-zinc-500">טוען...</p>
      ) : rows.length === 0 ? (
        <div className="card p-6 text-center">
          <p className="font-medium text-brand-slatedark">אין רישומים</p>
          <p className="text-sm text-brand-slate/60 mt-1">
            רישום נוצר בכל פעם שמסמנים תשלום מזומן בהזמנה.
          </p>
        </div>
      ) : (
        <div className="table-wrap">
          <table className="admin">
            <thead>
              <tr>
                <th>תאריך</th>
                <th>הזמנה</th>
                <th>לקוח</th>
                <th>שולם</th>
                <th>מחיר סופי אז</th>
                <th>אמצעי</th>
                <th>נקלט ע"י</th>
                <th>הערה</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const isPartial = r.difference < -0.01;
                const isOver = r.difference > 0.01;
                return (
                  <tr key={r.id} className={isPartial ? "bg-red-50/50" : ""}>
                    <td className="text-zinc-500 whitespace-nowrap">{fmtDate(r.createdAt)}</td>
                    <td>
                      {r.orderNumber != null ? (
                        r.orderDeleted ? (
                          <span>#{r.orderNumber}</span>
                        ) : (
                          <Link
                            href={`/admin/orders/${r.orderId}`}
                            className="text-brand-rust font-bold hover:underline"
                          >
                            #{r.orderNumber}
                          </Link>
                        )
                      ) : (
                        <span className="text-zinc-400 text-xs">הזמנה נמחקה</span>
                      )}
                      {r.pointName && (
                        <span className="block text-xs text-zinc-400">{r.pointName}</span>
                      )}
                    </td>
                    <td>
                      <div className="font-medium">{r.customerName ?? "—"}</div>
                      {r.phone && (
                        <div className="text-xs text-zinc-400" dir="ltr">
                          {r.phone}
                        </div>
                      )}
                    </td>
                    <td>
                      <span className="font-bold">{fmt(r.amountPaid)}</span>
                      {isPartial && (
                        <span className="block text-xs text-red-700">
                          חסר {fmt(Math.abs(r.difference))}
                        </span>
                      )}
                      {isOver && (
                        <span className="block text-xs text-amber-700">
                          עודף {fmt(r.difference)}
                        </span>
                      )}
                    </td>
                    <td className="text-zinc-500">{fmt(r.finalTotalAtTime)}</td>
                    <td>
                      <span className="badge bg-zinc-100 text-zinc-700">
                        {PAYMENT_METHOD_LABELS[r.paymentMethod] ?? r.paymentMethod}
                      </span>
                      {r.action !== "MANUAL_CASH_PAYMENT" && (
                        <span className="block text-xs text-zinc-400">
                          {ACTION_LABELS[r.action] ?? r.action}
                        </span>
                      )}
                    </td>
                    <td className="text-zinc-600 text-xs" dir="ltr">
                      {r.receivedByUserId}
                    </td>
                    <td className="text-zinc-600 text-xs">{r.note || "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
