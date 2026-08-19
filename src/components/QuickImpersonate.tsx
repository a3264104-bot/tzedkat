"use client";

// ═══════════════════════════════════════════════════════════════
// §144: כניסה מהירה כלקוח, מהתפריט
// ═══════════════════════════════════════════════════════════════
// התרחיש: לקוח מתקשר ואומר "לא מצליח להזמין". המנהל צריך לראות
// בדיוק מה שהוא רואה - וכמה שיותר מהר, כי הלקוח על הקו.
//
// עד היום זה דרש: מסך לקוחות -> חיפוש -> פתיחת כרטיס -> גלילה
// לתחתית המודל -> כפתור התחזות. חמישה צעדים בזמן ששיחה פתוחה.
//
// ⚠️ אותו endpoint של ImpersonateButton, ולכן אותו תיעוד ואותה
// דרך חזרה. זה קיצור למסלול קיים ולא מסלול חדש - שני מנגנוני
// התחזות היו מסוכנים בדיוק כמו שזה נשמע.

import { useEffect, useRef, useState } from "react";
import { signIn } from "next-auth/react";

type Hit = {
  id: string;
  name: string;
  phone: string | null;
  pointName: string | null;
  role: string;
};

export function QuickImpersonate() {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  // פוקוס אוטומטי בפתיחה - המנהל על הקו ולא צריך ללחוץ עוד פעם
  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 50);
  }, [open]);

  // חיפוש עם debounce
  useEffect(() => {
    if (!open) return;
    if (q.trim().length < 2) {
      setHits([]);
      return;
    }
    const t = setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/admin/customers?q=${encodeURIComponent(q.trim())}`
        );
        const data = await res.json();
        // ⚠️ נפילה למערך: התשובה עברה למבנה עם rows (§127), אבל
        // קליינט ישן מול שרת חדש (או להפך) לא צריך להישבר.
        const rows: any[] = Array.isArray(data) ? data : (data?.rows ?? []);
        setHits(
          rows
            // מנהל אחר לא ניתן להתחזות אליו - זו הסלמת הרשאות
            .filter((c) => c.role !== "ADMIN")
            .slice(0, 8)
            .map((c) => ({
              id: c.id,
              name: c.name,
              phone: c.phone,
              pointName: c.pointName,
              role: c.role,
            }))
        );
      } catch {
        setHits([]);
      }
    }, 250);
    return () => clearTimeout(t);
  }, [q, open]);

  async function go(c: Hit) {
    setBusy(true);
    setError("");
    try {
      // §144: אותו מסלול בדיוק כמו ImpersonateButton - שני שלבים.
      //
      // ⚠️ ה-endpoint מחזיר **כרטיס** ולא מחליף session ישירות,
      // ו-signIn הוא זה שמחליף. קריאה ישירה בלי השלב השני הייתה
      // מחזירה 200 בלי שכלום קורה - הבאג הכי מבלבל שיש.
      //
      // ⚠️ targetId ולא customerId: זה שם השדה שה-route מצפה לו.
      const res = await fetch("/api/admin/impersonate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetId: c.id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "שגיאה");

      const signInRes = await signIn("impersonate", {
        ticket: data.ticket,
        redirect: false,
      });
      if (signInRes?.error) {
        throw new Error("החלפת החשבון נכשלה. ייתכן שהכרטיס פג - נסה שוב.");
      }

      // ⚠️ ניווט מלא ולא router.push: ה-session השתנה, ו-Next עלול
      // להגיש מטמון של המשתמש הקודם.
      //
      // היעד לפי התפקיד: נציג רואה מסך אחר לגמרי מלקוח.
      window.location.href = c.role === "AGENT" ? "/agent" : "/account";
    } catch (e: any) {
      setError(e.message);
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-brand-slatedark hover:bg-brand-slate/10 transition-colors"
      >
        <span className="text-base">🧑</span>
        <span>כניסה כלקוח</span>
      </button>
    );
  }

  return (
    <div className="px-3 py-2 space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-bold text-brand-slatedark">
          🧑 כניסה כלקוח
        </span>
        <button
          onClick={() => {
            setOpen(false);
            setQ("");
            setHits([]);
          }}
          className="text-zinc-400 text-lg leading-none px-1"
        >
          ×
        </button>
      </div>

      <input
        ref={inputRef}
        className="input w-full text-sm py-1.5"
        placeholder="שם או טלפון…"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        disabled={busy}
      />

      {error && <p className="text-red-600 text-[11px]">{error}</p>}

      {q.trim().length >= 2 && hits.length === 0 && !busy && (
        <p className="text-[11px] text-zinc-400">לא נמצאו לקוחות</p>
      )}

      <div className="space-y-1 max-h-56 overflow-y-auto">
        {hits.map((c) => (
          <button
            key={c.id}
            onClick={() => go(c)}
            disabled={busy}
            className="w-full text-right bg-white border border-zinc-200 rounded-lg px-2.5 py-1.5 hover:border-brand-rust disabled:opacity-50"
          >
            <div className="text-xs font-bold text-brand-slatedark truncate">
              {c.name}
              {/* נציג מסומן - התחזות אליו מראה מסך אחר לגמרי */}
              {c.role === "AGENT" && (
                <span className="text-[9px] bg-purple-100 text-purple-700 rounded px-1 mr-1">
                  נציג
                </span>
              )}
            </div>
            <div className="text-[10px] text-zinc-500" dir="ltr">
              {c.phone || "—"}
            </div>
            {c.pointName && (
              <div className="text-[10px] text-zinc-400 truncate">
                {c.pointName}
              </div>
            )}
          </button>
        ))}
      </div>

      {busy && <p className="text-[11px] text-zinc-500">נכנס…</p>}

      {/* ⚠️ ההסבר חיוני: מנהל שנכנס כלקוח ולא יודע איך לחזור
          עלול לחשוב שהוא איבד את ההרשאות שלו. */}
      <p className="text-[10px] text-zinc-400 leading-relaxed">
        הכניסה מתועדת ביומן. לחזרה — הבאנר בראש המסך.
      </p>
    </div>
  );
}
