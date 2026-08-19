"use client";

// ═══════════════════════════════════════════════════════════════
// §142: כפתור צף שאפשר להזיז
// ═══════════════════════════════════════════════════════════════
// הבעיה: כפתורי "חזרה" ו"נגישות" יושבים במיקום קבוע בפינה, ובמסכים
// ארוכים הם מכסים בדיוק את מה שמתחתיהם - כפתור "שמור", שדה אחרון
// בטופס, או שורה בטבלה. במובייל זה קורה הרבה כי המסך צר.
//
// הפתרון: לחיצה ארוכה גוררת את הכפתור למקום אחר, וההעדפה נשמרת.
//
// ⚠️ **לחיצה ארוכה ולא גרירה מיידית.** גרירה רגילה הייתה גורמת
// לכפתור לזוז בכל פעם שהאצבע מחליקה קצת בלחיצה - והמשתמש היה
// מפספס את הפעולה שהוא רצה. חצי שנייה של החזקה היא כוונה ברורה.
//
// ⚠️ **המיקום נשמר ב-localStorage ולא ב-sessionStorage.** מי שהזיז
// את הכפתור עשה את זה כי המקום המקורי הפריע לו, וזה לא ישתנה
// בביקור הבא.

import { useEffect, useRef, useState } from "react";

const LONG_PRESS_MS = 450;
/** מרווח מינימלי מקצה המסך, כדי שהכפתור לא ייצא ולא ייחתך */
const EDGE_PADDING = 8;

type Pos = { x: number; y: number };

