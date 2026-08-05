// עמוד תנאי שימוש
//

export const metadata = {
  title: "תנאי שימוש | צדקת רבותינו",
  description: "תנאי השימוש של אתר צדקת רבותינו",
};

export default function TermsPage() {
  return (
    <main dir="rtl" className="min-h-screen bg-white">
      <div className="mx-auto max-w-3xl px-4 py-10">
        <h1 className="text-3xl font-extrabold text-brand-slatedark mb-2">
          תנאי שימוש
        </h1>
        <p className="text-sm text-zinc-500 mb-6">
          עודכן לאחרונה: 5 באוגוסט 2026
        </p>

        <div className="max-w-none space-y-5 text-brand-slatedark leading-relaxed">
          <p>
            ברוכים הבאים לאתר צדקת רבותינו. השימוש באתר ובשירותיו כפוף לתנאים
            המפורטים להלן. עצם השימוש באתר וביצוע הזמנה מהווים הסכמה לתנאים אלו.
          </p>

          <section>
            <h2 className="text-xl font-bold mt-6 mb-2">1. כללי</h2>
            <p>
              האתר מופעל על ידי עמותת צדקת רבותינו. התנאים
              מנוסחים בלשון זכר מטעמי נוחות בלבד ומופנים לכל המגדרים.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-bold mt-6 mb-2">2. ההזמנות והמוצרים</h2>
            <ul className="list-disc pr-6 space-y-1">
              <li>האתר מאפשר הזמנת מוצרי בשר, עוף ודגים לחלוקה בנקודות שנקבעו.</li>
              <li>
                <strong>מחיר משוער מול מחיר סופי:</strong> המחיר המוצג בעת ההזמנה
                הוא מחיר משוער בלבד. המחיר הסופי נקבע לאחר שקילה בפועל של המוצרים.
              </li>
              <li>
                <strong>סטיות במשקל (בודדים):</strong> בהזמנת פריטים "בודדים",
                המשקל בפועל עשוי להיות שונה מהכמות שהוזמנה, מאחר שכל פריט נשקל
                בנפרד ובמשקל שונה. ביצוע ההזמנה מהווה אישור והסכמה לכך.
              </li>
              <li>העמותה רשאית להגביל כמויות או לבטל פריטים בהתאם למלאי.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-bold mt-6 mb-2">3. תשלום וחיוב</h2>
            <ul className="list-disc pr-6 space-y-1">
              <li>התשלום מתבצע באמצעות כרטיס אשראי דרך מערכת סליקה מאובטחת.</li>
              <li>
                בעת רישום כרטיס אשראי מבוצע חיוב אימות בסך 1 ש"ח, המקוזז מסכום
                ההזמנה הראשונה.
              </li>
              <li>
                החיוב הסופי מתבצע לאחר קביעת המחיר הסופי (לאחר שקילה), בהתאם למשקל
                בפועל.
              </li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-bold mt-6 mb-2">4. ביטול הזמנה</h2>
            <p>
              ניתן לבטל או לשנות הזמנה כל עוד לא נקבע המחיר הסופי (טרם שקילה) ובתוך
              מועד הסגירה של המכירה. ביטול עסקה יתבצע בהתאם להוראות חוק הגנת הצרכן,
              התשמ"א-1981, ככל שהן חלות.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-bold mt-6 mb-2">5. אחריות</h2>
            <p>
              העמותה עושה מאמץ לספק מידע מדויק ושירות תקין. עם זאת, העמותה לא תישא
              באחריות לנזק עקיף הנובע משימוש באתר או מתקלות טכניות שאינן בשליטתה.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-bold mt-6 mb-2">6. קניין רוחני</h2>
            <p>
              כל התכנים באתר, לרבות עיצוב, טקסטים ותמונות, הם קניינה של העמותה ואין
              לעשות בהם שימוש ללא רשות.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-bold mt-6 mb-2">7. פרטיות</h2>
            <p>
              השימוש באתר כפוף גם ל
              <a href="/privacy" className="text-brand-rust underline underline-offset-2">
                מדיניות הפרטיות
              </a>
              .
            </p>
          </section>

          <section>
            <h2 className="text-xl font-bold mt-6 mb-2">8. דין וסמכות שיפוט</h2>
            <p>
              על תנאים אלו יחולו דיני מדינת ישראל, וסמכות השיפוט הבלעדית בכל
              מחלוקת נתונה לבתי המשפט המוסמכים במדינת ישראל.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-bold mt-6 mb-2">9. יצירת קשר</h2>
            <p>
              בכל שאלה בנוגע לתנאי שימוש אלו:{" "}
              <a href="mailto:m5402088@gmail.com" className="text-brand-rust underline underline-offset-2">
                m5402088@gmail.com
              </a>
            </p>
          </section>

          <p className="text-sm text-zinc-500 border-t pt-4 mt-6">
            תודה שבחרתם בצדקת רבותינו. אנו מאחלים לכם חוויית שירות נעימה.
          </p>
        </div>
      </div>
    </main>
  );
}
