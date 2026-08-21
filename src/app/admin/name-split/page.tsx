"use client";

// ═══════════════════════════════════════════════════════════════
// §174: השלמת פיצול שמות
// ═══════════════════════════════════════════════════════════════
// 400 לקוחות ותיקים נרשמו עם שדה שם אחד. המסך הזה הופך את
// ההשלמה מ"שעות הקלדה" ל"20 דקות סריקה".
//
// 🚨 הסדר בנתונים **מעורב**:
//   "וולדמן ישעיה"  -> משפחה, פרטי
//   "טוביה בוקשפן"  -> פרטי, משפחה
//
// ולכן אין פיצול אוטומטי. יש ניחוש + כפתור **⇄ החלף** שהופך
// את השניים בלחיצה אחת. רוב השורות הן לחיצה אחת או אפס.
//
// ⚠️ השמירה בקבוצות ולא בכל שינוי: 400 בקשות רשת היו איטיות,
// והמנהל היה רואה את המסך "נתקע" בין שורה לשורה.

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/client";

type Row = {
  id: string;
  name: string;
  phone: string | null;
  pointName: string | null;
  orderCount: number;
  isActive: boolean;
  guessFirst: string;
  guessLast: string;
  /** שם בודד - אי אפשר לנחש, צריך לשאול את הלקוח */
  singleWord: boolean;
};

type Edit = { first: string; last: string; done: boolean };

