"use client";

// קומפוננט משותף לעדכון כרטיס אשראי
// שימוש: <UpdateCardButton customerId={id} onSuccess={fn} />
//
// מתאים לכל 3 הרמות:
//   - לקוח (באזור אישי) - customerId = החשבון שלו
//   - מנהל (מסך לקוחות) - customerId = של הלקוח שנבחר
//   - נציג (אם יש הרשאה) - customerId = של הלקוח
//
// הflow:
// 1. לחיצה על הכפתור פותחת Modal עם iframe של נדרים
// 2. הלקוח מזין פרטי כרטיס + מפצה על תוקף
// 3. אישור → 1 ש"ח יורד לאימות + נשמר טוקן חדש (מחליף ישן)
// 4. onSuccess נקראת אחרי הצלחה

import { useEffect, useRef, useState } from "react";

// ═════════════════════════════════════════════════════════
// TYPES
// ═════════════════════════════════════════════════════════
type Props = {
  customerId: string;
  // האם יש כרטיס ישן (להצגת ההודעה "החלף כרטיס")
  hasCurrentCard?: boolean;
  cardLast4?: string | null;
  // כפתור מותאם: אם רוצים כפתור בעיצוב אחר, אפשר להעביר. אם null, נוצר default
  buttonClassName?: string;
  buttonLabel?: string;
  // callback אחרי הצלחה
  onSuccess?: () => void;
};

// ═════════════════════════════════════════════════════════
// MAIN COMPONENT
// ═════════════════════════════════════════════════════════
export function UpdateCardButton({
  customerId,
  hasCurrentCard,
  cardLast4,
  buttonClassName,
  buttonLabel,
  onSuccess,
}: Props) {
  const [open, setOpen] = useState(false);

  const label = buttonLabel || (hasCurrentCard ? "🔄 עדכן כרטיס" : "➕ הוסף כרטיס");
  const className =
    buttonClassName ||
    (hasCurrentCard
      ? "inline-flex items-center gap-1.5 px-3 py-1.5 bg-white border border-brand-rust text-brand-rust text-sm font-bold rounded-lg hover:bg-brand-rust hover:text-white transition-colors"
      : "inline-flex items-center gap-1.5 px-3 py-1.5 bg-brand-rust text-white text-sm font-bold rounded-lg hover:bg-[#a83a15] transition-colors");

  return (
    <>
      <button onClick={() => setOpen(true)} className={className}>
        {label}
        {hasCurrentCard && cardLast4 && (
          <span className="text-xs opacity-70" dir="ltr">
            (****{cardLast4})
          </span>
        )}
      </button>

      {open && (
        <UpdateCardModal
          customerId={customerId}
          onClose={() => setOpen(false)}
          onSuccess={() => {
            setOpen(false);
            onSuccess?.();
          }}
        />
      )}
    </>
  );
}