export function DraggableFloating({
  storageKey,
  children,
  /** מיקום ברירת מחדל אם המשתמש לא הזיז. ערכים ב-px מהקצוות. */
  defaultBottom = 16,
  defaultSide = 16,
  side = "right",
  zIndex = 40,
}: {
  /** מפתח ייחודי לכל כפתור - כדי ששניהם לא ידרסו זה את זה */
  storageKey: string;
  children: React.ReactNode;
  defaultBottom?: number;
  defaultSide?: number;
  side?: "right" | "left";
  /**
   * §142: ⚠️ נשלט מבחוץ ולא קבוע.
   *
   * לכפתורים הצפים יש היררכיה מכוונת: כפתור החזרה נמוך (40) כדי
   * שמודלים והבאנר של ההתחזות יכסו אותו, וכפתור הנגישות גבוה (90)
   * כי הוא חייב להיות זמין תמיד. ערך קבוע בעטיפה היה משטח את
   * שניהם ושובר את הסדר.
   */
  zIndex?: number;
}) {
  const [pos, setPos] = useState<Pos | null>(null);
  const [dragging, setDragging] = useState(false);
  const [armed, setArmed] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startRef = useRef<{ px: number; py: number; ox: number; oy: number } | null>(null);

  // טעינת המיקום השמור
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) {
        const p = JSON.parse(raw);
        if (typeof p?.x === "number" && typeof p?.y === "number") setPos(p);
      }
    } catch {
      // מיקום פגום - מתעלמים ונשארים בברירת המחדל
    }
  }, [storageKey]);

  // ⚠️ תיקון מיקום אחרי סיבוב מסך או שינוי גודל.
  //
  // כפתור שנשמר בפינה ימנית-תחתונה במצב לאורך יוצא מהמסך במצב
  // לרוחב, והמשתמש מאבד אותו לגמרי בלי דרך להחזירו.
  useEffect(() => {
    if (!pos) return;
    function clampToScreen() {
      const el = ref.current;
      if (!el) return;
      const w = el.offsetWidth || 48;
      const h = el.offsetHeight || 48;
      setPos((cur) => {
        if (!cur) return cur;
        const maxX = window.innerWidth - w - EDGE_PADDING;
        const maxY = window.innerHeight - h - EDGE_PADDING;
        const nx = Math.min(Math.max(EDGE_PADDING, cur.x), Math.max(EDGE_PADDING, maxX));
        const ny = Math.min(Math.max(EDGE_PADDING, cur.y), Math.max(EDGE_PADDING, maxY));
        return nx === cur.x && ny === cur.y ? cur : { x: nx, y: ny };
      });
    }
    window.addEventListener("resize", clampToScreen);
    window.addEventListener("orientationchange", clampToScreen);
    clampToScreen();
    return () => {
      window.removeEventListener("resize", clampToScreen);
      window.removeEventListener("orientationchange", clampToScreen);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pos?.x, pos?.y]);

  function beginPress(clientX: number, clientY: number) {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    startRef.current = {
      px: clientX,
      py: clientY,
      ox: rect.left,
      oy: rect.top,
    };
    timerRef.current = setTimeout(() => {
      setArmed(true);
      setDragging(true);
      // ⚠️ רטט קצר: המשתמש צריך לדעת שהכפתור "השתחרר", אחרת
      // הוא לא יבין למה הוא זז ויחשוב שהוא לחץ בטעות.
      if (typeof navigator !== "undefined" && navigator.vibrate) {
        navigator.vibrate(30);
      }
    }, LONG_PRESS_MS);
  }

  function cancelPress() {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }

  function moveTo(clientX: number, clientY: number) {
    const st = startRef.current;
    const el = ref.current;
    if (!st || !el) return;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const nx = st.ox + (clientX - st.px);
    const ny = st.oy + (clientY - st.py);
    setPos({
      x: Math.min(Math.max(EDGE_PADDING, nx), window.innerWidth - w - EDGE_PADDING),
      y: Math.min(Math.max(EDGE_PADDING, ny), window.innerHeight - h - EDGE_PADDING),
    });
  }

  function endDrag() {
    cancelPress();
    if (dragging && pos) {
      try {
        localStorage.setItem(storageKey, JSON.stringify(pos));
      } catch {
        // מכסת אחסון מלאה - המיקום פשוט לא יישמר, ולא נפיל את הדף
      }
    }
    setDragging(false);
    // ⚠️ השהיה קצרה לפני שמאפשרים לחיצה שוב: בלעדיה ה-click
    // שמגיע בסוף הגרירה היה מפעיל את הכפתור, והמשתמש שהזיז את
    // כפתור החזרה היה מוצא את עצמו בדף הקודם.
    setTimeout(() => setArmed(false), 80);
  }

  // האזנה גלובלית בזמן גרירה - כדי שהאצבע תוכל לצאת מהכפתור
  useEffect(() => {
    if (!dragging) return;
    const onTouchMove = (e: TouchEvent) => {
      e.preventDefault();
      const t = e.touches[0];
      if (t) moveTo(t.clientX, t.clientY);
    };
    const onMouseMove = (e: MouseEvent) => moveTo(e.clientX, e.clientY);
    window.addEventListener("touchmove", onTouchMove, { passive: false });
    window.addEventListener("touchend", endDrag);
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", endDrag);
    return () => {
      window.removeEventListener("touchmove", onTouchMove);
      window.removeEventListener("touchend", endDrag);
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", endDrag);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dragging]);

  const style: React.CSSProperties = pos
    ? { position: "fixed", left: pos.x, top: pos.y, right: "auto", bottom: "auto" }
    : {
        position: "fixed",
        bottom: defaultBottom,
        [side]: defaultSide,
      };

  return (
    <div
      ref={ref}
      style={{
        ...style,
        zIndex,
        touchAction: dragging ? "none" : "auto",
        transition: dragging ? "none" : "box-shadow 0.15s",
        boxShadow: dragging ? "0 8px 24px rgba(0,0,0,0.35)" : undefined,
        borderRadius: dragging ? 999 : undefined,
        opacity: dragging ? 0.9 : 1,
      }}
      onTouchStart={(e) => {
        const t = e.touches[0];
        if (t) beginPress(t.clientX, t.clientY);
      }}
      onTouchEnd={cancelPress}
      onTouchCancel={cancelPress}
      onMouseDown={(e) => beginPress(e.clientX, e.clientY)}
      onMouseUp={cancelPress}
      onMouseLeave={cancelPress}
      // ⚠️ חסימת הלחיצה בזמן גרירה ומיד אחריה
      onClickCapture={(e) => {
        if (armed) {
          e.preventDefault();
          e.stopPropagation();
        }
      }}
    >
      {children}
      {/* חיווי בזמן גרירה - כדי שיהיה ברור מה קורה */}
      {dragging && (
        <div className="absolute -top-7 right-1/2 translate-x-1/2 whitespace-nowrap bg-black/75 text-white text-[10px] rounded px-2 py-0.5 pointer-events-none">
          גרור למקום חדש
        </div>
      )}
    </div>
  );
}
