import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import Google from "next-auth/providers/google";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import {
  decryptCode,
  codesMatch,
  phoneCandidates,
  isLocked,
  lockUntilDate,
  MAX_FAILED_ATTEMPTS,
  LOCK_MINUTES,
} from "@/lib/login-code";

// ═══════════════════════════════════════════════════════════════
// §62: מודל ההתחברות
// ═══════════════════════════════════════════════════════════════
// שם המשתמש = מספר הטלפון. הסיסמה = קוד מספרי בן 4-6 ספרות
// (Customer.loginCode, מוצפן - ראה src/lib/login-code.ts).
//
// **מסלולי תאימות שנשמרו בכוונה**, כדי שאף אחד לא יינעל בחוץ ביום
// המעבר:
//   1. לקוח עם passwordHash ובלי loginCode - מתחבר בסיסמה הישנה
//      כרגיל. הוא יקבל קוד כשהמנהל ייצר לו אחד.
//   2. מנהלים בטבלת Admin הנפרדת - מייל + סיסמה, ללא שינוי.
//   3. Google OAuth - ללא שינוי.
//
// אין כאן מערכת מקבילה: כל המסלולים עוברים באותו provider ומייצרים
// את אותו session.

async function registerFailedAttempt(customerId: string, current: number) {
  const next = current + 1;
  const shouldLock = next >= MAX_FAILED_ATTEMPTS;
  await prisma.customer
    .update({
      where: { id: customerId },
      data: {
        failedLoginAttempts: next,
        ...(shouldLock ? { lockedUntil: lockUntilDate() } : {}),
      },
    })
    .catch(() => null);
  if (shouldLock) {
    console.warn(
      `[auth] account LOCKED for ${LOCK_MINUTES}m after ${next} failed attempts: customer=${customerId}`
    );
  }
}

