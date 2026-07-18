"use client";

import { useState, useMemo, useEffect, useRef } from "react";
import Link from "next/link";
import { signOut } from "next-auth/react";
import { Logo } from "@/components/Logo";
import { effectiveUnitPrice, lineEstimate, smartLineEstimate, fmt } from "@/lib/pricing";

type Point = {
  id: string;
  name: string;
  city: string | null;
  address: string | null;
  contactName: string | null;
  phone: string | null;
  email: string | null;
  deliveryHours: string | null;
  notes: string | null;
  // §6: תאריך חלוקה חריג לנקודה - עדיף על deliveryDateText של המחירון
  customDeliveryDateText: string | null;
};

// רינדור שם מוצר עם הדגשות: *מילה* הופכת למודגשת (סלמון *פילה*)
function renderName(name: string) {
  const parts = name.split(/\*([^*]+)\*/g);
  return parts.map((part, i) =>
    i % 2 === 1 ? (
      <strong key={i} className="text-brand-rust">
        {part}
      </strong>
    ) : (
      <span key={i}>{part}</span>
    )
  );
}

type Product = {
  id: string;
  name: string;
  category: string;
  categorySort: number;
  imageUrl: string | null;
  kashrut: string | null;
  isFeatured: boolean;
  highlightNote: string | null;
  price: number;
  allowSingles: boolean;
  singlesMode: string; // "KG" (default) | "UNITS" - בודדים לפי ק"ג או לפי יחידה
  singleUnitPrice: number | null; // מחיר קבוע ליחידה בבודדים (כשsinglesMode=UNITS)
  unit: string;
  saleType: string;
  priceType: string;
  avgWeightPerUnit: number | null;
  packageWeight: string | null;
  isFrozen: boolean;
  limitedQty: boolean;
  sortOrder: number;
};

type Pricelist = {
  id: string;
  name: string;
  deliveryDateText: string | null;
  closeDateText: string | null; // תאריך סיום הרשמה לתצוגה (סעיף 10)
  notes: string | null;
  singleSurcharge: number;
};

// פרטי הלקוח המחובר - מגיעים מה-session, לא מוקלדים מחדש בכל הזמנה
type LoggedInCustomer = {
  name: string;
  phone: string | null;
  email: string | null;
  defaultPointId: string | null;
};

// ח4: עגלה תומכת גם בקרטונים וגם בבודדים לאותו מוצר
type CartLine = { cartonQty: number; singlesQty: number };

// שלב ההזמנה הוסר (§5 מאפיון 2): phone2 והערות הוסרו — הלקוח יכול לעדכן באזור האישי
type Step = "point" | "date" | "products" | "summary" | "done";

