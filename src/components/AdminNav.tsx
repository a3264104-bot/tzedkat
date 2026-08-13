"use client";

// תפריט אדמין מסודר לפי *סדר העבודה במכירה* (ולא לפי סוג נתון).
// מנהל שנכנס באמצע מכירה צריך לראות מיד "איפה אני עומד ומה הצעד הבא":
//   ① הכנה          - לפני שהמכירה נפתחת
//   ② במהלך המכירה  - לקוחות מזמינים
//   ③ אחרי הסגירה   - קליטת סחורה ושקילה
//   ④ כספים         - חיוב וגבייה
//   ⑤ סיכום         - סגירת המכירה
// ומתחת: "ניהול שוטף" - דברים שלא תלויים במכירה ספציפית.

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, useEffect } from "react";

type NavItem = { href: string; label: string; icon: string };

type NavGroup = {
  id: string;
  label: string;
  icon: string;
  step: number | null; // מספר השלב ברצף; null = לא חלק מהרצף
  hint: string;
  items: NavItem[];
};

const NAV_GROUPS: NavGroup[] = [
  {
    id: "prepare",
    label: "הכנה",
    icon: "🗂️",
    step: 1,
    hint: "פתיחת מכירה חדשה",
    items: [
      { href: "/admin/pricelists", label: "מחירונים / מכירות", icon: "💵" },
      { href: "/admin/points", label: "נקודות חלוקה", icon: "📍" },
    ],
  },
  {
    id: "running",
    label: "במהלך המכירה",
    icon: "🧾",
    step: 2,
    hint: "לקוחות מזמינים",
    items: [{ href: "/admin/orders", label: "הזמנות", icon: "🧾" }],
  },
  {
    id: "intake",
    label: "אחרי הסגירה",
    icon: "⚖️",
    step: 3,
    hint: "קליטת סחורה ושקילה",
    items: [
      { href: "/admin/delivery-notes", label: "תעודות משלוח", icon: "📄" },
      { href: "/admin/pending-weights", label: "משקלים ממתינים", icon: "⚖️" },
      // בקרת מכירה משווה תעודות משלוח מול מה שחולק בפועל - ולכן היא
      // שייכת לשלב הזה. בשלב ② היא ריקה כי עוד לא הגיעה סחורה.
      { href: "/admin/sale-control", label: "בקרת מכירה", icon: "📊" },
    ],
  },
  {
    id: "money",
    label: "כספים",
    icon: "💳",
    step: 4,
    hint: "חיוב וגבייה",
    items: [
      { href: "/admin/payments", label: "תשלומים", icon: "💳" },
      { href: "/admin/debts", label: "חובות לקוחות", icon: "💰" },
      { href: "/admin/agent-debts", label: "חובות נציגים", icon: "🧮" },
      { href: "/admin/payment-audit", label: "יומן תשלומים", icon: "🧾" },
    ],
  },
  {
    id: "closing",
    label: "סיכום",
    icon: "📑",
    step: 5,
    hint: "סגירת המכירה",
    items: [
      { href: "/admin/sale-summary", label: "סיכום מכירה", icon: "📑" },
      { href: "/admin/reports", label: "דוחות", icon: "📈" },
    ],
  },
  {
    id: "ongoing",
    label: "ניהול שוטף",
    icon: "👥",
    step: null,
    hint: "לא תלוי במכירה",
    items: [
      // קטלוג המוצרים יציב ולא משתנה בכל מכירה, ולכן הוא ניהול שוטף
      // ולא חלק מהכנת המכירה.
      { href: "/admin/products", label: "מוצרים", icon: "🥩" },
      { href: "/admin/kashrut", label: "כשרויות", icon: "🏷️" },
      { href: "/admin/customers", label: "לקוחות", icon: "🧑" },
      { href: "/admin/phone-signups", label: "בקשות מהטלפון", icon: "📞" },
      { href: "/admin/agents", label: "נציגים", icon: "🧑‍💼" },
      { href: "/admin/personal-requests", label: "בקשות אישיות", icon: "💬" },
      { href: "/admin/broadcast", label: "שליחת מייל ללקוחות", icon: "📧" },
    ],
  },
];

