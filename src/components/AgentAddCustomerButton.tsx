"use client";

// כפתור "לקוח חדש" למסך הנציג + Modal מלא
//
// §55: שדרוג החיפוש.
//   - חיפוש לפי טלפון *או* לפי שם. הנציג בשטח לא תמיד יודע את המספר,
//     והוא היה נאלץ לוותר או ליצור לקוח כפול.
//   - לקוח ששייך לנקודה אחרת מוצג *חסום* עם שם הנציג האחראי, במקום
//     להיעלם. אם הוא נעלם, הנציג חושב שהוא לא קיים ויוצר אותו מחדש -
//     וזו כפילות שמפצלת היסטוריה והזמנות.
//   - לקוח לא פעיל מסומן ונחסם.
//
// הזרימה: חיפוש -> תוצאה מותרת: "פתח הזמנה" / תוצאה חסומה: הסבר /
// לא נמצא: יצירה.

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

type Hit = {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  isActivated: boolean;
  isActive: boolean;
  hasCard: boolean;
  cardLast4: string | null;
  pointId: string | null;
  pointName: string | null;
  orderCount: number;
  allowed: boolean;
  blockedReason: string | null;
};

type SystemUser = {
  systemRole: string;
  customerName: string;
};

export function AgentAddCustomerButton({ className = "" }: { className?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className={`inline-flex items-center gap-2 px-4 py-2.5 bg-emerald-600 text-white rounded-xl font-bold text-sm shadow-sm hover:bg-emerald-700 transition-colors ${className}`}
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z"
          />
        </svg>
        חיפוש / לקוח חדש
      </button>
      {open && <AddCustomerModal onClose={() => setOpen(false)} />}
    </>
  );
}

