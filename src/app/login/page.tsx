"use client";

import { useState, Suspense } from "react";
import { signIn, getSession } from "next-auth/react";
import { useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";
import { Logo } from "@/components/Logo";

function LoginPageInner() {
  const params = useSearchParams();
  const router = useRouter();
  const callbackUrl = params.get("callbackUrl") || "";

  const [identifier, setIdentifier] = useState(""); // טלפון או מייל
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleLogin() {
    setError("");
    if (!identifier.trim() || !password) {
      setError("נא למלא מספר טלפון וסיסמה");
      return;
    }
    setLoading(true);
    const res = await signIn("login", {
      identifier: identifier.trim(),
      password,
      redirect: false,
    });

    if (res?.error) {
      setLoading(false);
      setError("פרטים שגויים. אם אין לך חשבון — הירשם קודם.");
      return;
    }

    // אחרי התחברות מוצלחת - בודקים את ה-role כדי להפנות למקום הנכון
    const session = await getSession();
    const role = (session?.user as any)?.role;
    setLoading(false);

    // בודקים שה-callbackUrl מתאים להרשאות של המשתמש.
    // בלי הבדיקה: נציג שניסה /admin היה נכנס ללולאת הפניות אינסופית
    // (middleware מפנה ל-login, login מחזיר ל-admin, וחוזר חלילה).
    const canAccess = (url: string): boolean => {
      if (url.startsWith("/admin")) return role === "ADMIN";
      if (url.startsWith("/agent")) return role === "AGENT" || role === "ADMIN";
      return true; // כל שאר היעדים פתוחים לכל מחובר
    };

    if (callbackUrl && canAccess(callbackUrl)) {
      router.replace(callbackUrl);
    } else if (role === "ADMIN") {
      router.replace("/admin");
    } else if (role === "AGENT") {
      router.replace("/agent");
    } else {
      router.replace("/account");
    }
    router.refresh();
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
          <h1 className="text-xl font-extrabold text-brand-slatedark text-center">
            כניסה לחשבון
          </h1>

          <div>
            <label className="label">מספר טלפון</label>
            <input
              className="input"
              type="text"
              inputMode="email"
              autoComplete="username"
              placeholder="0501234567"
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleLogin()}
            />
          </div>

          <div>
            <label className="label">סיסמה</label>
            <input
              className="input"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleLogin()}
            />
          </div>

          {error && <p className="text-red-600 text-sm font-medium">{error}</p>}

          <button onClick={handleLogin} disabled={loading} className="btn-primary w-full">
            {loading ? "מתחבר..." : "כניסה"}
          </button>

          <div className="flex justify-between text-sm pt-1">
            <Link href="/forgot-password" className="text-brand-rust font-medium">
              שכחתי סיסמה
            </Link>
            <Link
              href={`/register${callbackUrl ? `?callbackUrl=${encodeURIComponent(callbackUrl)}` : ""}`}
              className="text-brand-rust font-medium"
            >
              הרשמה ←
            </Link>
          </div>
        </div>
      </div>
    </main>
  );
}

export default function LoginPage() {
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
      <LoginPageInner />
    </Suspense>
  );
}
