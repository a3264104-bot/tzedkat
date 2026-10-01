// ═══════════════════════════════════════════════════════════════
// §396: 🔁 מכירות שבועיות — פתיחה, החלפה ובחירת מכירה ללקוח
// ═══════════════════════════════════════════════════════════════
// התרחיש: נקודות שהנציג שלהן מוכר כל שבוע, ולא פעם בחודש/חג.
// המנהל מגדיר "סדרה שבועית" פעם אחת (נקודות + תבנית מוצרים +
// יום ושעת החלפה), ומכאן כל שבוע נפתח לבד.
//
// ═══ החלפת שבוע ═══
// שבוע מוחלף רק כששני תנאים מתקיימים:
//   1. הגיע זמן ההחלפה (weekEnd)
//   2. כל ההזמנות סומנו "נמסר" או בוטלו — או שהנציג/מנהל לחץ
//      "סגור שבוע" (weekClosedAt) למקרה של לקוח שלא הגיע לאסוף.
// עד אז השבוע הישן נשאר ACTIVE, והזמנות חדשות נכנסות אליו.
//
// ⚠️ הזמנות שעוד לא נשקלו/חויבו נשארות בשבוע הישן (CLOSED), ומשם
// ממשיכים לשקול ולחייב אותן כרגיל — בדיוק כמו במכירה רגילה שנסגרה.
//
// ═══ למה "עצל" ולא cron ═══
// ensureWeeklySales רץ בכל כניסה לאתר / לטלפון / למסך הנציג (עם
// הגבלה של פעם בדקה). cron ב-Vercel Hobby רץ פעם ביום בלבד ובשעה
// לא מדויקת — שבוע היה נפתח באיחור של עד 24 שעות. כאן הוא נפתח
// ברגע שמישהו צריך אותו.
//
// ⚠️ שתי בקשות באותה שנייה: @@unique([weeklySeriesId, weekStart])
// במסד. השנייה נכשלת על כפילות, ואנחנו מתעלמים מזה — השבוע כבר
// קיים, וזו התוצאה שרצינו.

import { prisma } from "@/lib/prisma";

const TZ = "Asia/Jerusalem";
const DAY_MS = 24 * 60 * 60 * 1000;

export const WEEKDAY_NAMES = [
  "ראשון",
  "שני",
  "שלישי",
  "רביעי",
  "חמישי",
  "שישי",
  "שבת",
];

// ───────────────────────────────────────────────────────────────
// זמן ישראל
// ───────────────────────────────────────────────────────────────

/** חלקי התאריך כפי שהם בישראל (שעון קיץ/חורף נכלל) */
function ilParts(d: Date) {
  const f = new Intl.DateTimeFormat("en-US", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    weekday: "short",
    hour12: false,
  });
  const parts: Record<string, string> = {};
  for (const p of f.formatToParts(d)) parts[p.type] = p.value;
  const wd = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(
    parts.weekday
  );
  const hour = Number(parts.hour) % 24; // "24" בחצות בחלק מהדפדפנים
  return {
    y: Number(parts.year),
    m: Number(parts.month),
    d: Number(parts.day),
    hour,
    minute: Number(parts.minute),
    second: Number(parts.second),
    weekday: wd,
  };
}

/** ההפרש (ms) בין שעון ישראל ל-UTC ברגע נתון */
function ilOffsetMs(at: Date): number {
  const p = ilParts(at);
  const asUtc = Date.UTC(p.y, p.m - 1, p.d, p.hour, p.minute, p.second);
  return asUtc - Math.floor(at.getTime() / 1000) * 1000;
}

/**
 * תאריך+שעה בישראל → רגע ב-UTC.
 *
 * ⚠️ שני סבבים: ההפרש תלוי ברגע עצמו (מעבר שעון קיץ). הסבב השני
 * מתקן את המקרה שבו הניחוש הראשון נפל בצד השני של המעבר.
 */
function ilToUtc(y: number, m: number, d: number, minutes: number): Date {
  const guess = Date.UTC(y, m - 1, d, 0, minutes);
  let t = guess - ilOffsetMs(new Date(guess));
  t = guess - ilOffsetMs(new Date(t));
  return new Date(t);
}

/** הוספת ימים לתאריך-לוח (בלי שעה) */
function addDays(y: number, m: number, d: number, days: number) {
  const base = new Date(Date.UTC(y, m - 1, d) + days * DAY_MS);
  return {
    y: base.getUTCFullYear(),
    m: base.getUTCMonth() + 1,
    d: base.getUTCDate(),
  };
}

