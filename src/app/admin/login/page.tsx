"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { signIn } from "next-auth/react";
import { Logo } from "@/components/Logo";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit() {
    setError("");
    setLoading(true);
    // חשוב: שם ה-provider הוא "admin" (לא "credentials") מאז שפיצלנו לשני providers
    const res = await signIn("admin", { email, password, redirect: false });
    setLoading(false);
    if (res?.error) {
      setError("אימייל או סיסמה שגויים");
      return;
    }
    router.push("/admin");
    router.refresh();
  }

  return (
    <main className="min-h-screen bg-brand-yellow flex items-center justify-center p-5">
      <div className="w-full max-w-sm">
        <div className="flex justify-center mb-6">
          <Logo size={120} />
        </div>
        <div className="card p-6">
          <h1 className="text-xl font-extrabold text-brand-slatedark text-center mb-5">
            כניסת מנהל
          </h1>
          <div className="space-y-3">
            <div>
              <label className="label">אימייל</label>
              <input
                className="input"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && submit()}
              />
            </div>
            <div>
              <label className="label">סיסמה</label>
              <input
                className="input"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && submit()}
              />
            </div>
            {error && <p className="text-red-600 text-sm">{error}</p>}
            <button onClick={submit} disabled={loading} className="btn-primary w-full">
              {loading ? "מתחבר..." : "כניסה"}
            </button>
          </div>
        </div>
      </div>
    </main>
  );
}
