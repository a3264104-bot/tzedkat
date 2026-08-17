"use client";

// §51: תכנון ההזמנה לספק - הטבלה שממנה המנהל משדר לחברה.
//
// מחליפה את הטבלה הישנה שהציגה "מה הוזמן" בלי לענות על השאלה
// היחידה שחשובה ביום ההזמנה: כמה קרטונים אני מזמין מכל מוצר.
//
// המבנה זהה לקובץ האקסל, ומה שממלאים כאן נשמר ומופיע גם שם - כדי
// שלא למלא פעמיים ולא להתבלבל בין שתי גרסאות.
//
//   מוצר | קרטונים | יחידות | בודדים | להשלמה* | סה״כ להזמנה | בקרטון* | עודף
//                                        ↑ ידני                  ↑ ידני
//
// העמודה "סה״כ להזמנה" היא הנתון המשודר, ולכן היא הבולטת ביותר.
// העמודה "עודף/חוסר" עונה על "כמה יישאר לי" - מידע שחוסך הפתעות
// ביום החלוקה.

import { useCallback, useEffect, useRef, useState } from "react";

type Row = {
  productId: string;
  productName: string;
  categoryName: string;
  cartons: number;
  units: number;
  singlesKg: number;
  extraCartons: number;
  unitsPerCarton: number | null;
  perCartonIsAuto: boolean;
};

type Point = { id: string; name: string; city: string | null };

