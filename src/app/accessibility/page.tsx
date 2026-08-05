// עמוד הצהרת נגישות - חובה באתרי שירות בישראל
// (תקנות שוויון זכויות לאנשים עם מוגבלות - התאמות נגישות לשירות)
//

export const metadata = {
  title: "הצהרת נגישות | צדקת רבותינו",
  description: "הצהרת הנגישות של אתר צדקת רבותינו",
};

export default function AccessibilityPage() {
  return (
    <main dir="rtl" className="min-h-screen bg-white">
      <div className="mx-auto max-w-3xl px-4 py-10">
        <h1 className="text-3xl font-extrabold text-brand-slatedark mb-6">
          הצהרת נגישות
        </h1>

        <div className="prose prose-zinc max-w-none space-y-5 text-brand-slatedark leading-relaxed">
          <p>
            עמותת צדקת רבותינו (להלן: "העמותה") רואה חשיבות רבה במתן שירות שוויוני
            ונגיש לכלל הציבור, לרבות אנשים עם מוגבלות, ופועלת להנגשת אתר האינטרנט
            שלה בהתאם להוראות חוק שוויון זכויות לאנשים עם מוגבלות, התשנ"ח-1998,
            והתקנות שהותקנו מכוחו.
        </p>

          <section>
            <h2 className="text-xl font-bold mt-6 mb-2">רמת הנגישות באתר</h2>
            <p>
              אתר זה נבנה בהתאם להנחיות מסמך התקן הישראלי (ת"י 5568) המבוסס על
              הנחיות <strong>WCAG 2.0</strong> ברמה <strong>AA</strong>, ככל שניתן
              מבחינה טכנית. בין היתר בוצעו ההתאמות הבאות:
            </p>
            <ul className="list-disc pr-6 space-y-1">
              <li>ניווט מלא באמצעות מקלדת בכל חלקי האתר.</li>
              <li>תמיכה בקוראי מסך (screen readers) באמצעות תיוג ARIA וטקסט חלופי.</li>
              <li>טקסט חלופי (alt) לתמונות ולאייקונים בעלי משמעות.</li>
              <li>ניגודיות צבעים מספקת בין טקסט לרקע.</li>
              <li>תוויות (labels) ברורות בכל שדות הטפסים.</li>
              <li>מבנה כותרות היררכי וסמנטי.</li>
              <li>התאמה לצפייה במכשירים ניידים.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-bold mt-6 mb-2">הסתייגויות</h2>
            <p>
              למרות מאמצי העמותה להנגיש את כלל הדפים והרכיבים באתר, ייתכן שיימצאו
              חלקים שטרם הונגשו במלואם. אנו ממשיכים לפעול לשיפור הנגישות באופן שוטף.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-bold mt-6 mb-2">פנייה בנושא נגישות</h2>
            <p>
              נתקלתם בבעיה או בקושי בנושא נגישות באתר? נשמח לקבל משוב. ניתן לפנות
              אלינו ואנו נעשה כמיטב יכולתנו לטפל בפנייה בהקדם:
            </p>
            <ul className="list-none space-y-1 mt-2">
              <li>
                <strong>דוא"ל:</strong>{" "}
                <a
                  href="mailto:m5402088@gmail.com"
                  className="text-brand-rust underline underline-offset-2"
                >
                  m5402088@gmail.com
                </a>
              </li>
              <li>
                <strong>אחראי/ת נגישות:</strong> ניתן לפנות בנושאי נגישות
                באמצעות כתובת הדוא"ל שלמעלה, ואנו נעביר את הפנייה לגורם המתאים
                בעמותה.
              </li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-bold mt-6 mb-2">עדכון ההצהרה</h2>
            <p className="text-sm text-zinc-500">
              הצהרת נגישות זו עודכנה בתאריך 5 באוגוסט 2026.
            </p>
          </section>
        </div>
      </div>
    </main>
  );
}
