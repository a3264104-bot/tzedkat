import Link from "next/link";
import { Logo } from "@/components/Logo";

export const metadata = {
  title: "תנאי שימוש",
  description: "תנאי השימוש של אתר צדקת רבותינו.",
};

export default function TermsPage() {
  return (
    <main
      dir="rtl"
      className="min-h-screen"
      style={{ background: "linear-gradient(to bottom, #fff3a3, #fff8d8)" }}
    >
      <div className="mx-auto max-w-2xl px-5 py-10">
        <div className="flex justify-center mb-6">
          <Link href="/">
            <Logo size={90} />
          </Link>
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-zinc-100 p-6 md:p-8 space-y-5 text-zinc-700 leading-relaxed">
          <h1 className="text-2xl font-extrabold text-brand-slatedark">תנאי שימוש</h1>
          <p className="text-sm text-zinc-500">עודכן לאחרונה: {new Date().getFullYear()}</p>

          <section className="space-y-2">
            <h2 className="text-lg font-bold text-brand-slatedark">כללי</h2>
            <p>
              אתר צדקת רבותינו מאפשר הזמנת עופות, בשר ודגים במסגרת מכירות תקופתיות, עם חלוקה בנקודות
              איסוף. השימוש באתר ובהזמנה מהווה הסכמה לתנאים אלה.
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="text-lg font-bold text-brand-slatedark">מחיר משוער ומחיר סופי</h2>
            <p>
              חלק מהמוצרים נמכרים לפי משקל. המחיר המוצג בעת ההזמנה הוא <strong>מחיר משוער</strong>{" "}
              בלבד, המבוסס על משקל ממוצע. <strong>המחיר הסופי</strong> נקבע לאחר שקילה בפועל של
              המוצרים, וייתכנו הפרשים בהתאם למשקל המדויק.
            </p>
            <p>
              לאחר קביעת המחיר הסופי, תישלח אליך הודעה עם קישור לתשלום, או שהתשלום יבוצע באמצעות אמצעי
              התשלום שנשמר.
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="text-lg font-bold text-brand-slatedark">תשלום</h2>
            <p>
              התשלום מתבצע באמצעות כרטיס אשראי דרך חברת סליקה מאובטחת. בעת ההרשמה מתבצע חיוב אימות
              חד-פעמי בסך 1 ש"ח לצורך אימות תקינות הכרטיס, אשר יקוזז מההזמנה הראשונה.
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="text-lg font-bold text-brand-slatedark">הזמנות וביטולים</h2>
            <p>
              הזמנות ניתן לבצע בתקופת המכירה הפעילה בלבד. לבירורים, שינויים או ביטולים, יש לפנות
              בהקדם דרך פרטי הקשר באתר. ביטול הזמנה כפוף לזמינות ולשלב שבו נמצאת ההזמנה.
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="text-lg font-bold text-brand-slatedark">איסוף</h2>
            <p>
              האיסוף מתבצע בנקודת החלוקה שבחרת, במועדים ובשעות המפורסמים לכל נקודה. באחריותך לאסוף את
              ההזמנה במועד שנקבע.
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="text-lg font-bold text-brand-slatedark">אחריות</h2>
            <p>
              אנו עושים כמיטב יכולתנו לספק מוצרים טריים ואיכותיים ולהציג מידע מדויק. איננו אחראים
              לעיכובים או תקלות הנובעים מגורמים שאינם בשליטתנו.
            </p>
          </section>

          <div className="pt-4 border-t flex gap-4 text-sm">
            <Link href="/" className="text-brand-rust font-medium">
              ← חזרה לדף הבית
            </Link>
            <Link href="/privacy" className="text-brand-rust font-medium">
              מדיניות פרטיות
            </Link>
          </div>
        </div>
      </div>
    </main>
  );
}
