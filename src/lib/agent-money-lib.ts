// ═══════════════════════════════════════════════════════════════
// §397/§398: 💰 חשבון הנציג — מקור אחד לסיכום, לפירוט ולנציג
// ═══════════════════════════════════════════════════════════════
// מסך "חובות ותשלומים לנציגים" מציג סכומים (נגבה באשראי, מזומן
// שאצלו, טרם נגבה, המנהל חייב). הסיכום, הפירוט, והמסך של הנציג
// עצמו ("החשבון שלי") מחושבים כאן — אחרת הם מתפצלים, והסכום בכרטיס
// לא תואם לסכום השורות, או שהנציג רואה "מגיע לך" כשהמנהל רואה "חייב".
//
// §398: 💵 **פיצול הכסף לפי מי שמחזיק בו** (ולא לפי אמצעי התשלום
// האחרון). שדות ההזמנה:
//   agentCashAmount  — מזומן שנציג קיבל ביד (agentCashById = איזה נציג)
//   adminCashAmount  — מזומן שהמנהל קיבל
//   היתרה מ-amountPaid — אשראי/העברה (אצל העסק)
//
// 🐛 מה שהיה (§397): כל הנגבה בהזמנה נזקף לפי paymentMethod האחרון.
//   • 500 מזומן לנציג + 300 באשראי → 800 "אשראי", והנציג "לא מחזיק" כלום
//   • 500 באשראי + 32 מזומן לנציג → הנציג "מחזיק" 532
//   • סגירת מכירה דרסה paymentMethod ל-DEBT_CARRIED → מזומן חלקי נספר כאשראי
//   • שני נציגים באותה נקודה → כל אחד "מחזיק" את המזומן של שניהם
//   • ביטול הזמנה ששולמה → המזומן נעלם מחשבון הנציג (והוא עדיין אצלו)

import { prisma } from "@/lib/prisma";

export type OrderForAgentMoney = {
  id: string;
  orderNumber: number;
  customerName: string;
  pointId: string;
  status: string;
  paymentStatus: string | null;
  paymentMethod: string | null;
  amountPaid: any;
  appliedDebt: any;
  finalTotal: any;
  estimatedTotal: any;
  receivedByUserId: string | null;
  paidAt: Date | null;
  pricelistId: string | null;
  agentCashAmount?: any;
  agentCashById?: string | null;
  adminCashAmount?: any;
};

export type OrderMoneyBucket =
  /** נגבה באשראי/העברה — הכסף אצל העסק */
  | "CARD"
  /** שולם במזומן לנציג — הכסף אצל הנציג עד שיעביר */
  | "CASH_AGENT"
  /** שולם במזומן למנהל ישירות — לא אצל הנציג */
  | "CASH_ADMIN"
  /** טרם שולם (או שולם חלקית) */
  | "PENDING"
  /** הועבר לחוב בסגירת המכירה */
  | "DEBT_CARRIED";

export type OrderMoney = {
  /** נגבה בפועל מההזמנה הזו (בלי חוב קודם שקוזז בה) */
  collected: number;
  /** כמה עוד חסר */
  pending: number;
  /** החלק הגדול של הנגבה — לתווית בשורה */
  collectedBucket: "CARD" | "CASH_AGENT" | "CASH_ADMIN" | null;
  /** הסטטוס לסיכום */
  bucket: OrderMoneyBucket;
  /** סכום ההזמנה לתשלום (בלי חוב קודם) */
  due: number;
  /** חוב קודם שקוזז בהזמנה (לא הכנסה מהמכירה — §325) */
  debtPart: number;
  /** §398: הנגבה (בלי חוב קודם) לפי מי שמחזיק בו */
  cardRev: number;
  adminCashRev: number;
  agentCashRev: number;
  /**
   * §398: מזומן **פיזי** שאצל הנציג — כולל חוב קודם שגבה. זה מה
   * שהוא צריך להעביר, ולכן נספר במלואו בחשבונו.
   */
  agentCash: number;
  agentCashById: string | null;
};

const r2 = (n: number) => Math.round(n * 100) / 100;

/** מזומן שסומן ע"י נציג (ולא ע"י המנהל) — הכסף אצל הנציג */
export function receivedByAgent(receivedBy: string | null | undefined): boolean {
  return !!receivedBy && receivedBy.startsWith("נציג");
}

/**
 * §398: כמה שולם, ואיפה הכסף. משותף לחשבון הנציג ולבקרת המכירה.
 *
 * ⚠️ גם בלי השדות החדשים (הזמנה שטרם עברה מיגרציה) — נופל לכלל
 * הישן לפי אמצעי התשלום, כדי שמסך לא יציג אפס.
 */
