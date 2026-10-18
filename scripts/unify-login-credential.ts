// ═══════════════════════════════════════════════════════════════
// §152: איחוד פרטי הכניסה — הסיסמה שהלקוח בחר הופכת לקוד שלו
// ═══════════════════════════════════════════════════════════════
// לקוחות שבחרו סיסמה בהרשמה קיבלו בנוסף קוד אקראי (ensureLoginCode),
// ונוצרו להם שני ערכים. הסקריפט מחליף את הקוד בסיסמה שבחרו.
//
// ⚠️ אחרי ההרצה הקוד האקראי הישן **מפסיק לעבוד**. הסיסמה ממשיכה
// לעבוד כרגיל (passwordHash לא נוגעים בו).
//
// הרצה (מתיקיית הפרויקט):
//   npx tsx --env-file=.env scripts/unify-login-credential.ts          ← ניסוי, לא כותב
//   npx tsx --env-file=.env scripts/unify-login-credential.ts --apply  ← כותב למסד
//
// לפני כתיבה נשמר גיבוי של הקודים הישנים (מוצפנים, כמו במסד) לקובץ
// unify-login-backup-<זמן>.json — מאפשר החזרה.

import { writeFileSync } from "fs";
import { PrismaClient } from "@prisma/client";
import { decryptCode, encryptCode, isCodeKeyConfigured } from "../src/lib/login-code";

const prisma = new PrismaClient();
const APPLY = process.argv.includes("--apply");

async function main() {
  if (!isCodeKeyConfigured()) throw new Error("AUTH_CODE_KEY אינו מוגדר");

  const rows = await prisma.customer.findMany({
    where: { role: "CUSTOMER", passwordPlain: { not: null }, loginCode: { not: null } },
    select: { id: true, passwordPlain: true, loginCode: true, loginCodeSetAt: true },
  });

  const targets = rows.filter((r) => {
    const pw = (r.passwordPlain || "").trim();
    const code = decryptCode(r.loginCode);
    return pw.length > 0 && code !== pw;
  });

  console.log(`לקוחות עם סיסמה וקוד: ${rows.length}`);
  console.log(`יעודכנו (הקוד שונה מהסיסמה): ${targets.length}`);

  if (!APPLY) {
    console.log("ניסוי בלבד — לא נכתב דבר. להרצה אמיתית: --apply");
    return;
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupFile = `unify-login-backup-${stamp}.json`;
  writeFileSync(
    backupFile,
    JSON.stringify(
      targets.map((t) => ({ id: t.id, loginCode: t.loginCode, loginCodeSetAt: t.loginCodeSetAt })),
      null,
      2
    )
  );
  console.log(`גיבוי נשמר: ${backupFile}`);

  let done = 0;
  for (const t of targets) {
    await prisma.customer.update({
      where: { id: t.id },
      data: {
        loginCode: encryptCode((t.passwordPlain || "").trim()),
        loginCodeSetAt: new Date(),
      },
    });
    done++;
  }
  console.log(`עודכנו: ${done}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
