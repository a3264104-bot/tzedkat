"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/client";
import { Modal, Field } from "@/components/AdminModal";
import { AdminAddCustomerButton } from "@/components/AdminAddCustomerButton";
import { AdminCustomerCodePanel } from "@/components/AdminCustomerCodePanel";
import { ImpersonateButton } from "@/components/ImpersonateButton";
// §82: עדכון אשראי ישירות ממסך הלקוחות
import { UpdateCardModal } from "@/components/UpdateCardButton";

type Customer = {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  city: string | null;
  pointName: string | null;
  orderCount: number;
  hasPaymentToken: boolean;
  // §82: מצב הכרטיס - להצגה בכרטיס העריכה
  cardLast4?: string | null;
  cardExpiry?: string | null;
  cardNeedsUpdate?: boolean;
  defaultPointId?: string | null;
  passwordPlain: string | null;
  // §62: מצב הקוד בלבד. הקוד עצמו לעולם לא מגיע ברשימה.
  hasLoginCode?: boolean;
  hasPassword?: boolean;
  /** §126: יתרת זכות פתוחה */
  creditBalance?: number;
  /** §145: מקבל קובץ אקסל להזמנה בכל מכירה */
  wantsExcelOrder?: boolean;
  /** §173: שם פרטי ומשפחה. null אצל לקוחות ותיקים. */
  /** §199: טלפון נוסף לזיהוי ב-IVR (§161) */
  phone2?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  /** §158: הזמנה פעילה במכירה הנוכחית */
  activeOrderId?: string | null;
  activeOrderNumber?: number | null;
  loginCodeSetAt?: string | null;
  lockedUntil?: string | null;
  failedLoginAttempts?: number;
  // §60: CASH / CREDIT
  paymentPreference?: string;
  role: string;
  agentPointId: string | null;
  agentPoints?: { id: string; name: string; city: string | null }[];
  agentCanSetFinalPrice?: boolean;
  agentCanSendPaymentLink?: boolean;
  agentCanCharge?: boolean;
  agentCanUpdateCards?: boolean;
  /** §155: הקמה/סימון של לקוחות מזומן */
  agentCanCreateCashCustomers?: boolean;
  createdAt: string;
  // §52: לקוח לא פעיל - לא מקבל מיילים, לא נכלל בברודקסט ובתזכורות,
  // ולא יכול לבצע הזמנה. ההיסטוריה שלו נשמרת במלואה.
  isActive?: boolean;
  deactivatedAt?: string | null;
  deactivatedReason?: string | null;
};

type Point = {
  id: string;
  name: string;
  city: string | null;
  /**
   * §163: נקודה סמויה - לא מוצגת ללקוחות.
   *
   * לחנויות שלוקחות הזמנות לפתח העסק שלהן. המנהל משייך אליה
   * ידנית, והלקוח לא יכול לבחור בה בעצמו.
   */
  isPrivate?: boolean;
};

type SortKey = "name" | "phone" | "city" | "orderCount" | "createdAt";
type SortDir = "asc" | "desc";

