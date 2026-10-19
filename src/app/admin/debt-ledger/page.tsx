"use client";

// ═══════════════════════════════════════════════════════════════
// §376: ספר החובות — כל התנועות, במקום אחד
// ═══════════════════════════════════════════════════════════════
// /admin/debt-ledger
//
// הצורך: המנהל שואל "כמה חוב יש לי בחוץ? מי חייב? מה נגבה
// השבוע? דרך איזה נציג?" — ועד היום התשובה הייתה בשלושה
// מסכים.
//
// ⚠️ שלושה מסננים, טבלה אחת: לפי לקוח, מכירה, או נציג. הנתונים
// זהים — הזווית שונה.

import { useEffect, useState } from "react";

type Row = {
  id: string;
  kind: "ADD" | "COLLECT" | "RESTORE" | "ADJUST";
  amount: number;
  balanceAfter: number;
  note: string | null;
  customer: { id: string; name: string; phone: string | null };
  orderNumber: number | null;
  pricelistName: string | null;
  agentName: string | null;
  createdBy: string;
  createdAt: string;
};

const KIND: Record<Row["kind"], { text: string; cls: string; icon: string }> = {
  ADD: { text: "נרשם", cls: "text-red-700 bg-red-50", icon: "➕" },
  COLLECT: { text: "נגבה", cls: "text-emerald-700 bg-emerald-50", icon: "✓" },
  RESTORE: { text: "הוחזר", cls: "text-amber-700 bg-amber-50", icon: "↩" },
  ADJUST: { text: "תיקון", cls: "text-zinc-600 bg-zinc-100", icon: "✏️" },
};