export function splitPaid(o: {
  paymentStatus: string | null;
  paymentMethod: string | null;
  amountPaid: any;
  finalTotal: any;
  estimatedTotal?: any;
  receivedByUserId?: string | null;
  agentCashAmount?: any;
  adminCashAmount?: any;
}): { paid: number; agentCash: number; adminCash: number; card: number } {
  const total = Number(o.finalTotal ?? o.estimatedTotal ?? 0);
  const ps = o.paymentStatus ?? "PENDING";
  // PAID בלי amountPaid (הזמנות ישנות) = כל הסכום
  const paid = r2(
    o.amountPaid != null ? Number(o.amountPaid) : ps === "PAID" ? total : 0
  );
  if (paid <= 0) return { paid: 0, agentCash: 0, adminCash: 0, card: 0 };

  let agentCash = o.agentCashAmount != null ? Number(o.agentCashAmount) : 0;
  let adminCash = o.adminCashAmount != null ? Number(o.adminCashAmount) : 0;
  if (o.agentCashAmount == null && o.adminCashAmount == null) {
    // נפילה לכלל הישן (לפני מיגרציה 398)
    const isCash = o.paymentMethod === "CASH" || o.paymentMethod === "MANUAL";
    if (isCash) {
      if (receivedByAgent(o.receivedByUserId)) agentCash = paid;
      else adminCash = paid;
    }
  }
  // הגנה: הפיצול לעולם לא עולה על מה ששולם
  agentCash = Math.min(Math.max(0, agentCash), paid);
  adminCash = Math.min(Math.max(0, adminCash), paid - agentCash);
  return {
    paid,
    agentCash: r2(agentCash),
    adminCash: r2(adminCash),
    card: r2(paid - agentCash - adminCash),
  };
}

/**
 * סיווג הזמנה אחת לחשבון הנציג.
 *
 * ⚠️ חוב קודם (appliedDebt) יורד מהנגבה: הוא כסף ממכירה אחרת, וספירה
 * שלו כאן הייתה מנפחת את "נגבה באשראי" מול העברת חברת האשראי (§325).
 * החוב יורד קודם מהאשראי, אחר כך ממזומן המנהל, ורק בסוף ממזומן הנציג.
 * **אבל** המזומן הפיזי שאצל הנציג (agentCash) נספר במלואו בחשבונו —
 * גם החלק שהוא חוב קודם. הכסף אצלו, והוא צריך להעביר אותו.
 *
 * ⚠️ שולם חלקית: החלק ששולם נספר בנגבה, והיתרה ב"טרם נגבה".
 */
export function classifyOrderMoney(o: OrderForAgentMoney): OrderMoney {
  const total = Number(o.finalTotal ?? o.estimatedTotal ?? 0);
  const debtPart = Number(o.appliedDebt ?? 0);
  const due = Math.max(0, r2(total - debtPart));
  const ps = o.paymentStatus ?? "PENDING";

  const sp = splitPaid(o);
  const collected = Math.max(0, r2(sp.paid - debtPart));

  // החוב הקודם יורד מהנגבה לפי הסדר: אשראי → מזומן מנהל → מזומן נציג
  let debtLeft = Math.min(debtPart, sp.paid);
  const fromCard = Math.min(debtLeft, sp.card);
  const cardRev = r2(sp.card - fromCard);
  debtLeft -= fromCard;
  const fromAdmin = Math.min(debtLeft, sp.adminCash);
  const adminCashRev = r2(sp.adminCash - fromAdmin);
  debtLeft -= fromAdmin;
  const agentCashRev = r2(sp.agentCash - Math.min(debtLeft, sp.agentCash));

  let collectedBucket: OrderMoney["collectedBucket"] = null;
  if (collected > 0) {
    const max = Math.max(cardRev, adminCashRev, agentCashRev);
    collectedBucket =
      agentCashRev === max ? "CASH_AGENT" : adminCashRev === max ? "CASH_ADMIN" : "CARD";
  }

  const base = {
    collected,
    collectedBucket,
    due,
    debtPart,
    cardRev,
    adminCashRev,
    agentCashRev,
    agentCash: sp.agentCash,
    agentCashById: o.agentCashById ?? null,
  };

  if (ps === "DEBT_CARRIED") {
    return { ...base, pending: 0, bucket: "DEBT_CARRIED" };
  }
  if (ps === "PAID") {
    return { ...base, pending: 0, bucket: collectedBucket ?? "CARD" };
  }
  return { ...base, pending: Math.max(0, r2(due - collected)), bucket: "PENDING" };
}

export const ORDER_MONEY_SELECT = {
  id: true,
  orderNumber: true,
  customerName: true,
  pointId: true,
  status: true,
  paymentStatus: true,
  paymentMethod: true,
  amountPaid: true,
  appliedDebt: true,
  finalTotal: true,
  estimatedTotal: true,
  receivedByUserId: true,
  paidAt: true,
  pricelistId: true,
  agentCashAmount: true,
  agentCashById: true,
  adminCashAmount: true,
} as const;

