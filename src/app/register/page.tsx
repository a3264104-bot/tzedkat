"use client";

import { useState, useEffect, useMemo, Suspense } from "react";
import { signIn } from "next-auth/react";
import { useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";
import { Logo } from "@/components/Logo";

type Point = { id: string; name: string; city: string | null };
type RegStep = "details" | "station" | "payment";

function RegisterPageInner() {
  const params = useSearchParams();
  const router = useRouter();
  const callbackUrl = params.get("callbackUrl") || "/order";

  const [step, setStep] = useState<RegStep>("details");
  const [points, setPoints] = useState<Point[]>([]);

  // שלב פרטים
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [password2, setPassword2] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  // שלב תחנה שמורה
  const [selectedCity, setSelectedCity] = useState<string | null>(null);
  const [defaultPointId, setDefaultPointId] = useState("");

  // שלב תשלום
  // customerId נשמר אחרי ההרשמה (לפני תשלום) כדי לשלוח ל-webhook של נדרים
  const [registeredCustomerId, setRegisteredCustomerId] = useState<string | null>(null);
  const [paymentDone, setPaymentDone] = useState(false);

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

  // שלב 1: אימות פרטים
  function validateDetails() {
    setError("");
    if (!name.trim()) return setError("נא להזין שם");
    if (!phone.trim() && !email.trim()) return setError("יש להזין טלפון או מייל (לפחות אחד)");
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return setError("כתובת מייל לא תקינה");
    if (password.length < 6) return setError("הסיסמה חייבת להכיל לפחות 6 תווים");
    if (password !== password2) return setError("הסיסמאות אינן תואמות");
    setStep("station");
  }

  // שלב 2→3: רישום ב-DB לפני שלב התשלום (כדי שה-webhook של נדרים ידע מי הלקוח)
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
      // שומרים את ה-customerId לשלב ה-iframe
      setRegisteredCustomerId(data.id);
      setStep("payment");
    } catch {
      setError("שגיאת שרת. נסה שוב.");
    } finally {
      setLoading(false);
    }
  }

  // שלב 3: אחרי אישור התשלום, מתחברים אוטומטית
  async function finishRegistration() {
    setError("");
    if (!paymentDone) {
      setError("יש להשלים את שלב האימות לפני הסיום");
      return;
    }
    setLoading(true);
    const identifier = phone.trim() || email.trim().toLowerCase();
    const signInRes = await signIn("login", {
      identifier,
      password,
      redirect: false,
    });
    setLoading(false);
    if (signInRes?.error) {
      router.replace(`/login?callbackUrl=${encodeURIComponent(callbackUrl)}`);
    } else {
      router.replace(callbackUrl);
    }
  }

  // URL של ה-iframe לנדרים - חיוב 1₪ לאימות, עם callback לשרת שלנו
  const nedarimIframeUrl = registeredCustomerId
    ? `https://www.matara.pro/nedarimplus/online/?` +
      `mosad=7015318` +
      `&ApiValid=NxhXRWeG5P` +
      `&Amount=1` +
      `&AmountLock=1` +
      `&CallBack=${encodeURIComponent(`${process.env.NEXT_PUBLIC_APP_URL || "https://tzidkat.com"}/api/webhooks/nedarim`)}` +
      `&param1=${encodeURIComponent(registeredCustomerId)}` +
      `&param2=registration` +
      `&Nota=${encodeURIComponent("אימות כרטיס אשראי - צדקת רבותינו")}` +
      `&ClientName=${encodeURIComponent(name.trim())}`
    : null;

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

        {/* progress dots */}
        <div className="flex justify-center gap-2 mb-6">
          {(["details", "station", "payment"] as RegStep[]).map((s, i) => (
            <div
              key={s}
              className={`h-2 w-8 rounded-full transition-colors ${
                step === s
                  ? "bg-brand-rust"
                  : (["details", "station", "payment"] as RegStep[]).indexOf(step) > i
                    ? "bg-brand-rust/40"
                    : "bg-zinc-200"
              }`}
            />
          ))}
        </div>

        {/* ═══ שלב 1: פרטים ═══ */}
        {step === "details" && (
          <div className="bg-white rounded-2xl shadow-sm border border-zinc-100 p-6 space-y-4">
            <h1 className="text-xl font-extrabold text-brand-slatedark text-center">הרשמה</h1>

            <div>
              <label className="label">שם מלא *</label>
              <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div>
              <label className="label">טלפון</label>
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
              <label className="label">מייל</label>
              <input
                className="input"
                type="email"
                inputMode="email"
                placeholder="user@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <p className="text-xs text-zinc-400">יש למלא לפחות טלפון או מייל (אפשר שניהם)</p>
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

        {/* ═══ שלב 2: בחירת תחנה שמורה ═══ */}
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

        {/* ═══ שלב 3: אימות כרטיס אשראי — חיוב 1₪ ═══ */}
        {step === "payment" && (
          <div className="bg-white rounded-2xl shadow-sm border border-zinc-100 p-6 space-y-4">
            <h2 className="text-lg font-extrabold text-brand-slatedark">אימות כרטיס אשראי</h2>

            {/* הסבר ברור על החיוב */}
            <div className="card p-3 bg-amber-50 border-amber-200 text-sm space-y-1">
              <p className="font-semibold text-amber-900">
                חיוב חד‑פעמי של <span className="text-brand-rust">1₪ בלבד</span> לאימות הכרטיס
              </p>
              <p className="text-amber-800">
                הסכום יקוזז אוטומטית מהחשבון הראשון שלך — כך שלמעשה לא תשלם עליו.
              </p>
            </div>

            {/* iframe של נדרים פלוס */}
            {nedarimIframeUrl ? (
              <div className="rounded-xl overflow-hidden border border-zinc-200">
                <iframe
                  src={nedarimIframeUrl}
                  className="w-full"
                  style={{ height: "380px", border: "none" }}
                  title="אימות כרטיס אשראי"
                />
              </div>
            ) : (
              <p className="text-sm text-zinc-500">טוען...</p>
            )}

            <label className="flex items-start gap-3 card p-3 cursor-pointer">
              <input
                type="checkbox"
                checked={paymentDone}
                onChange={(e) => setPaymentDone(e.target.checked)}
                className="mt-1 h-5 w-5 accent-brand-rust"
              />
              <span className="text-sm font-medium text-zinc-700">
                אישרתי את החיוב של 1₪ לאימות הכרטיס
              </span>
            </label>

            {error && <p className="text-red-600 text-sm">{error}</p>}
            <button
              disabled={!paymentDone || loading}
              onClick={finishRegistration}
              className="btn-primary w-full"
            >
              {loading ? "מסיים הרשמה..." : "סיום הרשמה"}
            </button>
          </div>
        )}
      </div>
    </main>
  );
}

export default function RegisterPage() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center" style={{background:"linear-gradient(to bottom, #fff3a3, #fff8d8)"}}>טוען...</div>}>
      <RegisterPageInner />
    </Suspense>
  );
}
