// §62: באנר "אתה מחובר כ-X".
//
// למה זה חובה ולא נחמד-שיהיה: מנהל ששכח שהוא בתוך חשבון של לקוח
// עלול לבצע פעולות בשמו בלי לשים לב - להזמין, לשנות פרטים, לבטל.
// הבאנר נעול לראש המסך ואינו ניתן לסגירה, כך שאין מצב שבו ההתחזות
// פעילה ולא נראית.
//
// ═══════════════════════════════════════════════════════════════
// למה server component ולא useSession
// ═══════════════════════════════════════════════════════════════
// SessionProvider עטוף רק סביב /admin (דרך Providers ב-admin/layout).
// באנר שמסתמך על useSession היה שקט בדיוק במקומות שבהם הוא הכי
// נחוץ - /account ו-/order, שאליהם המנהל מגיע כשהוא מתחזה ללקוח.
//
// קריאה ל-auth() בשרת עובדת בכל עמוד בלי שום provider, ולכן הבאנר
// אפשרי ב-layout השורש בלי לשנות את מבנה ה-providers של המערכת.

import { auth } from "@/lib/auth";
import { ReturnToAdminButton } from "./ReturnToAdminButton";

export async function ImpersonationBanner() {
  const session = await auth();
  const impersonatorId = (session?.user as any)?.impersonatorId as string | null;
  if (!impersonatorId) return null;

  const impersonatorName = (session?.user as any)?.impersonatorName as string | null;

  return (
    <div
      dir="rtl"
      className="sticky top-0 z-[100] bg-amber-400 text-amber-950 shadow-md print:hidden"
    >
      <div className="mx-auto max-w-6xl px-4 py-2 flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2 min-w-0 text-sm">
          <span className="text-lg shrink-0">👤</span>
          <span className="font-bold truncate">מחובר כ-{session?.user?.name}</span>
          <span className="text-xs opacity-80 truncate hidden sm:inline">
            (כניסה בשם משתמש{impersonatorName ? ` · ${impersonatorName}` : ""})
          </span>
        </div>
        <ReturnToAdminButton />
      </div>
    </div>
  );
}
