"use client";

// §62: החלק האינטראקטיבי של באנר ההתחזות.
//
// מופרד מהבאנר עצמו כדי שהבאנר יוכל להישאר server component ולקרוא
// את ה-session ישירות, בלי SessionProvider.
//
// signIn מ-next-auth/react אינו דורש provider - רק useSession דורש.

import { useState } from "react";
import { signIn } from "next-auth/react";

export function ReturnToAdminButton() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function goBack() {
    setError("");
    setLoading(true);
    try {
      const res = await fetch("/api/admin/impersonate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "return" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "שגיאה");

      const signInRes = await signIn("impersonate", {
        ticket: data.ticket,
        redirect: false,
      });
      if (signInRes?.error) throw new Error("החזרה נכשלה. נסה שוב.");

      // ניווט מלא ולא router.push - ה-session התחלף לגמרי, וכל מה
      // שנטען בזיכרון שייך לחשבון שממנו יצאנו.
      window.location.href = "/admin";
    } catch (e: any) {
      setError(e.message);
      setLoading(false);
    }
  }

  return (
    <div className="shrink-0 flex items-center gap-2">
      {error && <span className="text-xs text-red-800 font-bold">{error}</span>}
      <button
        onClick={goBack}
        disabled={loading}
        className="bg-amber-950 text-amber-50 text-xs font-bold px-3 py-1.5 rounded-lg hover:bg-amber-900 disabled:opacity-50"
      >
        {loading ? "חוזר..." : "← חזרה לחשבון שלי"}
      </button>
    </div>
  );
}