async function clearFailedAttempts(customerId: string, current: number, wasLocked: boolean) {
  if (current === 0 && !wasLocked) return;
  await prisma.customer
    .update({
      where: { id: customerId },
      data: { failedLoginAttempts: 0, lockedUntil: null },
    })
    .catch(() => null);
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  trustHost: true,
  session: { strategy: "jwt" },
  pages: { signIn: "/login" },
  providers: [
    // ══════════════════════════════════════════════════════════
    // Google OAuth - התחברות בלחיצה אחת דרך חשבון Google
    // ══════════════════════════════════════════════════════════
    // אחרי sign-in ראשון:
    //  - אם כבר קיים לקוח עם אותו מייל -> login מוצלח (משתמש קיים)
    //  - אם לא קיים -> הפנייה ל-/register?googleEmail=X&googleName=Y
    //    כדי שהמשתמש יוסיף טלפון + נקודת חלוקה + סיסמא
    ...(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET
      ? [
          Google({
            clientId: process.env.GOOGLE_CLIENT_ID,
            clientSecret: process.env.GOOGLE_CLIENT_SECRET,
            // מאפשר קישור לאוטומטי לפי מייל - כי המערכת שלנו מזהה משתמשים לפי email/phone
            allowDangerousEmailAccountLinking: true,
          }),
        ]
      : []),

    // ══════════════════════════════════════════════════════════
    // Credentials - טלפון (או מייל) + קוד התחברות
    // ══════════════════════════════════════════════════════════
    Credentials({
      id: "login",
      name: "login",
      credentials: { identifier: {}, password: {} },
      async authorize(creds) {
        const identifier = String(creds?.identifier ?? "").trim();
        // "password" נשמר כשם השדה לתאימות עם הקליינט; התוכן הוא הקוד.
        // ⚠️ הערך הזה לעולם לא נרשם ללוג.
        const secret = String(creds?.password ?? "");
        if (!identifier || !secret) {
          console.warn(
            `[auth] missing credentials: identifier=${!!identifier} secret=${!!secret}`
          );
          return null;
        }

        // 1) מנסים קודם כמנהל (טבלת Admin, לפי מייל)
        // TODO: אחרי שיצליחו כל המנהלים לעבור לטבלת Customer עם role=ADMIN,
        // אפשר להסיר את הבלוק הזה ולמחוק את טבלת Admin
        const admin = await prisma.admin
          .findUnique({ where: { email: identifier.toLowerCase() } })
          .catch(() => null);
        if (admin) {
          const ok = await bcrypt.compare(secret, admin.password);
          if (ok) {
            console.log(`[auth] admin login SUCCESS: ${identifier}`);
            return {
              id: admin.id,
              email: admin.email,
              name: admin.name ?? "מנהל",
              role: "ADMIN",
            };
          }
          console.warn(`[auth] admin login FAILED (wrong password): ${identifier}`);
        }

        // 2) לקוח - לפי טלפון (המזהה הראשי) או מייל.
        // הנירמול זהה לזה שבהרשמה, ב-customer-create וב-IVR, אחרת
        // מי שמקליד מקף או מעתיק מוואטסאפ לא נמצא.
        const candidates = phoneCandidates(identifier);

        const customers = await prisma.customer.findMany({
          where: {
            OR: [
              ...candidates.map((p) => ({ phone: p })),
              { email: identifier.toLowerCase() },
            ],
          },
        });

        if (customers.length === 0) {
          console.warn(
            `[auth] customer NOT FOUND: identifier=${identifier} phoneTries=${JSON.stringify(candidates)}`
          );
          return null;
        }

        // אזהרה אם יש כפילויות - זה יכול לגרום להתחברות לא עקבית
        if (customers.length > 1) {
          console.error(
            `[auth] ⚠️ DUPLICATE CUSTOMERS FOUND (${customers.length}) for identifier=${identifier}:`,
            customers.map((c) => ({ id: c.id, name: c.name, phone: c.phone, email: c.email }))
          );
        }

        // §62: נעילה. נבדקת לפני כל ניסיון השוואה - אחרת התוקף פשוט
        // ממשיך לנחש בזמן שהמונה עולה.
        const lockedOnes = customers.filter((c) => isLocked(c.lockedUntil));
        if (lockedOnes.length === customers.length) {
          console.warn(
            `[auth] login blocked - account locked: identifier=${identifier} until=${lockedOnes[0].lockedUntil?.toISOString()}`
          );
          return null;
        }

        for (const customer of customers) {
          if (isLocked(customer.lockedUntil)) continue;

          // §62: קודם הקוד המוצפן (המסלול החדש)
          const storedCode = decryptCode(customer.loginCode);
          let ok = storedCode !== null && codesMatch(storedCode, secret);

          // תאימות אחורה: לקוח שעדיין לא קיבל קוד מתחבר בסיסמה הישנה.
          // הבדיקה שנייה בכוונה - ברגע שיש קוד, הוא הקובע.
          if (!ok && !customer.loginCode && customer.passwordHash) {
            ok = await bcrypt.compare(secret, customer.passwordHash);
          }

          if (ok) {
            await clearFailedAttempts(
              customer.id,
              customer.failedLoginAttempts,
              !!customer.lockedUntil
            );
            console.log(
              `[auth] customer login SUCCESS: id=${customer.id} name=${customer.name} method=${customer.loginCode ? "code" : "legacy-password"}`
            );
            return {
              id: customer.id,
              email: customer.email ?? undefined,
              name: customer.name,
              role: customer.role, // CUSTOMER / AGENT / ADMIN
            };
          }
        }

        // כישלון - מגדילים את המונה על ההתאמה הראשונה בלבד, כדי
        // שכפילות לא תנעל שני חשבונות בבת אחת.
        const primary = customers.find((c) => !isLocked(c.lockedUntil));
        if (primary) {
          await registerFailedAttempt(primary.id, primary.failedLoginAttempts);
        }

        console.warn(
          `[auth] customer login FAILED: identifier=${identifier} tried=${customers.length} customer(s)`
        );
        return null;
      },
    }),

    // ══════════════════════════════════════════════════════════
    // §62: כניסה בשם משתמש (Login As) + חזרה
    // ══════════════════════════════════════════════════════════
    // הקליינט מגיע לכאן עם כרטיס חד-פעמי שהונפק ב-
    // /api/admin/impersonate. הכרטיס הוא מקור האמת היחיד: אין שום
    // ערך מהקליינט שנלקח כפשוטו, ולכן אי אפשר "לבקש" להתחזות.
    Credentials({
      id: "impersonate",
      name: "impersonate",
      credentials: { ticket: {} },
      async authorize(creds) {
        const token = String(creds?.ticket ?? "").trim();
        if (!token) return null;

        const ticket = await prisma.impersonationTicket.findUnique({
          where: { token },
        });
        if (!ticket) {
          console.warn("[auth] impersonation ticket not found");
          return null;
        }
        // חד-פעמי ופג-תוקף: כרטיס שנעשה בו שימוש או שפג אינו תקף,
        // גם אם מישהו שמר את ה-URL.
        if (ticket.usedAt || ticket.expiresAt.getTime() < Date.now()) {
          console.warn(
            `[auth] impersonation ticket rejected (used=${!!ticket.usedAt} expired=${ticket.expiresAt.getTime() < Date.now()})`
          );
          return null;
        }

        const target = await prisma.customer.findUnique({
          where: { id: ticket.targetId },
          select: { id: true, name: true, email: true, role: true },
        });
        if (!target) return null;

        await prisma.impersonationTicket
          .update({ where: { id: ticket.id }, data: { usedAt: new Date() } })
          .catch(() => null);

        console.log(
          `[auth] impersonation ${ticket.isReturn ? "RETURN" : "START"}: actor=${ticket.actorId} -> target=${ticket.targetId}`
        );

        return {
          id: target.id,
          email: target.email ?? undefined,
          name: target.name,
          role: target.role,
          // כרטיס חזרה מחזיר את המנהל לעצמו, ולכן אין יותר מתחזה
          impersonatorId: ticket.isReturn ? null : ticket.actorId,
          impersonatorRole: ticket.isReturn ? null : ticket.actorRole,
          impersonatorName: ticket.isReturn ? null : ticket.actorName,
        } as any;
      },
    }),
  ],
  callbacks: {
    // ══════════════════════════════════════════════════════════
    // SignIn callback - טיפול בהתחברות Google
    // ══════════════════════════════════════════════════════════
    async signIn({ user, account }) {
      // רק Google צריך טיפול מיוחד - Credentials כבר עבר את authorize
      if (account?.provider !== "google") return true;

      const email = user.email?.toLowerCase();
      if (!email) {
        console.warn("[auth-google] no email from Google");
        return "/login?error=no_email";
      }

      const existing = await prisma.customer.findUnique({ where: { email } });

      if (existing) {
        console.log(`[auth-google] existing customer login: ${email}`);
        return true;
      }

      // אין user - הפנה ל-register עם פרטי Google
      console.log(`[auth-google] new user - redirecting to register: ${email}`);
      const params = new URLSearchParams({
        googleEmail: email,
        googleName: user.name || "",
      });
      return `/register?${params.toString()}`;
    },

    async jwt({ token, user, account, trigger }) {
      // בכניסה ראשונית - מטעינים את הנתונים ל-token
      if (user) {
        token.role = (user as any).role;
        token.id = (user as any).id;
        // §62: זהות המתחזה. נשמר ב-JWT (חתום בשרת) ולא ב-cookie
        // נפרד, כדי שלא ניתן יהיה לזייף אותו מהדפדפן.
        // כרטיס חזרה מציב null ובכך מסיים את ההתחזות.
        token.impersonatorId = (user as any).impersonatorId ?? null;
        token.impersonatorRole = (user as any).impersonatorRole ?? null;
        token.impersonatorName = (user as any).impersonatorName ?? null;
      }

      // כניסה עם Google - צריך לחפש את ה-Customer ב-DB לפי email
      if (account?.provider === "google" && user?.email) {
        const dbUser = await prisma.customer.findUnique({
          where: { email: user.email.toLowerCase() },
          select: { id: true, role: true, name: true },
        });
        if (dbUser) {
          token.id = dbUser.id;
          token.role = dbUser.role;
          token.name = dbUser.name;
        }
      }

      // §62: רענון תפקיד יזום (session.update()). נדרש למעבר
      // נציג<->לקוח: הנציג מחליף תצוגה, וה-role ב-token חייב להשתנות
      // בלי שיתנתק ויתחבר מחדש.
      if (trigger === "update" && token.id) {
        const fresh = await prisma.customer
          .findUnique({
            where: { id: String(token.id) },
            select: { role: true, isActive: true },
          })
          .catch(() => null);
        if (fresh) token.actualRole = fresh.role;
      }

      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        (session.user as any).role = token.role;
        (session.user as any).id = token.id;
        // §62: ה-UI מציג באנר "אתה מחובר כ-X" עם כפתור חזרה
        (session.user as any).impersonatorId = token.impersonatorId ?? null;
        (session.user as any).impersonatorName = token.impersonatorName ?? null;
        (session.user as any).impersonatorRole = token.impersonatorRole ?? null;
      }
      return session;
    },
    authorized({ auth, request }) {
      const path = request.nextUrl.pathname;
      const isLoginPage = path === "/login" || path === "/admin/login";
      const isAdminArea = path.startsWith("/admin");
      const isAccountArea = path.startsWith("/account");
      const isAgentArea = path.startsWith("/agent");

      if (isLoginPage) return true;

      // אזור הניהול: חובה role של ADMIN בלבד
      if (isAdminArea) {
        return (auth?.user as any)?.role === "ADMIN";
      }

      // אזור נציג: AGENT או ADMIN בלבד
      if (isAgentArea) {
        const r = (auth?.user as any)?.role;
        return r === "AGENT" || r === "ADMIN";
      }

      // אזור אישי: כל session מחובר מספיק
      if (isAccountArea) {
        return !!auth?.user;
      }

      return true;
    },
  },
});
