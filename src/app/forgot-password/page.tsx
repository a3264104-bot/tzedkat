"use client";

import { useState } from "react";
import Link from "next/link";
import { Logo } from "@/components/Logo";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function submit() {
    setError("");
    if (!email.trim()) {
      setError("נא להזין כתובת מייל");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/customer/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "שגיאה");
        return;
      }
      setSent(true);
    } catch {
      setError("שגיאת שרת. נסה שוב.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main
      dir="rtl"
      className="min-h-screen flex items-center justify-center px-4"
      style={{ background: "linear-gradient(to bottom, #fff3a3, #fff8d8)" }}
    >
      <div className="w-full max-w-sm">
        <div className="flex justify-center mb-8">
          <Logo size={100} />
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-zinc-100 p-6 space-y-4">
          {sent ? (
            <>
              <div className="text-center">
                <div className="mx-auto w-14 h-14 rounded-full bg-green-100 flex items-center justify-center text-2xl">
                  ✓
                </div>
                <h1 className="text-lg font-extrabold text-brand-slatedark mt-3">נשלח!</h1>
                <p className="text-sm text-zinc-600 mt-2 leading-relaxed">
                  אם קיים חשבון עם כתובת המייל הזו, נשלח אליו קישור לאיפוס סיסמה. הקישור תקף לשעה
                  אחת.
                </p>
                <p className="text-xs text-zinc-500 mt-3 leading-relaxed bg-amber-50 border border-amber-100 rounded-lg p-3">
                  לא הגיע מייל תוך מספר דקות? בדוק בתיקיית הספאם, וודא שזו הכתובת שנרשמת
                  איתה במקור. אם נרשמת עם טלפון בלבד — פנה אלינו ונאפס לך את הסיסמה.
                </p>
              </div>
              <Link href="/login" className="btn-primary w-full block text-center">
                חזרה לכניסה
              </Link>
            </>
          ) : (
            <>
              <h1 className="text-xl font-extrabold text-brand-slatedark text-center">
                איפוס סיסמה
              </h1>
              <p className="text-sm text-zinc-500 text-center">
                הזן את כתובת המייל שציינת בהרשמה ונשלח אליך קישור לאיפוס. אם נרשמת ללא
                מייל — פנה אלינו טלפונית ונאפס לך את הסיסמה.
              </p>
              <div>
                <label className="label">כתובת מייל</label>
                <input
                  className="input"
                  type="email"
                  inputMode="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && submit()}
                />
              </div>
              {error && <p className="text-red-600 text-sm">{error}</p>}
              <button onClick={submit} disabled={loading} className="btn-primary w-full">
                {loading ? "שולח..." : "שליחת קישור"}
              </button>
              <p className="text-center text-sm">
                <Link href="/login" className="text-brand-rust font-medium">
                  חזרה לכניסה
                </Link>
              </p>
            </>
          )}
        </div>
      </div>
    </main>
  );
}
