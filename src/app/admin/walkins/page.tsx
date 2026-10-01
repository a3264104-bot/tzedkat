"use client";

// ═══════════════════════════════════════════════════════════════
// §398: 🚶➜👤 המרת מזדמנים ללקוחות — ניקוי חד-פעמי
// ═══════════════════════════════════════════════════════════════
// מזדמנים ישנים יושבים מחוץ למערכת: בלי חשבון, בלי מספר הזמנה,
// ובדוחות כשורה נפרדת ("₪260 ממזדמנים"). כאן הם הופכים ללקוחות —
// עם הזמנה רגילה במכירה שבה קנו.
//
// ⚠️ הסכומים לא זזים: העמלה, המזומן שאצל הנציג וההכנסה נשארים
// אותו דבר. הם רק עוברים למקום הרגיל — תחת שם הלקוח.

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/client";
import { fmt } from "@/lib/pricing";

type W = {
  id: string;
  walkinNumber: number;
  customerName: string;
  customerPhone: string | null;
  customerEmail: string | null;
  paymentMethod: string;
  paymentReceived: boolean;
  totalAmount: number;
  createdAt: string;
  pointId: string | null;
  pointName: string | null;
  autoPointId: string | null;
  agentPointIds: string[];
  pricelistId: string;
  pricelistName: string;
  agentId: string;
  agentName: string;
};
type P = { id: string; name: string; city: string | null };

type Result =
  | { id: string; ok: true; orderNumber: number; customerName: string; customerExisted: boolean }
  | { id: string; ok: false; code: string; error: string };

const METHOD: Record<string, string> = {
  CASH: "💵 מזומן",
  CARD_TERMINAL: "💳 מסוף",
  TRANSFER: "🏦 העברה",
  ONLINE: "🌐 אונליין",
  CARD_ONLINE: "🌐 אונליין",
};