/** רגע ההחלפה האחרון שכבר עבר (או בדיוק עכשיו) */
export function lastSwitchAtOrBefore(
  now: Date,
  switchDay: number,
  switchMinute: number
): Date {
  const p = ilParts(now);
  const back = (p.weekday - switchDay + 7) % 7;
  let c = addDays(p.y, p.m, p.d, -back);
  let at = ilToUtc(c.y, c.m, c.d, switchMinute);
  if (at.getTime() > now.getTime()) {
    c = addDays(c.y, c.m, c.d, -7);
    at = ilToUtc(c.y, c.m, c.d, switchMinute);
  }
  return at;
}

/** רגע ההחלפה הבא אחרי תחילת שבוע (שבעה ימי לוח, לא 168 שעות) */
export function nextSwitchAfter(weekStart: Date, switchMinute: number): Date {
  const p = ilParts(weekStart);
  const c = addDays(p.y, p.m, p.d, 7);
  return ilToUtc(c.y, c.m, c.d, switchMinute);
}

function ddmm(d: Date): string {
  const p = ilParts(d);
  return `${p.d}/${p.m}`;
}

/** "4/10–10/10" — היום האחרון הוא היום שלפני ההחלפה */
export function weekRangeLabel(start: Date, end: Date): string {
  return `${ddmm(start)}–${ddmm(new Date(end.getTime() - 60_000))}`;
}

export function switchLabel(switchDay: number, switchMinute: number): string {
  const hh = String(Math.floor(switchMinute / 60)).padStart(2, "0");
  const mm = String(switchMinute % 60).padStart(2, "0");
  return `${WEEKDAY_NAMES[switchDay] ?? "?"} ${hh}:${mm}`;
}

// ───────────────────────────────────────────────────────────────
// פתיחת שבוע
// ───────────────────────────────────────────────────────────────

type SeriesForOpen = {
  id: string;
  name: string;
  switchDay: number;
  switchMinute: number;
  orderFee: any;
  singleSurcharge: any;
  deliveryNote: string | null;
  points: { pointId: string }[];
  products: { productId: string; price: any }[];
};

async function openWeek(series: SeriesForOpen, weekStart: Date) {
  const weekEnd = nextSwitchAfter(weekStart, series.switchMinute);
  const range = weekRangeLabel(weekStart, weekEnd);
  try {
    const created = await prisma.pricelist.create({
      data: {
        // ⚠️ 🔁 בשם: כל בורר מכירות במערכת מציג את השם, וכך שבוע
        // לעולם לא מתבלבל עם מכירה רגילה — גם במסכים שלא עודכנו.
        name: `🔁 ${series.name} · ${range}`,
        status: "ACTIVE",
        agentOnly: false,
        weeklySeriesId: series.id,
        weekStart,
        weekEnd,
        openDate: weekStart,
        // ⚠️ closeDate ריק בכוונה: השבוע נסגר רק אחרי מסירה (למעלה)
        closeDate: null,
        editDeadline: null,
        deliveryDate: weekStart,
        deliveryDateEnd: new Date(weekEnd.getTime() - 60_000),
        deliveryDateText: series.deliveryNote?.trim()
          ? `${series.deliveryNote.trim()} (${range})`
          : `במהלך השבוע (${range})`,
        orderFee: series.orderFee,
        singleSurcharge: series.singleSurcharge,
        products: {
          create: series.products.map((p) => ({
            productId: p.productId,
            price: p.price,
          })),
        },
        points: {
          create: series.points.map((p) => ({ pointId: p.pointId })),
        },
      },
      select: { id: true, name: true },
    });
    console.log(`[weekly] opened ${created.name} (${created.id})`);
    return created;
  } catch (e: any) {
    // P2002 = השבוע כבר נפתח בבקשה מקבילה. זו התוצאה שרצינו.
    if (e?.code === "P2002") return null;
    throw e;
  }
}

/** כמה הזמנות בשבוע טרם נמסרו (בלי מבוטלות) */
/**
 * §398: הזמנות "תוספת" (supplement — §120) לא נספרות: הנציג יוצר
 * אותן בחלוקה עצמה ומוסר מיד, ואין להן סימון מסירה משלהן. בלי זה
 * כל תוספת הייתה תוקעת את השבוע עד סגירה ידנית.
 */
export const UNDELIVERED_WHERE = {
  status: { notIn: ["CANCELLED"] },
  deliveredAt: null,
  parentOrderId: null,
};

export async function countUndelivered(pricelistId: string): Promise<number> {
  return prisma.order.count({
    where: { pricelistId, ...UNDELIVERED_WHERE },
  });
}