/**
 * §398: הנקודות של הנציג — agentPoints + agentPointId הישן (אם לא
 * כלול). מקור אחד, כדי שהמנהל והנציג יראו בדיוק את אותן הזמנות.
 */
export async function resolveAgentPointIds(agentId: string): Promise<string[]> {
  const a = await prisma.customer.findUnique({
    where: { id: agentId },
    select: { agentPointId: true, agentPoints: { select: { pointId: true } } },
  });
  if (!a) return [];
  const ids = a.agentPoints.map((p) => p.pointId);
  if (a.agentPointId && !ids.includes(a.agentPointId)) ids.push(a.agentPointId);
  return ids;
}

/**
 * §398: ההזמנות שנוגעות לחשבון הנציג:
 *   • כל ההזמנות (לא מבוטלות) בנקודות שלו — לאשראי, למזומן מנהל ולטרם נגבה
 *   • כל הזמנה שהוא קיבל עליה מזומן — **בכל נקודה ובכל סטטוס** (גם
 *     מבוטלת: אם הכסף נגבה, הוא אצלו עד שיעביר או יחזיר)
 */
export async function loadAgentMoneyOrders(agentId: string, pointIds: string[]) {
  const or: any[] = [{ agentCashById: agentId }];
  if (pointIds.length > 0) {
    or.push({ pointId: { in: pointIds }, status: { not: "CANCELLED" } });
  }
  const rows = await prisma.order.findMany({
    where: { OR: or },
    select: {
      ...ORDER_MONEY_SELECT,
      pricelist: { select: { name: true } },
    },
    orderBy: { orderNumber: "desc" },
  });
  const inPoints = new Set(pointIds);
  return rows.map((o) => ({
    order: o,
    /** בנקודות הנציג ולא מבוטלת — נספרת באשראי/מנהל/טרם נגבה */
    inPoints: inPoints.has(o.pointId) && o.status !== "CANCELLED",
    /** המזומן בהזמנה הזו אצל הנציג הזה */
    mine: o.agentCashById === agentId,
  }));
}

// ═══════════════════════════════════════════════════════════════
// §398: 🧮 חשבון הכסף של הנציג — מקור אחד למנהל ולנציג
// ═══════════════════════════════════════════════════════════════

export type AgentCashAccount = {
  /** מזומן ממזדמנים (ישנים — לפני ההמרה) */
  walkinCash: number;
  walkinCashCount: number;
  /** מזומן מהזמנות שהנציג קיבל ביד */
  cashFromOrders: number;
  cashOrders: number;
  /** נגבה באשראי/העברה (כסף אצל העסק) */
  cardCollected: number;
  cardOrders: number;
  /** מזומן שהמנהל קיבל ישירות */
  cashToAdmin: number;
  cashToAdminOrders: number;
  /** טרם נגבה */
  pendingCollection: number;
  pendingOrders: number;
  /** כל המזומן שאצל הנציג = מזדמנים + הזמנות */
  cashHeld: number;
};

export async function computeAgentCashAccount(agentId: string): Promise<AgentCashAccount> {
  const pointIds = await resolveAgentPointIds(agentId);
  const walkinAgg = await prisma.walkinOrder.aggregate({
    where: { agentId, paymentMethod: "CASH", paymentReceived: true },
    _sum: { totalAmount: true },
    _count: { _all: true },
  });
  const acc: AgentCashAccount = {
    walkinCash: Number(walkinAgg._sum.totalAmount || 0),
    walkinCashCount: walkinAgg._count._all,
    cashFromOrders: 0,
    cashOrders: 0,
    cardCollected: 0,
    cardOrders: 0,
    cashToAdmin: 0,
    cashToAdminOrders: 0,
    pendingCollection: 0,
    pendingOrders: 0,
    cashHeld: 0,
  };

  const rows = await loadAgentMoneyOrders(agentId, pointIds);
  for (const { order, inPoints, mine } of rows) {
    const m = classifyOrderMoney(order);
    if (mine && m.agentCash > 0) {
      acc.cashFromOrders += m.agentCash;
      acc.cashOrders++;
    }
    if (!inPoints) continue;
    if (m.cardRev > 0) {
      acc.cardCollected += m.cardRev;
      acc.cardOrders++;
    }
    if (m.adminCashRev > 0) {
      acc.cashToAdmin += m.adminCashRev;
      acc.cashToAdminOrders++;
    }
    if (m.pending > 0) {
      acc.pendingCollection += m.pending;
      acc.pendingOrders++;
    }
  }

  acc.walkinCash = r2(acc.walkinCash);
  acc.cashFromOrders = r2(acc.cashFromOrders);
  acc.cardCollected = r2(acc.cardCollected);
  acc.cashToAdmin = r2(acc.cashToAdmin);
  acc.pendingCollection = r2(acc.pendingCollection);
  acc.cashHeld = r2(acc.walkinCash + acc.cashFromOrders);
  return acc;
}
