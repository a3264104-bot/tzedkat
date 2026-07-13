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

          <label className="block text-sm">
            <span className="text-zinc-700 font-medium">נקודת חלוקה</span>
            <select
              value={values.pointId}
              onChange={(e) => setValues({ ...values, pointId: e.target.value })}
              className="w-full mt-1 px-3 py-2 border border-zinc-300 rounded-lg"
            >
              {points.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>

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