export default function NameSplitPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [total, setTotal] = useState(0);
  const [edits, setEdits] = useState<Record<string, Edit>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setErr("");
    try {
      const res = await api("/api/admin/name-split?take=200");
      setRows(res.rows ?? []);
      setTotal(res.total ?? 0);
      // אתחול העריכות מהניחוש
      const e: Record<string, Edit> = {};
      for (const r of res.rows ?? []) {
        e[r.id] = { first: r.guessFirst, last: r.guessLast, done: false };
      }
      setEdits(e);
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  /**
   * §174: החלפה בין השדות.
   *
   * ⚠️ זו הפעולה המרכזית במסך. אצל כמחצית מהלקוחות הסדר הפוך,
   * ובלי הכפתור הזה המנהל היה צריך למחוק ולהקליד מחדש שני
   * שדות בכל שורה כזו.
   */
  function swap(id: string) {
    setEdits((prev) => {
      const cur = prev[id];
      if (!cur) return prev;
      return { ...prev, [id]: { ...cur, first: cur.last, last: cur.first } };
    });
  }

  function setField(id: string, key: "first" | "last", val: string) {
    setEdits((prev) => ({
      ...prev,
      [id]: { ...(prev[id] ?? { first: "", last: "", done: false }), [key]: val },
    }));
  }

  function toggleDone(id: string) {
    setEdits((prev) => {
      const cur = prev[id];
      if (!cur) return prev;
      return { ...prev, [id]: { ...cur, done: !cur.done } };
    });
  }

  /**
   * §174: אישור הכל בבת אחת.
   *
   * ⚠️ מסמן רק שורות עם שני חלקים. שם בודד נשאר לא מסומן -
   * הוא דורש שיחה עם הלקוח, וסימון גורף היה שומר אותו חלקי
   * בלי שאיש ישים לב.
   */
  function approveAllComplete() {
    setEdits((prev) => {
      const next = { ...prev };
      for (const r of rows) {
        const e = next[r.id];
        if (e && e.first.trim() && e.last.trim()) {
          next[r.id] = { ...e, done: true };
        }
      }
      return next;
    });
  }

  async function save() {
    const items = rows
      .filter((r) => edits[r.id]?.done && edits[r.id]?.first.trim())
      .map((r) => ({
        id: r.id,
        firstName: edits[r.id].first.trim(),
        lastName: edits[r.id].last.trim(),
      }));

    if (items.length === 0) {
      setErr("לא סומנו שורות לשמירה");
      return;
    }

    setSaving(true);
    setErr("");
    setMsg("");
    try {
      const res = await api("/api/admin/name-split", {
        method: "POST",
        body: JSON.stringify({ items }),
      });
      setMsg(`נשמרו ${res.saved} לקוחות${res.failed ? ` · ${res.failed} נכשלו` : ""}`);
      await load();
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setSaving(false);
    }
  }

  const markedCount = rows.filter((r) => edits[r.id]?.done).length;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-extrabold text-brand-slatedark">
          השלמת שמות
        </h1>
        <p className="text-sm text-brand-slate/70 mt-1 max-w-2xl leading-relaxed">
          לקוחות ותיקים נרשמו עם שדה שם אחד. כאן משלימים את הפיצול לשם פרטי
          ושם משפחה — כדי שאפשר יהיה לסנן ולזהות אותם בחלוקה.
        </p>
      </div>

      {/* ⚠️ ההסבר על הסדר ההפוך - זה מה שהמנהל צריך לדעת לפני
          שהוא מתחיל לסרוק, אחרת הוא יאשר שורות שגויות. */}
      <div className="card p-3 border-amber-300 bg-amber-50 text-sm text-amber-900 leading-relaxed">
        <b>⚠️ שימו לב לסדר.</b> חלק מהלקוחות נרשמו &quot;משפחה פרטי&quot;
        (למשל <b>וולדמן ישעיה</b>) וחלק &quot;פרטי משפחה&quot; (למשל{" "}
        <b>טוביה בוקשפן</b>). הניחוש כאן מניח <b>פרטי ואז משפחה</b> — לחצו{" "}
        <b>⇄</b> בשורות שבהן הסדר הפוך.
      </div>

      {total > 0 && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="font-bold text-brand-slatedark">
            {total} לקוחות ממתינים
          </span>
          {rows.length < total && (
            <span className="text-zinc-500">· מוצגים {rows.length}</span>
          )}
          <button
            onClick={approveAllComplete}
            className="btn-ghost btn-sm mr-auto"
          >
            ✓ סמן את כל השורות המלאות
          </button>
        </div>
      )}

      {err && (
        <div className="card p-3 border-red-200 bg-red-50 text-sm text-red-800">
          {err}
        </div>
      )}
      {msg && (
        <div className="card p-3 border-emerald-200 bg-emerald-50 text-sm text-emerald-800">
          ✓ {msg}
        </div>
      )}

      {loading ? (
        <p className="text-zinc-500">טוען…</p>
      ) : rows.length === 0 ? (
        <div className="card p-8 text-center">
          <div className="text-3xl mb-2">✓</div>
          <p className="font-bold text-brand-slatedark">
            לכל הלקוחות יש שם פרטי ושם משפחה
          </p>
        </div>
      ) : (
        <div className="space-y-1.5">
          {rows.map((r) => {
            const e = edits[r.id] ?? { first: "", last: "", done: false };
            return (
              <div
                key={r.id}
                className={`card p-2.5 ${
                  e.done
                    ? "border-emerald-400 bg-emerald-50/50"
                    : r.singleWord
                      ? "border-amber-300"
                      : ""
                }`}
              >
                <div className="flex items-center gap-2 flex-wrap">
                  {/* השם המקורי - נשאר לעין כדי שאפשר יהיה להשוות */}
                  <div className="min-w-[130px]">
                    <div className="font-bold text-brand-slatedark text-sm">
                      {r.name}
                    </div>
                    <div className="text-[10px] text-zinc-400" dir="ltr">
                      {r.phone}
                    </div>
                  </div>

                  <input
                    className="input flex-1 min-w-[100px] py-1 text-sm"
                    value={e.first}
                    onChange={(ev) => setField(r.id, "first", ev.target.value)}
                    placeholder="שם פרטי"
                  />

                  {/* §174: הכפתור המרכזי במסך */}
                  <button
                    onClick={() => swap(r.id)}
                    title="החלף בין שם פרטי לשם משפחה"
                    className="w-8 h-8 shrink-0 rounded-lg border-2 border-brand-rust/40 text-brand-rust font-bold hover:bg-brand-rust hover:text-white transition-colors"
                  >
                    ⇄
                  </button>

                  <input
                    className="input flex-1 min-w-[100px] py-1 text-sm"
                    value={e.last}
                    onChange={(ev) => setField(r.id, "last", ev.target.value)}
                    placeholder="שם משפחה"
                  />

                  <button
                    onClick={() => toggleDone(r.id)}
                    disabled={!e.first.trim()}
                    className={`w-9 h-8 shrink-0 rounded-lg font-bold text-sm disabled:opacity-30 ${
                      e.done
                        ? "bg-emerald-600 text-white"
                        : "border-2 border-zinc-300 text-zinc-500"
                    }`}
                  >
                    ✓
                  </button>
                </div>

                {/* ⚠️ שם בודד - הניחוש חסר משמעות והמנהל חייב לשאול */}
                {r.singleWord && !e.last.trim() && (
                  <p className="text-[11px] text-amber-800 mt-1">
                    שם בודד — יש לברר עם הלקוח מה שם המשפחה
                    {r.orderCount > 0 && ` · ${r.orderCount} הזמנות`}
                    {r.pointName && ` · ${r.pointName}`}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* סרגל שמירה דביק - כדי שלא יצטרך לגלול חזרה למעלה */}
      {rows.length > 0 && (
        <div className="sticky bottom-0 bg-white border-t-2 border-zinc-200 p-3 flex items-center gap-3 -mx-4 px-4">
          <span className="text-sm font-bold text-brand-slatedark">
            {markedCount} מסומנים
          </span>
          <button
            onClick={save}
            disabled={saving || markedCount === 0}
            className="btn-primary flex-1 disabled:opacity-40"
          >
            {saving ? "שומר…" : `שמור ${markedCount} לקוחות`}
          </button>
        </div>
      )}
    </div>
  );
}
