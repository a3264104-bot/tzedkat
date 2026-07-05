"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/client";
import { fmt, PAYMENT_STATUS_LABELS } from "@/lib/pricing";

type Debt = {
  id: string;
  orderNumber: number;
  customerName: string;
  phone: string;
  email: string | null;
  pointName: string;
  finalTotal: number;
  amountPaid: number;
  paymentStatus: string;
  paymentLink: string | null;
  daysWaiting: number;
  customerNotifiedAt: string | null;
};

// בונה קישור וואטסאפ עם הודעת תזכורת מוכנה
function waLink(debt: Debt): string {
  const phone = debt.phone.replace(/\D/g, "").replace(/^0/, "972");
  const remaining = debt.finalTotal - debt.amountPaid;
  const text = encodeURIComponent(
    `שלום ${debt.customerName},\n` +
      `תזכורת ידידותית מצדקת רבותינו 🙂\n` +
      `הזמנה מס' ${debt.orderNumber} ממתינה לתשלום של ${fmt(remaining)}.\n` +
      (debt.paymentLink ? `לתשלום מאובטח: ${debt.paymentLink}\n` : "") +
      `תודה רבה!`
  );
  return `https://wa.me/${phone}?text=${text}`;
}

function downloadCsv(filename: string, rows: string[][]) {
  const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\r\n");
  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export default function DebtsPage() {
  const [debts, setDebts] = useState<Debt[]>([]);
  const [loading, setLoading] = useState(true);
  const [sendingId, setSendingId] = useState<string | null>(null);
  const [sentIds, setSentIds] = useState<Set<string>>(new Set());
  const [error, setError] = useState("");

  async function load() {
    setLoading(true);
    setDebts(await api("/api/admin/debts"));
    setLoading(false);
  }
  useEffect(() => {
    load();
  }, []);

  async function sendReminder(debt: Debt) {
    setError("");
    setSendingId(debt.id);
    try {
      await api("/api/admin/debts", {
        method: "POST",
        body: JSON.stringify({ orderId: debt.id }),
      });
      setSentIds((prev) => new Set(prev).add(debt.id));
    } catch (e: any) {
      setError(`הזמנה #${debt.orderNumber}: ${e.message}`);
    } finally {
      setSendingId(null);
    }
  }

  function exportCsv() {
    const rows: string[][] = [
      ["הזמנה", "שם", "טלפון", "נקודה", "לתשלום", "שולם חלקית", "ימים ממתין", "סטטוס"],
      ...debts.map((d) => [
        `#${d.orderNumber}`,
        d.customerName,
        d.phone,
        d.pointName,
        String(d.finalTotal),
        d.amountPaid ? String(d.amountPaid) : "",
        String(d.daysWaiting),
        PAYMENT_STATUS_LABELS[d.paymentStatus] ?? d.paymentStatus,
      ]),
    ];
    downloadCsv("דוח-חובות.csv", rows);
  }

  const totalOutstanding = debts.reduce((s, d) => s + (d.finalTotal - d.amountPaid), 0);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold text-brand-slatedark">חובות ותזכורות</h1>
          <p className="text-sm text-zinc-500">
            הזמנות שנקבע להן מחיר סופי וטרם שולמו במלואן
          </p>
        </div>
        {debts.length > 0 && (
          <button onClick={exportCsv} className="btn-ghost btn-sm no-print">
            ⬇ ייצוא לאקסל
          </button>
        )}
      </div>

      {/* סיכום */}
      <div className="grid grid-cols-2 gap-3 max-w-md">
        <div className="card p-4 text-center">
          <div className="text-2xl font-extrabold text-brand-slatedark">{debts.length}</div>
          <div className="text-xs text-zinc-500">הזמנות ממתינות</div>
        </div>
        <div className="card p-4 text-center">
          <div className="text-2xl font-extrabold text-red-600">{fmt(totalOutstanding)}</div>
          <div className="text-xs text-zinc-500">סה"כ לגבייה</div>
        </div>
      </div>

      {error && (
        <div className="card p-3 bg-red-50 border-red-200 text-sm text-red-700">{error}</div>
      )}

      {loading ? (
        <p className="text-zinc-500">טוען...</p>
      ) : debts.length === 0 ? (
        <div className="card p-8 text-center">
          <div className="text-3xl mb-2">🎉</div>
          <p className="font-bold text-brand-slatedark">אין חובות פתוחים!</p>
          <p className="text-sm text-zinc-500">כל ההזמנות עם מחיר סופי שולמו.</p>
        </div>
      ) : (
        <div className="table-wrap">
          <table className="admin">
            <thead>
              <tr>
                <th>#</th>
                <th>לקוח</th>
                <th>נקודה</th>
                <th>לתשלום</th>
                <th>ממתין</th>
                <th>תזכורות</th>
              </tr>
            </thead>
            <tbody>
              {debts.map((d) => {
                const remaining = d.finalTotal - d.amountPaid;
                return (
                  <tr key={d.id} className={d.daysWaiting >= 7 ? "bg-red-50/50" : ""}>
                    <td>#{d.orderNumber}</td>
                    <td>
                      <div className="font-medium">{d.customerName}</div>
                      <div className="text-xs text-zinc-400" dir="ltr">
                        {d.phone}
                      </div>
                    </td>
                    <td className="text-zinc-500">{d.pointName}</td>
                    <td>
                      <span className="font-bold text-brand-rust">{fmt(remaining)}</span>
                      {d.amountPaid > 0 && (
                        <div className="text-xs text-zinc-400">
                          (שולם {fmt(d.amountPaid)} מתוך {fmt(d.finalTotal)})
                        </div>
                      )}
                    </td>
                    <td>
                      <span
                        className={`badge ${
                          d.daysWaiting >= 7
                            ? "bg-red-100 text-red-700"
                            : d.daysWaiting >= 3
                              ? "bg-amber-100 text-amber-700"
                              : "bg-zinc-100 text-zinc-600"
                        }`}
                      >
                        {d.daysWaiting === 0 ? "היום" : `${d.daysWaiting} ימים`}
                      </span>
                    </td>
                    <td>
                      <div className="flex gap-1 justify-end">
                        {/* וואטסאפ - עם הודעה מוכנה + לינק תשלום */}
                        {d.phone && (
                          <a
                            href={waLink(d)}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="btn-ghost btn-sm"
                            title="שליחת תזכורת בוואטסאפ"
                          >
                            💬 וואטסאפ
                          </a>
                        )}
                        {/* מייל - רק אם יש כתובת */}
                        {d.email && (
                          <button
                            onClick={() => sendReminder(d)}
                            disabled={sendingId === d.id || sentIds.has(d.id)}
                            className="btn-ghost btn-sm"
                            title={`שליחת תזכורת ל-${d.email}`}
                          >
                            {sentIds.has(d.id)
                              ? "✓ נשלח"
                              : sendingId === d.id
                                ? "שולח..."
                                : "✉ מייל"}
                          </button>
                        )}
                      </div>
                    </td>
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