// ═════════════════════════════════════════════════════════
// MODAL - הflow המלא
// ═════════════════════════════════════════════════════════
function UpdateCardModal({
  customerId,
  onClose,
  onSuccess,
}: {
  customerId: string;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "verifying" | "success" | "error">(
    "idle"
  );
  const [error, setError] = useState<string | null>(null);
  const [cardTokef, setCardTokef] = useState(""); // MMYY
  // ref יציב לגישה מתוך postMessage listener (נמנע מ-stale closure)
  const cardTokefRef = useRef("");
  useEffect(() => {
    cardTokefRef.current = cardTokef;
  }, [cardTokef]);

  // מנעול לחסימת processing כפול
  const processingRef = useRef(false);
  // ⭐ שומרים את cardVerifiedAt הראשוני - כדי לזהות רק שינוי אמיתי
  const initialVerifiedAtRef = useRef<string | null>(null);

  // בטעינה - שומרים את cardVerifiedAt הנוכחי כדי לזהות רק אימות חדש
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(
          `/api/customer/verification-status?customerId=${customerId}`
        );
        const data = await res.json();
        initialVerifiedAtRef.current = data.cardVerifiedAt || null;
      } catch {
        // מתעלמים
      }
    })();
  }, [customerId]);

  // URL של iframe נדרים - זהה לזה של OrderFlow
  const iframeUrl =
    "https://www.matara.pro/nedarimplus/iframe?" +
    new URLSearchParams({
      language: "he",
      Mosad: "7015318",
      ApiValid: "NxhXRWeG5P",
      Amount: "1",
      AmountLock: "1",
      PaymentType: "CreateToken",
      TransactionType: "Debit",
      Tashlumim: "1",
      Tokef: "Hide",
      CVV: "Hide",
      CallBack: "https://tzidkat.com/api/webhooks/nedarim",
      param1: customerId,
      param2: "registration",
    }).toString();

  // Polling של verification-status
  useEffect(() => {
    if (status === "success" || status === "error") return;
    // מחכים שהtimestamp הראשוני נטען - כדי לא לסמן שווא-חיובי
    if (status === "idle") return;
    const interval = setInterval(async () => {
      if (processingRef.current) return;
      try {
        const res = await fetch(`/api/customer/verification-status?customerId=${customerId}`);
        const data = await res.json();
        // ⭐ רק אם cardVerifiedAt השתנה = יש אימות חדש
        const newVerifiedAt = data.cardVerifiedAt || null;
        const initial = initialVerifiedAtRef.current;
        if (data.verified && newVerifiedAt && newVerifiedAt !== initial) {
          processingRef.current = true;
          setStatus("success");
          setTimeout(() => onSuccess(), 1500); // מציג הודעת הצלחה לרגע
        }
      } catch {
        // מתעלמים
      }
    }, 2500);
    return () => clearInterval(interval);
  }, [status, customerId, onSuccess]);

  // postMessage listener מ-iframe של נדרים
  useEffect(() => {
    async function handleMessage(e: MessageEvent) {
      const origin = e.origin || "";
      if (!origin.includes("matara.pro")) return;

      let payload: any = e.data;
      if (typeof payload === "string") {
        try {
          payload = JSON.parse(payload);
        } catch {
          return;
        }
      }
      if (!payload || typeof payload !== "object") return;

      const name = payload.Name || payload.name;
      const value = payload.Value ?? payload.value;

      if (name !== "TransactionResponse") return;

      console.log("[UpdateCard] TransactionResponse:", value);
      const status = String(value?.Status || "").toLowerCase();
      const isError = status === "error" || status === "err" || status === "fail";
      const isOk = status === "ok" || status === "success";

      if (isError) {
        setStatus("error");
        setError(
          value?.Message || value?.message || "אירעה שגיאה בעדכון הכרטיס"
        );
        return;
      }

      if (!isOk) {
        console.warn("[UpdateCard] unknown status:", status, value);
        setStatus("error");
        setError(`סטטוס לא מזוהה מנדרים: ${status || "(ריק)"}`);
        return;
      }

      // ═══ הצלחה! נדרים מחזירים את הטוקן ישירות ב-TransactionResponse ═══
      // במצב CreateToken אין webhook - חובה לשמור את הטוקן כאן, ישירות.
      // Tokef: נדרים לא תמיד מחזירים אותו בחזרה - ניפול חזרה לשדה שהמשתמש הזין (cardTokef).
      const receivedToken = String(value?.Token || value?.token || "").trim();
      const receivedLast4 = String(value?.LastNum || value?.lastNum || "").trim();
      const receivedTokef =
        String(
          value?.Tokef || value?.tokef || value?.CardValidity || value?.Expiry || ""
        ).trim() || cardTokefRef.current.replace(/\D/g, "");

      if (!receivedToken) {
        console.warn("[UpdateCard] Status OK but no Token in response:", value);
        setStatus("error");
        setError("נדרים אישרו אך לא החזירו טוקן. נסה שוב או פנה לתמיכה.");
        return;
      }

      console.log(
        `[UpdateCard] ✅ Token received: ${receivedToken.slice(0, 6)}..., tokef: ${
          receivedTokef || "MISSING!"
        }, saving...`
      );

      try {
        const saveRes = await fetch("/api/customer/save-token", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            customerId, // תומך בעדכון ע"י מנהל/נציג בשם לקוח
            token: receivedToken,
            lastNum: receivedLast4,
            tokef: receivedTokef,
          }),
        });
        const saveData = await saveRes.json().catch(() => ({}));
        if (saveRes.ok) {
          console.log("[UpdateCard] Token saved successfully:", saveData);
          processingRef.current = true;
          setStatus("success");
          setTimeout(() => onSuccess(), 1500);
        } else {
          console.error("[UpdateCard] Failed to save token:", saveData);
          setStatus("error");
          setError(
            `הטוקן התקבל מנדרים אבל שמירתו נכשלה: ${
              saveData.error || "שגיאה לא ידועה"
            }`
          );
        }
      } catch (fetchErr: any) {
        console.error("[UpdateCard] Network error saving token:", fetchErr);
        setStatus("error");
        setError("שגיאת רשת בשמירת הטוקן. בדוק את החיבור ונסה שוב.");
      }
    }
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customerId]);

  function submitVerification() {
    if (!cardTokef || cardTokef.length !== 4) {
      setError("יש להזין תוקף כרטיס בפורמט MMYY (למשל 1225)");
      return;
    }
    const mm = parseInt(cardTokef.slice(0, 2), 10);
    if (mm < 1 || mm > 12) {
      setError("חודש התוקף לא תקין - יש להזין 01 עד 12");
      return;
    }
    if (!iframeRef.current?.contentWindow) {
      setError("ה-iframe לא נטען כראוי. רענן את הדף ונסה שוב.");
      return;
    }
    setError(null);
    setStatus("verifying");

    // שליחת ההוראה לנדרים - חייבים לכלול את כל הפרמטרים ב-Value!
    // זהו הפרוטוקול של נדרים - Param1/Param2 בURL של iframe לא מספיקים
    iframeRef.current.contentWindow.postMessage(
      {
        Name: "FinishTransaction2",
        Value: {
          Mosad: "7015318",
          ApiValid: "NxhXRWeG5P",
          // חייב להיות זהה ל-PaymentType שב-URL של ה-iframe!
          PaymentType: "CreateToken",
          Currency: "1",
          Amount: "1",
          Tashlumim: "1",
          CallBack: "https://tzidkat.com/api/webhooks/nedarim",
          Param1: customerId,
          Param2: "registration",
          // גיבוי: גם ב-Comment (במידה ש-Param1/Param2 לא עוברים ב-response)
          Comment: `customer:${customerId}|type:registration`,
          Zeout: "",
          FirstName: "",
          LastName: "",
          Street: "",
          City: "",
          Phone: "",
          Mail: "",
          Groupe: "Registration",
        },
      },
      "*"
    );
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="bg-white w-full max-w-lg sm:rounded-2xl rounded-t-2xl max-h-[95vh] overflow-y-auto shadow-2xl">
        <div className="sticky top-0 bg-white border-b border-zinc-200 px-5 py-3 flex items-center justify-between z-10">
          <h3 className="font-extrabold text-brand-slatedark text-lg">
            💳 עדכון כרטיס אשראי
          </h3>
          <button
            onClick={onClose}
            className="text-zinc-400 hover:text-zinc-600 text-2xl leading-none px-2"
          >
            ×
          </button>
        </div>

        <div className="p-5 space-y-4">
          {status === "success" ? (
            // מסך הצלחה
            <div className="text-center py-8">
              <div className="w-16 h-16 mx-auto mb-3 rounded-full bg-emerald-500 flex items-center justify-center">
                <svg
                  className="w-10 h-10 text-white"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={3}
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <p className="font-extrabold text-brand-slatedark text-lg">
                הכרטיס עודכן בהצלחה!
              </p>
              <p className="text-sm text-zinc-500 mt-1">
                מהחיוב הבא ואילך ישתמש בכרטיס החדש
              </p>
            </div>
          ) : (
            <>
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-xs text-blue-900">
                <div className="font-bold mb-1">🔒 תשלום מאובטח</div>
                <ul className="space-y-1 pr-4 list-disc">
                  <li>יחויב 1 ש"ח לאימות הכרטיס (נזקף לזכותך)</li>
                  <li>נשמר טוקן מוצפן - לא רואים את פרטי הכרטיס</li>
                  <li>מהחיוב הבא לא צריך להזין שוב פרטים</li>
                </ul>
              </div>

              {/* תוקף כרטיס - נאסף על ידינו כי נדרים אוסרים ב-CreateToken */}
              <div>
                <label className="text-xs font-bold text-zinc-500 block mb-1">
                  תוקף כרטיס (MMYY) *
                </label>
                <input
                  type="text"
                  value={cardTokef}
                  onChange={(e) =>
                    setCardTokef(e.target.value.replace(/\D/g, "").slice(0, 4))
                  }
                  placeholder="1225"
                  inputMode="numeric"
                  maxLength={4}
                  disabled={status === "verifying"}
                  className="w-full px-3 py-2 border-2 border-zinc-300 rounded-lg text-lg font-mono text-center focus:outline-none focus:border-brand-rust"
                />
                <p className="text-[10px] text-zinc-500 mt-1">
                  לדוגמה: אם התוקף 12/25, הזן 1225
                </p>
              </div>

              {/* iframe של נדרים */}
              <div className="border-2 border-zinc-200 rounded-xl overflow-hidden bg-zinc-50">
                <iframe
                  ref={iframeRef}
                  src={iframeUrl}
                  className="w-full"
                  style={{ height: "460px", border: "none" }}
                  title="עדכון כרטיס אשראי"
                />
              </div>

              {error && (
                <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-800">
                  ⚠️ {error}
                </div>
              )}
            </>
          )}
        </div>

        {status !== "success" && (
          <div className="sticky bottom-0 bg-white border-t border-zinc-200 p-4 flex gap-2">
            <button
              onClick={onClose}
              disabled={status === "verifying"}
              className="flex-1 py-3 rounded-xl border border-zinc-300 text-brand-slatedark font-bold hover:bg-zinc-50 disabled:opacity-50"
            >
              ביטול
            </button>
            <button
              onClick={submitVerification}
              disabled={status === "verifying" || !cardTokef || cardTokef.length !== 4}
              className="flex-1 py-3 rounded-xl bg-brand-rust text-white font-bold hover:bg-[#a83a15] disabled:opacity-50 shadow-md"
            >
              {status === "verifying" ? "מאמת..." : "אמת ושמור כרטיס"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
