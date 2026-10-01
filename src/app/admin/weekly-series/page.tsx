"use client";

// ═══════════════════════════════════════════════════════════════
// §396: 🔁 מכירות שבועיות — מסך הניהול
// ═══════════════════════════════════════════════════════════════
// המנהל מגדיר כאן פעם אחת "סדרה": נקודות, תבנית מוצרים ומחירים,
// ויום+שעת ההחלפה. כל שבוע נפתח לבד מהתבנית, ומוחלף כשהנציג מסר
// את כל ההזמנות של השבוע שהסתיים.
//
// ⚠️ סדרה לכל נקודה, או כמה נקודות בסדרה אחת — שתי האפשרויות.
// נקודה יכולה להיות בסדרה אחת בלבד.

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/client";
import { fmt } from "@/lib/pricing";
import { Modal, Field } from "@/components/AdminModal";

const DAYS = ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"];

type Series = {
  id: string;
  name: string;
  isActive: boolean;
  switchDay: number;
  switchMinute: number;
  orderFee: number;
  singleSurcharge: number;
  deliveryNote: string | null;
  points: { id: string; name: string; city: string | null }[];
  products: { productId: string; price: number | null }[];
  weeksCount: number;
  current: {
    id: string;
    name: string;
    status: string;
    weekStart: string | null;
    weekEnd: string | null;
    ordersCount: number;
    ended: boolean;
    undelivered: number;
  } | null;
};

