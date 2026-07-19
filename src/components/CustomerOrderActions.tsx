"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// קומפוננט פעולות ללקוח על הזמנה: ביטול + עריכת פרטי בסיס.
// מתווסף לכרטיס הזמנה באזור האישי.
//
// הצגה מותנית: אם ההזמנה לא ניתנת לעריכה (נסגר המחירון / נשקלה / בוטלה) -
// לא מציגים כפתורים. הפרונט מבוסס על ה-props isEditable שהאזור האישי מחשב.

type Point = {
  id: string;
  name: string;
  city: string | null;
};

type Props = {
  orderId: string;
  orderNumber: number;
  isEditable: boolean; // האם ניתן לערוך? מחושב בשרת ומועבר כ-prop
  editableUntil?: string | null; // תאריך שהמחירון נסגר (למידע ללקוח)
  // ערכים נוכחיים לעריכה
  currentValues: {
    customerName: string;
    phone: string;
    phone2: string | null;
    pointId: string;
    notes: string | null;
  };
  points: Point[]; // רשימת נקודות זמינות למעבר
};

export function CustomerOrderActions({
  orderId,
  orderNumber,
  isEditable,
  editableUntil,
  currentValues,
  points,
}: Props) {
  const [busy, setBusy] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const [msg, setMsg] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const router = useRouter();

  // אם לא ניתן לערוך - מציגים רק את הסיבה (או כלום)
  if (!isEditable) {
    return editableUntil ? (
      <div className="text-xs text-zinc-500 mt-2">
        לא ניתן יותר לערוך/לבטל הזמנה זו
      </div>
    ) : null;
  }

  async function handleCancel() {
    const confirmMsg = `לבטל את הזמנה #${orderNumber}?\n\nפעולה זו לא ניתנת לביטול (תצטרך ליצור הזמנה חדשה אם תשנה את דעתך).`;
    if (!confirm(confirmMsg)) return;
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch(`/api/customer/orders/${orderId}`, { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMsg({ type: "error", text: data.error || "שגיאה בביטול ההזמנה" });
        setBusy(false);
        return;
      }
      setMsg({ type: "success", text: "ההזמנה בוטלה בהצלחה" });
      // רענון לאחר 1.5 שניות (כדי שהלקוח יראה את ההודעה)
      setTimeout(() => router.refresh(), 1500);
    } catch (e: any) {
      setMsg({ type: "error", text: `שגיאת רשת: ${e.message || "לא ידוע"}` });
      setBusy(false);
    }
  }

  return (
    <div className="mt-3">
      {msg && (
        <div
          className={`mb-3 rounded-lg p-2.5 text-sm text-center ${
            msg.type === "success"
              ? "bg-emerald-50 text-emerald-800 border border-emerald-200"
              : "bg-red-50 text-red-800 border border-red-200"
          }`}
        >
          {msg.text}
        </div>
      )}

      <div className="flex gap-2 flex-wrap">
        <a
          href={`/order?editOrderId=${orderId}`}
          className="px-3 py-1.5 bg-blue-100 text-blue-700 rounded-lg text-sm font-medium hover:bg-blue-200"
        >
          🛒 עריכת פריטים
        </a>
        <button
          onClick={() => setShowEdit(true)}
          disabled={busy}
          className="px-3 py-1.5 bg-brand-yellow text-brand-slatedark rounded-lg text-sm font-medium hover:opacity-90 disabled:opacity-50"
        >
          ✏️ עדכן פרטים
        </button>
        <button
          onClick={handleCancel}
          disabled={busy}
          className="px-3 py-1.5 bg-red-100 text-red-700 rounded-lg text-sm font-medium hover:bg-red-200 disabled:opacity-50"
        >
          {busy ? "מבטל..." : "🗑 בטל הזמנה"}
        </button>
      </div>

      {editableUntil && (
        <div className="text-xs text-zinc-500 mt-2">ניתן לערוך/לבטל עד {editableUntil}</div>
      )}

      {/* Modal לעריכת פרטי בסיס */}
      {showEdit && (
        <EditModal
          orderId={orderId}
          orderNumber={orderNumber}
          currentValues={currentValues}
          points={points}
          onClose={() => setShowEdit(false)}
          onSuccess={() => {
            setShowEdit(false);
            setMsg({ type: "success", text: "פרטי ההזמנה עודכנו" });
            setTimeout(() => router.refresh(), 1500);
          }}
        />
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// EditModal - טופס עריכת פרטים
// ═══════════════════════════════════════════════════════════════════
function EditModal({
  orderId,
  orderNumber,
  currentValues,
  points,
  onClose,
  onSuccess,
}: {
  orderId: string;
  orderNumber: number;
  currentValues: Props["currentValues"];
  points: Point[];
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [values, setValues] = useState(currentValues);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/customer/orders/${orderId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customerName: values.customerName.trim(),
          phone: values.phone.trim(),
          phone2: values.phone2 || null,
          pointId: values.pointId,
          notes: values.notes || null,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || "שגיאה בעדכון");
        setBusy(false);
        return;
      }
      onSuccess();
    } catch (e: any) {
      setError(`שגיאת רשת: ${e.message || "לא ידוע"}`);
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-black/50 flex items-end sm:items-center justify-center p-0 sm:p-4"
      onClick={onClose}
    >
      <div
        className="bg-white w-full sm:max-w-md sm:rounded-2xl rounded-t-2xl max-h-[92vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-4 border-b flex justify-between items-center sticky top-0 bg-white">
          <div>
            <h3 className="font-bold text-brand-slatedark">עריכת הזמנה #{orderNumber}</h3>
            <p className="text-xs text-zinc-500">פרטי בסיס בלבד. לשינוי פריטים - בטל וצור הזמנה חדשה</p>
          </div>
          <button
            onClick={onClose}
            className="text-zinc-400 text-2xl leading-none px-2"
            aria-label="סגור"
          >
            ×
          </button>
        </div>

        <div className="p-4 space-y-3">
          <label className="block text-sm">
            <span className="text-zinc-700 font-medium">שם</span>
            <input
              type="text"
              value={values.customerName}
              onChange={(e) => setValues({ ...values, customerName: e.target.value })}
              className="w-full mt-1 px-3 py-2 border border-zinc-300 rounded-lg"
            />
          </label>

          <label className="block text-sm">
            <span className="text-zinc-700 font-medium">טלפון</span>
            <input
              type="tel"
              value={values.phone}
              onChange={(e) => setValues({ ...values, phone: e.target.value })}
              dir="ltr"
              className="w-full mt-1 px-3 py-2 border border-zinc-300 rounded-lg text-right"
            />
          </label>

          <label className="block text-sm">
            <span className="text-zinc-700 font-medium">טלפון נוסף (אופציונלי)</span>
            <input
              type="tel"
              value={values.phone2 || ""}
              onChange={(e) => setValues({ ...values, phone2: e.target.value })}
              dir="ltr"
              className="w-full mt-1 px-3 py-2 border border-zinc-300 rounded-lg text-right"
            />
          </label>

          <PointPicker
            points={points}
            value={values.pointId}
            onChange={(id) => setValues({ ...values, pointId: id })}
          />

          <label className="block text-sm">
            <span className="text-zinc-700 font-medium">הערות (אופציונלי)</span>
            <textarea
              value={values.notes || ""}
              onChange={(e) => setValues({ ...values, notes: e.target.value })}
              rows={3}
              className="w-full mt-1 px-3 py-2 border border-zinc-300 rounded-lg resize-none"
            />
          </label>

          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-2.5 text-sm text-red-700">
              {error}
            </div>
          )}
        </div>

        <div className="p-4 border-t bg-zinc-50 flex gap-2 sticky bottom-0">
          <button
            onClick={onClose}
            disabled={busy}
            className="flex-1 px-4 py-2 bg-white border border-zinc-300 rounded-lg text-sm font-medium hover:bg-zinc-50 disabled:opacity-50"
          >
            ביטול
          </button>
          <button
            onClick={submit}
            disabled={busy || !values.customerName.trim() || !values.phone.trim()}
            className="flex-1 px-4 py-2 bg-brand-rust text-white rounded-lg text-sm font-medium hover:opacity-90 disabled:opacity-50"
          >
            {busy ? "שומר..." : "שמור שינויים"}
          </button>
        </div>
      </div>
    </div>
  );
}

// PointPicker — בחירת נקודת חלוקה בשני שלבים: קודם עיר, אחר כך נקודה בעיר
function PointPicker({
  points,
  value,
  onChange,
}: {
  points: Point[];
  value: string;
  onChange: (id: string) => void;
}) {
  // מוצא את העיר של הנקודה הנבחרת כדי לפתוח על העיר הנכונה
  const currentPoint = points.find((p) => p.id === value);
  const [selectedCity, setSelectedCity] = useState<string | null>(
    currentPoint?.city ?? null
  );

  // מקבץ נקודות לפי ערים
  const cities = Array.from(
    new Set(points.map((p) => p.city).filter((c): c is string => !!c))
  ).sort((a, b) => a.localeCompare(b, "he"));

  const pointsWithoutCity = points.filter((p) => !p.city);
  const pointsInCity = selectedCity
    ? points.filter((p) => p.city === selectedCity)
    : [];

  // אם יש רק עיר אחת (או אף עיר), מציגים רשימה שטוחה — אין צורך בשלב עיר
  if (cities.length <= 1) {
    return (
      <label className="block text-sm">
        <span className="text-zinc-700 font-medium">נקודת חלוקה</span>
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-full mt-1 px-3 py-2 border border-zinc-300 rounded-lg"
        >
          {points.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}{p.city ? ` — ${p.city}` : ""}
            </option>
          ))}
        </select>
      </label>
    );
  }

  return (
    <div>
      <div className="text-zinc-700 font-medium text-sm mb-2">נקודת חלוקה</div>

      {/* שלב עיר */}
      {!selectedCity && (
        <div className="space-y-1.5 max-h-64 overflow-y-auto border border-zinc-200 rounded-lg p-2">
          {cities.map((city) => {
            const count = points.filter((p) => p.city === city).length;
            return (
              <button
                key={city}
                type="button"
                onClick={() => setSelectedCity(city)}
                className="w-full text-right px-3 py-2.5 rounded-lg hover:bg-zinc-50 border border-zinc-100 flex justify-between items-center"
              >
                <span className="font-medium text-brand-slatedark">🏙️ {city}</span>
                <span className="text-xs text-zinc-400">
                  {count === 1 ? "נקודה 1" : `${count} נקודות`}
                </span>
              </button>
            );
          })}
          {pointsWithoutCity.length > 0 && (
            <>
              <div className="text-xs text-zinc-400 px-2 pt-1">נקודות ללא עיר</div>
              {pointsWithoutCity.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => onChange(p.id)}
                  className={`w-full text-right px-3 py-2 rounded-lg hover:bg-zinc-50 border ${
                    value === p.id ? "border-brand-rust bg-brand-rust/5" : "border-zinc-100"
                  }`}
                >
                  {p.name}
                </button>
              ))}
            </>
          )}
        </div>
      )}

      {/* שלב נקודה בתוך עיר */}
      {selectedCity && (
        <div className="border border-zinc-200 rounded-lg p-2">
          <button
            type="button"
            onClick={() => setSelectedCity(null)}
            className="text-xs text-brand-rust font-medium mb-2 flex items-center gap-1"
          >
            ← חזרה לרשימת הערים
          </button>
          <div className="text-xs text-zinc-500 mb-2 px-1">
            נקודות ב<strong>{selectedCity}</strong>:
          </div>
          <div className="space-y-1.5 max-h-56 overflow-y-auto">
            {pointsInCity.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => onChange(p.id)}
                className={`w-full text-right px-3 py-2 rounded-lg hover:bg-zinc-50 border ${
                  value === p.id
                    ? "border-brand-rust bg-brand-rust/5 font-medium"
                    : "border-zinc-100"
                }`}
              >
                <span className="text-brand-slatedark">{p.name}</span>
                {value === p.id && <span className="text-brand-rust mr-2">✓</span>}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