// ───────────────────────────────────────────────────────────────
// הלב: פתיחה והחלפה
// ───────────────────────────────────────────────────────────────

let lastRunAt = 0;
let running: Promise<void> | null = null;
const THROTTLE_MS = 60_000;

/**
 * מוודא שלכל סדרה פעילה יש שבוע פתוח, ומחליף שבוע שהסתיים ונמסר.
 *
 * ⚠️ לא זורק לעולם: כשל כאן לא אמור להפיל את דף ההזמנה. הוא נרשם
 * בלוג, וההרצה הבאה תנסה שוב.
 *
 * @param force לעקוף את ההגבלה (אחרי "סגור שבוע", אחרי מסירה אחרונה)
 */
export async function ensureWeeklySales(force = false): Promise<void> {
  const now = Date.now();
  if (!force && now - lastRunAt < THROTTLE_MS) return;
  if (running) {
    // ⚠️ force בזמן ריצה: הריצה הנוכחית התחילה לפני השינוי (סדרה
    // חדשה, מסירה אחרונה) — מחכים לה ומריצים שוב.
    if (!force) return running;
    await running;
  }
  lastRunAt = Date.now();
  running = (async () => {
    try {
      await runRollover(new Date());
    } catch (e) {
      console.error("[weekly] rollover failed:", e);
    } finally {
      running = null;
    }
  })();
  return running;
}

async function runRollover(now: Date) {
  // §398: 🐛 שבוע ישן שהופעל מחדש (לא האחרון בסדרה) — הלולאה למטה
  // בודקת רק את השבוע האחרון, ולכן הוא היה נשאר ACTIVE לנצח גם אחרי
  // "סגור שבוע". סוגרים כל שבוע שהסתיים וסומן כסגור.
  await prisma.pricelist.updateMany({
    where: {
      weeklySeriesId: { not: null },
      status: "ACTIVE",
      weekClosedAt: { not: null },
      weekEnd: { lte: now },
    },
    data: { status: "CLOSED" },
  });

  // ⚠️ גם סדרות מושבתות: השבוע האחרון שלהן נסגר כרגיל כשהסתיים
  // ונמסר — רק שבוע חדש לא נפתח. בלי זה השבוע האחרון של סדרה
  // שהושבתה היה נשאר פתוח ללקוחות לנצח.
  const seriesList = await prisma.weeklySeries.findMany({
    select: {
      id: true,
      name: true,
      isActive: true,
      switchDay: true,
      switchMinute: true,
      orderFee: true,
      singleSurcharge: true,
      deliveryNote: true,
      points: { select: { pointId: true } },
      products: { select: { productId: true, price: true } },
      pricelists: {
        orderBy: { weekStart: "desc" },
        take: 1,
        select: {
          id: true,
          status: true,
          weekStart: true,
          weekEnd: true,
          weekClosedAt: true,
        },
      },
    },
  });

  for (const s of seriesList) {
    // ⚠️ סדרה בלי נקודות או בלי מוצרים — אין מה לפתוח. המסך של
    // המנהל מציג אזהרה.
    const canOpen = s.isActive && s.points.length > 0 && s.products.length > 0;

    const current = s.pricelists[0];
    const thisSwitch = lastSwitchAtOrBefore(now, s.switchDay, s.switchMinute);

    if (!current) {
      if (canOpen) await openWeek(s, thisSwitch);
      continue;
    }

    const ended = !!current.weekEnd && now.getTime() >= current.weekEnd.getTime();
    if (!ended) continue;

    if (current.status === "ACTIVE") {
      const undelivered = current.weekClosedAt
        ? 0
        : await countUndelivered(current.id);
      // ⚠️ השבוע נגמר אבל יש הזמנות שלא נמסרו — מחכים לנציג.
      // הוא רואה פס בדף הבית ובמסך המכירה.
      if (undelivered > 0) continue;

      await prisma.pricelist.update({
        where: { id: current.id },
        data: { status: "CLOSED" },
      });
      console.log(`[weekly] closed week ${current.id} (series ${s.name})`);
    }

    // ⚠️ מתחילים מההחלפה האחרונה שעברה — לא מהשבוע הבא אחרי הישן.
    // שבוע שנתקע שבועיים (לקוח לא הגיע) לא יפתח "שבוע מהעבר".
    if (
      canOpen &&
      (!current.weekStart || thisSwitch.getTime() > current.weekStart.getTime())
    ) {
      await openWeek(s, thisSwitch);
    }
  }
}

// ───────────────────────────────────────────────────────────────
// מצב השבוע — לנציג ולמנהל
// ───────────────────────────────────────────────────────────────

