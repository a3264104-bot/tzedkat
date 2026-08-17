"use client";

// §62: כפתור "כניסה כמשתמש".
//
// הזרימה: השרת מנפיק כרטיס חד-פעמי בן 60 שניות, והקליינט פודה אותו
// מול provider ה-impersonate של Auth.js. הכרטיס הוא מקור האמת -
// שום ערך מהדפדפן לא נלקח כפשוטו, ולכן אי אפשר "לבקש" להתחזות.
//
// אחרי ההחלפה נדרש ניווט מלא (window.location) ולא router.push:
// ה-session השתנה לגמרי, וכל מה שנטען עד כה בזיכרון שייך למנהל.

import { useState } from "react";
import { signIn } from "next-auth/react";

export function ImpersonateButton({
  customerId,
  customerName,
  role,
  className = "btn-ghost btn-sm",
}: {
  customerId: string;
  customerName: string;
  role?: string;
  className?: string;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function go() {
    setError("");
    if (
      !window.confirm(
        `להיכנס לחשבון של ${customerName}?\n\nתראה בדיוק מה שהוא רואה. הפעולה מתועדת ביומן, ותוכל לחזור לחשבונך בכל רגע.`
      )
    ) {
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/admin/impersonate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetId: customerId }),
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

      // יעד לפי התפקיד של מי שנכנסים אליו
      const target = role === "AGENT" ? "/agent" : "/account";
      window.location.href = target;
    } catch (e: any) {
      setError(e.message);
      setLoading(false);
    }
  }

  return (
    <div>
      <button type="button" onClick={go} disabled={loading} className={className}>
        {loading ? "נכנס..." : "👤 כניסה כמשתמש"}
      </button>
      {error && <p className="text-red-600 text-xs mt-1">{error}</p>}
    </div>
  );
}
