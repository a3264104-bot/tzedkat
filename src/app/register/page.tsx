"use client";

import { useState, useEffect, useMemo, Suspense } from "react";
// §290: חלונית עדכון אשראי מיד אחרי ההרשמה
import { UpdateCardModal } from "@/components/UpdateCardButton";
import { PasswordInput } from "@/components/PasswordInput";
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
  // אם המשתמש הגיע מ-Google Sign-In - מקבלים את המייל והשם ממולאים
  const googleEmail = params.get("googleEmail") || "";
  const googleName = params.get("googleName") || "";
  const fromGoogle = !!googleEmail;

  const [step, setStep] = useState<RegStep>("details");
  const [points, setPoints] = useState<Point[]>([]);

  // §173: שם פרטי ומשפחה בנפרד.
  //
  // 🐛 מה שגרם לבעיה: שדה "שם מלא" אחד. לקוחות הזינו "ברכה"
  // בלבד, ובחלוקה אי אפשר היה לדעת אם זה שם פרטי או שם משפחה.
  //
  // ⚠️ מגוגל מגיע שם מלא אחד. הפיצול כאן הוא **מילוי מראש
  // שהלקוח רואה ויכול לתקן** - שונה מהותית מפיצול אוטומטי במסד,
  // שם איש לא היה בודק אותו.
  const [firstName, setFirstName] = useState(
    googleName ? googleName.trim().split(/\s+/)[0] : ""
  );
  const [lastName, setLastName] = useState(
    googleName ? googleName.trim().split(/\s+/).slice(1).join(" ") : ""
  );
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState(googleEmail);
  const [password, setPassword] = useState("");
  const [password2, setPassword2] = useState("");
  // אישור קריאה והסכמה לתנאי שימוש ומדיניות פרטיות (חובה חוקית)
  const [agreedToTerms, setAgreedToTerms] = useState(false);
  // §66: אישור המיילים אוחד לתוך אישור התנאים (סעיף 2).
  // שני צ'קבוקסים נפרדים גרמו לנטישות בהרשמה - הלקוח סימן אחד,
  // לחץ "המשך", וקיבל שגיאה. ההסכמה עצמה לא בוטלה: היא נכללת
  // מפורשות בנוסח שהלקוח מאשר, ונשמרת עם חותמת זמן כמו קודם.
  const agreedToEmails = agreedToTerms;
  const [error, setError] = useState("");
  // §75: כשהטלפון כבר רשום - מציגים מסלול המשך ולא רק שגיאה
  const [existingAccount, setExistingAccount] = useState<{
    hasLoginCode: boolean;
    hasEmail: boolean;
  } | null>(null);
  const [loading, setLoading] = useState(false);

  // §290: 💳 חלונית האשראי מיד אחרי ההרשמה.
  //
  // הבעיה מהשטח: הרבה לקוחות נרשמים ולא מזמינים - והם נשארים
  // בלי אמצעי תשלום. כשהם סוף סוף מזמינים, הם נתקלים בחסימה
  // ברגע הכי גרוע: אחרי שבנו עגלה שלמה.
  //
  // ⚠️ **לא חובה**: אפשר לסגור ולהמשיך. החסימה בהזמנה הראשונה
  // (§61/§202) נשארת בדיוק כפי שהיא - זה רק מקדים את ההזדמנות.
  //
  // ⚠️ מזהה הלקוח נשמר מהתשובה של ההרשמה, כי החלונית צריכה
  // אותו כדי לשמור את הטוקן.
  const [cardForCustomerId, setCardForCustomerId] = useState<string | null>(
    null
  );
  const [pendingRedirect, setPendingRedirect] = useState<string | null>(null);

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

  // §77: הנקודות שמוצגות בפועל בשלב הזה
  const visiblePoints = showCityStep ? pointsInCity : points;

  // §77: בחירה אוטומטית כשיש נקודה אחת בלבד.
  //
  // 🐛 המצב שתוקן: בעיר עם נקודה אחת הוצג "מסך בחירה" עם פריט
  // יחיד. הלקוח לא הבין שצריך ללחוץ עליו לפני "המשך" - זה נראה
  // כמו כותרת, לא כמו כפתור.
  //
  // showCityStep כבר עשה בדיוק את זה לעיר יחידה; כאן זו המקבילה
  // החסרה לנקודות.
  //
  // תלוי גם ב-selectedCity: מעבר לעיר אחרת עם נקודה אחת יבחר
  // אותה מחדש, במקום להשאיר את הבחירה מהעיר הקודמת.
  useEffect(() => {
    if (visiblePoints.length === 1 && defaultPointId !== visiblePoints[0].id) {
      setDefaultPointId(visiblePoints[0].id);
    }
  }, [visiblePoints, defaultPointId]);

  function validateDetails() {
    setError("");
    // §173: שני השדות חובה, ובדיקה נפרדת לכל אחד.
    //
    // ⚠️ הודעה מדויקת ולא "נא להזין שם": מי שמילא רק אחד מהם
    // לא היה יודע מה חסר, וזה בדיוק המצב שיצר את הנתונים
    // החלקיים מלכתחילה.
    if (!firstName.trim()) return setError("יש להזין שם פרטי");
    if (firstName.trim().length < 2) return setError("השם הפרטי קצר מדי");
    if (!lastName.trim()) return setError("יש להזין שם משפחה");
    if (lastName.trim().length < 2) return setError("שם המשפחה קצר מדי");
    if (!phone.trim()) return setError("יש להזין מספר טלפון — איתו תתחבר למערכת");
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return setError("כתובת מייל לא תקינה");
    if (password.length < 6) return setError("הסיסמה חייבת להכיל לפחות 6 תווים");
    if (password !== password2) return setError("הסיסמאות אינן תואמות");
    // §66: בדיקה אחת. agreedToEmails נגזר מ-agreedToTerms.
    if (!agreedToTerms)
      return setError("יש לאשר את תנאי השימוש ומדיניות הפרטיות כדי להירשם");
    setStep("station");
  }

  async function proceedToPayment() {
    setError("");
    setExistingAccount(null);
    setLoading(true);
    try {
      const res = await fetch("/api/customer/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          // §173: השרת מרכיב את השם המלא משני החלקים, ומאמת
          // אותם שוב - הסתרת שדה נעקפת בבקשה ישירה.
          firstName: firstName.trim(),
          lastName: lastName.trim(),
          phone: phone.trim() || null,
          email: email.trim().toLowerCase() || null,
          password,
          defaultPointId: defaultPointId || null,
          agreedToEmails,
          // §22: נשלח לשרת כדי שההסכמה תישמר עם חותמת זמן וגרסה.
          // עד כה הסימון נבדק בטופס בלבד ולא נשלח כלל, כך שלא נשמרה
          // שום הוכחה שהלקוח אישר את התנאים.
          agreedToTerms,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (data.code === "DUPLICATE_PHONE" || data.code === "DUPLICATE_EMAIL") {
          setStep("details");
          setError(data.error);
          // §75: 🐛 הלקוח שנרשם בטלפון היה נתקע כאן - ההרשמה חסומה,
          // וההודעה שלחה אותו ל"שכחתי סיסמה" שעובד רק דרך מייל
          // שאין לו. עכשיו הוא מקבל כפתור שמוביל למקום הנכון.
          if (data.code === "DUPLICATE_PHONE") {
            setExistingAccount({
              hasLoginCode: !!data.hasLoginCode,
              hasEmail: !!data.hasEmail,
            });
          }
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
        return;
      }

      // §290: 💳 מציעים לעדכן אשראי **לפני** ההפניה.
      //
      // ⚠️ ההפניה נשמרת ולא מבוצעת: אחרי שהלקוח סוגר את החלונית
      // (בין אם הזין כרטיס ובין אם לא) הוא ממשיך בדיוק לאן
      // שהתכוון.
      //
      // ⚠️ רק כשיש מזהה: בלעדיו החלונית לא יכולה לשמור, ועדיף
      // לדלג בשקט מאשר להציג חלונית שנכשלת.
      // ⚠️ השדה נקרא id ולא customerId — זה מה שה-API מחזיר.
      if (data?.id) {
        setCardForCustomerId(data.id);
        setPendingRedirect(callbackUrl);
        setLoading(false);
        return;
      }

      router.replace(callbackUrl);
    } catch {
      setError("שגיאת שרת. נסה שוב.");
    } finally {
      setLoading(false);
    }
  }


  // בנוסף לחיוב 1₪ לאימות. אם נדרים דורשים שמות אחרים - נראה זאת בלוג ונתקן.

  // §290: אחרי סגירת החלונית — ממשיכים לאן שהלקוח התכוון.
  function finishCardStep() {
    setCardForCustomerId(null);
    router.replace(pendingRedirect || "/");
  }

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

            {fromGoogle && (
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-sm text-blue-900">
                <div className="font-bold mb-1">👋 ברוך הבא!</div>
                התחברת עם Google — נדרש להוסיף טלפון + סיסמא + נקודת חלוקה כדי להשלים את הרישום.
              </div>
            )}

            {!fromGoogle && (
              <>
                <button
                  type="button"
                  onClick={() =>
                    signIn("google", { callbackUrl })
                  }
                  className="w-full flex items-center justify-center gap-3 px-4 py-3 rounded-xl border-2 border-zinc-200 hover:bg-zinc-50 font-bold text-brand-slatedark shadow-sm transition"
                >
                  <svg className="w-5 h-5" viewBox="0 0 24 24" aria-hidden="true">
                    <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                    <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                    <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                    <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                  </svg>
                  הרשמה עם Google
                </button>

                <div className="flex items-center gap-3">
                  <div className="flex-1 border-t border-zinc-200"></div>
                  <span className="text-xs text-zinc-400">או הרשמה עם טלפון</span>
                  <div className="flex-1 border-t border-zinc-200"></div>
                </div>
              </>
            )}

            {/* §173: שני שדות ולא אחד.

                🐛 מה שגרם לבעיה: לקוחות הזינו "ברכה" בלבד בשדה
                "שם מלא", ובחלוקה אי אפשר היה לדעת אם זה שם פרטי
                או שם משפחה.

                ⚠️ הסדר - פרטי ואז משפחה - קובע את השם המלא
                שנשמר, ולכן את מה שהנציג רואה בדף החלוקה ובמיילים. */}
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="label" htmlFor="reg-first">
                  שם פרטי *
                </label>
                <input
                  id="reg-first"
                  className="input"
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  placeholder="יוסי"
                  autoComplete="given-name"
                  aria-required="true"
                />
              </div>
              <div>
                <label className="label" htmlFor="reg-last">
                  שם משפחה *
                </label>
                <input
                  id="reg-last"
                  className="input"
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  placeholder="כהן"
                  autoComplete="family-name"
                  aria-required="true"
                />
              </div>
            </div>
            <div>
              <label className="label" htmlFor="reg-phone">טלפון *</label>
              <input
                id="reg-phone"
                className="input"
                type="tel"
                inputMode="tel"
                placeholder="050-1234567"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                aria-required="true"
              />
            </div>
            <div>
              <label className="label" htmlFor="reg-email">
                מייל <span className="text-brand-rust font-bold">(מומלץ מאוד)</span>
              </label>
              <input
                id="reg-email"
                className="input"
                type="email"
                inputMode="email"
                placeholder="user@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <p className="text-xs text-zinc-500 leading-relaxed">
              💡 ההתחברות מתבצעת עם הטלפון או המייל. הוספת מייל מאפשרת <strong>לאפס סיסמא באופן עצמאי</strong>, ולקבל אישורי הזמנה.
              <br />
              בלי מייל — איפוס סיסמא יתאפשר רק דרך המנהל.
            </p>
            <div>
              <label className="label">סיסמה *</label>
              <PasswordInput
                value={password}
                onChange={setPassword}
                autoComplete="new-password"
              />
            </div>
            <div>
              <label className="label">אימות סיסמה *</label>
              <PasswordInput
                value={password2}
                onChange={setPassword2}
                autoComplete="new-password"
              />
            </div>

            {/* §66: אישור אחד - תנאים + מיילים (סעיף 2).
                ההסכמה למיילים נשארת מפורשת בנוסח ולא נעלמת, כי היא
                נדרשת להוכחה במחלוקת (GDPR/CAN-SPAM). מה שהשתנה זו
                רק החוויה: סימון אחד במקום שניים. */}
            <label className="flex items-start gap-2 bg-blue-50 border border-blue-200 rounded-lg p-3 cursor-pointer">
              <input
                type="checkbox"
                checked={agreedToTerms}
                onChange={(e) => setAgreedToTerms(e.target.checked)}
                className="mt-0.5 w-4 h-4 accent-brand-rust shrink-0"
                aria-label="אישור קריאה והסכמה לתנאי שימוש ומדיניות פרטיות"
              />
              <div className="text-xs text-brand-slatedark leading-relaxed">
                קראתי ואני מסכים/ה ל
                <Link
                  href="/terms"
                  target="_blank"
                  className="text-brand-rust font-medium underline underline-offset-2"
                >
                  תנאי השימוש
                </Link>{" "}
                ול
                <Link
                  href="/privacy"
                  target="_blank"
                  className="text-brand-rust font-medium underline underline-offset-2"
                >
                  מדיניות הפרטיות
                </Link>
                , ולקבלת עדכונים במייל על פתיחת מכירות והודעות כלליות
                <span className="text-brand-rust font-bold"> *</span>
                <span className="text-zinc-500 block mt-1">
                  מיילים תפעוליים (אישור הזמנה, אישור תשלום) יישלחו בכל
                  מקרה כחלק מהשירות. ניתן לבטל קבלת עדכונים בכל עת.
                </span>
              </div>
            </label>

            {error && <p className="text-red-600 text-sm" role="alert">{error}</p>}

            {/* §75: מסלול המשך ללקוח שכבר רשום - במקום להשאיר אותו
                מול שגיאה בלי דרך קדימה. */}
            {existingAccount && (
              <div className="bg-blue-50 border-2 border-blue-300 rounded-xl p-3.5 space-y-2.5">
                <div className="text-sm font-bold text-blue-900">
                  ✓ זוהה שכבר התחלת תהליך
                </div>
                <Link
                  href="/login"
                  className="btn-primary w-full block text-center"
                >
                  {existingAccount.hasLoginCode
                    ? "כניסה עם הטלפון והקוד ←"
                    : "מעבר להתחברות ←"}
                </Link>
                {existingAccount.hasEmail && (
                  <Link
                    href="/forgot-password"
                    className="block text-center text-xs text-blue-700 underline"
                  >
                    שכחתי את הסיסמה
                  </Link>
                )}
                {!existingAccount.hasLoginCode && !existingAccount.hasEmail && (
                  <p className="text-xs text-blue-800 leading-relaxed">
                    אין לחשבון שלך מייל, ולכן שחזור סיסמה במייל אינו זמין.
                    התקשר למערכת הטלפונית — קוד הכניסה שלך יוקרא בשיחה.
                  </p>
                )}
              </div>
            )}
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
              {showCityStep && !selectedCity ? "בחרי עיר" : "בחירת תחנת חלוקה"}
            </h2>
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs text-amber-900 leading-relaxed">
              <div className="font-bold mb-1">📍 בחירת תחנת חלוקה קבועה</div>
              <div>
                בחר/י את התחנה הכי נוחה לך.
                <br />
                <strong>אפשר לשנות תחנה בכל עת</strong> מהאזור האישי או בעת ביצוע הזמנה.
              </div>
            </div>

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
                {/* §77: נקודה יחידה - מוצגת כאישור ולא כרשימה לבחירה.
                    היא כבר נבחרה אוטומטית למעלה, והצגתה ככפתור
                    בודד רק גרמה ללקוח לחפש מה צריך ללחוץ. */}
                {visiblePoints.length === 1 ? (
                  <div className="card p-3 ring-2 ring-brand-rust border-brand-rust bg-orange-50/40">
                    <div className="flex items-center gap-2">
                      <span className="text-brand-rust text-lg">✓</span>
                      <div>
                        <div className="font-semibold text-brand-slatedark">
                          {visiblePoints[0].name}
                        </div>
                        <div className="text-xs text-zinc-500">
                          זו תחנת החלוקה{showCityStep ? " בעיר שבחרת" : ""}. אפשר
                          להמשיך.
                        </div>
                      </div>
                    </div>
                  </div>
                ) : (
                  visiblePoints.map((p) => (
                    <button
                      key={p.id}
                      onClick={() => setDefaultPointId(p.id)}
                      className={`w-full text-right card p-3 transition ${
                        defaultPointId === p.id ? "ring-2 ring-brand-rust border-brand-rust" : ""
                      }`}
                    >
                      <span className="font-semibold text-brand-slatedark">{p.name}</span>
                    </button>
                  ))
                )}
              </div>
            )}

            {error && <p className="text-red-600 text-sm" role="alert">{error}</p>}

            {/* §75: מסלול המשך ללקוח שכבר רשום - במקום להשאיר אותו
                מול שגיאה בלי דרך קדימה. */}
            {existingAccount && (
              <div className="bg-blue-50 border-2 border-blue-300 rounded-xl p-3.5 space-y-2.5">
                <div className="text-sm font-bold text-blue-900">
                  ✓ זוהה שכבר התחלת תהליך
                </div>
                <Link
                  href="/login"
                  className="btn-primary w-full block text-center"
                >
                  {existingAccount.hasLoginCode
                    ? "כניסה עם הטלפון והקוד ←"
                    : "מעבר להתחברות ←"}
                </Link>
                {existingAccount.hasEmail && (
                  <Link
                    href="/forgot-password"
                    className="block text-center text-xs text-blue-700 underline"
                  >
                    שכחתי את הסיסמה
                  </Link>
                )}
                {!existingAccount.hasLoginCode && !existingAccount.hasEmail && (
                  <p className="text-xs text-blue-800 leading-relaxed">
                    אין לחשבון שלך מייל, ולכן שחזור סיסמה במייל אינו זמין.
                    התקשר למערכת הטלפונית — קוד הכניסה שלך יוקרא בשיחה.
                  </p>
                )}
              </div>
            )}
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
      {/* §290: 💳 חלונית עדכון האשראי.
          
          מוצגת מיד אחרי הרשמה מוצלחת, לפני ההפניה. הלקוח יכול
          לסגור ולהמשיך - זו הזדמנות, לא חסימה.
          
          החסימה בהזמנה הראשונה (§61/§202) נשארת כפי שהיא. */}
      {cardForCustomerId && (
        <UpdateCardModal
          customerId={cardForCustomerId}
          hasCurrentCard={false}
          onSuccess={finishCardStep}
          onClose={finishCardStep}
        />
      )}
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
