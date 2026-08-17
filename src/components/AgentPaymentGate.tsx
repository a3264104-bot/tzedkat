"use client";

// §61: חוסם אופן תשלום לפני פתיחת הזמנה ע"י נציג.
//
// 🐛 הפער שנסגר כאן: לקוח שנרשם ב-IVR נוצר בלי כרטיס ועם
// paymentPreference ברירת מחדל CREDIT. הנציג קיבל את הבקשה, פתח לו
// הזמנה - ו-/api/orders פוטר הזמנות נציג מדרישת כרטיס בכוונה (הנציג
// לוקח אחריות על הגבייה). התוצאה: הזמנה תקועה בלי שום דרך לגבות -
// אין טוקן לחיוב, ואין סימון מזומן שיפנה אותה לגבייה בשטח. בזמן
// החיוב היא נופלת על "אין כרטיס שמור" וההזמנה נתקעת.
//
// הפתרון אינו לחסום את הנציג מלהזמין - זה היה שובר את העבודה בשטח.
// הפתרון הוא לדרוש **החלטה אחת** לפני שמתחילים: כרטיס או מזומן.
// שתי האפשרויות לגיטימיות, ושתיהן משאירות מסלול גבייה תקין.

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { UpdateCardModal } from "@/components/UpdateCardButton";

export function AgentPaymentGate({
  customerId,
  customerName,
  canUpdateCards,
}: {
  customerId: string;
  customerName: string;
  /** אין הרשאה = הנציג לא יכול להכריע, ומופנה למנהל */
  canUpdateCards: boolean;
}) {
  const router = useRouter();
  const [showCard, setShowCard] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function markCash() {
    setError("");
    setSaving(true);
    try {
      const res = await fetch("/api/agent/customer-payment-pref", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ customerId, preference: "CASH" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "שגיאה");
      // רענון השרת - הדף ייטען מחדש כלקוח מזומן וימשיך להזמנה
      router.refresh();
    } catch (e: any) {
      setError(e.message);
      setSaving(false);
    }
  }

  return (
    <main dir="rtl" className="min-h-screen bg-brand-cream flex items-center justify-center p-6">
      <div className="bg-white rounded-2xl shadow-lg p-6 max-w-md w-full">
        <div className="w-14 h-14 mx-auto mb-4 rounded-full bg-amber-100 flex items-center justify-center text-2xl">
          💳
        </div>
        <h1 className="text-lg font-bold text-brand-slatedark text-center">
          איך {customerName} משלם?
        </h1>
        <p className="text-sm text-zinc-600 mt-2 leading-relaxed text-center">
          ללקוח אין עדיין אמצעי תשלום במערכת. יש לקבוע איך תתבצע הגבייה
          לפני פתיחת ההזמנה — אחרת ההזמנה תיתקע בלי אפשרות לחייב.
        </p>

        {!canUpdateCards ? (
          <div className="mt-5 bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-amber-900">
            אין לך הרשאה לקבוע אמצעי תשלום ללקוחות. יש לפנות למנהל כדי
            שיגדיר את הלקוח כמשלם מזומן, או שיעדכן עבורו כרטיס אשראי.
          </div>
        ) : (
          <div className="mt-5 space-y-2">
            <button
              onClick={() => setShowCard(true)}
              disabled={saving}
              className="w-full py-3 rounded-xl border-2 border-blue-600 bg-blue-50 text-blue-800 font-bold hover:bg-blue-100 disabled:opacity-50"
            >
              💳 הזנת כרטיס אשראי
              <div className="text-[11px] font-normal mt-0.5">
                העבר את המכשיר ללקוח. יחויב 1 ש&quot;ח לאימות, שיקוזז
                מההזמנה הראשונה
              </div>
            </button>
            <button
              onClick={markCash}
              disabled={saving}
              className="w-full py-3 rounded-xl border-2 border-lime-600 bg-lime-50 text-lime-800 font-bold hover:bg-lime-100 disabled:opacity-50"
            >
              {saving ? "מעדכן..." : "💵 תשלום במזומן"}
              <div className="text-[11px] font-normal mt-0.5">
                הגבייה תתבצע במזומן בעת החלוקה, גם בהזמנות הבאות
              </div>
            </button>
          </div>
        )}

        {error && <p className="text-red-600 text-sm mt-3 text-center">{error}</p>}

        <Link
          href="/agent"
          className="block text-center text-xs text-zinc-500 hover:text-brand-rust mt-5"
        >
          חזרה לאזור הנציג
        </Link>
      </div>

      {/* שמירת הטוקן ב-save-token מציבה גם paymentPreference=CREDIT,
          ולכן רענון בלבד מספיק - הדף ייטען כלקוח עם כרטיס. */}
      {showCard && (
        <UpdateCardModal
          customerId={customerId}
          hasCurrentCard={false}
          onClose={() => setShowCard(false)}
          onSuccess={() => {
            setShowCard(false);
            router.refresh();
          }}
        />
      )}
    </main>
  );
}
