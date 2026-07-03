"use client";

import { useState, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";
import { Logo } from "@/components/Logo";

function ResetPasswordInner() {
  const params = useSearchParams();
  const router = useRouter();
  const token = params.get("token") || "";

  const [password, setPassword] = useState("");
  const [password2, setPassword2] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  async function submit() {
    setError("");
    if (password.length < 6) {
      setError("הסיסמה חייבת להכיל לפחות 6 תווים");
      return;
    }
    if (password !== password2) {
      setError("הסיסמאות אינן תואמות");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/customer/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "שגיאה באיפוס הסיסמה");
        return;
      }
      setDone(true);
      // מפנים לכניסה אחרי 2 שניות
      setTimeout(() => router.replace("/login"), 2000);
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
          {!token ? (
            <div className="text-center">
              <h1 className="text-lg font-extrabold text-brand-slatedark">קישור לא תקין</h1>
              <p className="text-sm text-zinc-600 mt-2">
                חסר קוד איפוס. נא לבקש קישור חדש.
              </p>
              <Link href="/forgot-password" className="btn-primary w-full block text-center mt-4">
                בקשת קישור חדש
              </Link>
            </div>
          ) : done ? (
            <div className="text-center">
              <div className="mx-auto w-14 h-14 rounded-full bg-green-100 flex items-center justify-center text-2xl">
                ✓
              </div>
              <h1 className="text-lg font-extrabold text-brand-slatedark mt-3">הסיסמה עודכנה!</h1>
              <p className="text-sm text-zinc-600 mt-2">מעביר אותך לכניסה...</p>
            </div>
          ) : (
            <>
              <h1 className="text-xl font-extrabold text-brand-slatedark text-center">
                בחירת סיסמה חדשה
              </h1>
              <div>
                <label className="label">סיסמה חדשה</label>
                <input
                  className="input"
                  type="password"
                  autoComplete="new-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </div>
              <div>
                <label className="label">אימות סיסמה</label>
                <input
                  className="input"
                  type="password"
                  autoComplete="new-password"
                  value={password2}
                  onChange={(e) => setPassword2(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && submit()}
                />
              </div>
              {error && <p className="text-red-600 text-sm">{error}</p>}
              <button onClick={submit} disabled={loading} className="btn-primary w-full">
                {loading ? "מעדכן..." : "עדכון סיסמה"}
              </button>
            </>
          )}
        </div>
      </div>
    </main>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense
      fallback={
        <div
          className="min-h-screen flex items-center justify-center"
          style={{ background: "linear-gradient(to bottom, #fff3a3, #fff8d8)" }}
        >
          טוען...
        </div>
      }
    >
      <ResetPasswordInner />
    </Suspense>
  );
}
