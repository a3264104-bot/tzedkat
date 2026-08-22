"use client";

// §54: הוספת לקוח על ידי המנהל.
//
// מקביל ל-AgentAddCustomerButton, עם הבדל מהותי אחד: לנציג יש נקודת
// חלוקה משלו והלקוח משויך אליה אוטומטית. למנהל אין נקודה - הוא חייב
// לבחור אחת במפורש, אחרת הלקוח נשאר בלי נקודה ולא יוכל להזמין.
//
// הזרימה: טלפון (חיפוש אוטומטי) -> אם קיים מציגים, אם לא -> שם,
// מייל ונקודה -> יצירה, והסיסמה מוצגת למסירה ללקוח.

import { useEffect, useRef, useState } from "react";
// §171: הזנת כרטיס מיד אחרי היצירה - כמו אצל הנציג
import { UpdateCardModal } from "@/components/UpdateCardButton";

type Existing = {
  id: string;
  name: string;
  phone: string;
  email: string | null;
  role: string;
  isActive: boolean;
  hasCard: boolean;
  cardLast4: string | null;
  pointName: string | null;
  orderCount: number;
};

type Point = { id: string; name: string; city: string | null };

export function AdminAddCustomerButton({
  points,
  onCreated,
  className = "",
  initialPhone,
  label,
}: {
  points: Point[];
  onCreated?: () => void;
  className?: string;
  /**
   * §164: טלפון שממלא מראש.
   *
   * כשפותחים את הטופס מתוך הודעה טלפונית, המספר כבר ידוע -
   * והקלדה מחדש היא גם עבודה מיותרת וגם מקור לטעויות.
   */
  initialPhone?: string;
  /** טקסט חלופי לכפתור, למשל "➕ הקם לקוח" בהקשר ההודעות */
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className={`inline-flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white rounded-lg font-bold text-sm hover:bg-emerald-700 transition-colors ${className}`}
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z"
          />
        </svg>
        {label ?? "לקוח חדש"}
      </button>
      {open && (
        <Modal
          points={points}
          initialPhone={initialPhone}
          onClose={() => setOpen(false)}
          onCreated={() => {
            setOpen(false);
            onCreated?.();
          }}
        />
      )}
    </>
  );
}