const DASHBOARD_ITEM = { href: "/admin", label: "דשבורד", icon: "🏠" };
const CREATE_ORDER_ITEM = { href: "/order", label: "בצע הזמנה", icon: "🛒" };
const SETTINGS_ITEM = { href: "/admin/settings", label: "הגדרות", icon: "⚙️" };

export default function AdminNav() {
  const pathname = usePathname();
  const [openGroup, setOpenGroup] = useState<string | null>(null);

  useEffect(() => {
    for (const group of NAV_GROUPS) {
      if (group.items.some((item) => pathname.startsWith(item.href))) {
        setOpenGroup(group.id);
        return;
      }
    }
  }, [pathname]);

  const isActive = (href: string) => {
    if (href === "/admin") return pathname === "/admin";
    return pathname === href || pathname.startsWith(href + "/");
  };

  return (
    <nav className="space-y-1" aria-label="ניווט ניהול">
      <NavLink item={DASHBOARD_ITEM} active={isActive(DASHBOARD_ITEM.href)} />
      <NavLink item={CREATE_ORDER_ITEM} active={isActive(CREATE_ORDER_ITEM.href)} />

      <div className="my-3 border-t border-brand-slate/15"></div>

      <p className="px-3 pb-1 text-[11px] font-bold tracking-wide text-brand-slate/50">
        סדר העבודה במכירה
      </p>

      {NAV_GROUPS.map((group, idx) => {
        const isOpen = openGroup === group.id;
        const hasActive = group.items.some((item) => isActive(item.href));
        const isFirstNonStep = group.step === null && NAV_GROUPS[idx - 1]?.step !== null;

        return (
          <div key={group.id}>
            {isFirstNonStep && (
              <>
                <div className="my-3 border-t border-brand-slate/15"></div>
                <p className="px-3 pb-1 text-[11px] font-bold tracking-wide text-brand-slate/50">
                  ניהול שוטף
                </p>
              </>
            )}

            <button
              onClick={() => setOpenGroup(isOpen ? null : group.id)}
              aria-expanded={isOpen}
              className={`w-full flex items-center justify-between px-3 py-2.5 rounded-lg text-sm font-bold transition-colors ${
                hasActive
                  ? "bg-brand-rust/15 text-brand-rust"
                  : "text-brand-slatedark hover:bg-brand-slate/10"
              }`}
            >
              <span className="flex items-center gap-2 min-w-0">
                {group.step !== null ? (
                  <span
                    className={`w-5 h-5 shrink-0 rounded-full grid place-items-center text-[11px] font-extrabold ${
                      hasActive ? "bg-brand-rust text-white" : "bg-brand-slate/15 text-brand-slate"
                    }`}
                  >
                    {group.step}
                  </span>
                ) : (
                  <span className="text-base shrink-0">{group.icon}</span>
                )}
                <span className="min-w-0 text-right">
                  <span className="block truncate">{group.label}</span>
                  <span className="block text-[10px] font-normal text-brand-slate/50 truncate">
                    {group.hint}
                  </span>
                </span>
                {hasActive && !isOpen && (
                  <span className="w-1.5 h-1.5 shrink-0 rounded-full bg-brand-rust"></span>
                )}
              </span>
              <svg
                className={`w-4 h-4 shrink-0 transition-transform ${isOpen ? "rotate-180" : ""}`}
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2.5}
                aria-hidden="true"
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
              </svg>
            </button>

            {isOpen && (
              <div className="mt-1 mr-3 space-y-0.5 border-r-2 border-brand-slate/15 pr-3">
                {group.items.map((item) => (
                  <NavLink key={item.href} item={item} active={isActive(item.href)} small />
                ))}
              </div>
            )}
          </div>
        );
      })}

      <div className="my-3 border-t border-brand-slate/15"></div>

      <NavLink item={SETTINGS_ITEM} active={isActive(SETTINGS_ITEM.href)} />

      {/* §37: זהות והתנתקות.
          למה זה חשוב כאן: יש שתי טבלאות משתמשים נפרדות (Admin ו-Customer),
          ואפשר להיות מחובר לאחת ולא לשנייה. בלי חיווי מי מחובר, משתמש
          שנתקע בהפניה חוזרת אין לו דרך להבין מה קורה או להחליף חשבון. */}
      <SessionBox />
    </nav>
  );
}

