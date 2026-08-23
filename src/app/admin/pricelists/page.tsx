"use client";

import { useEffect, useState } from "react";
// §200: תאריכים בשעון ישראל — השרת רץ ב-UTC
import { fmtDateTime } from "@/lib/date-lib";
import { api, download } from "@/lib/client";
import { PRICELIST_STATUS, fmt } from "@/lib/pricing";
import { Modal, Field } from "@/components/AdminModal";
import { HebrewDate } from "@/components/HebrewDate";

type Pricelist = {
  id: string;
  name: string;
  status: string;
  singleSurcharge: string;
  deliveryDateText: string | null;
  notes: string | null;
  // §111: מכירה לנציגים בלבד
  agentOnly?: boolean;
  // §145: מתי נשלחו קבצי האקסל
  excelSentAt?: string | null;
  excelSentCount?: number;
  _count: { orders: number; products: number; points: number };
};

/**
 * §193: 🐛 השעון "פיגר" ב-3 שעות.
 *
 * הבאג: `pl.closeDate.slice(0, 16)` חתך את מחרוזת ה-ISO **כמו
 * שהיא** - כלומר את שעת ה-UTC. המנהל קבע 21:00, המערכת שמרה
 * נכון (18:00 UTC), ובטעינה מחדש הציגה 18:00.
 *
 * הוא היה מתקן ל-21:00, נשמר 15:00 UTC, ובפעם הבאה רואה 15:00 -
 * וכך בכל עריכה השעה זזה עוד 3 שעות אחורה.
 *
 * ⚠️ getTimezoneOffset ולא אזור קבוע: הוא נכון גם בשעון קיץ,
 * שבישראל זז פעמיים בשנה. ערך קשיח היה שובר באוקטובר.
 */
function toLocalInput(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  // מזיזים לפי ההיסט המקומי, ואז חותכים - כך שהמחרוזת מייצגת
  // שעה מקומית, בדיוק כמו ש-datetime-local מצפה.
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
}