export type WeekState = {
  pricelistId: string;
  seriesName: string;
  weekEnd: string | null;
  /** הגיע זמן ההחלפה */
  ended: boolean;
  undelivered: number;
};

/**
 * שבועות שהסתיימו וממתינים למסירה — לפס בדף הבית.
 *
 * @param pointIds נקודות הנציג. undefined = הכל (מנהל).
 */
export async function getOverdueWeeks(
  pointIds?: string[]
): Promise<WeekState[]> {
  const now = new Date();
  const weeks = await prisma.pricelist.findMany({
    where: {
      status: "ACTIVE",
      weeklySeriesId: { not: null },
      weekEnd: { lte: now },
      weekClosedAt: null,
      ...(pointIds ? { points: { some: { pointId: { in: pointIds } } } } : {}),
    },
    select: {
      id: true,
      weekEnd: true,
      weeklySeries: { select: { name: true } },
    },
  });
  const out: WeekState[] = [];
  for (const w of weeks) {
    const undelivered = await prisma.order.count({
      where: {
        pricelistId: w.id,
        ...UNDELIVERED_WHERE,
        ...(pointIds ? { pointId: { in: pointIds } } : {}),
      },
    });
    out.push({
      pricelistId: w.id,
      seriesName: w.weeklySeries?.name ?? "",
      weekEnd: w.weekEnd?.toISOString() ?? null,
      ended: true,
      undelivered,
    });
  }
  return out;
}

// ───────────────────────────────────────────────────────────────
// בחירת המכירה ללקוח
// ───────────────────────────────────────────────────────────────

/**
 * איזו מכירה הלקוח רואה — באתר, בטלפון ובאזור האישי.
 *
 * הכלל:
 *   1. יש מכירה רגילה פעילה שכוללת את הנקודה שלו → הרגילה.
 *      (השבועית מוסתרת ממנו — מהלקוח בלבד. הנציג רואה את שתיהן.)
 *   2. הנקודה שלו בשבוע פעיל → השבוע.
 *   3. אחרת → הרגילה (אם יש), כמו היום.
 *
 * ⚠️ לקוח בלי נקודה מקבל את הרגילה — אין לו שבוע.
 *
 * ⚠️ מכירות לנציגים בלבד (agentOnly) לא נבחרות כאן לעולם.
 */
export async function resolveCustomerSaleId(
  pointId: string | null | undefined
): Promise<string | null> {
  await ensureWeeklySales();

  const regular = await prisma.pricelist.findFirst({
    where: { status: "ACTIVE", agentOnly: false, weeklySeriesId: null },
    orderBy: { createdAt: "desc" },
    select: { id: true, points: { select: { pointId: true } } },
  });

  if (pointId) {
    if (regular?.points.some((p) => p.pointId === pointId)) return regular.id;
    const weekly = await prisma.pricelist.findFirst({
      where: {
        status: "ACTIVE",
        agentOnly: false,
        weeklySeriesId: { not: null },
        points: { some: { pointId } },
      },
      orderBy: { weekStart: "desc" },
      select: { id: true },
    });
    if (weekly) return weekly.id;
  }
  return regular?.id ?? null;
}

/**
 * האם הנקודה שייכת לסדרה שבועית פעילה.
 *
 * ⚠️ משמש לחסימת הזמנה אישית: לנקודה שבועית אין בה צורך — היא
 * מזמינה כל שבוע ממילא.
 */
export async function isWeeklyPoint(
  pointId: string | null | undefined
): Promise<boolean> {
  if (!pointId) return false;
  const row = await prisma.weeklySeriesPoint.findFirst({
    where: { pointId, series: { isActive: true } },
    select: { id: true },
  });
  return !!row;
}

// ───────────────────────────────────────────────────────────────
// סינון דוחות לפי סוג מכירה
// ───────────────────────────────────────────────────────────────

export type SaleKind = "REGULAR" | "WEEKLY";

export function parseSaleKind(v: string | null | undefined): SaleKind | null {
  return v === "REGULAR" || v === "WEEKLY" ? v : null;
}

/** תנאי Prisma על Pricelist לפי סוג */
export function pricelistKindWhere(kind: SaleKind | null) {
  if (kind === "REGULAR") return { weeklySeriesId: null };
  if (kind === "WEEKLY") return { weeklySeriesId: { not: null } };
  return {};
}

/** תנאי Prisma על Order (דרך המכירה) לפי סוג */
export function orderKindWhere(kind: SaleKind | null) {
  if (!kind) return {};
  return { pricelist: pricelistKindWhere(kind) };
}