function Modal({
  points,
  onClose,
  onCreated,
  initialPhone,
}: {
  points: Point[];
  onClose: () => void;
  onCreated: () => void;
  initialPhone?: string;
}) {
  // §164: מתחילים עם הטלפון שכבר ידוע. ה-useEffect של החיפוש
  // ירוץ מיד ויבדוק אם הלקוח קיים - בדיוק כמו הקלדה ידנית.
  const [phone, setPhone] = useState(initialPhone ?? "");
  const [searching, setSearching] = useState(false);
  const [existing, setExisting] = useState<Existing | null>(null);
  const [searched, setSearched] = useState(false);
  const [name, setName] = useState("");
  // §173: שם פרטי ומשפחה - אופציונלי, להשלמת הפיצול
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  // §161: טלפון נוסף - לזיהוי במערכת הטלפונית ולחלוקה
  const [phone2, setPhone2] = useState("");
  const [pointId, setPointId] = useState("");
  // §171: אופן תשלום. אשראי -> נפתח מסך הכרטיס מיד אחרי היצירה.
  //
  // 🐛 מה שהיה: המנהל הקים לקוח, ראה את הסיסמה, ולחץ "סיום" -
  // ואז נאלץ לחפש אותו ברשימה ולפתוח את הכרטיס כדי להזין אשראי.
  // אצל הנציג (§60) זה עבד מזמן; מסך המנהל פשוט לא קיבל את זה.
  const [payMethod, setPayMethod] = useState<"" | "CASH" | "CREDIT">("");
  // הלקוח שנוצר וממתין להזנת כרטיס
  const [cardForCustomerId, setCardForCustomerId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState<{
    name: string;
    phone: string;
    password: string;
    pointName: string;
  } | null>(null);
  const timer = useRef<any>(null);
  // §171: מזהה הלקוח שנוצר - כדי לפתוח את מסך הכרטיס גם אחרי
  // שהמנהל סגר אותו, בלי לחפש אותו מחדש.
  const createdIdRef = useRef<string | null>(null);

  // חיפוש אוטומטי - מונע יצירת כפילויות לפני שהמנהל מקליד שם
  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    const digits = phone.replace(/\D/g, "");
    if (digits.length < 9) {
      setExisting(null);
      setSearched(false);
      return;
    }
    timer.current = setTimeout(async () => {
      setSearching(true);
      setError("");
      try {
        const res = await fetch(
          `/api/admin/customer-create?phone=${encodeURIComponent(phone.trim())}`
        );
        const j = await res.json();
        setExisting(j.found ? j.customer : null);
        setSearched(true);
      } catch (e: any) {
        setError("שגיאה בחיפוש: " + e.message);
      } finally {
        setSearching(false);
      }
    }, 500);
    return () => clearTimeout(timer.current);
  }, [phone]);

  async function create() {
    // §184: שני שדות, שניהם חובה.
    //
    // 🐛 מה שהיה: שלושה שדות - פרטי (מומלץ), משפחה (מומלץ),
    // ושם מלא (חובה). המנהל לא הבין למה הוא ממלא את השם פעמיים,
    // ובפועל מילא רק את המלא - וזה החזיר בדיוק את הבעיה שהפיצול
    // בא לפתור.
    if (firstName.trim().length < 2) {
      setError("יש להזין שם פרטי");
      return;
    }
    if (lastName.trim().length < 2) {
      setError("יש להזין שם משפחה");
      return;
    }
    if (!pointId) {
      setError("יש לבחור נקודת חלוקה");
      return;
    }
    // §171: בחירה מפורשת, בלי ברירת מחדל שקטה. לקוח שנוצר
    // כאשראי בטעות ייחסם מהזמנה עד שיוזן כרטיס.
    if (!payMethod) {
      setError("יש לבחור איך הלקוח משלם - מזומן או אשראי");
      return;
    }
    setCreating(true);
    setError("");
    try {
      const res = await fetch("/api/admin/customer-create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          // §184: השם המלא נגזר משני החלקים - מקור אמת אחד.
          name: `${firstName.trim()} ${lastName.trim()}`,
          firstName: firstName.trim(),
          lastName: lastName.trim(),
          phone: phone.trim(),
          email: email.trim() || null,
          // §161: טלפון נוסף
          phone2: phone2.trim() || null,
          // §171: אופן התשלום שנבחר
          paymentPreference: payMethod || "CREDIT",
          defaultPointId: pointId,
        }),
      });
      const j = await res.json();
      if (!res.ok) {
        // §162: המספר הנוסף כבר משמש לזיהוי של לקוח אחר.
        // ההודעה מהשרת אומרת מי מחזיק בו, ולכן מוצגת כמו שהיא.
        setError(j.error || "שגיאה");
        return;
      }
      setDone({
        name: j.customer.name,
        phone: j.customer.phone,
        password: j.password,
        pointName: j.pointName,
      });

      createdIdRef.current = j.customer.id;

      // §171: אשראי -> פותחים מיד את מסך הכרטיס.
      //
      // ⚠️ אחרי setDone ולא במקומו: אם המנהל יסגור את מסך הכרטיס
      // בלי להזין, הוא עדיין יראה את פרטי ההתחברות למסירה.
      if (payMethod === "CREDIT") {
        setCardForCustomerId(j.customer.id);
      }
    } catch (e: any) {
      setError("שגיאה: " + e.message);
    } finally {
      setCreating(false);
    }
  }

  const canCreate =
    searched && !existing && phone.replace(/\D/g, "").length >= 9;

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="bg-white w-full max-w-md sm:rounded-2xl rounded-t-2xl max-h-[95vh] overflow-y-auto shadow-2xl">
        <div className="sticky top-0 bg-white border-b border-zinc-200 px-5 py-3 flex items-center justify-between z-10">
          <h3 className="font-extrabold text-brand-slatedark text-lg">לקוח חדש</h3>
          <button
            onClick={onClose}
            className="text-zinc-400 hover:text-zinc-600 text-2xl leading-none px-2"
          >
            ×
          </button>
        </div>

        {done ? (
          // ─── פרטי ההתחברות ───
          // מוצגים פעם אחת, כדי שהמנהל ימסור ללקוח בטלפון
          <div className="p-5 space-y-4">
            <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4">
              <p className="font-bold text-emerald-800">{done.name} נוצר ✓</p>
              <p className="text-sm text-emerald-700 mt-1">
                📍 שויך לנקודה: {done.pointName}
              </p>
            </div>
            <div className="border border-zinc-200 rounded-xl divide-y divide-zinc-100">
              <div className="flex items-center justify-between p-3">
                <span className="text-sm text-zinc-500">שם משתמש (טלפון)</span>
                <span className="font-mono font-bold" dir="ltr">
                  {done.phone}
                </span>
              </div>
              <div className="flex items-center justify-between p-3">
                <span className="text-sm text-zinc-500">סיסמה</span>
                <span className="font-mono font-bold text-lg text-brand-rust" dir="ltr">
                  {done.password}
                </span>
              </div>
            </div>
            <button
              onClick={() => {
                navigator.clipboard
                  ?.writeText(
                    `כניסה למערכת צדקת רבותינו\nטלפון: ${done.phone}\nסיסמה: ${done.password}`
                  )
                  .then(() => alert("הפרטים הועתקו"))
                  .catch(() => alert("ההעתקה נכשלה"));
              }}
              className="w-full py-2.5 rounded-lg border border-zinc-300 text-sm font-bold hover:bg-zinc-50"
            >
              העתק פרטי התחברות
            </button>
            {/* §171: הזנת כרטיס גם ממסך ההצלחה.
                
                ⚠️ למי שבחר מזומן ובכל זאת רוצה להוסיף כרטיס, או
                למי שסגר את מסך הכרטיס בטעות. בלי זה הוא היה
                צריך לחפש את הלקוח מחדש. */}
            {!cardForCustomerId && (
              <button
                onClick={() => {
                  const id = createdIdRef.current;
                  if (id) setCardForCustomerId(id);
                }}
                className="w-full py-2.5 rounded-lg border-2 border-emerald-500 text-emerald-800 font-bold text-sm hover:bg-emerald-50"
              >
                💳 הזנת כרטיס אשראי
              </button>
            )}
            <button
              onClick={onCreated}
              className="w-full py-3 rounded-xl bg-brand-rust text-white font-bold"
            >
              סיום
            </button>
          </div>
        ) : (
          <div className="p-5 space-y-4">
            {/* טלפון */}
            <div>
              <label className="text-xs font-bold text-zinc-500 block mb-1">טלפון *</label>
              <div className="relative">
                <input
                  type="tel"
                  inputMode="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="0501234567"
                  dir="ltr"
                  autoFocus
                  className="w-full px-3 py-3 border-2 border-zinc-300 rounded-lg text-base font-mono focus:outline-none focus:border-brand-rust"
                />
                {searching && (
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs">⏳</span>
                )}
              </div>
              <p className="text-[10px] text-zinc-500 mt-1">
                המערכת תבדוק אוטומטית אם הלקוח כבר קיים
              </p>
            </div>

            {/* לקוח קיים */}
            {existing && (
              <div className="bg-blue-50 border-2 border-blue-300 rounded-xl p-4">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-bold text-brand-slatedark">{existing.name}</span>
                  {!existing.isActive && (
                    <span className="text-[10px] bg-zinc-200 text-zinc-600 px-2 py-0.5 rounded-full font-bold">
                      לא פעיל
                    </span>
                  )}
                  {existing.role !== "CUSTOMER" && (
                    <span className="text-[10px] bg-purple-100 text-purple-700 px-2 py-0.5 rounded-full font-bold">
                      {existing.role === "AGENT" ? "נציג" : "מנהל"}
                    </span>
                  )}
                  {existing.hasCard && (
                    <span className="text-[10px] bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full font-bold">
                      💳 כרטיס שמור
                    </span>
                  )}
                </div>
                <div className="text-xs text-zinc-600 mt-1">
                  {existing.pointName && <div>📍 {existing.pointName}</div>}
                  <div>{existing.orderCount} הזמנות במערכת</div>
                </div>
                <p className="text-xs text-blue-800 mt-2">
                  הלקוח כבר קיים — אין צורך ליצור אותו שוב.
                </p>
              </div>
            )}

            {/* שדות ליצירה */}
            {canCreate && (
              <>
                <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-2.5 text-xs text-emerald-800">
                  ✨ לקוח חדש — הזן פרטים
                </div>


                {/* §173: שם פרטי ומשפחה - **אופציונלי כאן**.
                    
                    ⚠️ בניגוד להרשמה באתר, כאן זה לא חובה: הנציג
                    מקים לקוח תוך כדי שיחה או בחלוקה, ודרישה לשני
                    שדות הייתה מאטה אותו ברגע הלא נכון.
                    
                    ⚠️ מי שמילא רק את השם המלא - הלקוח יופיע במסך
                    "השלמת שמות" ויטופל שם בהמשך. */}
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-xs font-bold text-zinc-500 block mb-1">
                      שם פרטי *
                    </label>
                    <input
                      type="text"
                      value={firstName}
                      onChange={(e) => setFirstName(e.target.value)}
                      placeholder="יוסי"
                      className="w-full px-3 py-2.5 border-2 border-zinc-300 rounded-lg text-sm focus:outline-none focus:border-brand-rust"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-bold text-zinc-500 block mb-1">
                      שם משפחה *
                    </label>
                    <input
                      type="text"
                      value={lastName}
                      onChange={(e) => setLastName(e.target.value)}
                      placeholder="כהן"
                      className="w-full px-3 py-2.5 border-2 border-zinc-300 rounded-lg text-sm focus:outline-none focus:border-brand-rust"
                    />
                  </div>
                </div>

                {/* §54: נקודת חלוקה חובה. לנציג היא נקבעת אוטומטית לפי
                    הנקודה שלו, אבל למנהל אין נקודה - וללא בחירה מפורשת
                    הלקוח לא יוכל להזמין. */}
                <div>
                  <label className="text-xs font-bold text-zinc-500 block mb-1">
                    נקודת חלוקה *
                  </label>
                  <select
                    value={pointId}
                    onChange={(e) => setPointId(e.target.value)}
                    className="w-full px-3 py-3 border-2 border-amber-400 bg-amber-50 rounded-lg text-base font-medium focus:outline-none"
                  >
                    <option value="">— בחר נקודה —</option>
                    {points.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                        {p.city ? ` — ${p.city}` : ""}
                      </option>
                    ))}
                  </select>
                  <p className="text-[10px] text-zinc-500 mt-1">
                    בלי נקודה הלקוח לא יוכל לבצע הזמנה.
                  </p>
                </div>

                <div>
                  <label className="text-xs font-bold text-zinc-500 block mb-1">
                    מייל <span className="font-normal text-zinc-400">(אופציונלי)</span>
                  </label>
                  <input
                    type="email"
                    inputMode="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="user@example.com"
                    dir="ltr"
                    className="w-full px-3 py-3 border-2 border-zinc-300 rounded-lg text-sm focus:outline-none focus:border-brand-rust"
                  />
                  <p className="text-[10px] text-zinc-500 mt-1">
                    עם מייל הלקוח יקבל אישורי הזמנה ויוכל לאפס סיסמה בעצמו.
                  </p>
                </div>

                {/* §161: טלפון נוסף.

                    ⚠️ אינו רק ליצירת קשר - הוא משמש **גם לזיהוי
                    במערכת הטלפונית**. הלקוח יוכל להתקשר משני
                    המספרים ולשמוע את ההזמנה שלו.

                    ⚠️ §162 חוסם מספר שכבר משמש לזיהוי של לקוח אחר.
                    בלי זה **שניהם** היו מפסיקים להיות מזוהים. */}
                <div>
                  <label className="text-xs font-bold text-zinc-500 block mb-1">
                    טלפון נוסף{" "}
                    <span className="font-normal text-zinc-400">(אופציונלי)</span>
                  </label>
                  <input
                    type="tel"
                    inputMode="tel"
                    value={phone2}
                    onChange={(e) => setPhone2(e.target.value)}
                    placeholder="050-1234567"
                    dir="ltr"
                    className="w-full px-3 py-3 border-2 border-zinc-300 rounded-lg text-sm focus:outline-none focus:border-brand-rust"
                  />
                  <p className="text-[10px] text-zinc-500 mt-1">
                    למשל הנייד של בן/בת הזוג. ניתן יהיה להתקשר גם ממנו
                    למערכת הטלפונית ולשמוע את ההזמנה.
                  </p>
                </div>

                {/* §171: אופן תשלום - חובה, בלי ברירת מחדל.
                    
                    ⚠️ אשראי פותח את מסך הכרטיס **מיד אחרי היצירה**.
                    קודם המנהל היה צריך לשמור, לחפש את הלקוח ברשימה,
                    ולפתוח את הכרטיס - שלושה מסכים במקום אחד. */}
                <div>
                  <label className="text-xs font-bold text-zinc-500 block mb-1">
                    איך הלקוח משלם? *
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setPayMethod("CASH")}
                      className={`py-3 px-2 rounded-xl border-2 font-bold text-sm transition-colors ${
                        payMethod === "CASH"
                          ? "border-lime-600 bg-lime-50 text-lime-800"
                          : "border-zinc-300 bg-white text-zinc-600 hover:border-zinc-400"
                      }`}
                    >
                      💵 מזומן
                      <div className="text-[10px] font-normal mt-0.5">
                        גבייה בחלוקה, בלי כרטיס
                      </div>
                    </button>
                    <button
                      type="button"
                      onClick={() => setPayMethod("CREDIT")}
                      className={`py-3 px-2 rounded-xl border-2 font-bold text-sm transition-colors ${
                        payMethod === "CREDIT"
                          ? "border-blue-600 bg-blue-50 text-blue-800"
                          : "border-zinc-300 bg-white text-zinc-600 hover:border-zinc-400"
                      }`}
                    >
                      💳 אשראי
                      <div className="text-[10px] font-normal mt-0.5">
                        הזנת כרטיס מיד אחרי היצירה
                      </div>
                    </button>
                  </div>
                  {payMethod === "CREDIT" && (
                    <p className="text-[10px] text-blue-700 mt-1 leading-relaxed">
                      אחרי היצירה ייפתח מסך הכרטיס. יחויב 1 ש&quot;ח לאימות,
                      שיקוזז מההזמנה הראשונה.
                    </p>
                  )}
                  {payMethod === "CASH" && (
                    <p className="text-[10px] text-lime-700 mt-1 leading-relaxed">
                      הלקוח יסומן כמשלם מזומן ויוכל להזמין בלי כרטיס. ניתן
                      להעביר לאשראי בהמשך.
                    </p>
                  )}
                </div>
              </>
            )}

            {error && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-2.5 text-xs text-red-800">
                {error}
              </div>
            )}
          </div>
        )}

        {/* §171: מסך הזנת הכרטיס - טופס נדרים המאובטח.
            
            ⚠️ onClose ו-onSuccess שניהם רק סוגרים: הלקוח כבר נוצר,
            והמנהל נשאר במסך ההצלחה עם פרטי ההתחברות. ויתור על
            הכרטיס אינו מבטל את היצירה. */}
        {cardForCustomerId && (
          <UpdateCardModal
            customerId={cardForCustomerId}
            hasCurrentCard={false}
            onSuccess={() => setCardForCustomerId(null)}
            onClose={() => setCardForCustomerId(null)}
          />
        )}

        {!done && (
          <div className="sticky bottom-0 bg-white border-t border-zinc-200 p-4 flex gap-2">
            <button
              onClick={onClose}
              disabled={creating}
              className="flex-1 py-3 rounded-xl border border-zinc-300 font-bold hover:bg-zinc-50"
            >
              ביטול
            </button>
            {canCreate && (
              <button
                onClick={create}
                disabled={creating || !firstName.trim() || !lastName.trim() || !pointId}
                className="flex-1 py-3 rounded-xl bg-emerald-600 text-white font-bold hover:bg-emerald-700 disabled:opacity-50"
              >
                {creating ? "יוצר..." : "צור לקוח"}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
