"use client";

// ═══════════════════════════════════════════════════════════════
// §181: עריכת פרטי לקוח מתוך ההזמנה
// ═══════════════════════════════════════════════════════════════
// 🐛 הפער: הנציג פוגש את הלקוח בחלוקה ומגלה שהטלפון שגוי, שהשם
// לא נכון, או שהוא משלם מזומן ולא באשראי.
//
// עד היום: לצאת מההזמנה -> לחפש אותו ברשימה -> לפתוח -> לערוך ->
// לחזור. חמישה מסכים. ברוב המקרים הוא פשוט ויתר, והנתון נשאר שגוי.
//
// ⚠️ מה **לא** כאן בכוונה: הרשאות, נקודת חלוקה, מחיקה. אלה
// החלטות של המנהל, ופתיחתן לנציג הייתה מייצרת נזק שקשה לאתר.

import { useState } from "react";

type Props = {
  customerId: string;
  name: string;
  /** §184: הפיצול. null אצל לקוחות ותיקים שטרם הושלמו. */
  firstName?: string | null;
  lastName?: string | null;
  phone: string | null;
  phone2: string | null;
  paymentPreference: string;
  hasCard: boolean;
  /** §155: האם הנציג רשאי לסמן לקוחות כמזומן */
  canSetCash: boolean;
  onSaved?: () => void;
};