export default function WalkinsConvertPage() {
  const [list, setList] = useState<W[] | null>(null);
  const [points, setPoints] = useState<P[]>([]);
  const [error, setError] = useState("");
  const [phones, setPhones] = useState<Record<string, string>>({});
  const [pointSel, setPointSel] = useState<Record<string, string>>({});
  const [noPhoneOk, setNoPhoneOk] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<Result[]>([]);

  async function load() {
    setError("");
    try {
      const d = await api("/api/admin/walkins");
      setList(d.walkins);
      setPoints(d.points);
    } catch (e: any) {
      setError(e.message || "שגיאה בטעינה");
      setList([]);
    }
  }
  useEffect(() => {
    load();
  }, []);

  const pointName = useMemo(() => new Map(points.map((p) => [p.id, p.name])), [points]);

  /** מה חסר כדי להמיר — לפי מה שכבר הוזן במסך */
  function missing(w: W): string | null {
    const phone = (phones[w.id] ?? "").trim() || w.customerPhone;
    if (!phone && !w.customerEmail && !noPhoneOk[w.id]) return "טלפון";
    if (!(pointSel[w.id] || w.autoPointId)) return "נקודה";
    return null;
  }

  const ready = (list ?? []).filter((w) => !missing(w));
  const total = (list ?? []).reduce((s, w) => s + w.totalAmount, 0);

  async function convert(ids: string[]) {
    if (ids.length === 0) return;
    setBusy(true);
    setError("");
    try {
      const overrides: Record<string, any> = {};
      for (const id of ids) {
        overrides[id] = {
          phone: (phones[id] ?? "").trim() || undefined,
          pointId: pointSel[id] || undefined,
          allowNoPhone: noPhoneOk[id] === true,
        };
      }
      const d = await api("/api/admin/walkins", {
        method: "POST",
        body: JSON.stringify({ ids, overrides }),
      });
      setResults((prev) => [...d.results, ...prev]);
      await load();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4 max-w-5xl">
      <div>
        <Link href="/admin/agent-debts" className="text-sm text-brand-rust font-bold">
          → חובות נציגים
        </Link>
        <h1 className="text-2xl font-extrabold text-brand-slatedark mt-1">🚶➜👤 הפיכת מזדמנים ללקוחות</h1>
        <p className="text-sm text-zinc-600 mt-1 leading-relaxed max-w-3xl">
          כל מזדמן הופך ללקוח רשום, עם הזמנה רגילה במכירה שבה קנה (מסומנת &quot;נמסרה&quot;,
          ושולמה אם התשלום התקבל). מי שכבר קיים במערכת לפי הטלפון — ההזמנה נרשמת עליו.
          <br />
          <b>הסכומים לא משתנים:</b> העמלה של הנציג, המזומן שאצלו וההכנסה נשארים אותו דבר —
          הם רק עוברים לדוחות הרגילים, תחת שם הלקוח. בפעם הבאה הלקוח כבר קיים, והנציג פשוט
          מזמין עבורו.
        </p>
      </div>

      {error && (
        <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg p-2">{error}</p>
      )}

      {results.length > 0 && (
        <div className="bg-white border border-zinc-200 rounded-xl p-3 space-y-1">
          <div className="font-bold text-sm text-brand-slatedark">תוצאות</div>
          {results.map((r, i) => (
            <div key={`${r.id}-${i}`} className="text-xs">
              {r.ok ? (
                <span className="text-emerald-700">
                  ✓ {r.customerName} → הזמנה #{r.orderNumber}
                  {r.customerExisted ? " (לקוח קיים)" : " (לקוח חדש)"}
                </span>
              ) : (
                <span className="text-red-700">✗ {r.error}</span>
              )}
            </div>
          ))}
        </div>
      )}

      {list === null ? (
        <p className="text-zinc-500">טוען…</p>
      ) : list.length === 0 ? (
        <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-6 text-center">
          <div className="text-3xl">✅</div>
          <div className="font-bold text-emerald-800 mt-1">אין מזדמנים — כולם רשומים כלקוחות</div>
        </div>
      ) : (
        <>
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 flex items-center justify-between gap-3 flex-wrap">
            <div className="text-sm text-amber-900">
              <b>{list.length}</b> מזדמנים · סה&quot;כ <b>₪{fmt(total)}</b> ·{" "}
              <b>{ready.length}</b> מוכנים להמרה
              {list.length - ready.length > 0 && (
                <span> · {list.length - ready.length} חסר להם טלפון או נקודה (מלא בשורה)</span>
              )}
            </div>
            <button
              disabled={busy || ready.length === 0}
              onClick={() => {
                if (
                  !window.confirm(
                    `להפוך ${ready.length} מזדמנים ללקוחות?\n\nלכל אחד תיווצר הזמנה רגילה במכירה שלו. אי אפשר לבטל בלחיצה.`
                  )
                )
                  return;
                convert(ready.map((w) => w.id));
              }}
              className="btn-primary disabled:opacity-50"
            >
              {busy ? "ממיר…" : `👤 הפוך את כל המוכנים (${ready.length})`}
            </button>
          </div>

          <div className="bg-white border border-zinc-200 rounded-xl divide-y divide-zinc-100">
            {list.map((w) => {
              const miss = missing(w);
              const needPhone = !w.customerPhone && !w.customerEmail;
              const needPoint = !w.autoPointId;
              const choices = w.agentPointIds.length > 0
                ? points.filter((p) => w.agentPointIds.includes(p.id))
                : points;
              return (
                <div key={w.id} className="p-3 flex flex-col sm:flex-row sm:items-center gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-bold text-brand-slatedark">{w.customerName}</span>
                      <span className="text-xs text-zinc-400">מזדמן #{w.walkinNumber}</span>
                      <span
                        className={`text-[10px] px-1.5 py-0.5 rounded font-bold ${
                          w.paymentReceived ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"
                        }`}
                      >
                        {METHOD[w.paymentMethod] ?? w.paymentMethod}
                        {!w.paymentReceived && " — טרם התקבל"}
                      </span>
                    </div>
                    <div className="text-xs text-zinc-500 mt-0.5">
                      {w.customerPhone && <span dir="ltr">{w.customerPhone} · </span>}
                      ₪{fmt(w.totalAmount)} · {w.pricelistName} · נציג: {w.agentName}
                      {w.autoPointId && ` · 📍 ${w.pointName ?? pointName.get(w.autoPointId) ?? ""}`}
                    </div>
                    {(needPhone || needPoint) && (
                      <div className="flex gap-2 flex-wrap mt-1.5 items-center">
                        {needPhone && (
                          <>
                            <input
                              type="tel"
                              dir="ltr"
                              placeholder="טלפון"
                              value={phones[w.id] ?? ""}
                              onChange={(e) => setPhones((p) => ({ ...p, [w.id]: e.target.value }))}
                              className="px-2 py-1 border border-amber-400 bg-amber-50 rounded text-sm w-36"
                            />
                            <label className="text-[11px] text-zinc-600 flex items-center gap-1">
                              <input
                                type="checkbox"
                                checked={noPhoneOk[w.id] === true}
                                onChange={(e) =>
                                  setNoPhoneOk((p) => ({ ...p, [w.id]: e.target.checked }))
                                }
                              />
                              אין טלפון — להקים בכל זאת
                            </label>
                          </>
                        )}
                        {needPoint && (
                          <select
                            value={pointSel[w.id] ?? ""}
                            onChange={(e) => setPointSel((p) => ({ ...p, [w.id]: e.target.value }))}
                            className="px-2 py-1 border border-amber-400 bg-amber-50 rounded text-sm"
                          >
                            <option value="">בחר נקודה</option>
                            {choices.map((p) => (
                              <option key={p.id} value={p.id}>
                                {p.name}
                                {p.city ? ` — ${p.city}` : ""}
                              </option>
                            ))}
                          </select>
                        )}
                      </div>
                    )}
                  </div>
                  <button
                    disabled={busy || !!miss}
                    onClick={() => convert([w.id])}
                    title={miss ? `חסר: ${miss}` : "הפוך ללקוח"}
                    className="text-xs px-3 py-2 bg-brand-rust text-white rounded-lg font-bold disabled:opacity-40 shrink-0"
                  >
                    {miss ? `חסר ${miss}` : "👤 הפוך ללקוח"}
                  </button>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