export default function PricelistsPage() {
  const [lists, setLists] = useState<Pricelist[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  // §145: חוסם לחיצה כפולה בזמן שליחת האקסלים
  const [busy, setBusy] = useState(false);

  async function load() {
    setLoading(true);
    setLists(await api("/api/admin/pricelists"));
    setLoading(false);
  }
  useEffect(() => {
    load();
  }, []);

  // §145: שליחת קבצי אקסל ללקוחות שביקשו.
  //
  // ⚠️ פעולה נפרדת ולא אוטומטית בהפעלה: המנהל לעיתים מפעיל
  // מכירה כדי לבדוק אותה, ושליחה אוטומטית הייתה מציפה לקוחות
  // בקובץ שעוד לא מוכן.
  async function sendExcel(l: Pricelist, force = false) {
    if (
      !force &&
      !window.confirm(
        `לשלוח קבצי אקסל ללקוחות שסימנת ב"${l.name}"?\n\nכל לקוח יקבל קובץ עם המוצרים והמחירים, למילוי והחזרה במייל.`
      )
    )
      return;

    setBusy(true);
    try {
      const res = await fetch("/api/admin/excel-broadcast", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pricelistId: l.id, force }),
      });
      const data = await res.json();

      // ⚠️ 409 = כבר נשלח. מציעים שליחה חוזרת במקום להיכשל -
      // לפעמים באמת צריך (מוצר נוסף, מחיר שהשתנה).
      if (res.status === 409) {
        if (window.confirm(`${data.error}\n\nלשלוח שוב לכולם?`)) {
          await sendExcel(l, true);
        }
        return;
      }
      if (!res.ok) throw new Error(data.error || "שגיאה");

      alert(
        `נשלחו ${data.sentCount} קבצים.` +
          (data.failedCount > 0
            ? `\n\n⚠️ ${data.failedCount} נכשלו:\n${data.failed
                .map((f: any) => `${f.name} — ${f.error}`)
                .join("\n")}`
            : "")
      );
      await load();
    } catch (e: any) {
      alert(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function setStatus(l: Pricelist, status: string) {
    // אזהרה: הפעלת מכירה ריקה תציג ללקוחות מכירה בלי מוצרים
    if (status === "ACTIVE" && (l._count.products === 0 || l._count.points === 0)) {
      const missing = [
        l._count.products === 0 ? "מוצרים" : null,
        l._count.points === 0 ? "נקודות חלוקה" : null,
      ]
        .filter(Boolean)
        .join(" ו");
      if (
        !confirm(
          `למכירה "${l.name}" עדיין לא הוגדרו ${missing}.
לקוחות שייכנסו יראו מכירה ריקה.
להפעיל בכל זאת?`
        )
      )
        return;
    }
    // 🐛 תוקן: הקריאה הייתה בלי try/catch, ולכן שגיאות מהשרת נבלעו
    // בשקט - המנהל לחץ "הפעל", כלום לא קרה, ולא הייתה שום אינדיקציה
    // למה. הכי בולט באכיפת תאריך החלוקה (400) שהחזירה הודעה ברורה
    // שאיש לא ראה.
    try {
      await api(`/api/admin/pricelists/${l.id}`, {
        method: "PATCH",
        body: JSON.stringify({ status }),
      });
      load();
    } catch (e: any) {
      alert(e.message || "שגיאה בעדכון הסטטוס");
    }
  }
  async function duplicate(l: Pricelist) {
    await api("/api/admin/pricelists", {
      method: "POST",
      body: JSON.stringify({ duplicateFrom: l.id, name: `${l.name} (העתק)` }),
    });
    load();
  }
  async function remove(l: Pricelist) {
    if (!confirm(`למחוק את "${l.name}"?`)) return;
    try {
      await api(`/api/admin/pricelists/${l.id}`, { method: "DELETE" });
      load();
    } catch (e: any) {
      alert(e.message);
    }
  }

  const statusColor: Record<string, string> = {
    DRAFT: "bg-zinc-200 text-zinc-600",
    ACTIVE: "bg-green-100 text-green-700",
    CLOSED: "bg-amber-100 text-amber-700",
    DONE: "bg-blue-100 text-blue-700",
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold text-brand-slatedark">מכירות</h1>
          <p className="text-sm text-zinc-500 mt-1 max-w-xl">
            כל מכירה היא אירוע הזמנות לתקופה מסוימת — למשל "מכירת ראש השנה" או "מכירת חודש אב".
            במכירה בוחרים אילו מוצרים ובאיזה מחיר, ובאילו נקודות חלוקה. רק מכירה במצב{" "}
            <b>פעיל</b> פתוחה ללקוחות להזמנות.
          </p>
        </div>
        <button onClick={() => setCreating(true)} className="btn-primary btn-sm">
          + מכירה חדשה
        </button>
      </div>

      {loading ? (
        <p className="text-zinc-500">טוען...</p>
      ) : lists.length === 0 ? (
        <div className="card p-8 text-center">
          <div className="text-3xl mb-2">🗓️</div>
          <p className="font-bold text-brand-slatedark">עדיין אין מכירות</p>
          <p className="text-sm text-zinc-500 mt-1">
            צור מכירה ראשונה (למשל לחג הקרוב), בחר בה מוצרים ונקודות חלוקה, והפוך אותה לפעילה —
            ואז לקוחות יוכלו להזמין.
          </p>
          <button onClick={() => setCreating(true)} className="btn-primary btn-sm mt-4">
            + מכירה חדשה
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {lists.map((l) => (
            <div key={l.id} className="card p-4">
              <div className="flex flex-wrap justify-between items-start gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-brand-slatedark text-lg">{l.name}</span>
                    <span className={`badge ${statusColor[l.status]}`}>
                      {PRICELIST_STATUS[l.status]}
                    </span>
                    {/* §111: סימון בולט - מכירה שהלקוחות לא רואים */}
                    {l.agentOnly && (
                      <span className="badge bg-amber-100 text-amber-800 border border-amber-300">
                        🧑‍💼 נציגים בלבד
                      </span>
                    )}
                  </div>
                  <div className="text-sm text-zinc-500 mt-1">
                    {l._count.products} מוצרים · {l._count.points} נקודות · {l._count.orders} הזמנות ·
                    תוספת בודדים {fmt(l.singleSurcharge)}
                  </div>
                  {l.deliveryDateText && (
                    <div className="text-sm text-zinc-400 mt-0.5">חלוקה: {l.deliveryDateText}</div>
                  )}
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {l.status !== "ACTIVE" && (
                    <button onClick={() => setStatus(l, "ACTIVE")} className="btn-yellow btn-sm">
                      הפוך לפעיל
                    </button>
                  )}
                  {l.status === "ACTIVE" && (
                    <button onClick={() => setStatus(l, "CLOSED")} className="btn-ghost btn-sm">
                      סגור הזמנות
                    </button>
                  )}
                  {/* §116: הקישור למסך "מצב המכירה" הוסר.
                      הוא הוביל ל-/admin/sale-status, מסך שנבנה
                      בכפילות ל-/admin/sale-control הקיים ונמחק.
                      בקרת המכירה נגישה מהתפריט הראשי, שלב ③. */}
                  {/* §145: שליחת אקסל - רק ממכירה פעילה שאינה
                      לנציגים בלבד. */}
                  {l.status === "ACTIVE" && !l.agentOnly && (
                    <button
                      onClick={() => sendExcel(l)}
                      disabled={busy}
                      title={
                        l.excelSentAt
                          ? `נשלח ב-${fmtDateTime(l.excelSentAt)} · ${l.excelSentCount} נמענים`
                          : "שליחת קבצי אקסל ללקוחות שביקשו"
                      }
                      className="btn-sm bg-emerald-600 text-white rounded-lg px-3 font-bold hover:opacity-90 disabled:opacity-50"
                    >
                      📊 שלח אקסל
                      {!!l.excelSentAt && (
                        <span className="text-[10px] font-normal mr-1">
                          ✓{l.excelSentCount}
                        </span>
                      )}
                    </button>
                  )}
                  <button onClick={() => setEditing(l.id)} className="btn-ghost btn-sm">
                    ערוך
                  </button>
                  <button onClick={() => duplicate(l)} className="btn-ghost btn-sm">
                    שכפל
                  </button>
                  <button
                    onClick={() => download(`/api/admin/export?type=orders&pricelistId=${l.id}`)}
                    className="btn-ghost btn-sm"
                  >
                    ייצוא לאקסל
                  </button>
                  {l._count.orders === 0 && (
                    <button onClick={() => remove(l)} className="btn-ghost btn-sm text-red-600">
                      מחק
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {creating && (
        <CreateModal
          onClose={() => setCreating(false)}
          onDone={() => {
            setCreating(false);
            load();
          }}
        />
      )}
      {editing && (
        <EditModal
          id={editing}
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

function CreateModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [name, setName] = useState("");
  const [surcharge, setSurcharge] = useState("3");
  const [dateText, setDateText] = useState("");
  // §111: מכירה לנציגים בלבד
  const [agentOnly, setAgentOnly] = useState(false);
  const [notes, setNotes] = useState("");
  // §16/#6: תאריכים למכירה
  const [openDate, setOpenDate] = useState("");
  const [closeDate, setCloseDate] = useState("");
  const [editDeadline, setEditDeadline] = useState("");
  const [deliveryStart, setDeliveryStart] = useState("");
  const [deliveryEnd, setDeliveryEnd] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  async function create() {
    setError("");
    // ולידציה עם הודעות ברורות - לא נכשלים בשקט
    if (!name.trim()) {
      setError("יש להזין שם למכירה (למשל: מכירת ראש השנה)");
      return;
    }
    if (surcharge !== "" && isNaN(parseFloat(surcharge))) {
      setError("תוספת הבודדים חייבת להיות מספר");
      return;
    }
    setSaving(true);
    try {
      await api("/api/admin/pricelists", {
        method: "POST",
        body: JSON.stringify({
          name: name.trim(),
          singleSurcharge: parseFloat(surcharge) || 3,
          deliveryDateText: dateText || null,
          agentOnly,
          notes: notes || null,
          openDate: openDate ? new Date(openDate).toISOString() : null,
          closeDate: closeDate ? new Date(closeDate).toISOString() : null,
          editDeadline: editDeadline ? new Date(editDeadline).toISOString() : null,
          deliveryDate: deliveryStart ? new Date(deliveryStart).toISOString() : null,
          deliveryDateEnd: deliveryEnd ? new Date(deliveryEnd).toISOString() : null,
        }),
      });
      onDone();
    } catch (e: any) {
      setError(e.message || "שגיאה ביצירת המכירה");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal onClose={onClose} title="מכירה חדשה">
      <div className="space-y-3">
        <p className="text-xs text-zinc-500 bg-zinc-50 rounded-lg p-2">
          יוצרים מכירה לתקופה/חג, ואחרי היצירה בוחרים בה מוצרים, מחירים ונקודות חלוקה דרך
          "ערוך". כשהכל מוכן — "הפוך לפעיל" פותח אותה ללקוחות.
        </p>
        <Field label="שם המכירה *">
          <input
            className="input"
            placeholder='למשל: מכירת ראש השנה תשפ"ז'
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </Field>
        <Field label='תוספת לבודדים לק"ג'>
          <input className="input" type="number" step="0.5" value={surcharge} onChange={(e) => setSurcharge(e.target.value)} />
        </Field>
        <Field label="תאריך חלוקה (טקסט חופשי)">
          <input
            className="input"
            placeholder='למשל: יום שלישי כ"ח אלול'
            value={dateText}
            onChange={(e) => setDateText(e.target.value)}
          />
        </Field>

        {/* §111: מכירה לנציגים בלבד.
            הסימון כאן ולא בעריכה שאחרי היצירה, כי הוא משנה מי
            רואה את המכירה - החלטה שצריכה להילקח בפתיחה ולא
            להשתנות באמצע, כשכבר יש בה הזמנות. */}
        <label className="flex items-start gap-2.5 bg-amber-50 border-2 border-amber-300 rounded-xl p-3 cursor-pointer">
          <input
            type="checkbox"
            checked={agentOnly}
            onChange={(e) => setAgentOnly(e.target.checked)}
            className="h-4 w-4 accent-brand-rust mt-0.5 shrink-0"
          />
          <span className="text-sm">
            <b className="text-amber-900">מכירה לנציגים בלבד (הזמנה מהירה)</b>
            <span className="block text-xs text-amber-800 leading-relaxed mt-0.5">
              הלקוחות <b>לא יראו</b> את המכירה הזו — לא באתר ולא במערכת
              הטלפונית. רק נציגים יוכלו לפתוח בה הזמנות, מתוך כרטיס
              הלקוח. החיוב, השקילה והמחירים זהים למכירה רגילה.
            </span>
          </span>
        </label>

        {/* §16/#6: שדות תאריכים עם תצוגת תאריך עברי */}
        <div className="bg-zinc-50 rounded-lg p-3 space-y-3">
          <p className="text-xs font-bold text-brand-slatedark">תאריכי מכירה</p>

          <Field label="פתיחת ההרשמה">
            <input
              className="input"
              type="datetime-local"
              value={openDate}
              onChange={(e) => setOpenDate(e.target.value)}
            />
            {openDate && (
              <p className="text-xs text-brand-rust mt-1">
                📅 <HebrewDate date={openDate} />
              </p>
            )}
          </Field>

          <Field label="סגירת ההרשמה (הזמנות חדשות)">
            <input
              className="input"
              type="datetime-local"
              value={closeDate}
              onChange={(e) => setCloseDate(e.target.value)}
            />
            {closeDate && (
              <p className="text-xs text-brand-rust mt-1">
                📅 <HebrewDate date={closeDate} />
              </p>
            )}
          </Field>

          <Field label="נעילת שינויים (הלקוח לא יכול לערוך אחרי)">
            <input
              className="input"
              type="datetime-local"
              value={editDeadline}
              onChange={(e) => setEditDeadline(e.target.value)}
            />
            {editDeadline && (
              <p className="text-xs text-brand-rust mt-1">
                📅 <HebrewDate date={editDeadline} />
              </p>
            )}
            <p className="text-xs text-zinc-500 mt-1">
              אם ריק — הלקוח יכול לערוך עד סגירת ההרשמה.
            </p>
          </Field>

          <div className="grid grid-cols-2 gap-2">
            <Field label="תחילת חלוקה">
              <input
                className="input"
                type="datetime-local"
                value={deliveryStart}
                onChange={(e) => setDeliveryStart(e.target.value)}
              />
              {deliveryStart && (
                <p className="text-xs text-brand-rust mt-1">
                  <HebrewDate date={deliveryStart} />
                </p>
              )}
            </Field>
            <Field label="סוף חלוקה">
              <input
                className="input"
                type="datetime-local"
                value={deliveryEnd}
                onChange={(e) => setDeliveryEnd(e.target.value)}
              />
              {deliveryEnd && (
                <p className="text-xs text-brand-rust mt-1">
                  <HebrewDate date={deliveryEnd} />
                </p>
              )}
            </Field>
          </div>
        </div>
        <Field label="הערות ללקוח (אופציונלי)">
          <textarea className="input" value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
        {error && (
          <p className="text-sm text-red-600 font-medium bg-red-50 border border-red-200 rounded-lg p-2">
            {error}
          </p>
        )}
        <button onClick={create} disabled={saving} className="btn-primary w-full">
          {saving ? "יוצר..." : "צור מכירה"}
        </button>
      </div>
    </Modal>
  );
}

function EditModal({ id, onClose, onDone }: { id: string; onClose: () => void; onDone: () => void }) {
  const [data, setData] = useState<any>(null);
  const [allProducts, setAllProducts] = useState<any[]>([]);
  const [allPoints, setAllPoints] = useState<any[]>([]);
  const [selProducts, setSelProducts] = useState<Record<string, { on: boolean; price: string }>>({});
  const [selPoints, setSelPoints] = useState<Record<string, boolean>>({});
  const [form, setForm] = useState({
    name: "",
    surcharge: "3",
    dateText: "",
    notes: "",
    openDate: "",
    closeDate: "",
    editDeadline: "",
    deliveryDate: "",
    deliveryDateEnd: "",
  });

  useEffect(() => {
    (async () => {
      const [pl, products, points] = await Promise.all([
        api(`/api/admin/pricelists/${id}`),
        api("/api/admin/products"),
        api("/api/admin/points"),
      ]);
      setData(pl);
      setAllProducts(products);
      setAllPoints(points);
      setForm({
        name: pl.name,
        surcharge: String(pl.singleSurcharge),
        dateText: pl.deliveryDateText ?? "",
        notes: pl.notes ?? "",
        openDate: toLocalInput(pl.openDate),
        closeDate: toLocalInput(pl.closeDate),
        editDeadline: toLocalInput(pl.editDeadline),
        deliveryDate: toLocalInput(pl.deliveryDate),
        deliveryDateEnd: toLocalInput(pl.deliveryDateEnd),
      });
      const sp: Record<string, { on: boolean; price: string }> = {};
      for (const p of products) {
        const inList = pl.products.find((x: any) => x.productId === p.id);
        sp[p.id] = { on: !!inList, price: inList?.price ? String(inList.price) : "" };
      }
      setSelProducts(sp);
      const spt: Record<string, boolean> = {};
      for (const pt of points) spt[pt.id] = !!pl.points.find((x: any) => x.pointId === pt.id);
      setSelPoints(spt);
    })();
  }, [id]);

  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  async function save() {
    setError("");
    // ולידציה עם הודעות ברורות
    if (!form.name.trim()) {
      setError("יש להזין שם למכירה");
      return;
    }
    const products = Object.entries(selProducts)
      .filter(([, v]) => v.on)
      .map(([productId, v]) => ({ productId, price: v.price ? parseFloat(v.price) : null }));
    const pointIds = Object.entries(selPoints)
      .filter(([, v]) => v)
      .map(([id]) => id);
    if (products.length === 0) {
      setError("יש לסמן לפחות מוצר אחד שישתתף במכירה");
      return;
    }
    if (pointIds.length === 0) {
      setError("יש לסמן לפחות נקודת חלוקה אחת");
      return;
    }
    setSaving(true);
    try {
      await api(`/api/admin/pricelists/${id}`, {
        method: "PATCH",
        body: JSON.stringify({
          name: form.name,
          singleSurcharge: parseFloat(form.surcharge) || 3,
          deliveryDateText: form.dateText || null,
          notes: form.notes || null,
          openDate: form.openDate ? new Date(form.openDate).toISOString() : null,
          closeDate: form.closeDate ? new Date(form.closeDate).toISOString() : null,
          editDeadline: form.editDeadline ? new Date(form.editDeadline).toISOString() : null,
          deliveryDate: form.deliveryDate ? new Date(form.deliveryDate).toISOString() : null,
          deliveryDateEnd: form.deliveryDateEnd ? new Date(form.deliveryDateEnd).toISOString() : null,
          products,
          pointIds,
        }),
      });
      onDone();
    } catch (e: any) {
      setError(e.message || "שגיאה בשמירה");
    } finally {
      setSaving(false);
    }
  }

  if (!data) return <Modal onClose={onClose} title="טוען..."><p className="text-zinc-500">טוען...</p></Modal>;

  return (
    <Modal onClose={onClose} title="עריכת מכירה">
      <div className="space-y-4">
        <Field label="שם המכירה *">
          <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label='תוספת בודדים לק"ג'>
            <input className="input" type="number" step="0.5" value={form.surcharge} onChange={(e) => setForm({ ...form, surcharge: e.target.value })} />
          </Field>
          <Field label="תאריך חלוקה">
            <input className="input" value={form.dateText} onChange={(e) => setForm({ ...form, dateText: e.target.value })} />
          </Field>
        </div>
        <Field label="הערות ללקוח">
          <textarea className="input" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
        </Field>

        {/* §16/#6: שדות תאריכים עם תצוגת תאריך עברי */}
        <div className="bg-zinc-50 rounded-lg p-3 space-y-3">
          <p className="text-xs font-bold text-brand-slatedark">תאריכי מכירה</p>

          <Field label="פתיחת ההרשמה">
            <input
              className="input"
              type="datetime-local"
              value={form.openDate}
              onChange={(e) => setForm({ ...form, openDate: e.target.value })}
            />
            {form.openDate && (
              <p className="text-xs text-brand-rust mt-1">📅 <HebrewDate date={form.openDate} /></p>
            )}
          </Field>

          <Field label="סגירת ההרשמה (הזמנות חדשות)">
            <input
              className="input"
              type="datetime-local"
              value={form.closeDate}
              onChange={(e) => setForm({ ...form, closeDate: e.target.value })}
            />
            {form.closeDate && (
              <p className="text-xs text-brand-rust mt-1">📅 <HebrewDate date={form.closeDate} /></p>
            )}
          </Field>

          <Field label="נעילת שינויים (הלקוח לא יכול לערוך אחרי)">
            <input
              className="input"
              type="datetime-local"
              value={form.editDeadline}
              onChange={(e) => setForm({ ...form, editDeadline: e.target.value })}
            />
            {form.editDeadline && (
              <p className="text-xs text-brand-rust mt-1">📅 <HebrewDate date={form.editDeadline} /></p>
            )}
            <p className="text-xs text-zinc-500 mt-1">
              אם ריק — הלקוח יכול לערוך עד סגירת ההרשמה.
            </p>
          </Field>

          <div className="grid grid-cols-2 gap-2">
            <Field label="תחילת חלוקה">
              <input
                className="input"
                type="datetime-local"
                value={form.deliveryDate}
                onChange={(e) => setForm({ ...form, deliveryDate: e.target.value })}
              />
              {form.deliveryDate && (
                <p className="text-xs text-brand-rust mt-1"><HebrewDate date={form.deliveryDate} /></p>
              )}
            </Field>
            <Field label="סוף חלוקה">
              <input
                className="input"
                type="datetime-local"
                value={form.deliveryDateEnd}
                onChange={(e) => setForm({ ...form, deliveryDateEnd: e.target.value })}
              />
              {form.deliveryDateEnd && (
                <p className="text-xs text-brand-rust mt-1"><HebrewDate date={form.deliveryDateEnd} /></p>
              )}
            </Field>
          </div>
        </div>

        <div>
          {/* §180: סימון הכל בלחיצה.
              
              🐛 עם 15 נקודות המנהל סימן אותן אחת-אחת בכל מכירה
              חדשה. זו עבודה שחוזרת על עצמה, ומספיק לשכוח אחת
              כדי שלקוחות שלמים לא יוכלו להזמין.
              
              ⚠️ הספירה כוללת את הסמויות במפורש - הן לא מופיעות
              ללקוח, והמנהל צריך לדעת שהן נכללו. */}
          <div className="flex items-center justify-between gap-2 mb-1">
            <div className="label mb-0">נקודות חלוקה משתתפות</div>
            <div className="flex gap-1.5">
              <button
                type="button"
                onClick={() => {
                  const all: Record<string, boolean> = {};
                  for (const pt of allPoints) all[pt.id] = true;
                  setSelPoints(all);
                }}
                className="text-[11px] font-bold text-brand-rust hover:underline"
              >
                ✓ סמן הכל
              </button>
              <span className="text-zinc-300">·</span>
              <button
                type="button"
                onClick={() => setSelPoints({})}
                className="text-[11px] text-zinc-500 hover:underline"
              >
                נקה
              </button>
            </div>
          </div>

          {/* חיווי הבחירה - כולל פירוט הסמויות */}
          {(() => {
            const chosen = allPoints.filter((pt) => selPoints[pt.id]);
            const hidden = chosen.filter((pt: any) => pt.isPrivate);
            if (chosen.length === 0) return null;
            return (
              <p className="text-[11px] text-emerald-800 bg-emerald-50 border border-emerald-200 rounded p-1.5 mb-1.5">
                נבחרו <b>{chosen.length}</b> נקודות
                {hidden.length > 0 && (
                  <>
                    {" "}
                    · כולל <b>{hidden.length} סמויות</b> 🔒 שאינן מוצגות ללקוחות
                  </>
                )}
              </p>
            );
          })()}

          <div className="grid grid-cols-2 gap-1.5 max-h-40 overflow-y-auto border rounded-xl p-2">
            {allPoints.map((pt) => (
              <label key={pt.id} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={selPoints[pt.id] ?? false}
                  onChange={(e) => setSelPoints({ ...selPoints, [pt.id]: e.target.checked })}
                  className="h-4 w-4 accent-brand-rust"
                />
                <span className={(pt as any).isPrivate ? "text-violet-800" : ""}>
                  {(pt as any).isPrivate && "🔒 "}
                  {pt.name}
                </span>
              </label>
            ))}
          </div>
        </div>

        <div>
          <div className="label">מוצרים במכירה ומחיר מיוחד (ריק = המחיר הרגיל של המוצר)</div>
          <div className="max-h-64 overflow-y-auto border rounded-xl divide-y">
            {allProducts.map((p) => (
              <div key={p.id} className="flex items-center gap-2 p-2 text-sm">
                <input
                  type="checkbox"
                  checked={selProducts[p.id]?.on ?? false}
                  onChange={(e) =>
                    setSelProducts({
                      ...selProducts,
                      [p.id]: { ...(selProducts[p.id] ?? { price: "" }), on: e.target.checked },
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
                      [p.id]: { on: selProducts[p.id]?.on ?? false, price: e.target.value },
                    })
                  }
                />
              </div>
            ))}
          </div>
        </div>

        {error && (
          <p className="text-sm text-red-600 font-medium bg-red-50 border border-red-200 rounded-lg p-2">
            {error}
          </p>
        )}
        <button onClick={save} disabled={saving} className="btn-primary w-full">
          {saving ? "שומר..." : "שמירה"}
        </button>
      </div>
    </Modal>
  );
}
