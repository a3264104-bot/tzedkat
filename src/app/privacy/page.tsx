import Link from "next/link";
import { Logo } from "@/components/Logo";

export const metadata = {
  title: "מדיניות פרטיות",
  description: "מדיניות הפרטיות של אתר צדקת רבותינו — כיצד אנו אוספים ומגנים על המידע שלך.",
};

export default function PrivacyPage() {
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
          <h1 className="text-2xl font-extrabold text-brand-slatedark">מדיניות פרטיות</h1>
          <p className="text-sm text-zinc-500">עודכן לאחרונה: {new Date().getFullYear()}</p>

          <section className="space-y-2">
            <h2 className="text-lg font-bold text-brand-slatedark">איזה מידע אנו אוספים</h2>
            <p>
              בעת הרשמה והזמנה באתר, אנו אוספים את הפרטים הבאים: שם מלא, מספר טלפון, כתובת דוא"ל
              (אם נמסרה), נקודת החלוקה שבחרת, ופרטי ההזמנות שלך.
            </p>
            <p>
              לצורך תשלום, אנו משתמשים בשירות סליקה חיצוני ומאובטח (נדרים פלוס). פרטי כרטיס האשראי
              המלאים <strong>אינם נשמרים אצלנו</strong> — הם נשמרים באופן מאובטח אצל חברת הסליקה
              בהתאם לתקן PCI. אצלנו נשמר רק מזהה מוצפן (טוקן) וארבע ספרות אחרונות של הכרטיס, לצורך
              חיוב הזמנות עתידיות.
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="text-lg font-bold text-brand-slatedark">כיצד אנו משתמשים במידע</h2>
            <p>המידע משמש אך ורק לצורך:</p>
            <ul className="list-disc pr-6 space-y-1">
              <li>עיבוד וניהול ההזמנות שלך</li>
              <li>יצירת קשר בנוגע להזמנה (טלפון, דוא"ל)</li>
              <li>חיוב עבור הזמנות שביצעת</li>
              <li>שליחת אישורי הזמנה ועדכונים</li>
            </ul>
            <p>איננו מוכרים, משכירים או מעבירים את המידע שלך לצדדים שלישיים לצרכים שיווקיים.</p>
          </section>

          <section className="space-y-2">
            <h2 className="text-lg font-bold text-brand-slatedark">שירותים חיצוניים</h2>
            <p>
              אנו נעזרים בספקי שירות מהימנים לצורך תפעול האתר: חברת הסליקה נדרים פלוס (תשלומים),
              שירות דוא"ל לשליחת אישורים, ושירותי אחסון ותשתית מאובטחים. כל אחד מהם מקבל רק את המידע
              ההכרחי לביצוע תפקידו.
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="text-lg font-bold text-brand-slatedark">אבטחת מידע</h2>
            <p>
              אנו נוקטים באמצעי אבטחה מקובלים להגנה על המידע שלך, כולל הצפנה, גישה מוגבלת, ושמירת
              פרטי אשראי אצל חברת סליקה מוסמכת בלבד. עם זאת, אין אפשרות להבטיח אבטחה מוחלטת בהעברת
              מידע באינטרנט.
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="text-lg font-bold text-brand-slatedark">הזכויות שלך</h2>
            <p>
              באפשרותך לעיין במידע שלך, לעדכן אותו או לבקש את מחיקתו, בכפוף לחובות חוקיות לשמירת
              רשומות. לבקשות בנושא פרטיות, ניתן לפנות אלינו.
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="text-lg font-bold text-brand-slatedark">עוגיות (Cookies)</h2>
            <p>
              האתר משתמש בעוגיות הכרחיות בלבד — לצורך שמירת ההתחברות שלך למערכת. איננו משתמשים
              בעוגיות למעקב שיווקי.
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="text-lg font-bold text-brand-slatedark">יצירת קשר</h2>
            <p>לשאלות בנוגע למדיניות פרטיות זו, ניתן לפנות אלינו דרך פרטי הקשר באתר.</p>
          </section>

          <div className="pt-4 border-t flex gap-4 text-sm">
            <Link href="/" className="text-brand-rust font-medium">
              ← חזרה לדף הבית
            </Link>
            <Link href="/terms" className="text-brand-rust font-medium">
              תנאי שימוש
            </Link>
          </div>
        </div>
      </div>
    </main>
  );
}
