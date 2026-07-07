"use client";

import { useState, useEffect, useMemo, Suspense } from "react";
import { signIn } from "next-auth/react";
import { useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";
import { Logo } from "@/components/Logo";

type Point = { id: string; name: string; city: string | null };
type RegStep = "details" | "station";

function RegisterPageInner() {
  const params = useSearchParams();
  const router = useRouter();
  const callbackUrl = params.get("callbackUrl") || "/order";

  const [step, setStep] = useState<RegStep>("details");
  const [points, setPoints] = useState<Point[]>([]);

  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [password2, setPassword2] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const [selectedCity, setSelectedCity] = useState<string | null>(null);
  const [defaultPointId, setDefaultPointId] = useState("");


  useEffect(() => {
    fetch("/api/customer/points")
      .then((r) => r.json())
      .then(setPoints)
      .catch(() => null);
  }, []);


  const cities = useMemo(() => {
    const set = new Set<string>();
    for (const p of points) if (p.city) set.add(p.city);
    return Array.from(set).sort((a, b) => a.localeCompare(b, "he"));
  }, [points]);
  const pointsWithoutCity = useMemo(() => points.filter((p) => !p.city), [points]);
  const showCityStep = cities.length > 1;
  const pointsInCity = useMemo(
    () => (selectedCity ? points.filter((p) => p.city === selectedCity) : []),
    [points, selectedCity]
  );

  function validateDetails() {
    setError("");
    if (!name.trim()) return setError("נא להזין שם");
    if (!phone.trim()) return setError("יש להזין מספר טלפון — איתו תתחבר למערכת");
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return setError("כתובת מייל לא תקינה");
    if (password.length < 6) return setError("הסיסמה חייבת להכיל לפחות 6 תווים");
    if (password !== password2) return setError("הסיסמאות אינן תואמות");
    setStep("station");
  }

  async function proceedToPayment() {
    setError("");
    setLoading(true);
    try {
      const res = await fetch("/api/customer/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          phone: phone.trim() || null,
          email: email.trim().toLowerCase() || null,
          password,
          defaultPointId: defaultPointId || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (data.code === "DUPLICATE_PHONE" || data.code === "DUPLICATE_EMAIL") {
          setStep("details");
          setError(data.error);
        } else {
          setError(data.error || "שגיאה בהרשמה");
        }
        return;
      }
      // החשבון נוצר - מתחברים מיד וממשיכים. אימות הכרטיס (1 ש"ח)
      // יתבקש בשמירת ההזמנה הראשונה, לא כאן.
      const identifier = phone.trim() || email.trim().toLowerCase();
      const signInRes = await signIn("login", { identifier, password, redirect: false });
      if (signInRes?.error) {
        router.replace(`/login?callbackUrl=${encodeURIComponent(callbackUrl)}`);
      } else {
        router.replace(callbackUrl);
      }
    } catch {
      setError("שגיאת שרת. נסה שוב.");
    } finally {
      setLoading(false);
    }
  }


  // בנוסף לחיוב 1₪ לאימות. אם נדרים דורשים שמות אחרים - נראה זאת בלוג ונתקן.

  return (
    <main
      dir="rtl"
      className="min-h-screen px-4 py-8"
      style={{ background: "linear-gradient(to bottom, #fff3a3, #fff8d8)" }}
    >
      <div className="w-full max-w-sm mx-auto">
        <div className="flex justify-center mb-6">
          <Logo size={80} />
        </div>

        <div className="flex justify-center gap-2 mb-6">
          {(["details", "station"] as RegStep[]).map((s, i) => (
            <div
              key={s}
              className={`h-2 w-8 rounded-full transition-colors ${
                step === s
                  ? "bg-brand-rust"
                  : (["details", "station"] as RegStep[]).indexOf(step) > i
                    ? "bg-brand-rust/40"
                    : "bg-zinc-200"
              }`}
            />
          ))}
        </div>

        {/* שלב 1: פרטים */}
        {step === "details" && (
          <div className="bg-white rounded-2xl shadow-sm border border-zinc-100 p-6 space-y-4">
            <h1 className="text-xl font-extrabold text-brand-slatedark text-center">הרשמה</h1>
            <div>
              <label className="label">שם מלא *</label>
              <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div>
              <label className="label">טלפון *</label>
              <input
                className="input"
                type="tel"
                inputMode="tel"
                placeholder="050-1234567"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
              />
            </div>
            <div>
              <label className="label">מייל (מומלץ)</label>
              <input
                className="input"
                type="email"
                inputMode="email"
                placeholder="user@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <p className="text-xs text-zinc-400">
              ההתחברות למערכת מתבצעת עם מספר הטלפון. מומלץ להוסיף מייל — הוא מאפשר לאפס
              סיסמה בעצמך ולקבל אישורי הזמנה.
            </p>
            <div>
              <label className="label">סיסמה *</label>
              <input
                className="input"
                type="password"
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            <div>
              <label className="label">אימות סיסמה *</label>
              <input
                className="input"
                type="password"
                autoComplete="new-password"
                value={password2}
                onChange={(e) => setPassword2(e.target.value)}
              />
            </div>
            {error && <p className="text-red-600 text-sm">{error}</p>}
            <button onClick={validateDetails} className="btn-primary w-full">
              המשך ←
            </button>
            <p className="text-center text-sm">
              כבר רשום?{" "}
              <Link
                href={`/login?callbackUrl=${encodeURIComponent(callbackUrl)}`}
                className="text-brand-rust font-medium"
              >
                כניסה
              </Link>
            </p>
          </div>
        )}

        {/* שלב 2: תחנה שמורה */}
        {step === "station" && (
          <div className="bg-white rounded-2xl shadow-sm border border-zinc-100 p-6 space-y-4">
            <h2 className="text-lg font-extrabold text-brand-slatedark">
              {showCityStep && !selectedCity ? "בחרי עיר" : "בחרי תחנת חלוקה שמורה"}
            </h2>
            <p className="text-sm text-zinc-500">תוכל/י לשנות זאת בכל עת מהאזור האישי.</p>

            {showCityStep && !selectedCity && (
              <div className="space-y-2">
                {cities.map((city) => (
                  <button
                    key={city}
                    onClick={() => setSelectedCity(city)}
                    className="w-full text-right card p-3 flex justify-between items-center hover:border-brand-rust"
                  >
                    <span className="font-semibold text-brand-slatedark">{city}</span>
                    <span className="text-zinc-400 text-xs">
                      {points.filter((p) => p.city === city).length > 1
                        ? `${points.filter((p) => p.city === city).length} נקודות`
                        : ""}
                    </span>
                  </button>
                ))}
                {pointsWithoutCity.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => setDefaultPointId(p.id)}
                    className={`w-full text-right card p-3 transition ${
                      defaultPointId === p.id ? "ring-2 ring-brand-rust" : ""
                    }`}
                  >
                    <span className="font-semibold">{p.name}</span>
                  </button>
                ))}
              </div>
            )}

            {(!showCityStep || selectedCity) && (
              <div className="space-y-2">
                {showCityStep && (
                  <button
                    onClick={() => setSelectedCity(null)}
                    className="text-sm text-brand-rust font-medium"
                  >
                    ← חזרה לבחירת עיר
                  </button>
                )}
                {(showCityStep ? pointsInCity : points).map((p) => (
                  <button
                    key={p.id}
                    onClick={() => setDefaultPointId(p.id)}
                    className={`w-full text-right card p-3 transition ${
                      defaultPointId === p.id ? "ring-2 ring-brand-rust border-brand-rust" : ""
                    }`}
                  >
                    <span className="font-semibold text-brand-slatedark">{p.name}</span>
                  </button>
                ))}
              </div>
            )}

            {error && <p className="text-red-600 text-sm">{error}</p>}
            <div className="flex gap-2">
              <button onClick={() => setStep("details")} className="btn-ghost flex-1">
                חזרה
              </button>
              <button
                disabled={!defaultPointId || loading}
                onClick={proceedToPayment}
                className="btn-primary flex-1"
              >
                {loading ? "מכין..." : "המשך ←"}
              </button>
            </div>
          </div>
        )}

      </div>
    </main>
  );
}

export default function RegisterPage() {
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
      <RegisterPageInner />
    </Suspense>
  );
}
