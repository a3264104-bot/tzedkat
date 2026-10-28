// ═══════════════════════════════════════════════════════════════
// 💸 בעלות על חוב — של מי החוב (מי רשם אותו)
// ═══════════════════════════════════════════════════════════════
// הכלל העסקי:
//   • חוב שנציג רשם — שייך לנציג, ונספר בהכנסה שלו כשהוא נגבה.
//   • חוב שהמנהל רשם — של המנהל, ולא נספר אצל הנציג, גם אם הלקוח
//     בנקודה של הנציג (למשל סחורה שנקנתה ישירות מהמנהל).
//
// debtBalance על הלקוח נשאר המספר האחד. debtOwners מפרק אותו:
//   { "agent:<customerId>": 300, "admin": 5850 }
// ⚠️ חוב ישן שנרשם לפני הפיצול (אין לו בעלים) — היתרה נחשבת "admin".
// כך שום דבר ישן לא עובר פתאום לנציג.
//
// בגבייה (קיזוז בהזמנה) הפירוק עובר ל-Order.appliedDebtOwners, ובביטול
// ההזמנה הוא חוזר ללקוח.

export type DebtOwners = Record<string, number>;

export const ADMIN_OWNER = "admin";
export const agentOwnerKey = (agentId: string) => `agent:${agentId}`;
export const isAgentOwner = (key: string) => key.startsWith("agent:");
export const agentIdOfOwner = (key: string) => (isAgentOwner(key) ? key.slice(6) : null);

const r2 = (n: number) => Math.round(n * 100) / 100;

/** מי רושם: נציג → החוב שלו; מנהל (או כל דבר אחר) → של המנהל */
export function ownerKeyForActor(role: string | null | undefined, userId: string | null | undefined) {
  return role === "AGENT" && userId ? agentOwnerKey(userId) : ADMIN_OWNER;
}

export function normOwners(raw: unknown): DebtOwners {
  const out: DebtOwners = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const n = r2(Number(v));
    if (Number.isFinite(n) && n > 0) out[k] = n;
  }
  return out;
}

export function ownersTotal(o: DebtOwners) {
  return r2(Object.values(o).reduce((a, b) => a + b, 0));
}

export function addOwners(a: DebtOwners, b: DebtOwners): DebtOwners {
  const out: DebtOwners = { ...a };
  for (const [k, v] of Object.entries(b)) out[k] = r2((out[k] ?? 0) + v);
  return normOwners(out);
}

/**
 * הפירוק המלא של יתרה: מה שרשום + היתרה בלי בעלים → "admin".
 * אם הרשום גדול מהיתרה (למשל תיקון ידני) — מקטינים באופן יחסי.
 */
export function ownersForBalance(raw: unknown, balance: number): DebtOwners {
  const bal = r2(Math.max(0, Number(balance) || 0));
  if (bal <= 0) return {};
  const o = normOwners(raw);
  const sum = ownersTotal(o);
  if (sum <= bal + 0.005) {
    const rest = r2(bal - sum);
    return rest > 0 ? addOwners(o, { [ADMIN_OWNER]: rest }) : o;
  }
  return scaleTo(o, bal);
}

/** מקטין/מגדיל את הפירוק באופן יחסי לסכום חדש (עיגול נספג באחרון) */
export function scaleTo(o: DebtOwners, total: number): DebtOwners {
  const t = r2(Math.max(0, total));
  const sum = ownersTotal(o);
  if (t <= 0 || sum <= 0) return {};
  const keys = Object.keys(o);
  const out: DebtOwners = {};
  let used = 0;
  keys.forEach((k, i) => {
    const v = i === keys.length - 1 ? r2(t - used) : r2((o[k] / sum) * t);
    used = r2(used + v);
    out[k] = v;
  });
  return normOwners(out);
}

/**
 * הקטנת חוב: קודם מהבעלים שמבצע את ההקטנה (מי שמתקן את החוב שלו),
 * ואז משאר הבעלים באופן יחסי.
 */
export function reduceOwners(o: DebtOwners, newTotal: number, preferKey?: string): DebtOwners {
  let cut = r2(ownersTotal(o) - Math.max(0, newTotal));
  if (cut <= 0) return o;
  const out = { ...o };
  if (preferKey && out[preferKey]) {
    const take = Math.min(out[preferKey], cut);
    out[preferKey] = r2(out[preferKey] - take);
    cut = r2(cut - take);
  }
  const rest = normOwners(out);
  return cut > 0 ? scaleTo(rest, r2(ownersTotal(rest) - cut)) : rest;
}

/** תווית לתצוגה */
export function ownerLabel(key: string, names?: Map<string, string>) {
  if (key === ADMIN_OWNER) return "המנהל";
  const id = agentIdOfOwner(key);
  return id ? `נציג: ${names?.get(id) ?? "?"}` : key;
}