function timeLabel(min: number) {
  return `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
}

function fmtIl(iso: string | null) {
  if (!iso) return "";
  return new Date(iso).toLocaleString("he-IL", {
    timeZone: "Asia/Jerusalem",
    weekday: "short",
    day: "numeric",
    month: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function WeeklySeriesPage() {
  const [list, setList] = useState<Series[] | null>(null);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState<Series | "new" | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  async function load() {
    setError("");
    try {
      setList(await api("/api/admin/weekly-series"));
    } catch (e: any) {
      setError(e.message || "שגיאה בטעינה");
      setList([]);
    }
  }
  useEffect(() => {
    load();
  }, []);

  async function forceClose(s: Series) {
    if (!s.current) return;
    if (
      !window.confirm(
        `לסגור את "${s.current.name}"?\n\n` +
          `${s.current.undelivered} הזמנות טרם סומנו כנמסרו. הן יישארו בשבוע הישן — ` +
          `אפשר להמשיך לשקול, לחייב או לבטל אותן שם.\n\nהשבוע הבא ייפתח מיד.`
      )
    )
      return;
    setBusy(s.id);
    try {
      await api("/api/agent/weekly-close", {
        method: "POST",
        body: JSON.stringify({ pricelistId: s.current.id }),
      });
      await load();
    } catch (e: any) {
      alert(e.message);
    } finally {
      setBusy(null);
    }
  }

  async function remove(s: Series) {
    if (!window.confirm(`למחוק את הסדרה "${s.name}"?`)) return;
    setBusy(s.id);
    try {
      await api(`/api/admin/weekly-series/${s.id}`, { method: "DELETE" });
      await load();
    } catch (e: any) {
      alert(e.message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-4 max-w-4xl">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-extrabold text-brand-slatedark">🔁 מכירות שבועיות</h1>
          <p className="text-sm text-zinc-600 mt-1 leading-relaxed max-w-2xl">
            מכירה שנפתחת לבד כל שבוע, לנקודות שבחרת. השבוע מתחלף ביום ובשעה
            שקבעת — <b>ורק אחרי שהנציג סימן שכל ההזמנות של השבוע נמסרו</b>.
            כשמכירה רגילה (חודשית) כוללת נקודה שבועית, הלקוחות של הנקודה
            רואים רק את הרגילה. הנציג ממשיך לראות את שתיהן.
          </p>
        </div>
        <button onClick={() => setEditing("new")} className="btn-primary">
          + סדרה חדשה
        </button>
      </div>

      {error && (
        <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg p-2">{error}</p>
      )}

      {list === null ? (
        <p className="text-zinc-500">טוען…</p>
      ) : list.length === 0 ? (
        <div className="card p-6 text-center text-zinc-500">
          עדיין אין סדרות שבועיות. לחץ "סדרה חדשה" כדי להתחיל.
        </div>
      ) : (
        <div className="space-y-3">
          {list.map((s) => (
            <div
              key={s.id}
              className={`card p-4 border-2 ${s.isActive ? "border-violet-200" : "border-zinc-200 opacity-70"}`}
            >
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-extrabold text-brand-slatedark text-lg">🔁 {s.name}</span>
                    {s.isActive ? (
                      <span className="text-[11px] font-bold bg-violet-100 text-violet-800 rounded-full px-2 py-0.5">
                        פעילה
                      </span>
                    ) : (
                      <span className="text-[11px] font-bold bg-zinc-200 text-zinc-700 rounded-full px-2 py-0.5">
                        מושבתת — לא נפתחים שבועות חדשים
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-zinc-600 mt-1">
                    החלפה: <b>{DAYS[s.switchDay]} {timeLabel(s.switchMinute)}</b> · {s.products.length} מוצרים ·
                    דמי הזמנה {fmt(s.orderFee)}
                  </div>
                  <div className="flex flex-wrap gap-1 mt-1.5">
                    {s.points.map((p) => (
                      <span key={p.id} className="text-[11px] bg-zinc-100 text-zinc-700 rounded-full px-2 py-0.5">
                        📍 {p.name}
                      </span>
                    ))}
                  </div>
                </div>
                <div className="flex gap-2 shrink-0">
                  <button onClick={() => setEditing(s)} className="btn-ghost btn-sm">
                    עריכה
                  </button>
                  {s.weeksCount === 0 && (
                    <button
                      onClick={() => remove(s)}
                      disabled={busy === s.id}
                      className="btn-ghost btn-sm text-red-700"
                    >
                      מחיקה
                    </button>
                  )}
                </div>
              </div>

              {/* השבוע הנוכחי */}
              {s.current ? (
                <div
                  className={`mt-3 rounded-xl p-3 text-sm ${
                    s.current.status === "ACTIVE" && s.current.ended && s.current.undelivered > 0
                      ? "bg-orange-50 border-2 border-orange-300"
                      : "bg-zinc-50 border border-zinc-200"
                  }`}
                >
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <div>
                      <div className="font-bold text-brand-slatedark">{s.current.name}</div>
                      <div className="text-xs text-zinc-600">
                        {s.current.status === "ACTIVE" ? "פתוח" : "סגור"} · {s.current.ordersCount} הזמנות ·
                        מתחלף {fmtIl(s.current.weekEnd)}
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <Link
                        href={`/admin/sale-control/${s.current.id}`}
                        className="btn-ghost btn-sm"
                      >
                        בקרת השבוע ←
                      </Link>
                    </div>
                  </div>
                  {s.current.status === "ACTIVE" && s.current.ended && s.current.undelivered > 0 && (
                    <div className="mt-2 text-xs text-orange-900 leading-relaxed">
                      ⏳ השבוע הסתיים, אבל <b>{s.current.undelivered} הזמנות</b> טרם סומנו כנמסרו.
                      השבוע הבא ייפתח ברגע שהנציג יסמן אותן — או כאן, אם לקוח לא הגיע לאסוף.
                      <button
                        onClick={() => forceClose(s)}
                        disabled={busy === s.id}
                        className="block mt-2 text-xs font-bold bg-orange-600 text-white rounded-lg px-3 py-1.5"
                      >
                        {busy === s.id ? "סוגר…" : "סגור שבוע ופתח את הבא"}
                      </button>
                    </div>
                  )}
                </div>
              ) : (
                s.isActive && (
                  <p className="mt-3 text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-2">
                    השבוע הראשון ייפתח ברגע שיש בסדרה נקודה ומוצר אחד לפחות.
                  </p>
                )
              )}
            </div>
          ))}
        </div>
      )}

      {editing && (
        <SeriesModal
          series={editing === "new" ? null : editing}
          allSeries={list ?? []}
          onClose={() => setEditing(null)}
          onDone={() => {
            setEditing(null);
            load();
          }}
        />
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// יצירה / עריכה
// ═══════════════════════════════════════════════════════════════
function SeriesModal({
  series,
  allSeries,
  onClose,
  onDone,
}: {
  series: Series | null;
  allSeries: Series[];
  onClose: () => void;
  onDone: () => void;
}) {
  const [allProducts, setAllProducts] = useState<any[] | null>(null);
  const [allPoints, setAllPoints] = useState<any[]>([]);
  const [sales, setSales] = useState<any[]>([]);
  const [name, setName] = useState(series?.name ?? "");
  const [isActive, setIsActive] = useState(series?.isActive ?? true);
  const [switchDay, setSwitchDay] = useState(series?.switchDay ?? 0);
  const [switchTime, setSwitchTime] = useState(timeLabel(series?.switchMinute ?? 0));
  const [orderFee, setOrderFee] = useState(String(series?.orderFee ?? 3));
  const [surcharge, setSurcharge] = useState(String(series?.singleSurcharge ?? 3));
  const [deliveryNote, setDeliveryNote] = useState(series?.deliveryNote ?? "");
  const [selPoints, setSelPoints] = useState<Record<string, boolean>>(() => {
    const m: Record<string, boolean> = {};
    for (const p of series?.points ?? []) m[p.id] = true;
    return m;
  });
  const [selProducts, setSelProducts] = useState<Record<string, { on: boolean; price: string }>>(() => {
    const m: Record<string, { on: boolean; price: string }> = {};
    for (const p of series?.products ?? []) {
      m[p.productId] = { on: true, price: p.price != null ? String(p.price) : "" };
    }
    return m;
  });
  const [q, setQ] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      const [products, points, pls] = await Promise.all([
        api("/api/admin/products"),
        api("/api/admin/points"),
        api("/api/admin/pricelists"),
      ]);
      setAllProducts(products);
      setAllPoints(points);
      setSales(pls);
    })().catch((e) => setError(e.message));
  }, []);

  // ⚠️ נקודות שכבר בסדרה אחרת — מוצגות אבל נעולות, עם שם הסדרה.
  const takenBy = useMemo(() => {
    const m = new Map<string, string>();
    for (const s of allSeries) {
      if (series && s.id === series.id) continue;
      for (const p of s.points) m.set(p.id, s.name);
    }
    return m;
  }, [allSeries, series]);

  // העתקת מוצרים ומחירים ממכירה קיימת — חוסך סימון של 40 מוצרים
  async function copyFrom(pricelistId: string) {
    if (!pricelistId) return;
    try {
      const pl = await api(`/api/admin/pricelists/${pricelistId}`);
      const m: Record<string, { on: boolean; price: string }> = {};
      for (const pp of pl.products ?? []) {
        m[pp.productId] = { on: true, price: pp.price != null ? String(pp.price) : "" };
      }
      setSelProducts(m);
    } catch (e: any) {
      setError(e.message);
    }
  }

  async function save() {
    setError("");
    const [hh, mm] = switchTime.split(":").map((x) => Number(x));
    if (!Number.isFinite(hh) || !Number.isFinite(mm)) {
      setError("שעת ההחלפה אינה תקינה");
      return;
    }
    const body = {
      name,
      isActive,
      switchDay,
      switchMinute: hh * 60 + mm,
      orderFee: Number(orderFee),
      singleSurcharge: Number(surcharge),
      deliveryNote,
      pointIds: Object.entries(selPoints).filter(([, v]) => v).map(([id]) => id),
      products: Object.entries(selProducts)
        .filter(([, v]) => v.on)
        .map(([productId, v]) => ({
          productId,
          price: v.price.trim() === "" ? null : Number(v.price),
        })),
    };
    setSaving(true);
    try {
      if (series) {
        await api(`/api/admin/weekly-series/${series.id}`, {
          method: "PATCH",
          body: JSON.stringify(body),
        });
      } else {
        await api("/api/admin/weekly-series", { method: "POST", body: JSON.stringify(body) });
      }
      onDone();
    } catch (e: any) {
      setError(e.message || "שגיאה בשמירה");
    } finally {
      setSaving(false);
    }
  }

  const filteredProducts = (allProducts ?? []).filter(
    (p) => !q.trim() || String(p.name).includes(q.trim())
  );
  const selectedCount = Object.values(selProducts).filter((v) => v.on).length;

  return (
    <Modal onClose={onClose} title={series ? `עריכת סדרה — ${series.name}` : "סדרה שבועית חדשה"}>
      <div className="space-y-4">
        <Field label="שם הסדרה *">
          <input
            className="input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder='למשל: "בני ברק — שבועי"'
          />
        </Field>

        <div className="bg-violet-50 border border-violet-200 rounded-xl p-3 space-y-2">
          <p className="text-xs font-bold text-violet-900">מתי השבוע מתחלף (שעון ישראל)</p>
          <div className="grid grid-cols-2 gap-2">
            <select
              className="input"
              value={switchDay}
              onChange={(e) => setSwitchDay(Number(e.target.value))}
            >
              {DAYS.map((d, i) => (
                <option key={i} value={i}>
                  יום {d}
                </option>
              ))}
            </select>
            <input
              className="input"
              type="time"
              value={switchTime}
              onChange={(e) => setSwitchTime(e.target.value)}
            />
          </div>
          <p className="text-[11px] text-violet-800 leading-relaxed">
            בזמן הזה השבוע מתחלף — בתנאי שכל ההזמנות שלו נמסרו. אם לא, השבוע הישן
            נשאר פתוח עד שהנציג יסמן מסירה או יסגור אותו.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label="דמי הזמנה ₪">
            <input className="input" type="number" step="0.5" value={orderFee} onChange={(e) => setOrderFee(e.target.value)} />
          </Field>
          <Field label='תוספת בודדים לק"ג'>
            <input className="input" type="number" step="0.5" value={surcharge} onChange={(e) => setSurcharge(e.target.value)} />
          </Field>
        </div>

        <Field label="מתי מקבלים (מוצג ללקוח)">
          <input
            className="input"
            value={deliveryNote}
            onChange={(e) => setDeliveryNote(e.target.value)}
            placeholder='למשל: "בכל יום 16:00–19:00". ריק = "במהלך השבוע"'
          />
        </Field>

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={isActive}
            onChange={(e) => setIsActive(e.target.checked)}
            className="h-4 w-4 accent-brand-rust"
          />
          <span>
            <b>פעילה</b> — שבועות חדשים נפתחים אוטומטית
          </span>
        </label>

        {/* נקודות */}
        <div>
          <div className="label">נקודות חלוקה בסדרה</div>
          <div className="grid grid-cols-2 gap-1.5 max-h-44 overflow-y-auto border rounded-xl p-2">
            {allPoints.map((pt) => {
              const other = takenBy.get(pt.id);
              return (
                <label
                  key={pt.id}
                  className={`flex items-center gap-2 text-sm ${other ? "opacity-50" : ""}`}
                  title={other ? `כבר בסדרה "${other}"` : undefined}
                >
                  <input
                    type="checkbox"
                    disabled={!!other}
                    checked={!!selPoints[pt.id]}
                    onChange={(e) => setSelPoints({ ...selPoints, [pt.id]: e.target.checked })}
                    className="h-4 w-4 accent-brand-rust"
                  />
                  <span>
                    {pt.isPrivate && "🔒 "}
                    {pt.name}
                    {other && <span className="text-[10px] text-zinc-500"> · ב"{other}"</span>}
                  </span>
                </label>
              );
            })}
          </div>
          <p className="text-[11px] text-zinc-500 mt-1">
            לנקודות שבסדרה שבועית אין הזמנה אישית — הן מזמינות כל שבוע.
          </p>
        </div>

        {/* תבנית מוצרים */}
        <div>
          <div className="flex items-center justify-between gap-2 mb-1 flex-wrap">
            <div className="label mb-0">
              תבנית מוצרים ומחירים · {selectedCount} נבחרו
            </div>
            <select
              className="text-xs border rounded-lg px-2 py-1"
              defaultValue=""
              onChange={(e) => copyFrom(e.target.value)}
            >
              <option value="">העתק מוצרים ומחירים ממכירה…</option>
              {sales.map((s: any) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
          <input
            className="input mb-1.5"
            placeholder="חיפוש מוצר…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <div className="max-h-64 overflow-y-auto border rounded-xl divide-y">
            {allProducts === null ? (
              <p className="p-2 text-sm text-zinc-500">טוען…</p>
            ) : (
              filteredProducts.map((p) => (
                <div key={p.id} className="flex items-center gap-2 p-2 text-sm">
                  <input
                    type="checkbox"
                    checked={selProducts[p.id]?.on ?? false}
                    onChange={(e) =>
                      setSelProducts({
                        ...selProducts,
                        [p.id]: { price: selProducts[p.id]?.price ?? "", on: e.target.checked },
                      })
                    }
                    className="h-4 w-4 accent-brand-rust"
                  />
                  <span className="flex-1">{p.name}</span>
                  <span className="text-zinc-400 text-xs">{fmt(p.cartonPrice)}</span>
                  <input
                    className="w-20 rounded-lg border border-zinc-200 px-2 py-1 text-xs"
                    placeholder="מחיר"
                    type="number"
                    step="0.1"
                    value={selProducts[p.id]?.price ?? ""}
                    onChange={(e) =>
                      setSelProducts({
                        ...selProducts,
                        [p.id]: { on: selProducts[p.id]?.on ?? true, price: e.target.value },
                      })
                    }
                  />
                </div>
              ))
            )}
          </div>
          <p className="text-[11px] text-zinc-500 mt-1">
            מחיר ריק = המחיר הרגיל של המוצר. שינוי בתבנית חל <b>מהשבוע הבא</b>; את השבוע
            הפתוח עורכים במסך המכירות.
          </p>
        </div>

        {error && (
          <p className="text-sm text-red-600 font-medium bg-red-50 border border-red-200 rounded-lg p-2">
            {error}
          </p>
        )}
        <button onClick={save} disabled={saving} className="btn-primary w-full">
          {saving ? "שומר…" : series ? "שמירה" : "יצירה ופתיחת השבוע הראשון"}
        </button>
      </div>
    </Modal>
  );
}