export default function DebtLedgerPage() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [totals, setTotals] = useState<{
    added: number;
    collected: number;
    restored: number;
    adjusted: number;
  } | null>(null);
  const [outstanding, setOutstanding] = useState<
    Array<{ id: string; name: string; debt: number; note: string | null }>
  >([]);
  const [filter, setFilter] = useState<"all" | "ADD" | "COLLECT">("all");

  // §377: 💳 **לא שולם במכירה הזו — נפרד מחוב קודם.**
  //
  // שני דברים שונים לגמרי:
  //   • חוב קודם: הלקוח נשאר חייב ממכירה שהסתיימה. נרשם ידנית,
  //     נגבה בחיוב הבא, מופיע ב-DebtLedger.
  //   • לא שולם: הזמנה במכירה הנוכחית שיש לה מחיר סופי ועדיין
  //     לא חויבה. זה לא "חוב" — זה תור לחיוב.
  //
  // ⚠️ ערבוב שלהם היה מציג "חוב בחוץ ₪280,000" כשבפועל זה
  // 255 הזמנות שמחכות ללחיצה על "חייב".
  const [unpaid, setUnpaid] = useState<{ count: number; sum: number } | null>(null);
  const [q, setQ] = useState("");

  useEffect(() => {
    // §399: בקשה אחת במקום שלוש. "מי חייב" ו"לא שולם" מגיעים מאותו
    // API — קודם נקראו /api/admin/debts (שמחזיר הזמנות, לא לקוחות —
    // ולכן 22 שורות ריקות של ₪0.00) ו-/api/admin/payments (250 הזמנות
    // מלאות, רק כדי לסכום שני מספרים).
    fetch("/api/admin/debt-ledger", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { rows: [], totals: null }))
      .then((d) => {
        setRows(d.rows ?? []);
        setTotals(d.totals ?? null);
        setOutstanding(
          (d.outstanding ?? []).map((c: any) => ({
            id: c.id,
            name: c.name ?? "",
            debt: Number(c.debt ?? 0),
            note: c.note ?? null,
          }))
        );
        setUnpaid(d.unpaid ?? null);
      })
      .catch(() => setRows([]));
  }, []);

  const fmt = (n: number) => `₪${Math.abs(n).toFixed(2)}`;
  const date = (iso: string) =>
    new Date(iso).toLocaleDateString("he-IL", {
      day: "2-digit",
      month: "2-digit",
      year: "2-digit",
      timeZone: "Asia/Jerusalem",
    });

  const visible = (rows ?? []).filter((r) => {
    if (filter !== "all" && r.kind !== filter) return false;
    if (q.trim()) {
      const s = q.trim();
      return (
        r.customer.name.includes(s) ||
        (r.pricelistName ?? "").includes(s) ||
        (r.agentName ?? "").includes(s) ||
        String(r.orderNumber ?? "").includes(s)
      );
    }
    return true;
  });

  const outstandingSum = outstanding.reduce((s, c) => s + c.debt, 0);

  return (
    <main dir="rtl" className="max-w-4xl mx-auto p-4 space-y-4">
      <div>
        <h1 className="text-2xl font-extrabold text-brand-slatedark">📒 ספר החובות</h1>
        <p className="text-sm text-zinc-500 mt-1">
          כל תנועת חוב — מי, כמה, מתי, ודרך מי
        </p>
      </div>

      {/* ⚠️ המספרים שחשובים — למעלה, לפני הטבלה. */}
      {/* §377: שתי קוביות נפרדות — חוב קודם מול לא-שולם-עדיין.
          
          ⚠️ צבעים שונים: אדום = חוב אמיתי שצריך לרדוף. כתום =
          תור לחיוב, פעולה אחת ונגמר. */}
      {unpaid && unpaid.count > 0 && (
        <a
          href="/admin/payments"
          className="block rounded-xl border-2 border-amber-300 bg-amber-50 p-3 hover:bg-amber-100 transition-colors"
        >
          <div className="flex items-center justify-between">
            <div>
              <div className="text-[11px] font-bold text-amber-800">
                💳 ממתין לתשלום — הזמנות שנשקלו
              </div>
              <div className="text-xl font-extrabold text-amber-900 tabular-nums">
                {fmt(unpaid.sum)}
              </div>
              <div className="text-[10px] text-amber-700">
                {unpaid.count} הזמנות עם מחיר סופי שטרם שולמו במלואן (היתרה בלבד) · זה לא חוב, זה תור
              </div>
            </div>
            <span className="text-amber-700 font-bold text-sm">לחיוב ←</span>
          </div>
        </a>
      )}
      {/* אותן הזמנות, אחת-אחת, עם תזכורת בוואטסאפ/מייל — במסך החובות.
          כאן רק הסכום, כדי שלא יהיו שתי רשימות של אותו דבר. */}
      {unpaid && unpaid.count > 0 && (
        <a href="/admin/debts" className="-mt-2 block text-xs text-amber-800 hover:underline">
          📲 לשליחת תזכורת לכל לקוח — חובות לקוחות ותזכורות ←
        </a>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <div className="rounded-xl border-2 border-red-300 bg-red-50 p-3">
          <div className="text-[11px] font-bold text-red-800">💸 חוב ממכירות קודמות</div>
          <div className="text-xl font-extrabold text-red-900 tabular-nums">
            {fmt(outstandingSum)}
          </div>
          <div className="text-[10px] text-red-700">{outstanding.length} לקוחות</div>
        </div>
        <div className="rounded-xl border-2 border-emerald-300 bg-emerald-50 p-3">
          <div className="text-[11px] font-bold text-emerald-800">נגבה סה״כ</div>
          <div className="text-xl font-extrabold text-emerald-900 tabular-nums">
            {fmt(totals?.collected ?? 0)}
          </div>
        </div>
        <div className="rounded-xl border border-zinc-200 bg-white p-3">
          <div className="text-[11px] font-bold text-zinc-500">נרשם סה״כ</div>
          <div className="text-xl font-extrabold text-zinc-700 tabular-nums">
            {fmt((totals?.added ?? 0) + (totals?.adjusted ?? 0))}
          </div>
        </div>
        <div className="rounded-xl border border-zinc-200 bg-white p-3">
          <div className="text-[11px] font-bold text-zinc-500">הוחזר (ביטולים)</div>
          <div className="text-xl font-extrabold text-zinc-700 tabular-nums">
            {fmt(totals?.restored ?? 0)}
          </div>
        </div>
      </div>

      {/* מי חייב עכשיו */}
      {rows !== null && outstanding.length === 0 && (
        <div className="card p-4 text-sm text-emerald-800 bg-emerald-50 border-emerald-200">
          ✅ אין לקוחות עם חוב ממכירות קודמות.
        </div>
      )}
      {outstanding.length > 0 && (
        <div className="card p-4">
          <h2 className="font-bold text-brand-slatedark mb-2">
            💸 חייבים עכשיו ({outstanding.length})
          </h2>
          <div className="space-y-1">
            {outstanding
              .sort((a, b) => b.debt - a.debt)
              .map((c) => (
                <a
                  key={c.id}
                  href={`/admin/customers?q=${encodeURIComponent(c.name)}`}
                  className="flex items-center justify-between text-sm px-2 py-1.5 rounded hover:bg-zinc-50"
                >
                  <span className="min-w-0 truncate">
                    {c.name}
                    {c.note && (
                      <span className="text-xs text-zinc-400"> · {c.note}</span>
                    )}
                  </span>
                  <span className="font-bold text-red-700 tabular-nums shrink-0">
                    {fmt(c.debt)}
                  </span>
                </a>
              ))}
          </div>
        </div>
      )}

      {/* התנועות */}
      <div className="card p-4">
        <div className="flex items-center justify-between gap-2 mb-3 flex-wrap">
          <h2 className="font-bold text-brand-slatedark">כל התנועות</h2>
          <div className="flex gap-1">
            {(["all", "ADD", "COLLECT"] as const).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`text-xs px-2.5 py-1 rounded-lg font-bold ${
                  filter === f
                    ? "bg-brand-slatedark text-white"
                    : "bg-zinc-100 text-zinc-600"
                }`}
              >
                {f === "all" ? "הכל" : f === "ADD" ? "➕ נרשמו" : "✓ נגבו"}
              </button>
            ))}
          </div>
        </div>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="חיפוש — לקוח, מכירה, נציג, מספר הזמנה"
          className="w-full mb-3 px-3 py-2 border-2 border-zinc-200 rounded-lg text-sm"
        />

        {rows === null ? (
          <p className="text-zinc-400 text-sm py-4">טוען...</p>
        ) : visible.length === 0 ? (
          <p className="text-zinc-400 text-sm py-4">אין תנועות</p>
        ) : (
          <div className="space-y-1">
            {visible.map((r) => {
              const k = KIND[r.kind];
              return (
                <div
                  key={r.id}
                  className="flex items-start gap-3 text-sm border-b border-zinc-100 py-2"
                >
                  <span
                    className={`shrink-0 text-[10px] font-bold px-1.5 py-0.5 rounded ${k.cls}`}
                  >
                    {k.icon} {k.text}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="font-bold text-brand-slatedark truncate">
                      {r.customer.name}
                      {r.orderNumber && (
                        <span className="font-normal text-zinc-400"> · #{r.orderNumber}</span>
                      )}
                    </div>
                    <div className="text-[11px] text-zinc-500 truncate">
                      {[r.pricelistName, r.agentName, r.note].filter(Boolean).join(" · ")}
                    </div>
                  </div>
                  <div className="text-left shrink-0">
                    <div
                      className={`font-bold tabular-nums ${
                        r.amount < 0 ? "text-emerald-700" : "text-red-700"
                      }`}
                    >
                      {r.amount < 0 ? "−" : "+"}
                      {fmt(r.amount)}
                    </div>
                    <div className="text-[10px] text-zinc-400">{date(r.createdAt)}</div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </main>
  );
}
