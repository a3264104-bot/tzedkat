// עמוד מדיניות פרטיות
//

export const metadata = {
  title: "מדיניות פרטיות | צדקת רבותינו",
  description: "מדיניות הפרטיות של אתר צדקת רבותינו",
};

export default function PrivacyPage() {
  return (
    <main dir="rtl" className="min-h-screen bg-white">
      <div className="mx-auto max-w-3xl px-4 py-10">
        <h1 className="text-3xl font-extrabold text-brand-slatedark mb-2">
          מדיניות פרטיות
        </h1>
        <p className="text-sm text-zinc-500 mb-6">
          עודכן לאחרונה: 5 באוגוסט 2026
        </p>

        <div className="max-w-none space-y-5 text-brand-slatedark leading-relaxed">
          <p>
            עמותת צדקת רבותינו (להלן: "העמותה" או "אנחנו") מכבדת את פרטיות
            המשתמשים באתר ומחויבת להגן על המידע האישי הנמסר לה. מדיניות זו מפרטת
            אילו נתונים נאספים, כיצד נעשה בהם שימוש, וכיצד הם מוגנים, בהתאם לחוק
            הגנת הפרטיות, התשמ"א-1981 והתקנות שמכוחו.
          </p>

          <section>
            <h2 className="text-xl font-bold mt-6 mb-2">1. איזה מידע אנו אוספים</h2>
            <p>בעת השימוש באתר וביצוע הזמנות, אנו עשויים לאסוף:</p>
            <ul className="list-disc pr-6 space-y-1">
              <li><strong>פרטי זיהוי:</strong> שם מלא, מספר טלפון (ומספר טלפון נוסף), כתובת דוא"ל.</li>
              <li><strong>פרטי הזמנה:</strong> המוצרים שהוזמנו, כמויות, נקודת החלוקה שנבחרה, הערות.</li>
              <li><strong>פרטי תשלום:</strong> אנו <u>איננו שומרים</u> את מספר כרטיס האשראי המלא. סליקת האשראי ואחסון פרטי הכרטיס מתבצעים באמצעות ספק הסליקה המאובטח "נדרים פלוס". אנו שומרים אך ורק מזהה מוצפן (טוקן), 4 ספרות אחרונות ותוקף - לצורך חיוב עתידי בהסכמתך.</li>
              <li><strong>מידע טכני:</strong> מידע הנאסף אוטומטית בעת הגלישה (כגון כתובת IP, סוג דפדפן) לצורך תפעול ואבטחת האתר.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-bold mt-6 mb-2">2. למה אנו משתמשים במידע</h2>
            <ul className="list-disc pr-6 space-y-1">
              <li>לעיבוד וניהול ההזמנות שלך.</li>
              <li>לביצוע חיובים ותשלומים עבור הזמנות.</li>
              <li>ליצירת קשר בנוגע להזמנה (אישורים, עדכונים, תזכורות חלוקה).</li>
              <li>לשליחת עדכונים על מכירות והודעות כלליות - <strong>רק אם אישרת זאת</strong> בעת ההרשמה.</li>
              <li>לשיפור השירות ואבטחת האתר.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-bold mt-6 mb-2">3. מסירת מידע לצדדים שלישיים</h2>
            <p>
              איננו מוכרים או משכירים את המידע שלך. מידע עשוי להימסר לצדדים
              שלישיים רק במקרים הבאים:
            </p>
            <ul className="list-disc pr-6 space-y-1">
              <li><strong>ספק סליקה (נדרים פלוס):</strong> לצורך ביצוע התשלום.</li>
              <li><strong>ספק שליחת דוא"ל:</strong> לצורך משלוח אישורים ועדכונים.</li>
              <li>כאשר הדבר נדרש על פי חוק או צו שיפוטי.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-bold mt-6 mb-2">4. אבטחת מידע</h2>
            <p>
              אנו נוקטים באמצעי אבטחה מקובלים להגנה על המידע, לרבות הצפנה, אחסון
              מאובטח והרשאות גישה מוגבלות. עם זאת, אין באפשרותנו להבטיח הגנה מוחלטת
              מפני חדירה בלתי מורשית.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-bold mt-6 mb-2">5. זכויותיך</h2>
            <p>
              על פי חוק, זכותך לעיין במידע שנאסף עליך, לבקש את תיקונו או מחיקתו.
              לכל בקשה בנושא, ניתן לפנות אלינו בכתובת:{" "}
              <a href="mailto:m5402088@gmail.com" className="text-brand-rust underline underline-offset-2">
                m5402088@gmail.com
              </a>
            </p>
          </section>

          <section>
            <h2 className="text-xl font-bold mt-6 mb-2">6. שמירת מידע</h2>
            <p>
              המידע יישמר כל עוד הוא נדרש למטרות שלשמן נאסף, או כפי שנדרש על פי חוק
              (למשל, חובת שמירת מסמכי הנהלת חשבונות).
            </p>
          </section>

          <section>
            <h2 className="text-xl font-bold mt-6 mb-2">7. שינויים במדיניות</h2>
            <p>
              העמותה רשאית לעדכן מדיניות זו מעת לעת. המדיניות המעודכנת תפורסם בעמוד
              זה.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-bold mt-6 mb-2">8. יצירת קשר</h2>
            <p>
              בכל שאלה בנוגע למדיניות פרטיות זו, ניתן לפנות אלינו:{" "}
              <a href="mailto:m5402088@gmail.com" className="text-brand-rust underline underline-offset-2">
                m5402088@gmail.com
              </a>
            </p>
          </section>

          <p className="text-sm text-zinc-500 border-t pt-4 mt-6">
            מדיניות זו נכתבה מתוך מחויבות לשקיפות ולהגנה על פרטיות המשתמשים. אנו
            עומדים לרשותכם בכל שאלה או בקשה.
          </p>
        </div>
      </div>
    </main>
  );
}
