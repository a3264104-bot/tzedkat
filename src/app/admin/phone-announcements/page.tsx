"use client";

// §30: הודעות למתקשרים למערכת הטלפונית.
//
// לקוח טלפוני אין לו מייל, ולכן עדכונים ("החלוקה נדחתה לשעה 18:00") לא
// מגיעים אליו. ההודעה כאן מוקראת לו בכניסה לשיחה.
//
// הסינון מוצג במפורש למנהל: הוא רואה *כמה לקוחות* ישמעו כל הודעה
// לפני שהוא מפרסם אותה.

import { useEffect, useState, useCallback } from "react";
import { api } from "@/lib/client";

type Row = {
  id: string;
  pricelistId: string;
  pricelistName: string;
  pointId: string | null;
  pointName: string | null;
  pointCity: string | null;
  text: string;
  isActive: boolean;
  expiresAt: string | null;
  createdAt: string;
  reachCount: number;
  isExpired: boolean;
};

type Pricelist = { id: string; name: string; status: string };
type Point = { id: string; name: string; city: string | null };

const MAX_LEN = 450;

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("he-IL", {
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

export default function AnnouncementsPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [lists, setLists] = useState<Pricelist[]>([]);
  const [points, setPoints] = useState<Point[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState("");

  // טופס יצירה
  const [fPricelist, setFPricelist] = useState("");
  const [fPoint, setFPoint] = useState("");
  const [fText, setFText] = useState("");
  const [fExpires, setFExpires] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setErr("");
    try {
      const [res, pls, pts] = await Promise.all([
        api("/api/admin/phone-announcements"),
        lists.length ? Promise.resolve(lists) : api("/api/admin/pricelists"),
        points.length ? Promise.resolve(points) : api("/api/admin/points"),
      ]);
      setRows(res.rows ?? []);
      setLists(pls);
      setPoints(pts);
      if (!fPricelist) {
        const active = (pls as Pricelist[]).find((l) => l.status === "ACTIVE");
        if (active) setFPricelist(active.id);
      }
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function create() {
    if (!fPricelist || !fText.trim()) {
      alert("יש לבחור מכירה ולכתוב את ההודעה");
      return;
    }
    setBusy("new");
    try {
      await api("/api/admin/phone-announcements", {
        method: "POST",
        body: JSON.stringify({
          pricelistId: fPricelist,
          pointId: fPoint || null,
          text: fText.trim(),
          expiresAt: fExpires || null,
        }),
      });
      setFText("");
      setFExpires("");
      setFPoint("");
      await load();
    } catch (e: any) {
      alert("שגיאה: " + e.message);
    } finally {
      setBusy(null);
    }
  }

  async function toggle(r: Row) {
    setBusy(r.id);
    try {
      await api("/api/admin/phone-announcements", {
        method: "PATCH",
        body: JSON.stringify({ id: r.id, isActive: !r.isActive }),
      });
      await load();
    } catch (e: any) {
      alert("שגיאה: " + e.message);
    } finally {
      setBusy(null);
    }
  }

  async function remove(r: Row) {
    if (!confirm("למחוק את ההודעה?")) return;
    setBusy(r.id);
    try {
      await api(`/api/admin/phone-announcements?id=${r.id}`, { method: "DELETE" });
      await load();
    } catch (e: any) {
      alert("שגיאה: " + e.message);
    } finally {
      setBusy(null);
    }
  }

  // כמה לקוחות ישמעו את ההודעה שנכתבת כרגע
  const previewReach = (() => {
    if (!fPricelist) return null;
    const same = rows.find(
      (r) => r.pricelistId === fPricelist && r.pointId === (fPoint || null)
    );
    return same?.reachCount ?? null;
  })();

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-extrabold text-brand-slatedark">
          הודעות למתקשרים
        </h1>
        <p className="text-sm text-brand-slate/60 mt-0.5">
          הודעה שתוקרא בטלפון ללקוחות שהזמינו במכירה. מיועד ללקוחות ללא מייל,
          שלא מקבלים עדכונים בדרך אחרת.
        </p>
      </div>

      {/* יצירת הודעה */}
      <div className="card p-5 space-y-3">
        <h2 className="font-bold text-brand-slatedark">הודעה חדשה</h2>

        <div className="grid md:grid-cols-2 gap-3">
          <label className="block">
            <span className="text-xs font-bold text-zinc-500">מכירה</span>
            <select
              className="input mt-1"
              value={fPricelist}
              onChange={(e) => setFPricelist(e.target.value)}
            >
              <option value="">בחר מכירה</option>
              {lists.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                  {l.status === "ACTIVE" ? " • פעילה" : ""}
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="text-xs font-bold text-zinc-500">
              נקודת חלוקה{" "}
              <span className="font-normal text-zinc-400">(ריק = כל הנקודות)</span>
            </span>
            <select
              className="input mt-1"
              value={fPoint}
              onChange={(e) => setFPoint(e.target.value)}
            >
              <option value="">כל הנקודות</option>
              {points.map((pt) => (
                <option key={pt.id} value={pt.id}>
                  {pt.name}
                  {pt.city ? ` — ${pt.city}` : ""}
                </option>
              ))}
            </select>
          </label>
        </div>

        <label className="block">
          <span className="text-xs font-bold text-zinc-500">תוכן ההודעה</span>
          <textarea
            className="input mt-1 min-h-[90px]"
            value={fText}
            onChange={(e) => setFText(e.target.value.slice(0, MAX_LEN))}
            placeholder="לדוגמה: החלוקה בנקודה שלך נדחתה לשעה שש בערב"
          />
          <div className="flex justify-between text-xs mt-1">
            <span className="text-zinc-500">
              ההודעה תוקרא בהקראה ממוחשבת. כדאי לכתוב במשפטים קצרים.
            </span>
            <span className={fText.length > MAX_LEN - 50 ? "text-amber-700" : "text-zinc-400"}>
              <bdi>
                {fText.length} / {MAX_LEN}
              </bdi>
            </span>
          </div>
        </label>

        <label className="block max-w-xs">
          <span className="text-xs font-bold text-zinc-500">
            תפוגה <span className="font-normal text-zinc-400">(אופציונלי)</span>
          </span>
          <input
            type="datetime-local"
            className="input mt-1"
            value={fExpires}
            onChange={(e) => setFExpires(e.target.value)}
          />
          <p className="text-xs text-zinc-500 mt-1">
            אחרי מועד זה ההודעה תפסיק להישמע אוטומטית. מומלץ להגדיר, כדי שהודעה
            על חלוקה שעברה לא תמשיך להישמע.
          </p>
        </label>

        <button
          onClick={create}
          disabled={busy === "new" || !fText.trim() || !fPricelist}
          className="btn-primary btn-sm"
        >
          {busy === "new" ? "שומר..." : "פרסם הודעה"}
        </button>
      </div>

      {err && (
        <div className="card p-4 border-red-200 bg-red-50 text-sm text-red-800">
          שגיאה: {err}
        </div>
      )}

      {/* רשימה */}
      {loading ? (
        <p className="text-zinc-500">טוען...</p>
      ) : rows.length === 0 ? (
        <div className="card p-6 text-center">
          <p className="font-medium text-brand-slatedark">אין הודעות</p>
          <p className="text-sm text-brand-slate/60 mt-1">
            הודעה שתפרסם כאן תוקרא ללקוחות שמתקשרים למערכת.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {rows.map((r) => (
            <div
              key={r.id}
              className={`card p-4 ${
                r.isActive && !r.isExpired ? "border-emerald-300" : "opacity-70"
              }`}
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap mb-1">
                    <span
                      className={`badge ${
                        r.isExpired
                          ? "bg-zinc-200 text-zinc-500"
                          : r.isActive
                            ? "bg-emerald-100 text-emerald-700"
                            : "bg-zinc-200 text-zinc-600"
                      }`}
                    >
                      {r.isExpired ? "פג תוקף" : r.isActive ? "פעילה" : "כבויה"}
                    </span>
                    <span className="text-xs text-zinc-500">{r.pricelistName}</span>
                    <span className="badge bg-zinc-100 text-zinc-700">
                      {r.pointName ? `📍 ${r.pointName}` : "כל הנקודות"}
                    </span>
                    <span className="text-xs text-brand-rust font-medium">
                      <bdi>{r.reachCount}</bdi> לקוחות ישמעו
                    </span>
                  </div>
                  <p className="text-sm text-brand-slatedark">{r.text}</p>
                  <p className="text-xs text-zinc-400 mt-1">
                    נוצר {fmtDate(r.createdAt)}
                    {r.expiresAt && ` · תפוגה ${fmtDate(r.expiresAt)}`}
                  </p>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <button
                    onClick={() => toggle(r)}
                    disabled={busy === r.id}
                    className="btn-ghost btn-sm"
                  >
                    {r.isActive ? "כבה" : "הפעל"}
                  </button>
                  <button
                    onClick={() => remove(r)}
                    disabled={busy === r.id}
                    className="btn-ghost btn-sm text-red-700"
                  >
                    מחק
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