function SessionBox() {
  const [who, setWho] = useState<{ name?: string; email?: string; role?: string } | null>(
    null
  );
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    // קריאה ישירה ל-endpoint במקום useSession, כדי לא להיות תלויים
    // בכך ש-SessionProvider עוטף את הפריסה של הניהול.
    fetch("/api/auth/session")
      .then((r) => r.json())
      .then((d) => setWho(d?.user ?? null))
      .catch(() => setWho(null));
  }, []);

  async function logout() {
    if (!confirm("להתנתק מהחשבון?")) return;
    setBusy(true);
    try {
      // signOut של Auth.js דורש CSRF token
      const csrf = await fetch("/api/auth/csrf").then((r) => r.json());
      await fetch("/api/auth/signout", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          csrfToken: csrf.csrfToken,
          callbackUrl: "/login",
        }),
      });
      window.location.href = "/login";
    } catch {
      // גם אם משהו נכשל, מעבירים ל-login - שם אפשר להתחבר מחדש
      window.location.href = "/login";
    }
  }

  const roleLabel =
    who?.role === "ADMIN" ? "מנהל" : who?.role === "AGENT" ? "נציג" : "לקוח";

  return (
    <div className="mt-4 pt-3 border-t border-brand-slate/15">
      {who && (
        <div className="px-3 pb-2">
          <p className="text-[11px] text-brand-slate/50">מחובר כ</p>
          <p className="text-sm font-bold text-brand-slatedark truncate">
            {who.name || who.email || "משתמש"}
          </p>
          <span className="inline-block mt-1 text-[10px] bg-brand-slate/10 text-brand-slate rounded px-1.5 py-0.5">
            {roleLabel}
          </span>
        </div>
      )}

      {/* מעבר מהיר למסך הנציג - רלוונטי למי שהוא גם מנהל וגם נציג */}
      {(who?.role === "ADMIN" || who?.role === "AGENT") && (
        <Link
          href="/agent"
          className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-brand-slatedark hover:bg-brand-slate/10 transition-colors"
        >
          <span className="text-base">🧑‍💼</span>
          <span>מסך הנציג</span>
        </Link>
      )}

      <button
        onClick={logout}
        disabled={busy}
        className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-red-700 hover:bg-red-50 transition-colors disabled:opacity-50"
      >
        <span className="text-base">🚪</span>
        <span>{busy ? "מתנתק..." : "התנתקות"}</span>
      </button>
    </div>
  );
}

function NavLink({
  item,
  active,
  small,
}: {
  item: NavItem;
  active: boolean;
  small?: boolean;
}) {
  return (
    <Link
      href={item.href}
      aria-current={active ? "page" : undefined}
      className={`flex items-center gap-2 px-3 rounded-lg text-sm transition-colors ${
        small ? "py-1.5" : "py-2.5 font-bold"
      } ${
        active
          ? "bg-brand-rust text-white shadow-sm"
          : "text-brand-slatedark hover:bg-brand-slate/10"
      }`}
    >
      <span className={small ? "text-sm" : "text-base"}>{item.icon}</span>
      <span>{item.label}</span>
    </Link>
  );
}

// Named export כדי שגם import { AdminNav } וגם import AdminNav יעבדו
export { AdminNav };
