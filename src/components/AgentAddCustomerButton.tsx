"use client";

// כפתור "לקוח חדש" למסך הנציג + Modal מלא
// - שלב 1: הזנת טלפון (עם חיפוש אוטומטי אחרי 500ms של הקלדה)
// - שלב 2a: אם הטלפון קיים - הצגת הלקוח + כפתור "פתח הזמנה עבורו"
// - שלב 2b: אם הטלפון לא קיים - שדה שם + מייל אופציונלי + "צור לקוח + הזמנה"
// - אחרי יצירה/בחירה: ניווט ל-/agent/order/[customerId]

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

type Existing = {
  id: string;
  name: string;
  phone: string;
  email: string | null;
  isActivated: boolean;
  hasCard: boolean;
  cardLast4: string | null;
  pointName: string | null;
  orderCount: number;
};

type SystemUser = {
  isSystemUser: true;
  systemRole: string;
  customerName: string;
};

export function AgentAddCustomerButton({
  className = "",
}: {
  className?: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className={`inline-flex items-center gap-2 px-4 py-2.5 bg-emerald-600 text-white rounded-xl font-bold text-sm shadow-sm hover:bg-emerald-700 transition-colors ${className}`}
      >
        <svg
          className="w-4 h-4"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2.5}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z"
          />
        </svg>
        לקוח חדש
      </button>

      {open && <AddCustomerModal onClose={() => setOpen(false)} />}
    </>
  );
}

function AddCustomerModal({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const [phone, setPhone] = useState("");
  const [searching, setSearching] = useState(false);
  const [existing, setExisting] = useState<Existing | null>(null);
  const [systemUser, setSystemUser] = useState<SystemUser | null>(null);
  const [searched, setSearched] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");
  const timerRef = useRef<any>(null);

  // חיפוש אוטומטי עם debounce של 500ms
  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    if (!phone.trim() || phone.replace(/\D/g, "").length < 9) {
      setExisting(null);
      setSystemUser(null);
      setSearched(false);
      return;
    }
    timerRef.current = setTimeout(async () => {
      setSearching(true);
      setError("");
      try {
        const res = await fetch(
          `/api/agent/customer-search?phone=${encodeURIComponent(phone.trim())}`
        );
        const json = await res.json();
        if (res.ok) {
          if (json.found) {
            setExisting(json.customer);
            setSystemUser(null);
          } else if (json.isSystemUser) {
            setSystemUser({
              isSystemUser: true,
              systemRole: json.systemRole,
              customerName: json.customerName,
            });
            setExisting(null);
          } else {
            setExisting(null);
            setSystemUser(null);
          }
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
  }, [phone]);

  async function createAndOpen() {
    if (!name.trim() || name.trim().length < 2) {
      setError("שם קצר מדי");
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
          phone: phone.trim(),
          email: email.trim() || null,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
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
      // ניווט למסך ההזמנה של הלקוח
      router.push(`/agent/order/${json.customer.id}`);
      onClose();
    } catch (e: any) {
      setError("שגיאה: " + e.message);
    } finally {
      setCreating(false);
    }
  }

  function openExisting() {
    if (!existing) return;
    router.push(`/agent/order/${existing.id}`);
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="bg-white w-full max-w-md sm:rounded-2xl rounded-t-2xl max-h-[95vh] overflow-y-auto shadow-2xl">
        {/* Header */}
        <div className="sticky top-0 bg-white border-b border-zinc-200 px-5 py-3 flex items-center justify-between z-10">
          <h3 className="font-extrabold text-brand-slatedark text-lg">
            ➕ לקוח חדש
          </h3>
          <button
            onClick={onClose}
            className="text-zinc-400 hover:text-zinc-600 text-2xl leading-none px-2"
          >
            ×
          </button>
        </div>

        <div className="p-5 space-y-4">
          {/* טלפון + חיפוש אוטומטי */}
          <div>
            <label className="text-xs font-bold text-zinc-500 block mb-1">
              טלפון *
            </label>
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
                <div className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-zinc-500">
                  <span className="inline-block animate-spin">⏳</span>
                </div>
              )}
            </div>
            <p className="text-[10px] text-zinc-500 mt-1">
              הזן טלפון - המערכת תחפש אוטומטית אם הלקוח כבר קיים
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
                    לא ניתן ליצור לקוח פסיבי עם טלפון של אנשי צוות. אם רוצים להזמין
                    עבורם, צריך להשתמש בטלפון אחר או לפנות למנהל.
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* לקוח קיים - הצגה + כפתור פתיחת הזמנה */}
          {existing && (
            <div className="bg-blue-50 border-2 border-blue-300 rounded-xl p-4 space-y-3">
              <div className="flex items-start gap-3">
                <div className="w-12 h-12 rounded-full bg-blue-500 flex items-center justify-center text-white font-extrabold text-lg shrink-0">
                  {existing.name.charAt(0)}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-bold text-brand-slatedark">
                      {existing.name}
                    </span>
                    {!existing.isActivated && (
                      <span className="text-[10px] bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full font-bold">
                        לא הופעל
                      </span>
                    )}
                    {existing.hasCard && (
                      <span className="text-[10px] bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full font-bold">
                        💳 יש כרטיס
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-zinc-600 mt-1 space-y-0.5" dir="ltr">
                    <div>{existing.phone}</div>
                    {existing.email && <div>{existing.email}</div>}
                  </div>
                  {existing.pointName && (
                    <div className="text-xs text-zinc-500 mt-1" dir="rtl">
                      📍 {existing.pointName}
                    </div>
                  )}
                  <div className="text-[10px] text-zinc-400 mt-1" dir="rtl">
                    {existing.orderCount} הזמנות במערכת
                  </div>
                </div>
              </div>
              <button
                onClick={openExisting}
                className="w-full py-3 bg-blue-600 text-white rounded-lg font-bold hover:bg-blue-700 shadow-sm"
              >
                פתח הזמנה חדשה עבורו ←
              </button>
            </div>
          )}

          {/* לא נמצא - שדות ליצירה (רק אם לא מדובר בטלפון של איש צוות) */}
          {searched && !existing && !systemUser && phone.replace(/\D/g, "").length >= 9 && (
            <>
              <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-2.5 text-xs text-emerald-800">
                ✨ לקוח חדש - הזן את הפרטים כדי ליצור אותו
              </div>

              <div>
                <label className="text-xs font-bold text-zinc-500 block mb-1">
                  שם *
                </label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="שם מלא של הלקוח"
                  className="w-full px-3 py-3 border-2 border-zinc-300 rounded-lg text-base focus:outline-none focus:border-brand-rust"
                />
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
                  💡 אם הלקוח יוסיף מייל, יוכל להפעיל את החשבון בעצמו דרך "שכחתי סיסמה"
                </p>
              </div>
            </>
          )}

          {/* שגיאה */}
          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-2.5 text-xs text-red-800">
              {error}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="sticky bottom-0 bg-white border-t border-zinc-200 p-4 flex gap-2">
          <button
            onClick={onClose}
            disabled={creating}
            className="flex-1 py-3 rounded-xl border border-zinc-300 text-brand-slatedark font-bold hover:bg-zinc-50"
          >
            ביטול
          </button>
          {searched && !existing && !systemUser && phone.replace(/\D/g, "").length >= 9 && (
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