export default function AdminCustomersPage() {
  const [customers, setCustomers] = useState<Customer[]>([]);
  // §109: פתיחה אוטומטית של לקוח לפי openCustomer בכתובת.
  //
  // הערך נקרא פעם אחת בטעינה (לא ב-state מתמשך) כדי שהמנהל יוכל
  // לסגור את המודל ולהישאר ברשימה - בלי שייפתח שוב בכל רענון.
  // §156: אותה בעיה - נקרא בשרת ומוחזר ריק.
  const [query, setQuery] = useState("");

  useEffect(() => {
    const q = new URLSearchParams(window.location.search).get("q");
    if (q) setQuery(q);
  }, []);
  // §156: 🐛 קריאת ה-URL עברה מ-useState ל-useEffect.
  //
  // האתחול היה `useState(() => new URLSearchParams(...))`. במסך
  // שעובר רינדור בשרת, ה-initializer רץ שם ומחזיר null - ובהידרציה
  // React משתמש במצב שהגיע מהשרת. התוצאה: pendingOpenId היה null
  // תמיד, והמודל לא נפתח לעולם.
  //
  // ⚠️ useEffect רץ **רק בדפדפן**, אחרי שההידרציה הסתיימה, ולכן
  // window.location שם אמין.
  const [pendingOpenId, setPendingOpenId] = useState<string | null>(null);

  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("openCustomer");
    if (id) setPendingOpenId(id);
  }, []);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Customer | null>(null);
  const [newPassword, setNewPassword] = useState("");
  const [editEmail, setEditEmail] = useState("");
  const [editPhone, setEditPhone] = useState("");
  const [editName, setEditName] = useState("");
  // §173: שם פרטי ומשפחה - להשלמה הדרגתית של לקוחות ותיקים
  const [editPhone2, setEditPhone2] = useState("");
  const [editFirst, setEditFirst] = useState("");
  const [editLast, setEditLast] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [successMsg, setSuccessMsg] = useState("");
  const [showExistingPw, setShowExistingPw] = useState(false);
  const [points, setPoints] = useState<Point[]>([]);
  // §82: מודל עדכון האשראי
  const [cardModalFor, setCardModalFor] = useState<Customer | null>(null);
  // §127: כמה לקוחות קיימים בפועל, מול כמה מוצגים
  const [totalCount, setTotalCount] = useState(0);
  const [truncated, setTruncated] = useState(false);
  const [convertingToAgent, setConvertingToAgent] = useState(false);
  const [newRole, setNewRole] = useState<string>("");
  const [newPointId, setNewPointId] = useState<string>("");
  // 🆕 בחירת נקודות מרובות לנציג (Set של pointIds)
  const [selectedAgentPointIds, setSelectedAgentPointIds] = useState<Set<string>>(new Set());
  // §52: הסתרת לקוחות לא פעילים. ברירת מחדל: מציגים אותם עם תגית,
  // כי אחרת אין דרך להפעיל אותם מחדש או לבדוק היסטוריה.
  const [hideInactive, setHideInactive] = useState(false);

  // טעינת רשימת נקודות למקרה שנרצה להפוך לקוח לנציג
  useEffect(() => {
    fetch('/api/admin/points')
      .then(r => r.json())
      .then(d => setPoints(Array.isArray(d) ? d : []))
      .catch(() => setPoints([]));
  }, []);

  // יצירת סיסמא אקראית קריאה - 4 אותיות + 4 ספרות (בלי i/l/o/0/1)
  function generateRandomPassword(): string {
    const letters = "abcdefghjkmnpqrstuvwxyz";
    const numbers = "23456789";
    let out = "";
    for (let i = 0; i < 4; i++) out += letters[Math.floor(Math.random() * letters.length)];
    for (let i = 0; i < 4; i++) out += numbers[Math.floor(Math.random() * numbers.length)];
    return out;
  }

  // סידור ושדה מיון
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  // §139: סינון וקיבוץ לפי **נקודת חלוקה** ולא לפי עיר.
  //
  // 🐛 הפער: בביתר יש כמה נקודות (B1, B2), וקיבוץ לפי עיר הציג
  // את כולן יחד. המנהל שרצה לראות מי מגיע ל-B1 ראה את כל ביתר,
  // וזה חסר תועלת בחלוקה - שם כל נקודה עומדת בפני עצמה.
  //
  // ⚠️ העיר נשמרת כתת-כותרת: היא עדיין שימושית להתמצאות, אבל
  // היא לא יחידת העבודה.
  const [pointFilter, setPointFilter] = useState<string>("");
  // מצב תצוגה: table / grouped
  const [viewMode, setViewMode] = useState<"table" | "grouped">("grouped");

  // §90: החלפת אופן תשלום. הפעולה נשמרת מיד ולא מחכה ל"שמירה" -
  // היא משנה מה הלקוח יכול לעשות ברגע זה, ולא ראוי שתישכח בטופס.
  async function setPaymentPref(pref: "CASH" | "CREDIT") {
    if (!editing) return;
    setSaving(true);
    setError("");
    try {
      const res = await fetch(`/api/admin/customers/${editing.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paymentPreference: pref }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "שגיאה");
      // §114: אם הופק קוד אוטומטית - מציגים אותו **מיד ובבירור**.
      //
      // קוד שנוצר בשקט הוא חסר ערך: המנהל לא ידע שהוא קיים ולא
      // ימסור אותו ללקוח. ההודעה כאן היא כל ההבדל בין תכונה
      // שעובדת לבין שדה במסד שאיש לא משתמש בו.
      const codeMsg = json.generatedCode
        ? ` · קוד הכניסה שהופק: ${json.generatedCode} — יש למסור ללקוח`
        : "";
      setSuccessMsg(
        (json.warning ||
          (pref === "CASH"
            ? "הלקוח סומן כלקוח מזומן ויכול להזמין"
            : "הלקוח הועבר לתשלום באשראי")) + codeMsg
      );
      await reload();
    } catch (e: any) {
      setError(e.message || "שגיאה בשינוי אופן התשלום");
    } finally {
      setSaving(false);
    }
  }

  async function reload() {
    const data = await api(`/api/admin/customers?q=${encodeURIComponent(query)}`);
    // §127: התשובה עברה ממערך לאובייקט עם מטא-דאטה.
    // ⚠️ הנפילה למערך נשמרת בכוונה - אם קליינט ישן פוגש שרת חדש
    // או להפך, המסך לא נשבר.
    const rowsRaw = Array.isArray(data) ? data : (data?.rows ?? []);
    setTotalCount(typeof data?.total === "number" ? data.total : rowsRaw.length);
    setTruncated(!!data?.truncated);
    const enriched = rowsRaw.map((c: any) => ({
      ...c,
      city: c.city || c.pointCity || null,
    }));
    setCustomers(enriched);

    // §86: 🐛 המודל הפתוח לא התרענן.
    //
    // reload() עדכן את הרשימה שברקע בלבד, ואילו `editing` המשיך
    // להחזיק את הרשומה כפי שנטענה כשהמודל נפתח. התוצאה: המנהל
    // הזין כרטיס אשראי, החיוב של 1 ש"ח עבר ומייל האישור הגיע -
    // אבל המסך המשיך להציג "אין כרטיס שמור. הלקוח אינו יכול
    // להזמין". רק סגירה ופתיחה מחדש הראו את האמת.
    //
    // אותה בעיה חלה על כל פעולה במודל שמשנה נתונים בשרת: קוד
    // התחברות, הרשאות, ואופן תשלום. הסנכרון כאן פותר את כולן.
    //
    // ⚠️ שדות שהמנהל ערך ידנית ועדיין לא שמר (למשל נקודת חלוקה
    // שנבחרה בבורר) **אינם** נדרסים - הם מוחזקים ב-state נפרד
    // בתוך editing ומשוחזרים מעליו.
    setEditing((cur) => {
      if (!cur) return cur;
      const fresh = enriched.find((c: any) => c.id === cur.id);
      if (!fresh) return cur;
      return {
        ...fresh,
        // שמירת עריכות שטרם נשמרו
        defaultPointId: cur.defaultPointId,
      };
    });
  }

  // §109: פתיחת כרטיס הלקוח ברגע שהרשימה נטענה.
  //
  // 🐛 מה שנסגר: הקישור ממסך בקשות ההרשמה העביר רק ?q=<טלפון>,
  // כלומר מילא את החיפוש - והמנהל נאלץ לאתר את השורה ולפתוח
  // אותה ידנית, כשהמזהה המדויק כבר היה ידוע.
  //
  // ⚠️ הפתיחה מתבצעת **פעם אחת בלבד** (pendingOpenId מתאפס מיד).
  // בלי זה, סגירת המודל הייתה גורמת לו להיפתח שוב בכל טעינה
  // מחדש של הרשימה - למשל אחרי עדכון אשראי, שקורא ל-reload.
  // §150: 🐛 הפתיחה נכשלה כשהחיפוש לא מצא את הלקוח.
  //
  // המנגנון חיפש את הלקוח **בתוך הרשימה שנטענה** - ולכן הוא היה
  // תלוי בכך שהחיפוש לפי טלפון יחזיר אותו. פורמט טלפון שונה,
  // לקוח מושבת, או רשימה חתוכה (§127) - וכל אחד מהם שבר את זה
  // בשקט. המנהל הגיע לרשימה מלאה ונאלץ לחפש ידנית.
  //
  // ⚠️ עכשיו הלקוח נשלף **ישירות לפי מזהה**, בלי תלות בחיפוש.
  // זה גם מהיר יותר - שאילתה אחת במקום המתנה לרשימה.
  useEffect(() => {
    if (!pendingOpenId) return;
    const id = pendingOpenId;
    setPendingOpenId(null);

    (async () => {
      // ניקוי הכתובת מיד, כדי שרענון לא יפתח שוב
      if (typeof window !== "undefined") {
        const url = new URL(window.location.href);
        url.searchParams.delete("openCustomer");
        window.history.replaceState({}, "", url.toString());
      }

      // קודם מנסים מהרשימה - אם הוא שם, זה מיידי
      const inList = customers.find((c) => c.id === id);
      if (inList) {
        openEdit(inList);
        return;
      }

      // אחרת שולפים ישירות
      try {
        const res = await fetch(`/api/admin/customers/${id}`);
        if (!res.ok) throw new Error();
        const data = await res.json();
        const c = data?.customer ?? data;
        if (c?.id) {
          openEdit({
            ...c,
            city: c.city || c.pointCity || null,
          } as Customer);
          return;
        }
        throw new Error();
      } catch {
        // ⚠️ נפילה שקטה הייתה משאירה את המנהל בלי מושג למה לא
        // נפתח כלום. הודעה מפורשת עדיפה.
        setError(
          "לא ניתן לפתוח את כרטיס הלקוח אוטומטית. ייתכן שהוא נמחק — יש לחפש אותו ברשימה."
        );
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingOpenId, customers.length]);

  // חיפוש עם debounce
  useEffect(() => {
    const t = setTimeout(async () => {
      setLoading(true);
      try {
        await reload();
      } catch {
        setCustomers([]);
      } finally {
        setLoading(false);
      }
    }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  function openEdit(c: Customer) {
    setEditing(c);
    setNewPassword("");
    setEditEmail(c.email ?? "");
    setEditPhone(c.phone ?? "");
    setEditName(c.name);
    setEditPhone2(c.phone2 ?? "");
    setEditFirst(c.firstName ?? "");
    setEditLast(c.lastName ?? "");
    setShowExistingPw(false);
    setConvertingToAgent(false);
    setNewRole(c.role);
    setNewPointId(c.agentPointId || "");
    // 🆕 טעינת כל הנקודות של הנציג ל-Set. עדיפות ל-agentPoints[] החדש,
    // fallback ל-agentPointId הישן אם עוד אין רשומות במערך
    const pointIds = new Set<string>();
    if (c.agentPoints && c.agentPoints.length > 0) {
      c.agentPoints.forEach((ap) => pointIds.add(ap.id));
    } else if (c.agentPointId) {
      pointIds.add(c.agentPointId);
    }
    setSelectedAgentPointIds(pointIds);
    setError("");
    setSuccessMsg("");
  }

  function toggleAgentPoint(pointId: string) {
    setSelectedAgentPointIds((prev) => {
      const next = new Set(prev);
      if (next.has(pointId)) next.delete(pointId);
      else next.add(pointId);
      return next;
    });
  }

  // שמירת נקודות הנציג (many-to-many) דרך PATCH /api/admin/customers/[id]
  async function saveAgentPoints() {
    if (!editing) return;
    setSaving(true);
    setError("");
    try {
      const res = await fetch(`/api/admin/customers/${editing.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          agentPointIds: Array.from(selectedAgentPointIds),
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "שגיאה");
      setSuccessMsg("נקודות החלוקה של הנציג עודכנו!");
      await reload();
    } catch (e: any) {
      setError(e.message || "שגיאה בשמירת נקודות");
    } finally {
      setSaving(false);
    }
  }

  // §52: הפעלה/השבתה של לקוח.
  //
  // למה לא מחיקה: ללקוח יש היסטוריית הזמנות, חיובים ותעודות שחייבים
  // להישמר - גם לתיעוד וגם כי מחיקה תשבור דוחות של מכירות עבר.
  //
  // לקוח לא פעיל לא מקבל מיילים, לא נכלל בברודקסט ובתזכורות חלוקה,
  // ולא יכול לבצע הזמנה חדשה. ההיסטוריה נשארת שלמה, ואפשר להפעיל
  // אותו מחדש בכל רגע.
  async function toggleActive() {
    if (!editing) return;
    const nowActive = editing.isActive !== false;
    let reason: string | null = null;

    if (nowActive) {
      const r = prompt(
        `להשבית את ${editing.name}?\n\n` +
          `הלקוח יפסיק לקבל מיילים ולא יוכל להזמין.\n` +
          `כל ההיסטוריה שלו נשמרת ואפשר להפעיל אותו מחדש בכל רגע.\n\n` +
          `סיבה (אופציונלי):`
      );
      if (r === null) return; // ביטול
      reason = r.trim() || null;
    } else {
      if (!confirm(`להפעיל מחדש את ${editing.name}?`)) return;
    }

    setSaving(true);
    setError("");
    try {
      const res = await fetch(`/api/admin/customers/${editing.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          isActive: !nowActive,
          deactivatedReason: reason,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "שגיאה");
      setEditing({
        ...editing,
        isActive: !nowActive,
        deactivatedReason: reason,
      });
      setSuccessMsg(nowActive ? "הלקוח הושבת" : "הלקוח הופעל מחדש");
      await reload();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  async function convertRole() {
    if (!editing) return;
    if (newRole === "AGENT" && !newPointId) {
      setError("יש לבחור נקודת חלוקה עבור הנציג");
      return;
    }
    if (!confirm(
      newRole === "AGENT"
        ? `להפוך את ${editing.name} לנציג?`
        : newRole === "ADMIN"
        ? `⚠️ להפוך את ${editing.name} למנהל? יהיו לו הרשאות מלאות!`
        : `להוריד את ${editing.name} מנציג ללקוח רגיל?`
    )) return;
    setSaving(true);
    setError("");
    try {
      const res = await fetch(`/api/admin/users/${editing.id}/role`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          role: newRole,
          agentPointId: newRole === "AGENT" ? newPointId : null,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'שגיאה');
      setSuccessMsg(`תפקיד עודכן ל-${newRole === "AGENT" ? "נציג" : newRole === "ADMIN" ? "מנהל" : "לקוח"}!`);
      setConvertingToAgent(false);
      await reload();
      // סגירת מודאל
      setTimeout(() => setEditing(null), 1500);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  // עדכון הרשאת נציג בודדת
  async function togglePermission(
    field:
      | "agentCanSetFinalPrice"
      | "agentCanSendPaymentLink"
      | "agentCanCharge"
      | "agentCanUpdateCards"
      | "agentCanCreateCashCustomers",
    value: boolean
  ) {
    if (!editing) return;
    setSaving(true);
    setError("");
    try {
      const res = await fetch(`/api/admin/customers/${editing.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [field]: value }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "שגיאה");
      // עדכון local state
      setEditing({ ...editing, [field]: value });
      // עדכון רשימה
      setCustomers((prev) =>
        prev.map((c) => (c.id === editing.id ? { ...c, [field]: value } : c))
      );
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  async function save() {
    if (!editing) return;
    setSaving(true);
    setError("");
    try {
      const payload: any = {};
      if (editName !== editing.name) payload.name = editName;
      // §173: מילוי שני החלקים מרכיב גם את השם המלא, אלא אם
      // המנהל ערך אותו ידנית באותו מסך.
      const f = editFirst.trim();
      const l = editLast.trim();
      if (f !== (editing.firstName ?? "") || l !== (editing.lastName ?? "")) {
        payload.firstName = f || null;
        payload.lastName = l || null;
        if (f && l && editName === editing.name) payload.name = `${f} ${l}`;
      }
      if (editEmail !== (editing.email ?? "")) payload.email = editEmail || null;
      if (editPhone !== (editing.phone ?? "")) payload.phone = editPhone || null;
      // §199: הטלפון הנוסף. השרת מאמת ייחודיות (§162).
      if (editPhone2 !== (editing.phone2 ?? "")) payload.phone2 = editPhone2 || null;
      if (newPassword) payload.newPassword = newPassword;
      // §82: נקודת חלוקה. ההשוואה מול הרשומה שברשימה ולא מול
      // editing - האחרון כבר מכיל את הערך החדש (setEditing ב-onChange),
      // ולכן השוואה מולו תמיד הייתה מחזירה "אין שינוי".
      const originalPoint = customers.find((c) => c.id === editing.id)?.defaultPointId ?? null;
      if ((editing.defaultPointId ?? null) !== originalPoint) {
        payload.defaultPointId = editing.defaultPointId ?? null;
      }

      if (Object.keys(payload).length === 0) {
        setError("לא בוצע שום שינוי");
        setSaving(false);
        return;
      }

      await api(`/api/admin/customers/${editing.id}`, {
        method: "PATCH",
        body: JSON.stringify(payload),
      });

      setSuccessMsg(
        newPassword
          ? `נשמר! מסור ללקוח את הסיסמה החדשה: ${newPassword}`
          : "הפרטים עודכנו בהצלחה"
      );
      setNewPassword("");
      await reload();
    } catch (e: any) {
      setError(e.message || "שגיאה");
    } finally {
      setSaving(false);
    }
  }

  // מיון
  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir(sortDir === "asc" ? "desc" : "asc");
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  }
  const sortArrow = (key: SortKey) =>
    sortKey === key ? (sortDir === "asc" ? " ▲" : " ▼") : "";

  // סינון + מיון
  const filtered = customers
    .filter((c) => !pointFilter || (c.pointName || "(ללא נקודה)") === pointFilter)
    .filter((c) => !hideInactive || c.isActive !== false)
    .sort((a, b) => {
      const dir = sortDir === "asc" ? 1 : -1;

      // §251: מיון לפי **שם משפחה** כשממיינים לפי שם.
      //
      // 🐛 המיון היה על השדה `name` - כלומר לפי השם הפרטי. המנהל
      // שמחפש את "ניימן" עבר על כל האלף-בית של השמות הפרטיים.
      //
      // ⚠️ אותה נפילה של דף החלוקה (§233): lastName אם קיים,
      // אחרת המילה האחרונה בשם המלא. כך זה עובד גם על 386
      // הלקוחות שטרם פוצלו.
      if (sortKey === "name") {
        const last = (c: typeof a) => {
          if (c.lastName?.trim()) return c.lastName.trim();
          const full = (c.name || "").trim();
          const parts = full.split(/\s+/);
          return parts.length > 1 ? parts[parts.length - 1] : full;
        };
        const r = last(a).localeCompare(last(b), "he") * dir;
        // ⚠️ שם משפחה זהה - ממיינים לפי השם המלא, כדי ששני
        // "כהן" יופיעו בסדר קבוע.
        if (r !== 0) return r;
        return String(a.name ?? "").localeCompare(String(b.name ?? ""), "he") * dir;
      }

      const av = a[sortKey] ?? "";
      const bv = b[sortKey] ?? "";
      if (typeof av === "number" && typeof bv === "number") return (av - bv) * dir;
      return String(av).localeCompare(String(bv), "he") * dir;
    });

  const inactiveCount = customers.filter((c) => c.isActive === false).length;

  // §213: לקוחות שתקועים בלי אמצעי תשלום.
  //
  // 🐛 המקור: הרשמה עצמית באתר יוצרת לקוח עם CREDIT (ברירת
  // המחדל בסכמה), והוא אמור להמשיך למסך הכרטיס. מי שנוטש שם
  // נשאר CREDIT **בלי טוקן** - ואז הוא חסום בכל ערוץ.
  //
  // זו לא תקלה אלא נטישה טבעית. הבעיה היחידה הייתה שאף אחד לא
  // ידע שהם שם, והם גילו את זה רק כשניסו להזמין.
  // §226: לקוחות בלי סיסמה גלויה ובלי קוד.
  //
  // ⚠️ מי שיש לו מייל יכול "שכחתי סיסמה" בעצמו - הוא לא נספר
  // כאן, ואיפוס שלו רק ינתק אותו מסיסמה שהוא אולי כן זוכר.
  // §263: כמה לקוחות חייבים, וכמה כסף.
  //
  // ⚠️ הסכום הכולל: המנהל רוצה לדעת כמה כסף "תלוי באוויר",
  // לא רק כמה אנשים.
  const debtors = customers.filter(
    (c) => Number((c as any).debtBalance ?? 0) > 0
  );
  const debtTotal = debtors.reduce(
    (sum, c) => sum + Number((c as any).debtBalance ?? 0),
    0
  );

  const noPassCount = customers.filter(
    (c) =>
      c.isActive !== false &&
      c.hasPassword &&
      !c.passwordPlain &&
      !c.hasLoginCode &&
      !c.email
  ).length;

  const stuckCount = customers.filter(
    (c) =>
      c.isActive !== false &&
      c.paymentPreference !== "CASH" &&
      !c.hasPaymentToken
  ).length;

  // §139: רשימת הנקודות לסינון
  const pointNames = Array.from(
    new Set(customers.map((c) => c.pointName || "(ללא נקודה)"))
  ).sort((a, b) => a.localeCompare(b, "he"));

  // §139: קיבוץ לפי נקודת חלוקה. זו יחידת העבודה בחלוקה - כל
  // נקודה עומדת בפני עצמה, עם נציג משלה ומועד משלה.
  const grouped = filtered.reduce((acc, c) => {
    const key = c.pointName || "(ללא נקודה)";
    if (!acc[key]) acc[key] = [];
    acc[key].push(c);
    return acc;
  }, {} as Record<string, Customer[]>);

  // העיר של כל נקודה - לתת-כותרת
  const cityOfPoint = new Map<string, string>();
  for (const c of customers) {
    const k = c.pointName || "(ללא נקודה)";
    if (c.city && !cityOfPoint.has(k)) cityOfPoint.set(k, c.city);
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold text-brand-slatedark">לקוחות</h1>
          <p className="text-sm text-zinc-500">
            {customers.length} לקוחות{pointFilter ? ` · ${pointFilter}` : ""}
            {inactiveCount > 0 && ` · ${inactiveCount} לא פעילים`}
          </p>
          {/* §213: התראה על לקוחות תקועים.
              
              ⚠️ מתחת לכותרת ולא בתוך הרשימה: הם לא "עוד שורה"
              אלא מצב שדורש טיפול, ומי שרואה אותם רק כשגולל
              לשורה שלהם לא יטפל בהם אף פעם. */}
          {/* §226: כפתור איפוס קבוצתי.
              
              ⚠️ מוצג רק כשיש תקועים, ורק אחרי אישור בשתי שלבים -
              הפעולה מנתקת לקוחות מהסיסמה הנוכחית שלהם. */}
          {noPassCount > 0 && (
            <p className="text-[11px] text-violet-900 bg-violet-50 border border-violet-300 rounded px-2 py-1 mt-1 inline-block">
              🔑 <b>{noPassCount} לקוחות ללא סיסמה גלויה</b> — לא ניתן למסור
              להם סיסמה.{" "}
              <a
                href="/api/admin/reset-passwords"
                target="_blank"
                rel="noopener noreferrer"
                className="underline font-bold"
              >
                הצג רשימה
              </a>
            </p>
          )}
          {debtors.length > 0 && (
            <p className="text-[11px] text-red-900 bg-red-50 border border-red-300 rounded px-2 py-1 mt-1 inline-block">
              💸 <b>{debtors.length} לקוחות עם חוב</b> — סה״כ ₪
              {debtTotal.toLocaleString("he-IL", {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })}
              . ייגבה אוטומטית בהזמנה הבאה שלהם.
            </p>
          )}
          {stuckCount > 0 && (
            <p className="text-[11px] text-red-800 bg-red-50 border border-red-300 rounded px-2 py-1 mt-1 inline-block">
              💳 <b>{stuckCount} לקוחות ללא אמצעי תשלום</b> — מוגדרים כאשראי
              בלי כרטיס שמור, ולא יוכלו להזמין. חפש 💳 ברשימה.
            </p>
          )}
        </div>
        <div className="flex gap-2">
          {/* §54: המנהל יוצר לקוחות בעצמו, כמו נציג.
              ההבדל: הוא בוחר נקודת חלוקה במפורש (אין לו ברירת מחדל). */}
          <AdminAddCustomerButton points={points} onCreated={reload} />
        </div>

        {/* §127: כמה מוצגים מתוך כמה.
            
            ⚠️ בלי זה המנהל רואה רשימה שנראית מלאה ולא יודע
            שחסרים לקוחות - והוא עלול ליצור כפילות למי שכבר קיים
            ופשוט לא הופיע. */}
        <div className="flex items-center gap-2 flex-wrap text-xs">
          <span className="text-zinc-500">
            {truncated ? (
              <>
                מוצגים <b>{customers.length}</b> מתוך <b>{totalCount}</b> לקוחות
              </>
            ) : (
              <>
                <b>{totalCount}</b> לקוחות
              </>
            )}
          </span>
          {truncated && (
            <span className="bg-amber-100 text-amber-800 border border-amber-300 rounded px-2 py-0.5 font-medium">
              ⚠️ הרשימה חלקית — יש להשתמש בחיפוש כדי למצוא לקוח שאינו מופיע
            </span>
          )}
          <button
            onClick={() => setViewMode(viewMode === "table" ? "grouped" : "table")}
            className="btn-ghost btn-sm"
          >
            {viewMode === "table" ? "📍 לפי נקודות" : "📋 טבלה"}
          </button>
        </div>
      </div>

      {/* חיפוש + סינון עיר */}
      <div className="flex gap-2 flex-wrap items-center">
        <input
          className="input flex-1 min-w-[200px]"
          placeholder="חיפוש לפי שם, טלפון או מייל..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          autoFocus
        />
        {/* §139: סינון לפי נקודת חלוקה. בביתר יש B1 ו-B2, וסינון
            לפי עיר הציג את שתיהן יחד - חסר תועלת בחלוקה. */}
        <select
          className="input w-auto min-w-[180px]"
          value={pointFilter}
          onChange={(e) => setPointFilter(e.target.value)}
        >
          <option value="">כל נקודות החלוקה</option>
          {pointNames.map((p) => (
            <option key={p} value={p}>
              {p}
              {cityOfPoint.get(p) ? ` — ${cityOfPoint.get(p)}` : ""}
            </option>
          ))}
        </select>
        {inactiveCount > 0 && (
          <label className="flex items-center gap-1.5 text-sm text-zinc-600 whitespace-nowrap">
            <input
              type="checkbox"
              checked={hideInactive}
              onChange={(e) => setHideInactive(e.target.checked)}
              className="w-4 h-4 accent-brand-rust"
            />
            הסתר לא פעילים
          </label>
        )}
      </div>

      {loading ? (
        <p className="text-zinc-500 text-center py-8">טוען...</p>
      ) : filtered.length === 0 ? (
        <div className="card p-8 text-center text-zinc-500">
          {query || pointFilter ? "לא נמצאו לקוחות" : "אין עדיין לקוחות רשומים"}
        </div>
      ) : viewMode === "table" ? (
        /* ═══ תצוגת טבלה ═══ */
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-zinc-50 border-b text-right">
                <th className="p-3 cursor-pointer hover:bg-zinc-100" onClick={() => toggleSort("name")}>
                  שם{sortArrow("name")}
                </th>
                <th className="p-3 cursor-pointer hover:bg-zinc-100" onClick={() => toggleSort("phone")}>
                  טלפון{sortArrow("phone")}
                </th>
                <th className="p-3 hidden md:table-cell">מייל</th>
                {/* §139: הנקודה קודם - היא יחידת העבודה. העיר
                    אחריה, להתמצאות בלבד. */}
                <th className="p-3">נקודת חלוקה</th>
                <th className="p-3 cursor-pointer hover:bg-zinc-100" onClick={() => toggleSort("city")}>
                  עיר{sortArrow("city")}
                </th>
                <th className="p-3 cursor-pointer hover:bg-zinc-100 text-center" onClick={() => toggleSort("orderCount")}>
                  הזמנות{sortArrow("orderCount")}
                </th>
                <th className="p-3 text-center">כרטיס</th>
                <th className="p-3"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((c) => (
                <tr
                  key={c.id}
                  className={`border-b hover:bg-zinc-50 transition ${
                    c.isActive === false ? "opacity-60" : ""
                  }`}
                >
                  <td className="p-3 font-medium text-brand-slatedark">
                    {c.name}
                    {/* §173: לקוח ותיק בלי פיצול שם.
                        
                        ⚠️ לא מפצלים אוטומטית: "ברכה" אי אפשר,
                        ו"בן דוד יוסי" יפוצל שגוי. התגית מאפשרת
                        למנהל להשלים בהדרגה, ולא מייצרת נתון
                        שנראה אמין ואינו. */}
                    {!c.firstName && (
                      <span className="mr-1.5 text-[10px] bg-amber-100 text-amber-800 px-1.5 py-0.5 rounded font-bold">
                        חסר פיצול
                      </span>
                    )}
                    {/* §213: סימון לקוח תקוע.
                        
                        ⚠️ אדום ולא כתום: "חסר פיצול" הוא נוחות,
                        "בלי אמצעי תשלום" הוא חסימה. */}
                    {/* §225: אין סיסמה גלויה = המנהל לא יכול לעזור
                        ללקוח שלא מצליח להיכנס.
                        
                        ⚠️ hasPassword=true אבל passwordPlain ריק:
                        יש לו סיסמה, אבל אף אחד לא יודע מה היא.
                        זה בדיוק המצב של נציג ירושלים. */}
                    {c.hasPassword && !c.passwordPlain && !c.hasLoginCode && (
                      <span
                        className="mr-1.5 text-[10px] bg-violet-100 text-violet-800 px-1.5 py-0.5 rounded font-bold"
                        title="יש סיסמה אך היא אינה גלויה — יש לאפס כדי למסור ללקוח"
                      >
                        🔑 סיסמה לא גלויה
                      </span>
                    )}
                    {/* §263: 💸 תגית חוב.
                        
                        ⚠️ המנהל סורק את הרשימה ומחפש מי חייב כסף.
                        בלי התגית הוא צריך לפתוח כל לקוח בנפרד.
                        
                        ⚠️ הסכום **בתגית עצמה**: "יש חוב" בלי סכום
                        מחייב לפתוח בכל מקרה. */}
                    {Number((c as any).debtBalance ?? 0) > 0 && (
                      <span
                        className="mr-1.5 text-[10px] bg-red-600 text-white px-1.5 py-0.5 rounded font-bold"
                        title={(c as any).debtNote || "חוב מהעבר"}
                      >
                        💸 חוב ₪{Number((c as any).debtBalance).toFixed(0)}
                      </span>
                    )}
                    {c.isActive !== false &&
                      c.paymentPreference !== "CASH" &&
                      !c.hasPaymentToken && (
                        <span
                          className="mr-1.5 text-[10px] bg-red-100 text-red-800 px-1.5 py-0.5 rounded font-bold"
                          title="מוגדר כאשראי אך אין כרטיס שמור — לא יוכל להזמין"
                        >
                          💳 ללא אמצעי תשלום
                        </span>
                      )}
                    {/* §52: תגית לקוח לא פעיל */}
                    {c.isActive === false && (
                      <span className="mr-2 text-[10px] bg-zinc-200 text-zinc-600 px-1.5 py-0.5 rounded font-bold">
                        לא פעיל
                      </span>
                    )}
                  </td>
                  <td className="p-3 text-zinc-600" dir="ltr">{c.phone || "—"}</td>
                  <td className="p-3 text-zinc-500 hidden md:table-cell text-xs">{c.email || "—"}</td>
                  <td className="p-3 text-zinc-700 text-xs font-medium">
                    {c.pointName || "—"}
                  </td>
                  <td className="p-3 text-zinc-500 text-xs">{c.city || "—"}</td>
                  <td className="p-3 text-center">{c.orderCount}</td>
                  <td className="p-3 text-center">
                    {c.hasPaymentToken ? (
                      <span className="text-green-600">✓</span>
                    ) : (
                      <span className="text-zinc-300">—</span>
                    )}
                  </td>
                  <td className="p-3">
                    <div className="flex items-center gap-2 justify-end">
                      {/* §158: אותה פעולה גם בתצוגת הטבלה */}
                      <a
                        href={
                          c.activeOrderId
                            ? `/agent/orders/${c.activeOrderId}`
                            : `/agent/customer/${c.id}`
                        }
                        className={`text-xs font-bold rounded-lg px-2 py-1 whitespace-nowrap ${
                          c.activeOrderId
                            ? "bg-emerald-50 text-emerald-800 border border-emerald-300"
                            : "bg-brand-rust/10 text-brand-rust border border-brand-rust/30"
                        }`}
                      >
                        {c.activeOrderId ? `📦 #${c.activeOrderNumber}` : "🛒 הזמנה"}
                      </a>
                      <button
                        onClick={() => openEdit(c)}
                        className="text-brand-rust text-xs font-medium hover:underline"
                      >
                        עריכה
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        /* ═══ תצוגה מקובצת לפי ערים ═══ */
        <div className="space-y-4">
          {Object.entries(grouped)
            .sort(([a], [b]) => a.localeCompare(b, "he"))
            .map(([pointName, pointCustomers]) => (
            <div key={pointName}>
              <div className="flex items-center gap-2 mb-2 flex-wrap">
                <h2 className="text-base font-bold text-brand-slatedark">
                  📍 {pointName}
                </h2>
                {/* העיר כתת-כותרת: שימושית להתמצאות, אבל היא לא
                    יחידת העבודה - הנקודה היא. */}
                {cityOfPoint.get(pointName) && (
                  <span className="text-xs text-zinc-500">
                    {cityOfPoint.get(pointName)}
                  </span>
                )}
                <span className="text-xs text-zinc-400">
                  {pointCustomers.length} לקוחות
                </span>
                <div className="flex-1 border-b border-zinc-200" />
              </div>
              <div className="card overflow-x-auto">
                <table className="w-full text-sm">
                  <tbody>
                    {pointCustomers.map((c) => (
                      <tr
                        key={c.id}
                        className={`border-b last:border-b-0 hover:bg-zinc-50 transition ${
                          c.isActive === false ? "opacity-60" : ""
                        }`}
                      >
                        <td className="p-2.5 font-medium text-brand-slatedark">
                          {c.name}
                          {c.isActive === false && (
                            <span className="mr-2 text-[10px] bg-zinc-200 text-zinc-600 px-1.5 py-0.5 rounded font-bold">
                              לא פעיל
                            </span>
                          )}
                        </td>
                        <td className="p-2.5 text-zinc-600 text-xs" dir="ltr">{c.phone || "—"}</td>
                        <td className="p-2.5 text-zinc-500 text-xs hidden md:table-cell">{c.email || "—"}</td>
                        <td className="p-2.5 text-center text-xs">{c.orderCount} הזמנות</td>
                        <td className="p-2.5 text-center">
                          {/* §102: שני מידעים נפרדים, ולכן שני סימונים.
                              💳 = **יש** ללקוח כרטיס שמור במערכת.
                              💵 = **כך הוא משלם בפועל** כרגע.

                              🐛 מה שחסר היה: לקוח עם כרטיס שהוגדר
                              כמזומן נראה זהה ללקוח שמחויב באשראי -
                              הסימון סיפר מה יש לו, לא מה פעיל לגביו.
                              בבוקשפן אשר, למשל, שניהם נכונים בו-זמנית. */}
                          <div className="flex items-center justify-center gap-1">
                            {c.hasPaymentToken && (
                              <span className="text-green-600 text-xs" title="יש כרטיס אשראי שמור">
                                💳
                              </span>
                            )}
                            {/* §126: יתרת זכות - כסף שהעמותה חייבת
                                ללקוח. גלוי ברשימה כדי שהמנהל יראה
                                למי חייבים בלי להיכנס לכל כרטיס. */}
                            {!!c.creditBalance && c.creditBalance > 0 && (
                              <span
                                className="text-[10px] font-bold bg-blue-100 text-blue-800 border border-blue-300 rounded px-1.5 py-0.5"
                                title="יתרת זכות שתקוזז מההזמנה הבאה"
                              >
                                ↩️ {c.creditBalance}
                              </span>
                            )}
                            {c.paymentPreference === "CASH" && (
                              <span
                                className="text-[10px] font-bold bg-amber-100 text-amber-800 border border-amber-300 rounded px-1.5 py-0.5"
                                title="מוגדר כלקוח מזומן — הכרטיס לא יחויב"
                              >
                                מזומן
                              </span>
                            )}
                            {!c.hasPaymentToken && c.paymentPreference !== "CASH" && (
                              <span
                                className="text-[10px] text-zinc-400"
                                title="אין אמצעי תשלום — הלקוח אינו יכול להזמין"
                              >
                                —
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="p-2.5">
                          {/* §158: פעולה ישירה על הלקוח.
                              
                              ⚠️ עד היום הפעולה היחידה הייתה "עריכה",
                              שפותחת מודל של שם/טלפון/הרשאות. כדי
                              להזמין ללקוח היה צריך לעבור לאזור הנציג
                              ולחפש אותו שוב מאפס.
                              
                              ⚠️ הטקסט משתנה לפי המצב: יש הזמנה פעילה
                              -> "הזמנה #412", אין -> "הזמנה חדשה".
                              המנהל יודע מה יקרה לפני שהוא לוחץ. */}
                          <div className="flex items-center gap-2 justify-end">
                            <a
                              href={
                                c.activeOrderId
                                  ? `/agent/orders/${c.activeOrderId}`
                                  : `/agent/customer/${c.id}`
                              }
                              className={`text-xs font-bold rounded-lg px-2 py-1 whitespace-nowrap ${
                                c.activeOrderId
                                  ? "bg-emerald-50 text-emerald-800 border border-emerald-300"
                                  : "bg-brand-rust/10 text-brand-rust border border-brand-rust/30"
                              }`}
                              title={
                                c.activeOrderId
                                  ? "פתיחת ההזמנה הפעילה"
                                  : "יצירת הזמנה חדשה ללקוח"
                              }
                            >
                              {c.activeOrderId
                                ? `📦 #${c.activeOrderNumber}`
                                : "🛒 הזמנה"}
                            </a>
                            <button
                              onClick={() => openEdit(c)}
                              className="text-brand-rust text-xs font-medium hover:underline"
                            >
                              עריכה
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </div>
      )}

      {editing && (
        <Modal onClose={() => setEditing(null)} title={`עריכת לקוח: ${editing.name}`}>
          <div className="space-y-3">
            {/* §52: באנר בולט כשהלקוח לא פעיל - כדי שהמנהל לא יבזבז
                זמן על עריכה ואז יתפלא למה הוא לא מקבל מיילים */}
            {editing.isActive === false && (
              <div className="bg-zinc-100 border border-zinc-300 rounded-lg p-3 text-sm">
                <p className="font-bold text-zinc-700">⏸ הלקוח אינו פעיל</p>
                <p className="text-xs text-zinc-600 mt-0.5">
                  לא מקבל מיילים ולא יכול להזמין.
                  {editing.deactivatedReason && ` סיבה: ${editing.deactivatedReason}`}
                </p>
              </div>
            )}

            {/* §158: הזמנה מתוך המודל.
                
                ⚠️ למעלה ובולט: המנהל שפתח כרטיס לקוח בדרך כלל
                עושה את זה כדי לטפל בהזמנה שלו, לא כדי לערוך שם. */}
            <a
              href={
                editing.activeOrderId
                  ? `/agent/orders/${editing.activeOrderId}`
                  : `/agent/customer/${editing.id}`
              }
              className={`flex items-center justify-center gap-2 w-full py-2.5 rounded-xl font-bold text-sm ${
                editing.activeOrderId
                  ? "bg-emerald-600 text-white"
                  : "bg-brand-rust text-white"
              }`}
            >
              {editing.activeOrderId
                ? `📦 פתח הזמנה #${editing.activeOrderNumber}`
                : "🛒 בצע הזמנה ללקוח"}
            </a>

            {/* §173: שם פרטי ומשפחה.
                
                ⚠️ שדה "שם" המלא נשאר: הוא מקור האמת לכל התצוגות
                (מיילים, דף חלוקה, IVR), והשניים החדשים מתווספים
                לצדו. מילוי שניהם מעדכן גם אותו.
                
                ⚠️ ללקוח ותיק הם ריקים - וזה בסדר. אין פיצול
                אוטומטי כי "ברכה" אי אפשר לפצל, ו"בן דוד יוסי"
                יפוצל שגוי. */}
            <div className="grid grid-cols-2 gap-2">
              <Field label="שם פרטי">
                <input
                  className="input"
                  value={editFirst}
                  onChange={(e) => setEditFirst(e.target.value)}
                  placeholder="יוסי"
                />
              </Field>
              <Field label="שם משפחה">
                <input
                  className="input"
                  value={editLast}
                  onChange={(e) => setEditLast(e.target.value)}
                  placeholder="כהן"
                />
              </Field>
            </div>
            {!editing.firstName && (
              <p className="text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded p-2 -mt-1">
                ⚠️ ללקוח זה אין עדיין פיצול שם. מילוי שני השדות יעדכן
                גם את השם המלא.
              </p>
            )}

            <Field label="שם מלא (כפי שמוצג בכל מקום)">
              <input className="input" value={editName} onChange={(e) => setEditName(e.target.value)} />
            </Field>
            <div className="grid grid-cols-2 gap-2">
              <Field label="טלפון">
                <input className="input" dir="ltr" value={editPhone} onChange={(e) => setEditPhone(e.target.value)} />
              </Field>
              {/* §199: 🐛 טלפון נוסף (§161) לא היה במסך הזה.
                  
                  המנהל הקים לקוח עם מספר שני, וזה נשמר במסד -
                  אבל הוא לא ראה אותו כאן ולא יכול היה לתקן.
                  הלקוח התקשר מהמספר השני, לא זוהה, והמנהל לא
                  ידע שהמספר בכלל קיים. */}
              <Field label="טלפון נוסף">
                <input
                  className="input"
                  dir="ltr"
                  value={editPhone2}
                  onChange={(e) => setEditPhone2(e.target.value)}
                  placeholder="של בן/בת הזוג"
                />
              </Field>
            </div>
            <Field label="מייל">
              <input
                className="input"
                dir="ltr"
                type="email"
                placeholder="הוסף מייל כדי שהלקוח יוכל לאפס סיסמה בעצמו"
                value={editEmail}
                onChange={(e) => setEditEmail(e.target.value)}
              />
            </Field>

            <div className="border-t pt-3 space-y-3">
              {/* §62: קוד ההתחברות מחליף את הסיסמה.
                  "שכחתי קוד" נפתר כאן: לחיצה על "הצג קוד" ומקריאים
                  ללקוח. בלי איפוס, בלי מייל, בלי SMS. */}
              <AdminCustomerCodePanel
                customerId={editing.id}
                customerName={editing.name}
                hasCode={!!editing.hasLoginCode}
                codeSetAt={editing.loginCodeSetAt}
                role={editing.role}
                hasPassword={editing.hasPassword}
                passwordPlain={editing.passwordPlain}
                onChanged={reload}
              />

              {/* §82: אשראי ונקודת חלוקה - שתי הפעולות שהמנהל צריך
                  בכל שיחה עם לקוח.

                  🐛 הפער שנסגר: שתיהן היו זמינות רק דרך אזור הנציג
                  (/agent -> חיפוש -> כרטיס הלקוח). המנהל שנכנס
                  למסך הלקוחות - המקום הטבעי - ראה את מצב הכרטיס
                  אבל לא יכול היה לגעת בו, ולא יכול היה לשנות נקודה
                  ללקוח רגיל בכלל (השדה היה קיים רק להסבת תפקיד). */}
              <div className="bg-gradient-to-br from-emerald-50 to-zinc-50 border border-emerald-200 rounded-lg p-3 space-y-2.5">
                <div className="text-xs font-bold text-zinc-600">💳 אמצעי תשלום</div>

                {/* §102: לקוח מזומן שיש לו גם כרטיס - שני המצבים
                    מוצגים יחד. קודם הכרטיס "נעלם" מהמסך ברגע
                    שסומן מזומן, והמנהל לא ידע שהוא קיים. */}
                {editing.paymentPreference === "CASH" ? (
                  <>
                    <div className="bg-white border border-amber-300 rounded-lg p-2.5 text-xs text-amber-800">
                      💵 לקוח <b>מזומן</b> — הגבייה מתבצעת פיזית בחלוקה,
                      והכרטיס לא יחויב.
                    </div>
                    {editing.hasPaymentToken && (
                      <div className="bg-white border border-zinc-200 rounded-lg p-2.5 text-xs text-zinc-600">
                        💳 יש לו גם כרטיס שמור:{" "}
                        <strong dir="ltr">****{editing.cardLast4 || "----"}</strong>
                        {editing.cardExpiry && (
                          <span className="text-zinc-400 mr-2" dir="ltr">
                            {editing.cardExpiry.slice(0, 2)}/{editing.cardExpiry.slice(2)}
                          </span>
                        )}
                        <div className="text-zinc-500 mt-0.5">
                          הוא שמור ומוכן, אך אינו בשימוש כל עוד הלקוח מוגדר
                          כמזומן. מעבר לאשראי יפעיל אותו מיד.
                        </div>
                      </div>
                    )}
                  </>
                ) : editing.hasPaymentToken ? (
                  <div className="bg-white border border-zinc-200 rounded-lg p-2.5 text-sm">
                    כרטיס שמור:{" "}
                    <strong dir="ltr">****{editing.cardLast4 || "----"}</strong>
                    {editing.cardExpiry && (
                      <span className="text-zinc-500 text-xs mr-2" dir="ltr">
                        {editing.cardExpiry.slice(0, 2)}/{editing.cardExpiry.slice(2)}
                      </span>
                    )}
                    {editing.cardNeedsUpdate && (
                      <div className="mt-1 text-orange-700 text-xs font-bold">
                        ⚠️ הכרטיס דורש עדכון — לא ניתן לחייב איתו
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="bg-white border border-orange-300 rounded-lg p-2.5 text-xs text-orange-800">
                    <b>אין כרטיס שמור.</b> הלקוח מוגדר לתשלום באשראי ולכן
                    אינו יכול להזמין עד שיוזן לו כרטיס — או עד שיסומן
                    כלקוח מזומן.
                  </div>
                )}

                {/* §90: מתג מזומן/אשראי.
                    🐛 קודם אפשר היה רק *להיכנס* למזומן. היציאה ממנו
                    דרשה הזנת כרטיס - שלרוב אין - ולכן לקוח שסומן
                    בטעות כמזומן נשאר כזה לנצח.
                    עכשיו: המנהל מחליט. אשראי בלי כרטיס הוא מצב תקף
                    שמשמעותו "חייב להסדיר כרטיס לפני שיזמין" - וזה
                    בדיוק המצב של כל לקוח חדש. */}
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    disabled={saving || editing.paymentPreference === "CREDIT"}
                    onClick={() => setPaymentPref("CREDIT")}
                    className={`py-2 rounded-lg text-xs font-bold border-2 transition-colors ${
                      editing.paymentPreference !== "CASH"
                        ? "border-emerald-500 bg-emerald-100 text-emerald-800"
                        : "border-zinc-300 bg-white text-zinc-600 hover:border-emerald-400"
                    }`}
                  >
                    💳 אשראי
                  </button>
                  <button
                    type="button"
                    disabled={saving || editing.paymentPreference === "CASH"}
                    onClick={() => {
                      if (
                        window.confirm(
                          "לסמן כלקוח מזומן?\n\nהוא יוכל להזמין בלי כרטיס אשראי, והגבייה תתבצע פיזית בחלוקה."
                        )
                      )
                        setPaymentPref("CASH");
                    }}
                    className={`py-2 rounded-lg text-xs font-bold border-2 transition-colors ${
                      editing.paymentPreference === "CASH"
                        ? "border-amber-500 bg-amber-100 text-amber-800"
                        : "border-zinc-300 bg-white text-zinc-600 hover:border-amber-400"
                    }`}
                  >
                    💵 מזומן
                  </button>
                </div>

                <button
                  type="button"
                  onClick={() => setCardModalFor(editing as Customer)}
                  className="w-full text-xs font-bold text-emerald-800 border-2 border-emerald-500 rounded-lg py-2 hover:bg-emerald-600 hover:text-white transition-colors"
                >
                  💳 {editing.hasPaymentToken ? "החלפת כרטיס אשראי" : "הזנת כרטיס אשראי"}
                </button>
              </div>

              {/* §126: יתרת זכות בכרטיס - עם הסיבה. */}
              {!!editing.creditBalance && editing.creditBalance > 0 && (
                <div className="bg-blue-50 border-2 border-blue-300 rounded-lg p-3">
                  <div className="font-bold text-blue-900 text-sm">
                    ↩️ יתרת זכות: {editing.creditBalance} ₪
                  </div>
                  <div className="text-[11px] text-blue-800 mt-0.5 leading-relaxed">
                    הסכום יקוזז אוטומטית מההזמנה הבאה של הלקוח. הוא רואה
                    אותו באזור האישי ובמערכת הטלפונית.
                  </div>
                </div>
              )}

              {/* §145: הזמנה דרך אקסל במייל.
                  
                  ⚠️ בקשה מפורשת ולא ברירת מחדל: שליחה לכולם הייתה
                  מייצרת דואר זבל, והלקוחות היו מפסיקים לפתוח את
                  המיילים - כולל אישורי התשלום שחשוב שיראו. */}
              <label className="flex items-start gap-2 bg-emerald-50 border border-emerald-200 rounded-lg p-2.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={editing.wantsExcelOrder ?? false}
                  onChange={async (e) => {
                    const v = e.target.checked;
                    setEditing({ ...editing, wantsExcelOrder: v });
                    try {
                      await fetch(`/api/admin/customers/${editing.id}`, {
                        method: "PATCH",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ wantsExcelOrder: v }),
                      });
                      setSuccessMsg(
                        v
                          ? "הלקוח יקבל קובץ אקסל בכל מכירה חדשה"
                          : "הלקוח לא יקבל יותר קבצי אקסל"
                      );
                      await reload();
                    } catch {
                      setError("שגיאה בשמירה");
                    }
                  }}
                  className="h-4 w-4 accent-emerald-600 mt-0.5 shrink-0"
                />
                <div>
                  <span className="text-sm font-bold text-emerald-900">
                    📊 שליחת קובץ אקסל להזמנה
                  </span>
                  <p className="text-[11px] text-emerald-800 font-normal leading-relaxed">
                    בכל מכירה חדשה הלקוח יקבל במייל קובץ עם כל המוצרים.
                    הוא ממלא כמויות ומחזיר במייל.
                    {!editing.email && (
                      <b className="block text-red-700 mt-0.5">
                        ⚠️ אין ללקוח מייל — לא ניתן לשלוח.
                      </b>
                    )}
                  </p>
                </div>
              </label>

              {/* §82: נקודת חלוקה - לכל לקוח, לא רק לנציג */}
              <Field label="📍 נקודת חלוקה">
                <select
                  className="input"
                  value={editing.defaultPointId ?? ""}
                  onChange={(e) =>
                    setEditing({ ...editing, defaultPointId: e.target.value || null })
                  }
                >
                  <option value="">— ללא נקודה —</option>
                  {/* §163: נקודה סמויה מסומנת בבירור.
                      
                      ⚠️ בלי הסימון המנהל היה משייך אליה בטעות
                      לקוח רגיל, והלקוח היה מגיע לפתח חנות של
                      מישהו אחר. */}
                  {points.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.isPrivate ? "🔒 " : ""}
                      {p.name}
                      {p.city ? ` — ${p.city}` : ""}
                      {p.isPrivate ? " (סמויה)" : ""}
                    </option>
                  ))}
                </select>
                <p className="text-[11px] text-zinc-500 mt-1">
                  קובעת לאיזה נציג הלקוח משויך ומאיפה יאסוף את ההזמנה.
                  השינוי נשמר בלחיצה על &quot;שמירה&quot; למטה.
                </p>
                {/* §163: חיווי כשהלקוח משויך לנקודה סמויה */}
                {points.find((p) => p.id === editing.defaultPointId)?.isPrivate && (
                  <p className="text-[11px] text-violet-700 bg-violet-50 border border-violet-200 rounded p-2 mt-1.5 leading-relaxed">
                    🔒 <b>נקודה סמויה</b> — הלקוח מקבל את ההזמנה בכתובת הזו,
                    והיא אינה מוצגת ללקוחות אחרים באתר או בטלפון. היא תופיע
                    כנקודה נפרדת בסיכום ובדף החלוקה.
                  </p>
                )}
              </Field>

              {/* §62: נעילה פעילה - הסבר למה הלקוח לא מצליח להיכנס.
                  קביעת קוד חדש מנקה אותה אוטומטית. */}
              {editing.lockedUntil &&
                new Date(editing.lockedUntil).getTime() > Date.now() && (
                  <div className="bg-red-50 border border-red-200 rounded-lg p-2.5 text-xs text-red-800">
                    🔒 החשבון נעול עד{" "}
                    {new Date(editing.lockedUntil).toLocaleTimeString("he-IL", {
                    // §200: השרת רץ ב-UTC — בלי זה 3 שעות אחורה
                    timeZone: "Asia/Jerusalem",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}{" "}
                    לאחר {editing.failedLoginAttempts ?? 0} ניסיונות כושלים.
                    קביעת קוד חדש תשחרר את הנעילה מיד.
                  </div>
                )}

              {/* §62: כניסה בשם משתמש. מתועדת ביומן, וניתן לחזור
                  בכל רגע דרך הבאנר שמופיע בראש המסך. */}
              <div className="flex items-center justify-between gap-2 bg-zinc-50 border border-zinc-200 rounded-lg p-2.5">
                <div className="text-xs text-zinc-600">
                  כניסה לחשבון כדי לראות בדיוק מה שהלקוח רואה
                </div>
                <ImpersonateButton
                  customerId={editing.id}
                  customerName={editing.name}
                  role={editing.role}
                />
              </div>

              {/* §152: פרטי הכניסה מוצגים בפאנל אחד למעלה.
                  
                  🐛 מה שהיה: שני פאנלים נפרדים - "קוד התחברות"
                  ו"סיסמה". המנהל ראה שני ערכים שונים לאותו לקוח
                  ולא ידע איזה למסור, והלקוח לא ידע איזה שלו.
                  
                  ⚠️ שניהם עדיין עובדים בכניסה (§125). מה שהשתנה
                  הוא שיש **מקור אמת אחד לתצוגה** - AdminCustomerCodePanel
                  מציג את הערך הרלוונטי ואומר מאיפה הוא. */}
            </div>

            {/* ═══ המרת תפקיד: לקוח ↔ נציג ↔ מנהל ═══ */}
            <div className="border-t pt-3">
              <div className="flex items-center justify-between mb-2">
                <div className="text-xs font-bold text-zinc-500">
                  תפקיד נוכחי: {" "}
                  <span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-bold ${
                    editing.role === "AGENT" ? "bg-purple-100 text-purple-700" :
                    editing.role === "ADMIN" ? "bg-red-100 text-red-700" :
                    "bg-zinc-100 text-zinc-600"
                  }`}>
                    {editing.role === "AGENT" ? "🎯 נציג" : editing.role === "ADMIN" ? "👑 מנהל" : "לקוח"}
                  </span>
                </div>
                {!convertingToAgent && (
                  <button type="button" onClick={() => setConvertingToAgent(true)} className="text-xs text-brand-rust font-bold hover:underline">
                    שינוי תפקיד ←
                  </button>
                )}
              </div>

              {convertingToAgent && (
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 space-y-3">
                  <Field label="תפקיד חדש">
                    <select className="input" value={newRole} onChange={(e) => setNewRole(e.target.value)}>
                      <option value="CUSTOMER">לקוח רגיל</option>
                      <option value="AGENT">נציג</option>
                      <option value="ADMIN">מנהל (⚠️ הרשאות מלאות)</option>
                    </select>
                  </Field>
                  {newRole === "AGENT" && (
                    <Field label="נקודת חלוקה משויכת *">
                      <select className="input" value={newPointId} onChange={(e) => setNewPointId(e.target.value)}>
                        <option value="">— בחר נקודה —</option>
                        {points.map(p => (
                          <option key={p.id} value={p.id}>{p.name}{p.city ? ` — ${p.city}` : ""}</option>
                        ))}
                      </select>
                    </Field>
                  )}
                  <div className="flex gap-2">
                    <button type="button" onClick={() => setConvertingToAgent(false)} className="btn-ghost btn-sm flex-1">ביטול</button>
                    <button type="button" onClick={convertRole} disabled={saving} className="btn-primary btn-sm flex-1">
                      {saving ? "מעדכן..." : "עדכן תפקיד"}
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* ═══ הרשאות נציג - רק אם הrole הוא AGENT ═══ */}
            {editing.role === "AGENT" && !convertingToAgent && (
              <div className="border-t pt-3">
                <div className="text-xs font-bold text-zinc-500 mb-2">
                  🔐 הרשאות נציג
                </div>
                <div className="bg-purple-50 border border-purple-200 rounded-lg p-3 space-y-2 text-sm">
                  <PermissionCheckbox
                    checked={!!editing.agentCanSetFinalPrice}
                    label="קביעת מחיר סופי"
                    hint="הנציג יכול לחתום על מחיר סופי לאחר שקילה"
                    onChange={(v) => togglePermission("agentCanSetFinalPrice", v)}
                    saving={saving}
                  />
                  <PermissionCheckbox
                    checked={!!editing.agentCanSendPaymentLink}
                    label="שליחת קישור תשלום"
                    hint="הנציג יכול לשלוח ללקוח קישור לתשלום"
                    onChange={(v) => togglePermission("agentCanSendPaymentLink", v)}
                    saving={saving}
                  />
                  <PermissionCheckbox
                    checked={!!editing.agentCanCharge}
                    label="💳 חיוב אוטומטי עם טוקן"
                    hint="הנציג יכול לחייב את הלקוח אוטומטית בכרטיס השמור"
                    onChange={(v) => togglePermission("agentCanCharge", v)}
                    saving={saving}
                  />
                  {/* §155: הקמת לקוחות מזומן.
                      
                      ⚠️ זו ההרשאה היחידה כאן שנוגעת ישירות בכסף
                      שנכנס: לקוח מזומן מזמין בלי כרטיס, והנציג
                      שסימן אותו לוקח אחריות לגבות בחלוקה. */}
                  <PermissionCheckbox
                    checked={!!editing.agentCanCreateCashCustomers}
                    label="💵 הקמת לקוחות מזומן"
                    hint="הנציג יוכל להקים לקוח בלי כרטיס אשראי, ולסמן לקוח קיים כמזומן. הגבייה תתבצע על ידו בחלוקה."
                    onChange={(v) => togglePermission("agentCanCreateCashCustomers", v)}
                    saving={saving}
                  />
                  <PermissionCheckbox
                    checked={!!editing.agentCanUpdateCards}
                    label="🔄 עדכון פרטי אשראי"
                    hint="הנציג יכול להזמין את הלקוח לעדכן כרטיס אצלו"
                    onChange={(v) => togglePermission("agentCanUpdateCards", v)}
                    saving={saving}
                  />
                </div>

                {/* 🆕 נקודות חלוקה משויכות - many-to-many */}
                <div className="mt-3">
                  <div className="text-xs font-bold text-zinc-500 mb-2">
                    📍 נקודות חלוקה משויכות
                    <span className="font-normal text-zinc-400 mr-1">
                      (הנציג יראה לקוחות והזמנות מכל הנקודות שסומנו)
                    </span>
                  </div>
                  <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-3">
                    {points.length === 0 ? (
                      <p className="text-xs text-zinc-500">טוען נקודות...</p>
                    ) : (
                      <div className="space-y-1 max-h-52 overflow-y-auto">
                        {points.map((p) => (
                          <label
                            key={p.id}
                            className={`flex items-center gap-2 p-2 rounded cursor-pointer text-sm transition-colors ${
                              selectedAgentPointIds.has(p.id)
                                ? "bg-emerald-100"
                                : "hover:bg-white"
                            }`}
                          >
                            <input
                              type="checkbox"
                              checked={selectedAgentPointIds.has(p.id)}
                              onChange={() => toggleAgentPoint(p.id)}
                              className="w-4 h-4 accent-emerald-600"
                            />
                            <span className="flex-1 min-w-0 truncate text-brand-slatedark">
                              {p.name}
                              {p.city ? ` — ${p.city}` : ""}
                            </span>
                          </label>
                        ))}
                      </div>
                    )}
                    <div className="flex items-center justify-between gap-2 mt-2 pt-2 border-t border-emerald-200">
                      <span className="text-xs text-emerald-800 font-medium">
                        {selectedAgentPointIds.size} נקודות נבחרו
                      </span>
                      <button
                        type="button"
                        onClick={saveAgentPoints}
                        disabled={saving}
                        className="text-xs px-3 py-1.5 rounded-lg bg-emerald-600 text-white font-bold hover:bg-emerald-700 disabled:opacity-50"
                      >
                        {saving ? "שומר..." : "שמור נקודות"}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* §52: הפעלה/השבתה. מוצג בתחתית ובנפרד כי זו פעולה
                משמעותית, ולא חלק מעריכת הפרטים השוטפת. */}
            <div className="border-t pt-3">
              {editing.isActive === false ? (
                <button
                  type="button"
                  onClick={toggleActive}
                  disabled={saving}
                  className="w-full py-2.5 rounded-lg bg-emerald-600 text-white text-sm font-bold hover:bg-emerald-700 disabled:opacity-50"
                >
                  ▶ הפעל את הלקוח מחדש
                </button>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={toggleActive}
                    disabled={saving}
                    className="w-full py-2 rounded-lg border border-zinc-300 text-zinc-700 text-sm font-bold hover:bg-zinc-50 disabled:opacity-50"
                  >
                    ⏸ השבת לקוח
                  </button>
                  <p className="text-[11px] text-zinc-500 mt-1.5 text-center">
                    הלקוח יפסיק לקבל מיילים ולא יוכל להזמין. ההיסטוריה נשמרת
                    במלואה וניתן להפעיל אותו מחדש בכל רגע.
                  </p>
                </>
              )}
            </div>

            {error && <p className="text-red-600 text-sm">{error}</p>}
            {successMsg && (
              <p className="text-green-700 text-sm font-medium bg-green-50 border border-green-200 rounded-lg p-2">
                {successMsg}
              </p>
            )}
            <button onClick={save} disabled={saving} className="btn-primary w-full">
              {saving ? "שומר..." : "שמירה"}
            </button>
          </div>
        </Modal>
      )}

      {/* §82: מודל עדכון האשראי. מציג את ה-iframe של נדרים ושומר
          את הטוקן על הלקוח הנבחר.

          onSuccess -> reload: הכרטיס החדש, מצב "דורש עדכון" ומעבר
          אוטומטי מ-CASH ל-CREDIT כולם נקבעים בשרת, ולכן נמשכים
          משם ולא מורכבים כאן מחדש. */}
      {cardModalFor && (
        <UpdateCardModal
          customerId={cardModalFor.id}
          hasCurrentCard={cardModalFor.hasPaymentToken}
          onClose={() => setCardModalFor(null)}
          onSuccess={() => {
            setCardModalFor(null);
            // §114: הקוד מופק בשרת עם שמירת הכרטיס, אבל המודל
            // מזהה הצלחה דרך polling ולא מקבל את תשובת save-token.
            // לכן מפנים לפאנל הקוד, שמתרענן ב-reload ויציג "יש קוד".
            setSuccessMsg(
              "הכרטיס עודכן בהצלחה. הופק קוד כניסה לאתר — ניתן להציגו בפאנל \"קוד התחברות\" ולמסור ללקוח."
            );
            reload();
          }}
        />
      )}
    </div>
  );
}

// ═══ קומפוננט checkbox של הרשאה ═══
function PermissionCheckbox({
  checked,
  label,
  hint,
  onChange,
  saving,
}: {
  checked: boolean;
  label: string;
  hint?: string;
  onChange: (v: boolean) => void;
  saving: boolean;
}) {
  return (
    <label className="flex items-start gap-2 cursor-pointer hover:bg-purple-100/50 rounded p-2 -m-2">
      <input
        type="checkbox"
        checked={checked}
        disabled={saving}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-1 w-4 h-4 accent-purple-600"
      />
      <div className="flex-1 min-w-0">
        <div className="font-bold text-purple-900 text-sm">{label}</div>
        {hint && <div className="text-xs text-purple-700 mt-0.5">{hint}</div>}
      </div>
    </label>
  );
}
