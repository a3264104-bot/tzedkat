"use client";

import { useState, Suspense } from "react";
import { PasswordInput } from "@/components/PasswordInput";
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
      setError("נא למלא טלפון (או מייל) וסיסמה");
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

          {/* כפתור Google - בולט בראש */}
          <button
            type="button"
            onClick={() =>
              signIn("google", { callbackUrl: callbackUrl || "/order" })
            }
            className="w-full flex items-center justify-center gap-3 px-4 py-3 rounded-xl border-2 border-zinc-200 hover:bg-zinc-50 font-bold text-brand-slatedark shadow-sm transition"
          >
            <svg className="w-5 h-5" viewBox="0 0 24 24">
              <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
              <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
              <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
              <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
            </svg>
            כניסה עם Google
          </button>

          <div className="flex items-center gap-3">
            <div className="flex-1 border-t border-zinc-200"></div>
            <span className="text-xs text-zinc-400">או</span>
            <div className="flex-1 border-t border-zinc-200"></div>
          </div>

          <div>
            <label className="label">טלפון או מייל</label>
            <input
              className="input"
              type="text"
              inputMode="text"
              autoComplete="username"
              placeholder="0501234567 או user@example.com"
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleLogin()}
              dir="ltr"
              style={{ textAlign: "right" }}
            />
            <p className="text-[11px] text-zinc-400 mt-1">
              אפשר להתחבר עם מספר הטלפון שאיתו נרשמת, או עם המייל
            </p>
          </div>

          <div>
            <label className="label">סיסמה</label>
            <PasswordInput
              value={password}
              onChange={setPassword}
              autoComplete="current-password"
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
