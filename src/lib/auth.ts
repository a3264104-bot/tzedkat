import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";

export const { handlers, auth, signIn, signOut } = NextAuth({
  trustHost: true,
  session: { strategy: "jwt" },
  pages: { signIn: "/admin/login" },
  providers: [
    // התחברות מנהל - נשאר זהה לחלוטין למה שהיה
    Credentials({
      id: "admin",
      name: "admin",
      credentials: { email: {}, password: {} },
      async authorize(creds) {
        if (!creds?.email || !creds?.password) return null;
        const admin = await prisma.admin.findUnique({
          where: { email: String(creds.email).toLowerCase().trim() },
        });
        if (!admin) return null;
        const ok = await bcrypt.compare(String(creds.password), admin.password);
        if (!ok) return null;
        return { id: admin.id, email: admin.email, name: admin.name ?? "מנהל", role: "ADMIN" };
      },
    }),
    // התחברות לקוח - טלפון או מייל + סיסמה
    Credentials({
      id: "customer",
      name: "customer",
      credentials: { identifier: {}, password: {} },
      async authorize(creds) {
        const identifier = String(creds?.identifier ?? "").trim();
        const password = String(creds?.password ?? "");
        if (!identifier || !password) return null;

        // הזיהוי יכול להיות טלפון או מייל - בודקים את שניהם
        const customer = await prisma.customer.findFirst({
          where: { OR: [{ phone: identifier }, { email: identifier.toLowerCase() }] },
        });
        if (!customer) return null;
        const ok = await bcrypt.compare(password, customer.passwordHash);
        if (!ok) return null;
        return {
          id: customer.id,
          email: customer.email ?? undefined,
          name: customer.name,
          role: customer.role, // CUSTOMER / AGENT / ADMIN (מוכן להרחבה עתידית לנציגים)
        };
      },
    }),
  ],
  callbacks: {
    // מעבירים role לתוך ה-JWT כדי שיהיה זמין ב-session בלי שאילתת DB נוספת
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
      const isAdminLogin = path.startsWith("/admin/login");
      const isAdminArea = path.startsWith("/admin");
      const isAccountArea = path.startsWith("/account");

      if (isAdminLogin) return true;

      // אזור הניהול: חובה session עם role של ADMIN בלבד.
      // זה קריטי - בלי הבדיקה הזו, לקוח רגיל מחובר היה יכול לגשת לאזור הניהול.
      if (isAdminArea) {
        return (auth?.user as any)?.role === "ADMIN";
      }

      // אזור אישי של לקוח: כל session מחובר (לקוח/נציג/מנהל) מספיק
      if (isAccountArea) {
        return !!auth?.user;
      }

      return true;
    },
  },
});