export function QuickCustomerEdit({
  customerId,
  name,
  firstName,
  lastName,
  phone,
  phone2,
  paymentPreference,
  hasCard,
  canSetCash,
  onSaved,
}: Props) {
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({
    // §184: שני שדות ולא אחד.
    //
    // 🐛 מה שהיה: שדה "שם" יחיד. המנהל תיקן שם, וזה דרס את
    // הפיצול - firstName ו-lastName נשארו כפי שהיו, ומאותו רגע
    // השם המלא לא תאם לחלקים שלו.
    //
    // ⚠️ ללקוח ותיק בלי פיצול - השדה הראשון מקבל את השם המלא,
    // והמנהל משלים. אותה התנהגות כמו במסך השלמת השמות.
    firstName: firstName ?? name,
    lastName: lastName ?? "",
    phone: phone ?? "",
    phone2: phone2 ?? "",
    paymentPreference,
  });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");

  async function save() {
    setErr("");
    setMsg("");
    if (f.firstName.trim().length < 2) {
      setErr("יש להזין שם פרטי");
      return;
    }
    if (f.lastName.trim().length < 2) {
      setErr("יש להזין שם משפחה");
      return;
    }
    setSaving(true);
    try {
      const payload: any = {};
      // §184: מעדכן את שלושת השדות יחד - השם המלא נגזר מהחלקים,
      // ולכן הם לעולם לא יוצאים מסנכרון.
      const fn = f.firstName.trim();
      const ln = f.lastName.trim();
      if (fn !== (firstName ?? "") || ln !== (lastName ?? "")) {
        payload.firstName = fn;
        payload.lastName = ln;
        payload.name = `${fn} ${ln}`;
      }
      if (f.phone.trim() !== (phone ?? "")) payload.phone = f.phone.trim();
      if (f.phone2.trim() !== (phone2 ?? "")) payload.phone2 = f.phone2.trim() || null;
      if (f.paymentPreference !== paymentPreference) {
        payload.paymentPreference = f.paymentPreference;
      }

      if (Object.keys(payload).length === 0) {
        setMsg("לא בוצעו שינויים");
        setOpen(false);
        return;
      }

      const res = await fetch(`/api/admin/customers/${customerId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "שגיאה");
      setMsg("הפרטים עודכנו");
      setOpen(false);
      onSaved?.();
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setSaving(false);
    }
  }

  if (!open) {
    return (
      <div>
        <button
          onClick={() => setOpen(true)}
          className="text-[11px] font-bold text-brand-rust hover:underline"
        >
          ✏️ עריכת פרטי הלקוח
        </button>
        {msg && (
          <span className="text-[11px] text-emerald-700 mr-2">✓ {msg}</span>
        )}
      </div>
    );
  }

  return (
    <div className="bg-white border-2 border-brand-rust/30 rounded-xl p-3 space-y-2">
      <div className="flex items-center justify-between">
        <span className="font-bold text-brand-slatedark text-sm">
          ✏️ עריכת פרטי הלקוח
        </span>
        <button
          onClick={() => setOpen(false)}
          className="text-zinc-400 text-xl leading-none px-1"
        >
          ×
        </button>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="text-[11px] font-bold text-zinc-500 block mb-0.5">
            שם פרטי *
          </label>
          <input
            className="input py-1.5 text-sm w-full"
            value={f.firstName}
            onChange={(e) => setF({ ...f, firstName: e.target.value })}
            placeholder="יוסי"
          />
        </div>
        <div>
          <label className="text-[11px] font-bold text-zinc-500 block mb-0.5">
            שם משפחה *
          </label>
          <input
            className="input py-1.5 text-sm w-full"
            value={f.lastName}
            onChange={(e) => setF({ ...f, lastName: e.target.value })}
            placeholder="כהן"
          />
        </div>
      </div>
      {/* ⚠️ ללקוח ותיק בלי פיצול - הסבר למה השדה השני ריק */}
      {!lastName && (
        <p className="text-[10px] text-amber-800 bg-amber-50 border border-amber-200 rounded p-1.5 -mt-1">
          ללקוח זה אין עדיין פיצול שם. יש לוודא שהשם הפרטי בשדה הראשון
          ולהשלים את שם המשפחה.
        </p>
      )}

      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="text-[11px] font-bold text-zinc-500 block mb-0.5">
            טלפון
          </label>
          <input
            className="input py-1.5 text-sm w-full"
            dir="ltr"
            value={f.phone}
            onChange={(e) => setF({ ...f, phone: e.target.value })}
          />
        </div>
        <div>
          <label className="text-[11px] font-bold text-zinc-500 block mb-0.5">
            טלפון נוסף
          </label>
          <input
            className="input py-1.5 text-sm w-full"
            dir="ltr"
            value={f.phone2}
            onChange={(e) => setF({ ...f, phone2: e.target.value })}
          />
        </div>
      </div>

      {/* §155: אופן תשלום - רק עם הרשאה, ורק לכיוון מזומן.
          
          ⚠️ מעבר לאשראי דורש כרטיס קיים ונשאר אצל המנהל: לקוח
          שיסומן כאשראי בלי כרטיס ייחסם מהזמנה, והנציג לא יידע
          שהוא גרם לזה. */}
      <div>
        <label className="text-[11px] font-bold text-zinc-500 block mb-0.5">
          אופן תשלום
        </label>
        {paymentPreference === "CASH" ? (
          <div className="text-xs bg-lime-50 border border-lime-300 rounded-lg px-2.5 py-2 text-lime-800">
            💵 <b>מזומן</b> — גבייה בחלוקה. מעבר לאשראי נעשה ע&quot;י המנהל.
          </div>
        ) : canSetCash ? (
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setF({ ...f, paymentPreference: "CREDIT" })}
              className={`py-2 rounded-lg border-2 text-xs font-bold ${
                f.paymentPreference === "CREDIT"
                  ? "border-blue-600 bg-blue-50 text-blue-800"
                  : "border-zinc-300 text-zinc-600"
              }`}
            >
              💳 אשראי {hasCard && "✓"}
            </button>
            <button
              type="button"
              onClick={() => setF({ ...f, paymentPreference: "CASH" })}
              className={`py-2 rounded-lg border-2 text-xs font-bold ${
                f.paymentPreference === "CASH"
                  ? "border-lime-600 bg-lime-50 text-lime-800"
                  : "border-zinc-300 text-zinc-600"
              }`}
            >
              💵 מזומן
            </button>
          </div>
        ) : (
          <div className="text-xs bg-zinc-50 border border-zinc-200 rounded-lg px-2.5 py-2 text-zinc-600">
            💳 אשראי{hasCard ? " · כרטיס שמור" : " · אין כרטיס"}
            <span className="block text-[10px] text-zinc-500 mt-0.5">
              אין לך הרשאה לשנות לאופן תשלום מזומן. פנה למנהל.
            </span>
          </div>
        )}
        {f.paymentPreference === "CASH" && paymentPreference !== "CASH" && (
          <p className="text-[10px] text-lime-700 mt-1 leading-relaxed">
            ⚠️ הלקוח יסומן כמשלם מזומן ויוכל להזמין בלי כרטיס. הגבייה תתבצע
            על ידך בחלוקה.
          </p>
        )}
      </div>

      {err && <p className="text-xs text-red-600">{err}</p>}

      <div className="flex gap-2">
        <button
          onClick={() => setOpen(false)}
          disabled={saving}
          className="flex-1 py-2 rounded-lg border border-zinc-300 text-xs font-bold"
        >
          ביטול
        </button>
        <button
          onClick={save}
          disabled={saving}
          className="flex-[2] py-2 rounded-lg bg-brand-rust text-white text-xs font-bold disabled:opacity-50"
        >
          {saving ? "שומר…" : "שמירה"}
        </button>
      </div>
    </div>
  );
}