export function OrderFlow({
  pricelist,
  points,
  products,
  customer,
  onBehalfOfCustomerId,
  cardVerified = true,
  customerId = "",
  existingOrder = null,
}: {
  pricelist: Pricelist;
  points: Point[];
  products: Product[];
  customer: LoggedInCustomer;
  onBehalfOfCustomerId?: string;
  cardVerified?: boolean;
  customerId?: string;
  existingOrder?: { id: string; orderNumber: number } | null;
}) {
  // §11: אם ללקוח יש נקודה שמורה ופעילה במכירה — דילוג ישירות למוצרים
  const hasValidDefault =
    !!customer.defaultPointId && points.some((p) => p.id === customer.defaultPointId);
  const [step, setStep] = useState<Step>(hasValidDefault ? "products" : "point");
  const [pointId, setPointId] = useState<string>(
    hasValidDefault ? customer.defaultPointId! : ""
  );
  const [selectedCity, setSelectedCity] = useState<string | null>(null);
  const [dateConfirmed, setDateConfirmed] = useState(false);
  const [cart, setCart] = useState<Record<string, CartLine>>({});
  // טלפון ראשי מהחשבון. אם חסר — משלים בסיכום.
  const [phone, setPhone] = useState(customer.phone ?? "");
  const [submitting, setSubmitting] = useState(false);
  const [orderNumber, setOrderNumber] = useState<number | null>(null);
  const [error, setError] = useState("");
  // §4: הודעת תנאים לפני תחילת ההזמנה
  const [termsAccepted, setTermsAccepted] = useState(false);
  // §13: מספר תשלומים (1 או 2 — מוצג ללקוח רק מעל 800₪)
  const [installments, setInstallments] = useState(1);

  // §11: אם ללקוח יש נקודה שמורה — דילוג אוטומטי על בחירת נקודה
  const point = points.find((p) => p.id === pointId) || null;
  const needsPhoneInput = !customer.phone;

  // קיבוץ נקודות חלוקה לפי עיר - אם יש כמה ערים, קודם בוחרים עיר ואז נקודה בתוכה.
  // אם יש עיר אחת בלבד (או שלנקודות אין עיר מוגדרת כלל), מציגים ישר רשימת נקודות בלי שלב עיר.
  const cities = useMemo(() => {
    const set = new Set<string>();
    for (const p of points) if (p.city) set.add(p.city);
    return Array.from(set).sort((a, b) => a.localeCompare(b, "he"));
  }, [points]);
  const pointsWithoutCity = useMemo(() => points.filter((p) => !p.city), [points]);
  const showCityStep = cities.length > 1;
  const pointsInSelectedCity = useMemo(
    () => (selectedCity ? points.filter((p) => p.city === selectedCity) : []),
    [points, selectedCity]
  );

  const categories = useMemo(() => {
    const map = new Map<string, Product[]>();
    for (const p of products) {
      if (!map.has(p.category)) map.set(p.category, []);
      map.get(p.category)!.push(p);
    }
    return Array.from(map.entries());
  }, [products]);

  // ח4: cartLines — מפרק כל entry לשורה/שתיים (קרטונים + בודדים)
  type ComputedLine = {
    product: Product;
    isSingle: boolean;
    qty: number;
    unitPrice: number;
    lineTotal: number | null;
  };
  const cartLines: ComputedLine[] = useMemo(() => {
    const lines: ComputedLine[] = [];
    for (const [id, entry] of Object.entries(cart)) {
      const p = products.find((x) => x.id === id);
      if (!p) continue;
      // שורת קרטונים
      if (entry.cartonQty > 0) {
        const up = effectiveUnitPrice(p.price, false, pricelist.singleSurcharge, p.singlesMode, p.singleUnitPrice);
        const lt = smartLineEstimate(up, entry.cartonQty, p.saleType, p.priceType, p.avgWeightPerUnit);
        lines.push({ product: p, isSingle: false, qty: entry.cartonQty, unitPrice: up, lineTotal: lt });
      }
      // שורת בודדים
      if (entry.singlesQty > 0) {
        const up = effectiveUnitPrice(p.price, true, pricelist.singleSurcharge, p.singlesMode, p.singleUnitPrice);
        const lt = Math.round(up * entry.singlesQty * 100) / 100;
        lines.push({ product: p, isSingle: true, qty: entry.singlesQty, unitPrice: up, lineTotal: lt });
      }
    }
    return lines;
  }, [cart, products, pricelist.singleSurcharge]);

  const estimatedTotal = cartLines.reduce((s, l) => s + (l.lineTotal ?? 0), 0);
  const hasMissingWeight = cartLines.some((l) => l.lineTotal === null);
  const itemCount = cartLines.length;

  // ח4: פונקציות עדכון כמות — נפרדות לקרטונים ולבודדים
  function setCartonQty(id: string, qty: number) {
    setCart((c) => {
      const prev = c[id] ?? { cartonQty: 0, singlesQty: 0 };
      return { ...c, [id]: { ...prev, cartonQty: Math.max(0, qty) } };
    });
  }
  function setSinglesQty(id: string, qty: number) {
    setCart((c) => {
      const prev = c[id] ?? { cartonQty: 0, singlesQty: 0 };
      return { ...c, [id]: { ...prev, singlesQty: Math.max(0, qty) } };
    });
  }
  // ח4: הסרת מוצר מהעגלה לגמרי
  function removeFromCart(productId: string, isSingle: boolean) {
    setCart((c) => {
      const prev = c[productId] ?? { cartonQty: 0, singlesQty: 0 };
      if (isSingle) {
        return { ...c, [productId]: { ...prev, singlesQty: 0 } };
      }
      return { ...c, [productId]: { ...prev, cartonQty: 0 } };
    });
  }

  // תווית כמות לתצוגה: "1 קרטון (~10 ק"ג)" / "3 ק"ג" / "2 יחידות"
  // הזיהוי של קרטון הוא avgWeightPerUnit != null (יש משקל ממוצע = זה קרטון)
  function qtyLabel(p: Product, line: { isSingle: boolean; qty: number }): string {
    if (line.qty <= 0) return "";
    if (line.isSingle && p.priceType === "PER_KG") {
      // סלומון וכד': בודדים = יחידות, לא ק"ג
      if (p.singlesMode === "UNITS") {
        return line.qty === 1 ? "1 יחידה" : `${line.qty} יחידות`;
      }
      // בשר: בודדים = ק"ג
      return line.qty === 1 ? '1 ק"ג' : `${line.qty} ק"ג`;
    }
    // אם יש משקל ממוצע - זה קרטון
    if (p.avgWeightPerUnit != null && p.avgWeightPerUnit > 0) {
      const totalWeight = Math.round(p.avgWeightPerUnit * line.qty * 10) / 10;
      const label = line.qty === 1 ? "1 קרטון" : `${line.qty} קרטונים`;
      return `${label} (~${totalWeight} ק"ג)`;
    }
    // אם saleType=PACKAGE אבל אין avgWeight - עדיין קרטון (בלי משקל)
    if (p.saleType === "PACKAGE" || p.priceType === "PER_KG") {
      return line.qty === 1 ? "1 קרטון" : `${line.qty} קרטונים`;
    }
    // יחידות במחיר קבוע
    return line.qty === 1 ? "1 יחידה" : `${line.qty} יחידות`;
  }

  function stepFromQty(_p: Product, _isSingle: boolean) {
    // סעיף 1: אין חצאי ק"ג או חצאי קרטון - הכל בקפיצות של יחידה שלמה.
    return 1;
  }

  // סעיף 1: מינימום הזמנה בבודדים (בשר/דגים) = 2 ק"ג
  const MIN_SINGLES_KG = 2;

  // מצב אימות כרטיס: idle=לא נדרש/הושלם, verifying=iframe מוצג, checking=polling
  const [showVerification, setShowVerification] = useState(false);
  const [isVerified, setIsVerified] = useState(cardVerified);

  // ═══ אינטגרציית postMessage מול iframe של נדרים ═══
  // נדרים לא מציגים כפתור submit בתוך ה-iframe. הפרוטוקול שלהם:
  //   1. אתר האם יש כפתור משלו ("אמת ושלם 1 ש"ח")
  //   2. בלחיצה שולחים postMessage({Name:'FinishTransaction2'}) ל-iframe
  //   3. ה-iframe מעבד ומחזיר postMessage עם Status
  //   4. במקביל הוא קורא ל-webhook שלנו
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const [iframeSubmitting, setIframeSubmitting] = useState(false);
  const [iframeError, setIframeError] = useState<string | null>(null);
  // מעקב אחר "נדרים אישרו את החיוב אבל עדיין ממתינים ל-webhook לשמור את הטוקן"
  const [nedarimConfirmedOk, setNedarimConfirmedOk] = useState(false);

  // iframe נדרים לאימות + יצירת Token (לפי תיעוד: PaymentType=CreateToken)
  // הוראות נדרים במפורש למצב יצירת טוקן:
  //   Tokef=Hide - "במצב יצירת טוקן, אין לשלוח תוקף. יש להסתיר שדה זה"
  //   CVV=Hide   - "במצב יצירת טוקן, אין לשלוח CVV. יש להסתיר שדה זה"
  const verificationIframeUrl =
    customerId &&
    "https://www.matara.pro/nedarimplus/iframe?" +
      new URLSearchParams({
        language: "he",
        Mosad: "7015318",
        ApiValid: "NxhXRWeG5P",
        Amount: "1",
        AmountLock: "1",
        PaymentType: "CreateToken",
        TransactionType: "Debit",
        Tashlumim: "1",
        Tokef: "Hide",
        CVV: "Hide",
        CallBack: "https://tzidkat.com/api/webhooks/nedarim",
        param1: customerId,
        param2: "registration",
      }).toString();

  // polling: בזמן שה-iframe פתוח, בודקים כל 3 שניות אם הטוקן נשמר (דרך ה-webhook)
  useEffect(() => {
    if (!showVerification || isVerified) return;
    const interval = setInterval(async () => {
      try {
        const res = await fetch("/api/customer/verification-status");
        const data = await res.json();
        if (data.verified) {
          setIsVerified(true);
          setShowVerification(false);
          setIframeSubmitting(false);
          setIframeError(null);
          setNedarimConfirmedOk(false);
          // האימות הושלם - שולחים את ההזמנה אוטומטית
          doSubmit();
        }
      } catch {
        // מתעלמים - ננסה שוב בסיבוב הבא
      }
    }, 3000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showVerification, isVerified]);

  // ═══ postMessage listener מ-iframe של נדרים ═══
  // לפי התיעוד של נדרים:
  //   {Name: 'Height', Value: <pixels>} - מציין גובה תוכן ה-iframe
  //   {Name: 'TransactionResponse', Value: {Status, Message, ...}} - תוצאת חיוב
  useEffect(() => {
    if (!showVerification) return;

    const handleMessage = async (event: MessageEvent) => {
      // אבטחה: מקבלים רק הודעות מ-matara.pro
      const origin = String(event.origin || "").toLowerCase();
      if (!origin.includes("matara.pro")) return;

      // DEBUG: לוג של כל הודעה כדי לראות מה נדרים שולחים
      console.log("[nedarim iframe] MESSAGE:", event.data);

      const data = event.data;
      if (!data || typeof data !== "object") return;

      const name = data.Name;
      const value = data.Value;

      // ── Height: התאמת גובה ה-iframe לתוכן ──
      if (name === "Height") {
        if (iframeRef.current && value !== undefined && value !== null) {
          const h = parseInt(String(value), 10);
          if (h > 0) {
            iframeRef.current.style.height = h + 15 + "px";
          }
        }
        return;
      }

      // ── TransactionResponse: תוצאת החיוב ──
      if (name === "TransactionResponse") {
        // ═══════════════════════════════════════════════════════════
        // === RAW DUMP: כל מה שנדרים שלחו, בלי הנחות ===
        // ═══════════════════════════════════════════════════════════
        console.log("[nedarim iframe] ╔══════════════════════════════════════════════");
        console.log("[nedarim iframe] ║ TransactionResponse FULL RAW DUMP");
        console.log("[nedarim iframe] ╚══════════════════════════════════════════════");
        console.log("[nedarim iframe] Origin:", event.origin);
        console.log("[nedarim iframe] Raw event.data (JSON):");
        console.log(JSON.stringify(data, null, 2));

        // כל שדה top-level
        console.log("[nedarim iframe] ─── Top-level keys ───");
        for (const [k, v] of Object.entries(data)) {
          const type = Array.isArray(v) ? "array" : typeof v;
          const preview =
            typeof v === "object" && v !== null ? JSON.stringify(v).substring(0, 100) : String(v);
          console.log(`[nedarim iframe]   ${k}: (${type}) ${preview}`);
        }

        // אם יש Value - נסרוק לעומק
        if (value && typeof value === "object") {
          console.log("[nedarim iframe] ─── Value contents (JSON) ───");
          console.log(JSON.stringify(value, null, 2));
          console.log("[nedarim iframe] ─── Value keys with types ───");
          for (const [k, v] of Object.entries(value)) {
            const type = Array.isArray(v) ? "array" : typeof v;
            console.log(`[nedarim iframe]   Value.${k}: (${type}) ${String(v)}`);
          }

          // ═══ חיפוש חכם של מזהי כרטיס - לפי דפוסי שם ═══
          console.log("[nedarim iframe] ─── Potential identifier fields (heuristic) ───");
          for (const [k, v] of Object.entries(value)) {
            const kLower = k.toLowerCase();
            const isIdCandidate =
              kLower.includes("token") ||
              kLower.includes("uid") ||
              (kLower.includes("id") && !kLower.includes("mid") && !kLower.includes("void")) ||
              kLower.includes("saved") ||
              kLower.includes("keva") ||
              kLower.includes("card");
            if (isIdCandidate && v !== null && v !== undefined && String(v).trim() !== "") {
              console.log(`[nedarim iframe]   🔑 CANDIDATE: ${k} = "${String(v)}"`);
            }
          }
        }
        console.log("[nedarim iframe] ╚══════════════════════════════════════════════");
        // ═══════════════════════════════════════════════════════════

        const status = String(value?.Status || "").toLowerCase();
        const isError = status === "error" || status === "err" || status === "fail";
        const isOk = status === "ok" || status === "success";

        if (isError) {
          setIframeSubmitting(false);
          const msg =
            value?.Message ||
            value?.message ||
            value?.Description ||
            value?.ErrorMessage ||
            "שגיאה באימות הכרטיס. בדוק את הפרטים ונסה שוב.";
          setIframeError(String(msg));
          console.error("[nedarim iframe] transaction failed:", value);
        } else if (isOk) {
          // ═══ הצלחה! ═══
          // במצב CreateToken, נדרים מחזירים את הטוקן ישירות ב-TransactionResponse.
          // אין webhook במצב CreateToken (כי אין חיוב).
          // שומרים את הטוקן מיד דרך API call.
          const receivedToken = String(value?.Token || value?.token || "").trim();
          const receivedLast4 = String(value?.LastNum || value?.lastNum || "").trim();

          if (receivedToken) {
            console.log(`[nedarim iframe] ✅ Token received: ${receivedToken}, saving...`);
            try {
              const saveRes = await fetch("/api/customer/save-token", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ token: receivedToken, lastNum: receivedLast4 }),
              });
              const saveData = await saveRes.json().catch(() => ({}));
              if (saveRes.ok) {
                console.log("[nedarim iframe] Token saved successfully:", saveData);
                // הטוקן נשמר — סוגרים את המודל ושולחים את ההזמנה
                setIsVerified(true);
                setShowVerification(false);
                setIframeSubmitting(false);
                setIframeError(null);
                setNedarimConfirmedOk(false);
                doSubmit();
              } else {
                console.error("[nedarim iframe] Failed to save token:", saveData);
                setIframeSubmitting(false);
                setIframeError(
                  `הטוקן התקבל מנדרים אבל שמירתו נכשלה: ${saveData.error || "שגיאה לא ידועה"}. נסה שוב.`
                );
              }
            } catch (fetchErr: any) {
              console.error("[nedarim iframe] Network error saving token:", fetchErr);
              setIframeSubmitting(false);
              setIframeError("שגיאת רשת בשמירת הטוקן. בדוק את החיבור ונסה שוב.");
            }
          } else {
            // Status=OK אבל אין Token — מצב בלתי צפוי
            console.warn("[nedarim iframe] Status OK but no Token in response:", value);
            setNedarimConfirmedOk(true);
            // ממשיכים לחכות — polling יבדוק אם ה-webhook שמר את הטוקן
          }
        } else {
          // סטטוס לא מזוהה - לוג ואל תיתקע
          console.warn("[nedarim iframe] unknown status:", status, value);
          setIframeSubmitting(false);
          setIframeError(
            `סטטוס לא מזוהה מנדרים: ${status || "(ריק)"}. ${value?.Message || ""}`
          );
        }
      }
    };

    window.addEventListener("message", handleMessage);

    // Safety timeout: אם אחרי 30 שניות לא קיבלנו טוקן שמור, מציגים הודעה
    // ופותחים את הכפתור. מבדיל בין 2 מצבים:
    //   - nedarimConfirmedOk=true: החיוב עבר אבל טוקן לא נוצר → בעיית API של נדרים
    //   - nedarimConfirmedOk=false: לא קיבלנו תשובה כלל → בעיית תקשורת/כרטיס
    const safetyTimer = setTimeout(() => {
      if (iframeSubmitting) {
        setIframeSubmitting(false);
        if (nedarimConfirmedOk) {
          setIframeError(
            "נדרים אישרו את הבקשה בהצלחה, אבל לא נוצר טוקן לחיובים עתידיים. " +
              "אין אפשרות להשלים את ההרשמה עד שהבעיה תיפתר. יש לפנות לתמיכה. " +
              "(ראה קונסולה + Vercel Logs לפרטים)"
          );
          console.error(
            "[nedarim iframe] TOKEN CREATION FAILURE: Nedarim confirmed OK but no paymentToken saved. " +
              "Check Vercel logs for token candidates in webhook payload."
          );
        } else {
          setIframeError(
            "לא התקבלה תשובה מנדרים אחרי 30 שניות. בדוק את פרטי הכרטיס ונסה שוב, או פנה לתמיכה."
          );
          console.warn("[nedarim iframe] safety timeout - no response after 30s");
        }
      }
    }, 30000);

    return () => {
      window.removeEventListener("message", handleMessage);
      clearTimeout(safetyTimer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showVerification, iframeSubmitting, nedarimConfirmedOk]);

  // לחיצה על "אמת ושלם 1 ש"ח" - שולחים postMessage ל-iframe עם כל פרטי החיוב ב-Value
  function submitVerificationIframe() {
    if (!iframeRef.current?.contentWindow || !customerId) {
      setIframeError("ה-iframe לא נטען כראוי. רענן את הדף ונסה שוב.");
      return;
    }
    setIframeError(null);
    setIframeSubmitting(true);
    try {
      iframeRef.current.contentWindow.postMessage(
        {
          Name: "FinishTransaction2",
          Value: {
            Mosad: "7015318",
            ApiValid: "NxhXRWeG5P",
            PaymentType: "CreateToken",
            Currency: "1",
            Amount: "1",
            Tashlumim: "1",
            CallBack: "https://tzidkat.com/api/webhooks/nedarim",
            Param1: customerId,
            Param2: "registration",
            // גיבוי: גם ב-Comment (במידה ש-Param1/Param2 לא עוברים ב-response)
            Comment: `customer:${customerId}|type:registration`,
            // שדות זיהוי אופציונליים (נדרים מצפים להם ריקים כברירת מחדל)
            Zeout: "",
            FirstName: "",
            LastName: "",
            Street: "",
            City: "",
            Phone: "",
            Mail: "",
            Groupe: "Registration",
          },
        },
        "*"
      );
    } catch (e) {
      setIframeSubmitting(false);
      setIframeError("שגיאה בשליחת הבקשה ל-iframe. רענן ונסה שוב.");
      console.error("[nedarim iframe] postMessage failed:", e);
    }
  }

  async function submit() {
    setError("");
    if (needsPhoneInput && !phone.trim()) {
      setError("נא להזין מספר טלפון");
      return;
    }
    if (needsPhoneInput && !phone.trim()) {
      setError("נא לאשר את תנאי ההזמנה");
      return;
    }
    // לקוח חדש בלי כרטיס שמור - קודם שמירת כרטיס (יצירת טוקן), ואז ההזמנה תישלח אוטומטית
    if (!isVerified && !onBehalfOfCustomerId) {
      setShowVerification(true);
      return;
    }
    await doSubmit();
  }

  // השליחה עצמה - נקראת ישירות (לקוח מאומת) או אוטומטית אחרי אימות
  async function doSubmit() {
    setError("");
    setSubmitting(true);
    try {
      const res = await fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pricelistId: pricelist.id,
          pointId,
          // השם תמיד מגיע מהחשבון המחובר - לא ניתן לעריכה כאן
          customerName: customer.name,
          phone: (phone || customer.phone || "").trim(),
          phone2: null,
          notes: null,
          requestedInstallments: estimatedTotal > 800 ? installments : 1,
          onBehalfOfCustomerId: onBehalfOfCustomerId || null,
          items: cartLines.map((l) => ({
            productId: l.product.id,
            isSingle: l.isSingle,
            quantity: l.qty,
          })),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "שגיאה בשליחת ההזמנה");
      setOrderNumber(data.orderNumber);
      setStep("done");
    } catch (e: any) {
      setError(e.message || "שגיאה");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="min-h-screen bg-[#faf6ec] pb-28">
      {/* header - עם שם המשתמש המחובר וקישור לאזור אישי (זמין תמיד) */}
      <header className="bg-brand-yellow border-b-4 border-brand-rust/20 sticky top-0 z-20">
        <div className="mx-auto max-w-md px-4 py-2.5 flex items-center justify-between gap-2">
          <div className="flex items-center gap-3 text-sm">
            <Link href="/" className="text-brand-slate font-medium">
              דף הבית
            </Link>
            <Link href="/account" className="text-brand-slate font-medium">
              האזור האישי
            </Link>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm text-brand-slate/80">
              שלום, <span className="font-bold text-brand-rust">{customer.name}</span>
            </span>
            <button
              onClick={() => signOut({ callbackUrl: "/" })}
              className="text-xs text-brand-slate/60 underline hover:text-brand-rust"
            >
              התנתק
            </button>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-md px-4 pt-5">
        <StepBar step={step} />

        {/* STEP: choose point - מקובץ לפי עיר אם יש יותר מעיר אחת */}
        {step === "point" && points.length === 0 && (
          <section className="card p-6 text-center mt-4">
            <div className="text-3xl mb-2">📍</div>
            <p className="font-bold text-brand-slatedark">לא הוגדרו נקודות חלוקה למכירה זו</p>
            <p className="text-sm text-zinc-500 mt-1">
              המכירה פעילה אך טרם שויכו אליה נקודות חלוקה. לא ניתן להזמין כרגע — אנא פנה
              למנהל שיוסיף נקודות חלוקה, ונסה שוב.
            </p>
            <Link href="/" className="btn-ghost btn-sm mt-4 inline-flex">
              חזרה לדף הבית
            </Link>
          </section>
        )}
        {step === "point" && points.length > 0 && (
          <section>
            {/* סעיף 1: הודעת עמלת טיפול. סעיף 10: תאריך סיום הרשמה */}
            <div className="card p-3 mb-3 bg-amber-50 border-amber-200 text-sm text-amber-800 space-y-1">
              <div>💳 לתשומת לבך: להזמנה תתווסף עמלת טיפול בסך 3₪.</div>
              {pricelist.closeDateText && (
                <div className="font-semibold">🗓️ ההרשמה נסגרת: {pricelist.closeDateText}</div>
              )}
            </div>
            <h2 className="text-lg font-extrabold text-brand-slatedark mb-3">
              {showCityStep && !selectedCity ? "בחירת עיר" : "בחירת נקודת חלוקה"}
            </h2>

            {/* שלב עיר - רק אם יש כמה ערים ועדיין לא נבחרה אחת */}
            {showCityStep && !selectedCity && (
              <div className="space-y-2.5">
                {cities.map((city) => {
                  const cityPoints = points.filter((p) => p.city === city);
                  return (
                    <button
                      key={city}
                      onClick={() => {
                        // עיר עם נקודה אחת בלבד - בוחרים אותה מיד, בלי מסך בחירה מיותר.
                        // עיר עם כמה נקודות - נכנסים לבחירה ביניהן.
                        if (cityPoints.length === 1) {
                          setPointId(cityPoints[0].id);
                          setStep("products");
                        } else {
                          setSelectedCity(city);
                        }
                      }}
                      className="w-full text-right card p-4 flex justify-between items-center"
                    >
                      <span className="font-bold text-brand-slatedark">{city}</span>
                      <span className="text-zinc-400 text-sm">
                        {cityPoints.length > 1 ? `${cityPoints.length} נקודות` : ""}
                      </span>
                    </button>
                  );
                })}
                {pointsWithoutCity.length > 0 && (
                  <>
                    <div className="text-sm text-zinc-400 pt-2">נקודות נוספות</div>
                    {pointsWithoutCity.map((p) => (
                      <button
                        key={p.id}
                        onClick={() => {
                          setPointId(p.id);
                          setStep("products");
                        }}
                        className="w-full text-right card p-4"
                      >
                        <div className="font-bold text-brand-slatedark">{p.name}</div>
                      </button>
                    ))}
                  </>
                )}
              </div>
            )}

            {/* שלב נקודה בתוך עיר שנבחרה (או רשימה שטוחה אם עיר אחת בלבד) */}
            {(!showCityStep || selectedCity) && (
              <div className="space-y-2.5">
                {showCityStep && (
                  <button
                    onClick={() => setSelectedCity(null)}
                    className="text-sm text-brand-rust font-medium mb-1"
                  >
                    ← חזרה לבחירת עיר
                  </button>
                )}
                {(showCityStep ? pointsInSelectedCity : points).map((p) => (
                  <button
                    key={p.id}
                    onClick={() => setPointId(p.id)}
                    className={`w-full text-right card p-4 transition ${
                      pointId === p.id ? "ring-2 ring-brand-rust border-brand-rust" : ""
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="font-bold text-brand-slatedark">{p.name}</div>
                        {p.contactName && (
                          <div className="text-sm text-zinc-500 mt-0.5">{p.contactName}</div>
                        )}
                        {/* §6: מציג תאריך חריג לנקודה בבירור אם הוגדר */}
                        {p.customDeliveryDateText && (
                          <div className="text-xs text-brand-rust font-medium mt-1">
                            📅 חלוקה: {p.customDeliveryDateText}
                          </div>
                        )}
                      </div>
                      {customer.defaultPointId === p.id && (
                        <span className="badge bg-amber-100 text-amber-700">נקודה שמורה</span>
                      )}
                    </div>
                  </button>
                ))}
              </div>
            )}

            <BottomBar>
              <button
                disabled={!point}
                onClick={() => setStep("products")}
                className="btn-primary w-full"
              >
                המשך ←
              </button>
            </BottomBar>
          </section>
        )}

        {/* STEP: confirm date */}

        {/* שלב אישור תאריך בוטל (סעיף 2) - פרטי החלוקה מוצגים בסיכום */}

        {/* STEP: products */}
        {step === "products" && !termsAccepted && (
          <section>
            <div className="card p-6 text-center">
              <h2 className="text-xl font-extrabold text-brand-slatedark mb-4">
                ברוכים הבאים למערכת הזמנות עופות בשר ודגים
              </h2>
              <div className="text-right text-sm text-zinc-700 space-y-3 leading-relaxed">
                <p>
                  <span className="font-bold text-brand-rust">*</span>{" "}
                  בהזמנתכם תחויבו בתוספת {fmt(pricelist.singleSurcharge || 3)} דמי הזמנה.
                </p>
                <p>
                  <span className="font-bold text-brand-rust">*</span>{" "}
                  עם קבלת הודעה על הגעת הסחורה, האחריות על המזמין, יש לבוא בהקדם לאסוף את ההזמנה.
                </p>
                <p>
                  <span className="font-bold text-brand-rust">*</span>{" "}
                  המחיר בעופות בשר ודגים הם לק&quot;ג בהזמנת קרטון שלם, בבשר ודגים תתאפשר הזמנה בבודדים
                  בתוספת {fmt(pricelist.singleSurcharge || 3)} לקילו. במוצרים הארוזים במשקל שווה (נקניק, טחון וכו&apos;) המחיר הוא ליחידה.
                </p>
                <p>
                  <span className="font-bold text-brand-rust">*</span>{" "}
                  הגבייה תבוצע אחרי אספקת ההזמנה לפי המשקל המופיע על הקרטון.
                </p>
                <p>
                  <span className="font-bold text-brand-rust">*</span>{" "}
                  בע&quot;ה הודעה תגיע אליכם בפתיחת ההרשמה למערכת ההזמנות, ובעת הגעת הסחורה לנקודת חלוקה.
                </p>
              </div>
              <button
                onClick={() => setTermsAccepted(true)}
                className="btn-primary w-full mt-6 text-base font-bold"
              >
                קראתי ומאשר/ת — להמשך ביצוע ההזמנה
              </button>
            </div>
          </section>
        )}
        {step === "products" && termsAccepted && (
          <section>
            {/* §12: הודעה על הזמנה קיימת */}
            {existingOrder && (
              <div className="card p-4 mb-4 bg-blue-50 border-blue-200">
                <p className="text-sm text-blue-900 font-medium">
                  שים לב: כבר יש לך הזמנה #{existingOrder.orderNumber} למכירה הזו.
                </p>
                <div className="flex gap-2 mt-2">
                  <a
                    href="/account"
                    className="text-xs text-blue-700 font-medium underline"
                  >
                    צפייה/עריכה באזור האישי
                  </a>
                </div>
              </div>
            )}
            <h2 className="text-lg font-extrabold text-brand-slatedark mb-1">בחירת מוצרים</h2>
            <p className="text-xs text-zinc-500 mb-4 leading-relaxed">
              המחיר באתר הוא מחיר משוער. המחיר הסופי ייקבע לפי המשקל והאריזה בפועל.
            </p>
            <div className="space-y-6">
              {/* ניווט קטגוריות דביק - קפיצה מהירה בלי לגלול רשימה ארוכה */}
              <div className="sticky top-0 z-10 -mx-4 px-4 py-2 bg-[#faf6ec]/95 backdrop-blur-sm border-b border-zinc-200 overflow-x-auto no-scrollbar">
                <div className="flex gap-2 w-max">
                  {categories.map(([cat]) => (
                    <button
                      key={cat}
                      onClick={() =>
                        document
                          .getElementById(`cat-${cat}`)
                          ?.scrollIntoView({ behavior: "smooth", block: "start" })
                      }
                      className="badge bg-white border border-zinc-300 text-brand-slatedark whitespace-nowrap px-3 py-1.5 hover:bg-brand-yellow/40 transition"
                    >
                      {cat}
                    </button>
                  ))}
                </div>
              </div>

              {categories.map(([cat, items]) => (
                <div key={cat} id={`cat-${cat}`} className="scroll-mt-16">
                  <h3 className="font-extrabold text-brand-rust mb-2 border-b-2 border-brand-rust/20 pb-1">
                    {cat}
                  </h3>
                  <div className="space-y-2">
                    {items.map((p) => {
                      const entry = cart[p.id] ?? { cartonQty: 0, singlesQty: 0 };
                      return (
                        <div
                          key={p.id}
                          className={`card p-3 ${
                            p.isFeatured ? "border-2 border-red-300 bg-red-50/40" : ""
                          }`}
                        >
                          {p.isFeatured && (
                            <div className="badge bg-red-600 text-white mb-1.5">🔥 מבצע</div>
                          )}
                          {/* שם + תמונה + מחיר בסיסי */}
                          <div className="flex gap-2 items-start">
                            {p.imageUrl && (
                              <img
                                src={p.imageUrl}
                                alt={p.name.replace(/\*/g, "")}
                                className="w-14 h-14 rounded-xl object-cover border border-zinc-200 shrink-0"
                                loading="lazy"
                              />
                            )}
                            <div className="flex-1">
                              <div className="font-semibold text-brand-slatedark text-[15px] leading-tight">
                                {renderName(p.name)}
                                {p.kashrut && (
                                  <span className="badge bg-sky-100 text-sky-700 mr-1.5 align-middle">
                                    {p.kashrut}
                                  </span>
                                )}
                              </div>
                              {p.highlightNote && (
                                <div className="text-xs font-bold text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-2 py-0.5 mt-1 inline-block">
                                  {p.highlightNote}
                                </div>
                              )}
                              <div className="text-sm text-zinc-500 mt-0.5">
                                {p.priceType === "PER_KG" ? (
                                  <>
                                    <span className="font-medium text-brand-slatedark">
                                      {fmt(p.price)} לק"ג
                                    </span>
                                    {p.avgWeightPerUnit != null && (
                                      <span className="block text-xs text-zinc-500">
                                        קרטון ≈ {p.avgWeightPerUnit} ק"ג (~{fmt(p.price * p.avgWeightPerUnit)} לקרטון)
                                      </span>
                                    )}
                                    <span className="block text-xs text-amber-600">
                                      המחיר הסופי לפי שקילה בפועל
                                    </span>
                                  </>
                                ) : (
                                  <>
                                    {fmt(p.price)} / {p.unit}
                                    {p.packageWeight && (
                                      <span className="block text-xs text-zinc-500">
                                        אריזה: {p.packageWeight}
                                      </span>
                                    )}
                                  </>
                                )}
                                {p.limitedQty && (
                                  <span className="badge bg-amber-100 text-amber-700 mr-2">
                                    כמות מוגבלת
                                  </span>
                                )}
                              </div>
                            </div>
                          </div>

                          {/* ח4: שורות כמות — קרטונים + בודדים בנפרד */}
                          <div className="mt-2 space-y-2">
                            {/* שורת קרטונים — תמיד מוצגת */}
                            <div className="flex items-center justify-between bg-zinc-50 rounded-lg px-3 py-2">
                              <span className="text-sm text-brand-slatedark font-medium">
                                {p.priceType === "PER_KG" ? "קרטונים" : p.unit}
                              </span>
                              <QtyControl
                                value={entry.cartonQty}
                                step={1}
                                min={0}
                                onChange={(v) => setCartonQty(p.id, v)}
                              />
                            </div>

                            {/* שורת בודדים — רק למוצרים שמאפשרים */}
                            {p.allowSingles && (
                              <div className="flex items-center justify-between bg-amber-50 rounded-lg px-3 py-2">
                                <div>
                                  <span className="text-sm text-amber-900 font-medium">
                                    {p.singlesMode === "UNITS" ? "יחידות" : 'בודדים (ק"ג)'}
                                  </span>
                                  {p.singlesMode !== "UNITS" && pricelist.singleSurcharge > 0 && (
                                    <span className="text-xs text-brand-rust mr-1">
                                      +{fmt(pricelist.singleSurcharge)}
                                    </span>
                                  )}
                                  {p.singlesMode === "UNITS" && p.singleUnitPrice != null && (
                                    <span className="text-xs text-amber-700 mr-1">
                                      {fmt(Number(p.singleUnitPrice))} ליח'
                                    </span>
                                  )}
                                </div>
                                <QtyControl
                                  value={entry.singlesQty}
                                  step={1}
                                  min={p.singlesMode === "UNITS" ? 1 : MIN_SINGLES_KG}
                                  onChange={(v) => setSinglesQty(p.id, v)}
                                />
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
            <BottomBar>
              <button onClick={() => setStep("products")} className="btn-ghost flex-1">
                חזרה
              </button>
              <button
                disabled={itemCount === 0}
                onClick={() => setStep("summary")}
                className="btn-primary flex-1"
              >
                לסיכום ({itemCount}) ←
              </button>
            </BottomBar>
          </section>
        )}

        {/* STEP: summary (ח3: כולל גם את הסל — אין שלב cart נפרד) */}
        {step === "summary" && point && (
          <section>
            <h2 className="text-lg font-extrabold text-brand-slatedark mb-3">סיכום הזמנה</h2>

            {/* פרטי חלוקה */}
            <div className="card p-4 space-y-2 text-sm">
              <Row label="נקודת חלוקה" value={point.name} />
              {point.address && <Row label="כתובת" value={point.address} />}
              <Row
                label="תאריך חלוקה"
                value={point.customDeliveryDateText || pricelist.deliveryDateText || "—"}
              />
              {point.deliveryHours && <Row label="שעות חלוקה" value={point.deliveryHours} />}
              {point.contactName && point.phone && (
                <Row label="נציג" value={`${point.contactName} — ${point.phone}`} />
              )}
              <Row label="שם" value={customer.name} />
              <Row label="טלפון" value={phone || customer.phone || "—"} />
              {cardVerified && customer.email && (
                <Row label="אמצעי תשלום" value={`כרטיס אשראי ****`} />
              )}
            </div>

            {/* רשימת מוצרים עם אפשרות הסרה */}
            <div className="card p-4 mt-3 space-y-2">
              <div className="font-bold text-brand-slatedark mb-1">המוצרים שלך</div>
              {cartLines.map((l) => (
                <div key={l.product.id} className="flex justify-between items-center text-sm">
                  <div>
                    <span className="text-brand-slatedark font-medium">{l.product.name}</span>
                    {l.isSingle && (
                      <span className="badge bg-amber-100 text-amber-700 mr-1 text-xs">בודדים</span>
                    )}
                    <span className="text-zinc-500 mr-2">
                      {qtyLabel(l.product, l)}
                    </span>
                  </div>
                  <button
                    onClick={() => removeFromCart(l.product.id, l.isSingle)}
                    className="text-zinc-300 hover:text-red-500 text-sm px-2"
                    title="הסר מוצר"
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>

            {/* §13: מעל 800₪ — הצעת 2 תשלומים (לא מציגים את הסכום ללקוח!) */}
            {estimatedTotal > 800 && (
              <div className="card p-4 mt-3 bg-blue-50 border-blue-200">
                <div className="text-sm font-medium text-blue-900 mb-2">
                  האם תרצה לפצל את התשלום לשני תשלומים?
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => setInstallments(1)}
                    className={`flex-1 py-2 rounded-lg text-sm font-medium transition ${
                      installments === 1
                        ? "bg-blue-600 text-white"
                        : "bg-white border border-blue-300 text-blue-700"
                    }`}
                  >
                    תשלום אחד
                  </button>
                  <button
                    onClick={() => setInstallments(2)}
                    className={`flex-1 py-2 rounded-lg text-sm font-medium transition ${
                      installments === 2
                        ? "bg-blue-600 text-white"
                        : "bg-white border border-blue-300 text-blue-700"
                    }`}
                  >
                    שני תשלומים
                  </button>
                </div>
              </div>
            )}

            {/* הודעת גבייה */}
            <div className="card p-3 mt-3 bg-amber-50 border-amber-200 text-sm text-amber-800 text-center">
              הגבייה תבוצע אחרי אספקת ההזמנה ועדכון המשקלים במערכת ע&quot;י הנציג.
            </div>

            {error && <p className="text-red-600 text-sm mt-3 font-medium">{error}</p>}

            <BottomBar>
              <button onClick={() => setStep("products")} className="btn-ghost flex-1">
                חזרה לבחירת מוצרים
              </button>
              <button
                disabled={submitting || cartLines.length === 0}
                onClick={submit}
                className="btn-primary flex-1"
              >
                {submitting ? "שולח..." : "שליחת הזמנה"}
              </button>
            </BottomBar>
          </section>
        )}

        {/* STEP: done */}
        {step === "done" && (
          <section className="text-center pt-10">
            <div className="mx-auto w-16 h-16 rounded-full bg-green-100 flex items-center justify-center text-3xl">
              ✓
            </div>
            <h2 className="text-2xl font-extrabold text-brand-slatedark mt-4">ההזמנה התקבלה!</h2>
            <p className="text-zinc-600 mt-2">
              מספר הזמנה: <span className="font-bold">#{orderNumber}</span>
            </p>
            <div className="card p-4 mt-6 text-sm text-right space-y-2">
              <Row label="נקודת החלוקה" value={point?.name || ""} />
              {point?.city && <Row label="עיר" value={point.city} />}
              <Row
                label="תאריך חלוקה"
                value={
                  point?.customDeliveryDateText || pricelist.deliveryDateText || "יימסר ע\"י הנציג"
                }
              />
            </div>
            <p className="text-xs text-zinc-500 mt-4">
              ההזמנה ממתינה לשקילה. לאחר קביעת המחיר הסופי, התשלום ייגבה אוטומטית מהכרטיס ששמרת ותקבל/י הודעה על החיוב.
            </p>
            <Link href="/" className="btn-primary mt-6 inline-flex">
              חזרה לדף הבית
            </Link>
          </section>
        )}
      </div>

      {/* מודל אימות כרטיס - לקוח חדש בהזמנה ראשונה */}
      {showVerification && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-end sm:items-center justify-center p-0 sm:p-4">
          <div className="bg-white w-full sm:max-w-md sm:rounded-2xl rounded-t-2xl max-h-[92vh] overflow-y-auto">
            <div className="p-4 border-b flex justify-between items-center sticky top-0 bg-white">
              <div>
                <h3 className="font-extrabold text-brand-slatedark">שמירת כרטיס אשראי</h3>
                <p className="text-xs text-zinc-500 mt-0.5">
                  שמירת כרטיס לחיובים עתידיים — ללא חיוב כרגע
                </p>
              </div>
              <button
                onClick={() => {
                  setShowVerification(false);
                  setIframeSubmitting(false);
                  setIframeError(null);
                  setNedarimConfirmedOk(false);
                }}
                className="text-zinc-400 text-2xl leading-none px-2"
                aria-label="סגירה"
              >
                ×
              </button>
            </div>
            <div className="p-2">
              {verificationIframeUrl ? (
                <>
                  <iframe
                    ref={iframeRef}
                    src={verificationIframeUrl}
                    className="w-full h-[620px] max-h-[calc(92vh-140px)] min-h-[500px] border-0 rounded-xl"
                    title="אימות כרטיס אשראי"
                  />
                  {iframeError && (
                    <div className="mt-3 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm text-center">
                      {iframeError}
                    </div>
                  )}
                  <button
                    onClick={submitVerificationIframe}
                    disabled={iframeSubmitting}
                    className="btn-primary w-full mt-3 text-base"
                    type="button"
                  >
                    {iframeSubmitting ? "שומר..." : "שמור כרטיס"}
                  </button>
                </>
              ) : (
                <p className="text-center text-red-600 p-6 text-sm">
                  שגיאה בטעינת טופס האימות. רענן את הדף ונסה שוב.
                </p>
              )}
              <p className="text-xs text-zinc-400 text-center pb-3 px-4 mt-3">
                לאחר השלמת האימות, ההזמנה תישלח אוטומטית. הכרטיס נשמר באופן מאובטח אצל חברת
                הסליקה בלבד.
              </p>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

function StepBar({ step }: { step: Step }) {
  const steps: Step[] = ["point", "products", "summary"];
  const idx = steps.indexOf(step);
  if (step === "done") return null;
  return (
    <div className="flex gap-1.5 mb-5">
      {steps.map((s, i) => (
        <div
          key={s}
          className={`h-1.5 flex-1 rounded-full ${i <= idx ? "bg-brand-rust" : "bg-zinc-200"}`}
        />
      ))}
    </div>
  );
}

function Row({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-zinc-500 text-sm">{label}</span>
      <span className={`text-sm font-semibold text-left ${highlight ? "text-brand-rust" : "text-brand-slatedark"}`}>
        {value}
      </span>
    </div>
  );
}

function QtyControl({
  value,
  step,
  onChange,
  min = 0,
}: {
  value: number;
  step: number;
  onChange: (v: number) => void;
  min?: number;
}) {
  const round = (n: number) => Math.round(n * 100) / 100;
  // ירידה מתחת למינימום (למשל 2 ק"ג בבודדים) - יורדים ל-0, לא לערך ביניים
  function dec() {
    const next = round(value - step);
    if (min > 0 && next > 0 && next < min) onChange(0);
    else onChange(round(Math.max(0, next)));
  }
  return (
    <div className="flex items-center gap-1.5">
      <button
        onClick={dec}
        className="w-8 h-8 rounded-lg bg-zinc-100 text-brand-slate font-bold text-lg leading-none active:scale-95"
        aria-label="הפחת"
      >
        −
      </button>
      <input
        type="number"
        inputMode="decimal"
        value={value || ""}
        onChange={(e) => {
          const v = round(parseFloat(e.target.value) || 0);
          onChange(min > 0 && v > 0 && v < min ? min : v);
        }}
        className="w-12 text-center rounded-lg border border-zinc-200 py-1.5 font-semibold"
        placeholder="0"
      />
      <button
        onClick={() => {
          const next = round(value + step);
          // אם למינימום יש ערך והמעבר מ-0/מתחת-למינימום ל-next עדיין מתחת - קפוץ למינימום
          onChange(min > 0 && next > 0 && next < min ? min : next);
        }}
        className="w-8 h-8 rounded-lg bg-brand-rust text-white font-bold text-lg leading-none active:scale-95"
        aria-label="הוסף"
      >
        +
      </button>
    </div>
  );
}

function BottomBar({ children }: { children: React.ReactNode }) {
  return (
    <div className="fixed bottom-0 inset-x-0 z-30 bg-white/95 backdrop-blur border-t border-zinc-200 no-print">
      <div className="mx-auto max-w-md px-4 py-3 flex gap-2">{children}</div>
    </div>
  );
}