function AddCustomerModal({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<Hit[]>([]);
  const [searchType, setSearchType] = useState<"phone" | "name" | null>(null);
  const [systemUser, setSystemUser] = useState<SystemUser | null>(null);
  const [searched, setSearched] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");
  // §55: בורר נקודה לנציג רב-נקודתי.
  // נציג עם נקודה אחת משויך אוטומטית ולא נשאל. עם כמה נקודות -
  // השרת מחזיר needsPoint עם הרשימה, ואז מוצג בורר.
  // defaultPointId קובע איפה הלקוח מקבל את הסחורה, ולכן זו לא
  // בחירה שאפשר לנחש.
  const [pointOptions, setPointOptions] = useState<
    { id: string; name: string; city: string | null }[] | null
  >(null);
  const [pointId, setPointId] = useState("");
  const timerRef = useRef<any>(null);

  // חיפוש אוטומטי עם debounce
  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    const term = q.trim();
    if (term.length < 2) {
      setResults([]);
      setSystemUser(null);
      setSearched(false);
      setSearchType(null);
      return;
    }
    timerRef.current = setTimeout(async () => {
      setSearching(true);
      setError("");
      try {
        const res = await fetch(
          `/api/agent/customer-search?q=${encodeURIComponent(term)}`
        );
        const json = await res.json();
        if (res.ok) {
          setResults(json.results || []);
          setSearchType(json.searchType || null);
          setSystemUser(
            json.isSystemUser
              ? { systemRole: json.systemRole, customerName: json.customerName }
              : null
          );
          setSearched(true);
        }
      } catch (e: any) {
        setError("שגיאה בחיפוש: " + e.message);
      } finally {
        setSearching(false);
      }
    }, 500);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [q]);

  async function createAndOpen() {
    if (!name.trim() || name.trim().length < 2) {
      setError("שם קצר מדי");
      return;
    }
    if (pointOptions && pointOptions.length > 0 && !pointId) {
      setError("יש לבחור נקודת חלוקה");
      return;
    }
    setCreating(true);
    setError("");
    try {
      const res = await fetch("/api/agent/customer-create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          phone: q.trim(),
          email: email.trim() || null,
          defaultPointId: pointId || null,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        // §55: השרת מבקש לבחור נקודה. לא שולחים שוב אוטומטית -
        // הנציג צריך לבחור במודע, כי זה קובע איפה הלקוח מקבל.
        if (json.needsPoint && Array.isArray(json.points)) {
          setPointOptions(json.points);
          setError("יש לבחור לאיזו נקודת חלוקה לשייך את הלקוח");
          return;
        }
        if (json.code === "DUPLICATE_PHONE" && json.existing) {
          setError(
            `לקוח בשם "${json.existing.name}" כבר קיים עם טלפון זה. חפש אותו למעלה.`
          );
        } else if (json.code === "DUPLICATE_EMAIL") {
          setError(`המייל כבר בשימוש ע"י לקוח אחר.`);
        } else {
          setError(json.error || "שגיאה");
        }
        return;
      }
      router.push(`/agent/order/${json.customer.id}`);
      onClose();
    } catch (e: any) {
      setError("שגיאה: " + e.message);
    } finally {
      setCreating(false);
    }
  }

  // יצירה אפשרית רק בחיפוש טלפון - בחיפוש שם אין מספר ליצור איתו
  const isPhoneSearch = searchType === "phone";
  const canCreate =
    searched &&
    isPhoneSearch &&
    results.length === 0 &&
    !systemUser &&
    q.replace(/\D/g, "").length >= 9;

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="bg-white w-full max-w-md sm:rounded-2xl rounded-t-2xl max-h-[95vh] overflow-y-auto shadow-2xl">
        <div className="sticky top-0 bg-white border-b border-zinc-200 px-5 py-3 flex items-center justify-between z-10">
          <h3 className="font-extrabold text-brand-slatedark text-lg">חיפוש לקוח</h3>
          <button
            onClick={onClose}
            className="text-zinc-400 hover:text-zinc-600 text-2xl leading-none px-2"
          >
            ×
          </button>
        </div>

        <div className="p-5 space-y-4">
          {/* §55: שדה אחד שמזהה לבד מה הוזן - ספרות=טלפון,
              אותיות=שם. בלי שני שדות ובלי בורר שצריך להבין. */}
          <div>
            <label className="text-xs font-bold text-zinc-500 block mb-1">
              טלפון או שם *
            </label>
            <div className="relative">
              <input
                type="text"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="0501234567 או שם הלקוח"
                autoFocus
                className="w-full px-3 py-3 border-2 border-zinc-300 rounded-lg text-base focus:outline-none focus:border-brand-rust"
              />
              {searching && (
                <div className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-zinc-500">
                  <span className="inline-block animate-spin">⏳</span>
                </div>
              )}
            </div>
            <p className="text-[10px] text-zinc-500 mt-1">
              {searchType === "name"
                ? "מחפש לפי שם — להוספת לקוח חדש יש להזין מספר טלפון"
                : "המערכת מזהה לבד אם הזנת טלפון או שם"}
            </p>
          </div>

          {/* טלפון של נציג/מנהל - חסום ליצירה */}
          {systemUser && (
            <div className="bg-red-50 border-2 border-red-300 rounded-xl p-4">
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-full bg-red-500 flex items-center justify-center text-white text-xl shrink-0">
                  🚫
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-bold text-red-900">
                    זהו טלפון של {systemUser.systemRole === "AGENT" ? "נציג" : "מנהל"}
                  </div>
                  <div className="text-sm text-red-800 mt-1">
                    <strong>{systemUser.customerName}</strong> רשום כ-
                    {systemUser.systemRole === "AGENT" ? "נציג" : "מנהל"} במערכת.
                  </div>
                  <div className="text-xs text-red-700 mt-2">
                    לא ניתן ליצור לקוח עם טלפון של אנשי צוות. אם רוצים להזמין
                    עבורם, צריך להשתמש בטלפון אחר או לפנות למנהל.
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* תוצאות */}
          {results.length > 0 && (
            <div className="space-y-2">
              {results.length > 1 && (
                <p className="text-xs text-zinc-500">
                  {results.length} תוצאות — בחר את הלקוח הנכון לפי הטלפון והנקודה
                </p>
              )}
              {results.map((c) => (
                <ResultCard
                  key={c.id}
                  hit={c}
                  onOpen={() => {
                    router.push(`/agent/order/${c.id}`);
                    onClose();
                  }}
                />
              ))}
            </div>
          )}

          {/* לא נמצא בחיפוש שם */}
          {searched && results.length === 0 && !systemUser && searchType === "name" && (
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm text-amber-900">
              לא נמצא לקוח בשם הזה בנקודות שלך.
              <br />
              <span className="text-xs">
                להוספת לקוח חדש — הזן את מספר הטלפון שלו בשדה למעלה.
              </span>
            </div>
          )}

          {/* לא נמצא בחיפוש טלפון - שדות ליצירה */}
          {canCreate && (
            <>
              <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-2.5 text-xs text-emerald-800">
                ✨ לקוח חדש — הזן את הפרטים כדי ליצור אותו
              </div>

              <div>
                <label className="text-xs font-bold text-zinc-500 block mb-1">שם *</label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="שם מלא של הלקוח"
                  className="w-full px-3 py-3 border-2 border-zinc-300 rounded-lg text-base focus:outline-none focus:border-brand-rust"
                />
              </div>

              {/* §55: בורר נקודה - מוצג רק כשהשרת ביקש */}
              {pointOptions && pointOptions.length > 0 && (
                <div>
                  <label className="text-xs font-bold text-zinc-500 block mb-1">
                    נקודת חלוקה *{" "}
                    <span className="font-normal text-zinc-400">
                      — לאיזו נקודה לשייך את הלקוח
                    </span>
                  </label>
                  <select
                    value={pointId}
                    onChange={(e) => setPointId(e.target.value)}
                    className="w-full px-3 py-3 border-2 border-amber-400 bg-amber-50 rounded-lg text-base font-medium focus:outline-none"
                  >
                    <option value="">— בחר נקודה —</option>
                    {pointOptions.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                        {p.city ? ` — ${p.city}` : ""}
                      </option>
                    ))}
                  </select>
                  <p className="text-[10px] text-zinc-500 mt-1">
                    כאן הלקוח יקבל את ההזמנות שלו.
                  </p>
                </div>
              )}

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
                  💡 עם מייל הלקוח יקבל אישורי הזמנה ויוכל לאפס סיסמה בעצמו
                </p>
              </div>
            </>
          )}

          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-2.5 text-xs text-red-800">
              {error}
            </div>
          )}
        </div>

        <div className="sticky bottom-0 bg-white border-t border-zinc-200 p-4 flex gap-2">
          <button
            onClick={onClose}
            disabled={creating}
            className="flex-1 py-3 rounded-xl border border-zinc-300 text-brand-slatedark font-bold hover:bg-zinc-50"
          >
            סגור
          </button>
          {canCreate && (
            <button
              onClick={createAndOpen}
              disabled={creating || !name.trim()}
              className="flex-1 py-3 rounded-xl bg-emerald-600 text-white font-bold hover:bg-emerald-700 disabled:opacity-50 shadow-md"
            >
              {creating ? "יוצר..." : "צור לקוח + הזמנה ←"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// §55: כרטיס תוצאה. לקוח חסום מוצג באפור עם ההסבר, ולא נעלם -
// כדי שהנציג לא יחשוב שהוא לא קיים ויצור אותו מחדש.
function ResultCard({ hit, onOpen }: { hit: Hit; onOpen: () => void }) {
  if (!hit.allowed) {
    return (
      <div className="bg-zinc-50 border-2 border-zinc-300 rounded-xl p-4">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-full bg-zinc-300 flex items-center justify-center text-zinc-600 font-bold shrink-0">
            {hit.name.charAt(0)}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-bold text-zinc-700">{hit.name}</span>
              {!hit.isActive && (
                <span className="text-[10px] bg-zinc-200 text-zinc-600 px-2 py-0.5 rounded-full font-bold">
                  לא פעיל
                </span>
              )}
            </div>
            <div className="text-xs text-zinc-500 mt-0.5" dir="ltr">
              {hit.phone}
            </div>
            <div className="mt-2 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-2 text-xs text-amber-900">
              🔒 {hit.blockedReason}
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-blue-50 border-2 border-blue-300 rounded-xl p-4 space-y-3">
      <div className="flex items-start gap-3">
        <div className="w-12 h-12 rounded-full bg-blue-500 flex items-center justify-center text-white font-extrabold text-lg shrink-0">
          {hit.name.charAt(0)}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-bold text-brand-slatedark">{hit.name}</span>
            {!hit.isActivated && (
              <span className="text-[10px] bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full font-bold">
                לא הופעל
              </span>
            )}
            {hit.hasCard && (
              <span className="text-[10px] bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full font-bold">
                💳 יש כרטיס
              </span>
            )}
          </div>
          <div className="text-xs text-zinc-600 mt-1 space-y-0.5" dir="ltr">
            <div>{hit.phone}</div>
            {hit.email && <div>{hit.email}</div>}
          </div>
          {hit.pointName && (
            <div className="text-xs text-zinc-500 mt-1" dir="rtl">
              📍 {hit.pointName}
            </div>
          )}
          <div className="text-[10px] text-zinc-400 mt-1" dir="rtl">
            {hit.orderCount} הזמנות במערכת
          </div>
        </div>
      </div>
      <button
        onClick={onOpen}
        className="w-full py-3 bg-blue-600 text-white rounded-lg font-bold hover:bg-blue-700 shadow-sm"
      >
        פתח הזמנה חדשה עבורו ←
      </button>
    </div>
  );
}