export function SupplierOrderPlanner({ pricelistId }: { pricelistId: string }) {
  const [rows, setRows] = useState<Row[]>([]);
  const [points, setPoints] = useState<Point[]>([]);
  const [pointId, setPointId] = useState<string>(""); // "" = כל הנקודות
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  // אילו שורות נשמרות כרגע - לחיווי ולא לחסימה
  const [saving, setSaving] = useState<Set<string>>(new Set());

  const load = useCallback(
    async (pid: string) => {
      setLoading(true);
      setErr("");
      try {
        const qs = new URLSearchParams({ pricelistId });
        if (pid) qs.set("pointId", pid);
        const res = await fetch(`/api/admin/supplier-plan?${qs}`, { cache: "no-store" });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "שגיאה");
        setRows(data.rows || []);
        setPoints(data.points || []);
      } catch (e: any) {
        setErr(e.message);
      } finally {
        setLoading(false);
      }
    },
    [pricelistId]
  );

  useEffect(() => {
    load(pointId);
  }, [load, pointId]);

  // שמירה בדחייה: המנהל מקליד, וההחלטה נשמרת שנייה אחרי שהוא מפסיק.
  // בלי זה כל הקשה הייתה קריאת רשת.
  const timers = useRef<Record<string, any>>({});
  function saveField(
    productId: string,
    field: "extraCartons" | "unitsPerCarton",
    value: number | null
  ) {
    const key = `${productId}:${field}`;
    clearTimeout(timers.current[key]);
    setSaving((s) => new Set(s).add(productId));
    timers.current[key] = setTimeout(async () => {
      try {
        const res = await fetch("/api/admin/supplier-plan", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            pricelistId,
            productId,
            pointId: pointId || null,
            [field]: value,
          }),
        });
        if (!res.ok) {
          const d = await res.json().catch(() => ({}));
          throw new Error(d.error || "שמירה נכשלה");
        }
      } catch (e: any) {
        setErr(`${e.message} — רענן ובדוק`);
      } finally {
        setSaving((s) => {
          const n = new Set(s);
          n.delete(productId);
          return n;
        });
      }
    }, 800);
  }

  function updateRow(productId: string, patch: Partial<Row>) {
    setRows((rs) => rs.map((r) => (r.productId === productId ? { ...r, ...patch } : r)));
  }

  // סיכומים
  const totalOrder = rows.reduce((s, r) => s + r.cartons + r.extraCartons, 0);
  const needsAttention = rows.filter(
    (r) => (r.units > 0 || r.singlesKg > 0) && r.extraCartons === 0
  ).length;

  if (loading) return <p className="text-zinc-500 text-sm">טוען...</p>;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-brand-slatedark">הזמנה לספק</h2>
          <p className="text-xs text-zinc-500">
            מלא את "להשלמה" — עמודת <strong>סה״כ להזמנה</strong> היא מה שמשדרים
            לחברה. ההחלטות נשמרות אוטומטית.
          </p>
        </div>
        <div className="flex gap-2 items-center no-print">
          {points.length > 1 && (
            <select
              className="input py-1.5 text-sm max-w-[200px]"
              value={pointId}
              onChange={(e) => setPointId(e.target.value)}
            >
              <option value="">כל הנקודות יחד</option>
              {points.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          )}
          <button
            onClick={() => {
              const qs = new URLSearchParams({ pricelistId });
              window.location.href = `/api/admin/supplier-export?${qs}`;
            }}
            className="btn-primary btn-sm bg-emerald-600 hover:bg-emerald-700"
          >
            📗 הורד לאקסל
          </button>
        </div>
      </div>

      {err && (
        <div className="card p-3 border-red-200 bg-red-50 text-sm text-red-800">{err}</div>
      )}

      {/* התראה: מוצרים עם יחידות/בודדים שעדיין לא הומרו לקרטונים.
          בלי זה קל לפספס מוצר ולהזמין ממנו אפס. */}
      {needsAttention > 0 && (
        <div className="card p-3 border-amber-300 bg-amber-50 text-sm text-amber-900">
          <strong>{needsAttention} מוצרים</strong> עם הזמנות ביחידות או בבודדים
          שעדיין לא הומרו לקרטונים. בלי מילוי העמודה "להשלמה" הם לא ייכללו
          בהזמנה לספק.
        </div>
      )}

      <div className="table-wrap">
        <table className="admin">
          <thead>
            <tr>
              <th className="text-right">מוצר</th>
              <th className="text-center">קרטונים<br />שהוזמנו</th>
              <th className="text-center">יחידות<br />שהוזמנו</th>
              <th className="text-center">בודדים<br />ק״ג</th>
              <th className="text-center bg-amber-50">קרטונים<br />להשלמה</th>
              <th className="text-center bg-orange-500 text-white">סה״כ<br />להזמנה</th>
              <th className="text-center bg-amber-50">כמות<br />בקרטון</th>
              <th className="text-center">עודף /<br />חוסר</th>
            </tr>
          </thead>
          <tbody>
            {(() => {
              let lastCat = "";
              const out: React.ReactNode[] = [];
              for (const r of rows) {
                if (r.categoryName && r.categoryName !== lastCat) {
                  lastCat = r.categoryName;
                  out.push(
                    <tr key={`cat-${lastCat}`} className="bg-zinc-100">
                      <td colSpan={8} className="font-bold text-brand-slatedark text-sm py-1">
                        {lastCat}
                      </td>
                    </tr>
                  );
                }

                const totalCartons = r.cartons + r.extraCartons;
                // עודף = מה שמגיע בקרטונים ההשלמה פחות מה שנדרש
                const need = r.units > 0 ? r.units : r.singlesKg;
                const surplus =
                  r.unitsPerCarton && need > 0
                    ? Math.round((r.extraCartons * r.unitsPerCarton - need) * 100) / 100
                    : null;
                const isSaving = saving.has(r.productId);

                out.push(
                  <tr key={r.productId}>
                    <td className="font-medium">
                      {r.productName}
                      {isSaving && (
                        <span className="text-[10px] text-zinc-400 mr-1">שומר…</span>
                      )}
                    </td>
                    <td className="text-center">{r.cartons || "—"}</td>
                    <td className="text-center">{r.units || "—"}</td>
                    <td className="text-center">{r.singlesKg || "—"}</td>

                    {/* להשלמה - ידני */}
                    <td className="text-center bg-amber-50/60">
                      <input
                        type="number"
                        min={0}
                        step={1}
                        value={r.extraCartons || ""}
                        onChange={(e) => {
                          const v = e.target.value === "" ? 0 : Number(e.target.value);
                          updateRow(r.productId, { extraCartons: v });
                          saveField(r.productId, "extraCartons", v);
                        }}
                        className="w-16 text-center rounded border border-amber-300 py-1 font-bold"
                        placeholder="0"
                      />
                    </td>

                    {/* סה"כ להזמנה - הנתון המשודר */}
                    <td className="text-center">
                      <span
                        className={`inline-block min-w-[3rem] py-1 px-2 rounded font-extrabold text-lg ${
                          totalCartons > 0
                            ? "bg-orange-100 text-brand-rust"
                            : "text-zinc-300"
                        }`}
                      >
                        {totalCartons || "—"}
                      </span>
                    </td>

                    {/* כמות בקרטון - ידני, עם ברירת מחדל אוטומטית */}
                    <td className="text-center bg-amber-50/60">
                      <input
                        type="number"
                        min={0}
                        step="0.01"
                        value={r.unitsPerCarton ?? ""}
                        onChange={(e) => {
                          const v = e.target.value === "" ? null : Number(e.target.value);
                          updateRow(r.productId, {
                            unitsPerCarton: v,
                            perCartonIsAuto: false,
                          });
                          saveField(r.productId, "unitsPerCarton", v);
                        }}
                        className={`w-16 text-center rounded border py-1 ${
                          r.perCartonIsAuto
                            ? "border-zinc-200 text-zinc-500"
                            : "border-amber-300 font-bold"
                        }`}
                        placeholder="—"
                        title={
                          r.perCartonIsAuto
                            ? "נגזר אוטומטית מנתוני המוצר - אפשר לתקן"
                            : "הוזן ידנית"
                        }
                      />
                    </td>

                    {/* עודף / חוסר */}
                    <td className="text-center">
                      {surplus === null ? (
                        <span className="text-zinc-300">—</span>
                      ) : (
                        <span
                          className={`font-bold ${
                            surplus > 0
                              ? "text-emerald-700"
                              : surplus < 0
                                ? "text-red-700"
                                : "text-zinc-500"
                          }`}
                        >
                          {surplus > 0 ? `+${surplus}` : surplus}
                        </span>
                      )}
                    </td>
                  </tr>
                );
              }
              return out;
            })()}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-zinc-300">
              <td className="font-extrabold">סה״כ</td>
              <td className="text-center font-bold">
                {rows.reduce((s, r) => s + r.cartons, 0) || "—"}
              </td>
              <td className="text-center font-bold">
                {rows.reduce((s, r) => s + r.units, 0) || "—"}
              </td>
              <td className="text-center font-bold">
                {Math.round(rows.reduce((s, r) => s + r.singlesKg, 0) * 100) / 100 || "—"}
              </td>
              <td className="text-center font-bold">
                {rows.reduce((s, r) => s + r.extraCartons, 0) || "—"}
              </td>
              <td className="text-center">
                <span className="text-xl font-extrabold text-brand-rust">{totalOrder}</span>
              </td>
              <td colSpan={2}></td>
            </tr>
          </tfoot>
        </table>
      </div>

      <p className="text-xs text-zinc-500">
        💡 "עודף / חוסר" מחושב לפי הכמות בקרטון: כמה יישאר לך אחרי שתחלק, או
        כמה יחסר. ירוק = עודף, אדום = חוסר.
      </p>
    </div>
  );
}
