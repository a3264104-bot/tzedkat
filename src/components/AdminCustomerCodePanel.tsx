"use client";

// §62: פאנל קוד ההתחברות בכרטיס הלקוח.
//
// התרחיש שהוא נועד לשרת: לקוח מתקשר ואומר "שכחתי קוד". המנהל פותח
// את הכרטיס, לוחץ "הצג קוד", ומקריא לו אותו. בלי איפוס, בלי SMS,
// בלי תהליך שחזור.
//
// הקוד **אינו** נשלח עם רשימת הלקוחות ואינו יושב ב-state של המסך.
// הוא נמשך בבקשה ייעודית רק כשהמנהל לוחץ, וכל לחיצה נרשמת ביומן.
// לו היה מגיע עם הרשימה, כל טעינת מסך הייתה שולחת את הקודים של 100
// לקוחות לדפדפן - ומספיק screenshot אחד כדי לחשוף את כולם.

import { useState } from "react";

export function AdminCustomerCodePanel({
  customerId,
  customerName,
  hasCode,
  codeSetAt,
  role,
  onChanged,
}: {
  customerId: string;
  customerName: string;
  hasCode: boolean;
  codeSetAt?: string | null;
  /** §83: מנהל/נציג מקבל סיסמה חזקה כברירת מחדל */
  role?: string;
  /** נקרא אחרי יצירת קוד, כדי לרענן את הרשימה */
  onChanged?: () => void;
}) {
  const [code, setCode] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [manualMode, setManualMode] = useState(false);
  const [manualCode, setManualCode] = useState("");
  const [exists, setExists] = useState(hasCode);
  // §83: מנהל או נציג - החשבונות שקוד מספרי קצר אינו מספיק להם
  const isPrivileged = role === "ADMIN" || role === "AGENT";

  async function call(payload: Record<string, unknown>) {
    setError("");
    setLoading(true);
    try {
      const res = await fetch("/api/admin/customer-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ customerId, ...payload }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "שגיאה");
      return data;
    } catch (e: any) {
      setError(e.message);
      return null;
    } finally {
      setLoading(false);
    }
  }

  async function viewCode() {
    const data = await call({ action: "view" });
    if (!data) return;
    if (!data.hasCode) {
      setExists(false);
      setError(data.message || "אין קוד");
      return;
    }
    setCode(data.loginCode);
    setExists(true);
  }

  async function generate(length: number, strong = false) {
    const data = await call({ action: "generate", length, strong });
    if (!data) return;
    setCode(data.loginCode);
    setExists(true);
    setManualMode(false);
    onChanged?.();
  }

  async function setManual() {
    const data = await call({ action: "set", code: manualCode.trim() });
    if (!data) return;
    setCode(data.loginCode);
    setExists(true);
    setManualMode(false);
    setManualCode("");
    onChanged?.();
  }

  return (
    <div className="bg-gradient-to-br from-blue-50 to-zinc-50 border border-blue-200 rounded-lg p-3 space-y-2.5">
      <div className="flex items-center justify-between gap-2">
        <div className="text-xs font-bold text-zinc-600">🔑 קוד התחברות</div>
        {exists && codeSetAt && !code && (
          <div className="text-[10px] text-zinc-400">
            נקבע {new Date(codeSetAt).toLocaleDateString("he-IL")}
          </div>
        )}
      </div>

      {/* הקוד עצמו - מוצג רק אחרי לחיצה מפורשת */}
      {code ? (
        <div className="bg-white border-2 border-brand-rust rounded-lg p-3 text-center">
          {/* §83: סיסמה ארוכה נשברת בפונט ענק - גודל לפי האורך */}
          <div
            className={`font-mono font-extrabold text-brand-rust select-all break-all ${
              code.length > 8 ? "text-xl" : "text-3xl tracking-[0.3em]"
            }`}
            dir="ltr"
          >
            {code}
          </div>
          <div className="text-[10px] text-zinc-500 mt-1.5">
            הקוד של {customerName} — ניתן להקריא לו בטלפון
          </div>
          <button
            type="button"
            onClick={() => setCode(null)}
            className="text-[11px] text-zinc-500 hover:text-zinc-700 mt-1.5 underline"
          >
            🙈 הסתר
          </button>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          {exists && (
            <button
              type="button"
              onClick={viewCode}
              disabled={loading}
              className="btn-primary btn-sm"
            >
              {loading ? "טוען..." : "👁️ הצג קוד"}
            </button>
          )}
          <button
            type="button"
            onClick={() => generate(6)}
            disabled={loading}
            className="btn-ghost btn-sm"
          >
            🎲 {exists ? "קוד חדש" : "צור קוד"}
          </button>
          {/* §83: סיסמה חזקה - למנהלים ולנציגים.
              קוד בן 6 ספרות הוא מיליון צירופים; לחשבון שרואה את
              הקודים של כל הלקוחות ויכול להיכנס בשם כל אחד, זה לא
              מספיק. */}
          <button
            type="button"
            onClick={() => generate(14, true)}
            disabled={loading}
            className={`btn-sm ${
              isPrivileged
                ? "bg-brand-rust text-white rounded-lg px-3 font-bold hover:opacity-90"
                : "btn-ghost"
            }`}
            title="סיסמה אלפאנומרית ארוכה - מומלץ למנהלים ולנציגים"
          >
            🔐 סיסמה חזקה
          </button>
          {!manualMode && (
            <button
              type="button"
              onClick={() => setManualMode(true)}
              disabled={loading}
              className="btn-ghost btn-sm"
            >
              ✏️ הזנה ידנית
            </button>
          )}
        </div>
      )}

      {/* הזנה ידנית */}
      {manualMode && (
        <div className="flex gap-2">
          {/* §83: מקבל גם אותיות. הניקוי היה replace(/\D/g,"") - כלומר
              כל אות שהמנהל הקליד נמחקה מתחת לאצבעות שלו בלי הסבר. */}
          <input
            className="input flex-1 font-mono text-center"
            dir="ltr"
            maxLength={64}
            placeholder="4-6 ספרות, או 8+ תווים עם אותיות"
            value={manualCode}
            onChange={(e) => setManualCode(e.target.value.replace(/\s/g, ""))}
          />
          <button
            type="button"
            onClick={setManual}
            disabled={
              loading ||
              (/^\d+$/.test(manualCode) ? manualCode.length < 4 : manualCode.length < 8)
            }
            className="btn-primary btn-sm"
          >
            שמירה
          </button>
          <button
            type="button"
            onClick={() => {
              setManualMode(false);
              setManualCode("");
              setError("");
            }}
            className="btn-ghost btn-sm"
          >
            ביטול
          </button>
        </div>
      )}

      {/* §83: מנהל/נציג עם קוד מספרי - חשיפה שכדאי לסגור */}
      {isPrivileged && exists && (
        <p className="text-[11px] text-amber-700 leading-relaxed">
          ⚠️ חשבון בעל הרשאות. אם הקוד הנוכחי מספרי בלבד — מומלץ להחליפו
          בסיסמה חזקה: חשבון כזה רואה את הקודים של כל הלקוחות ויכול
          להיכנס בשם כל אחד.
        </p>
      )}

      {!exists && !code && (
        <p className="text-[11px] text-amber-700">
          ללקוח אין קוד. עד שייווצר לו אחד הוא ממשיך להתחבר בסיסמה הישנה.
        </p>
      )}
      {error && <p className="text-red-600 text-xs">{error}</p>}
    </div>
  );
}
