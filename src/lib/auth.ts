import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";

export const { handlers, auth, signIn, signOut } = NextAuth({
  trustHost: true,
  session: { strategy: "jwt" },
  pages: { signIn: "/login" },
  providers: [
    // provider אחד מאוחד - מנסה קודם מנהל (לפי מייל), ואז לקוח (טלפון או מייל).
    // כך יש מסך התחברות אחד לכולם, וה-role נקבע אוטומטית לפי מי שנמצא.
    Credentials({
      id: "login",
      name: "login",
      credentials: { identifier: {}, password: {} },
      async authorize(creds) {
        const identifier = String(creds?.identifier ?? "").trim();
        const password = String(creds?.password ?? "");
        if (!identifier || !password) {
          console.warn(`[auth] missing credentials: identifier=${!!identifier} password=${!!password}`);
          return null;
        }

        // 1) מנסים קודם כמנהל (טבלת Admin, לפי מייל)
        const admin = await prisma.admin.findUnique({
          where: { email: identifier.toLowerCase() },
        });
        if (admin) {
          const ok = await bcrypt.compare(password, admin.password);
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

        // 2) אם לא מנהל - מנסים כלקוח (טבלת Customer, טלפון או מייל).
        // נירמול טלפון: מסירים מקפים/רווחים/סוגריים וממירים קידומת בינלאומית
        // (+972-53...) לפורמט מקומי (053...). בלי זה - התחברות נכשלת למי
        // שמקליד את המספר עם מקף או מעתיק אותו מוואטסאפ.
        const digitsOnly = identifier.replace(/\D/g, "");
        const localPhone = digitsOnly.startsWith("972")
          ? "0" + digitsOnly.slice(3)
          : digitsOnly;
        const phoneCandidates = [...new Set([identifier, digitsOnly, localPhone])].filter(
          (v) => v.length > 0
        );

        // שינוי מ-findFirst ל-findMany לזיהוי כפילויות
        const customers = await prisma.customer.findMany({
          where: {
            OR: [
              ...phoneCandidates.map((p) => ({ phone: p })),
              { email: identifier.toLowerCase() },
            ],
          },
        });

        if (customers.length === 0) {
          console.warn(`[auth] customer NOT FOUND: identifier=${identifier} phoneTries=${JSON.stringify(phoneCandidates)}`);
          return null;
        }

        // אזהרה אם יש כפילויות - זה יכול לגרום להתחברות לא עקבית
        if (customers.length > 1) {
          console.error(
            `[auth] ⚠️ DUPLICATE CUSTOMERS FOUND (${customers.length}) for identifier=${identifier}:`,
            customers.map((c) => ({ id: c.id, name: c.name, phone: c.phone, email: c.email }))
          );
        }

        // מנסים כל אחד עד שאחד עובר עם הסיסמה
        for (const customer of customers) {
          const ok = await bcrypt.compare(password, customer.passwordHash);
          if (ok) {
            console.log(`[auth] customer login SUCCESS: id=${customer.id} name=${customer.name} identifier=${identifier}`);
            return {
              id: customer.id,
              email: customer.email ?? undefined,
              name: customer.name,
              role: customer.role, // CUSTOMER / AGENT / ADMIN
            };
          }
        }

        console.warn(
          `[auth] customer login FAILED (wrong password): identifier=${identifier} tried=${customers.length} customer(s) [${customers.map((c) => c.id).join(", ")}]`
        );
        return null;
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.role = (user as any).role;
        token.id = (user as any).id;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        (session.user as any).role = token.role;
        (session.user as any).id = token.id;
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
