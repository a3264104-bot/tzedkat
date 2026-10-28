// 💸 החזרת בעלות החוב ללקוח — אחרי שחוב שקוזז בהזמנה הוחזר אליו
// (ביטול / מחיקה של הזמנה שלא שולמה).
//
// ⚠️ נקרא **אחרי** ש-debtBalance כבר הוגדל: היתרה שלפני ההחזרה היא
// debtBalance פחות מה שהוחזר. הפירוק של ההזמנה (appliedDebtOwners)
// מתווסף לפירוק שעל הלקוח.

import { prisma } from "@/lib/prisma";
import { addOwners, ownersForBalance } from "@/lib/debt-owners-lib";

export async function restoreDebtOwners(
  customerId: string,
  orderOwnersRaw: unknown,
  restored: number
): Promise<void> {
  if (!(restored > 0)) return;
  const c = await prisma.customer.findUnique({
    where: { id: customerId },
    select: { debtBalance: true, debtOwners: true },
  });
  if (!c) return;
  const bal = Number(c.debtBalance ?? 0);
  const prior = Math.max(0, Math.round((bal - restored) * 100) / 100);
  const owners = addOwners(
    ownersForBalance(c.debtOwners, prior),
    ownersForBalance(orderOwnersRaw, restored)
  );
  await prisma.customer.update({ where: { id: customerId }, data: { debtOwners: owners } });
}
