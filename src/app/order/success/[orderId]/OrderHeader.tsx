"use client";

// כותרת דינמית לעמוד הזמנה - מבחינה בין "הזמנה חדשה" ל"צפייה חוזרת"
//
// הבעיה שנפתרה: "ההזמנה התקבלה בהצלחה!" הופיע גם כשהלקוח נכנס
// לצפות בהזמנה ישנה מהאזור האישי - זה מבלבל, כי הוא לא הזמין כרגע.
//
// הפתרון: משתמשים באותו sessionStorage key שכבר יש ל-SuccessAnimation
// (success_anim_<path>) כדי לדעת אם זו הכניסה הראשונה לעמוד הזה בsession.

import { useEffect, useState } from "react";

export default function OrderHeader({
  orderNumber,
  pricelistName,
}: {
  orderNumber: number;
  pricelistName: string | null;
}) {
  // ברירת מחדל: מצב "צפייה" (בטוח יותר - לא מניחים "הזמנה חדשה" בלי אישור)
  const [isNewOrder, setIsNewOrder] = useState(false);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    const url = window.location.pathname;
    const key = `success_anim_${url}`;
    // אם האנימציה עוד לא רצה בsession הזה - זו כניסה טרייה (הזמנה חדשה)
    const alreadyShown = sessionStorage.getItem(key);
    setIsNewOrder(!alreadyShown);
    setChecked(true);
  }, []);

  // בזמן הבדיקה (רגע אחד) - לא מרצדים בין הטקסטים
  if (!checked) {
    return <div className="text-center mb-6 h-[72px]" />;
  }

  return (
    <div className="text-center mb-6">
      <h1 className="text-2xl md:text-3xl font-extrabold text-brand-slatedark">
        {isNewOrder ? "ההזמנה התקבלה בהצלחה!" : `הזמנה #${orderNumber}`}
      </h1>
      <p className="text-brand-slate mt-2 text-sm">
        {isNewOrder ? (
          <>
           טוב לראותך במכירה של{" "}
            <span className="font-bold">{pricelistName}</span>
          </>
        ) : (
          <>
            צפייה בפרטי ההזמנה שלך
            {pricelistName && (
              <>
                {" "}
                · <span className="font-bold">{pricelistName}</span>
              </>
            )}
          </>
        )}
      </p>
    </div>
  );
}
