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
  onChanged,
}: {
  customerId: string;
  customerName: string;
  hasCode: boolean;
  codeSetAt?: string | null;
  /** נקרא אחרי יצירת קוד, כדי לרענן את הרשימה */
  onChanged?: () => void;
}) {
  const [code, setCode] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [manualMode, setManualMode] = useState(false);
  const [manualCode, setManualCode] = useState("");
  const [exists, setExists] = useState(hasCode);

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

  async function generate(length: number) {
    const data = await call({ action: "generate", length });
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
          <div
            className="font-mono text-3xl font-extrabold text-brand-rust tracking-[0.3em] select-all"
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
          <input
            className="input flex-1 font-mono text-center tracking-widest"
            inputMode="numeric"
            dir="ltr"
            maxLength={6}
            placeholder="4-6 ספרות"
            value={manualCode}
            onChange={(e) => setManualCode(e.target.value.replace(/\D/g, ""))}
          />
          <button
            type="button"
            onClick={setManual}
            disabled={loading || manualCode.length < 4}
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

      {!exists && !code && (
        <p className="text-[11px] text-amber-700">
          ללקוח אין קוד. עד שייווצר לו אחד הוא ממשיך להתחבר בסיסמה הישנה.
        </p>
      )}
      {error && <p className="text-red-600 text-xs">{error}</p>}
    </div>
  );
}
