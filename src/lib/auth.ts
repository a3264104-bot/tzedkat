import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";

export const { handlers, auth, signIn, signOut } = NextAuth({
  trustHost: true,
  session: { strategy: "jwt" },
  pages: { signIn: "/admin/login" },
  providers: [
    Credentials({
      credentials: { email: {}, password: {} },
      async authorize(creds) {
        if (!creds?.email || !creds?.password) return null;
        const admin = await prisma.admin.findUnique({
          where: { email: String(creds.email).toLowerCase().trim() },
        });
        if (!admin) return null;
        const ok = await bcrypt.compare(String(creds.password), admin.password);
        if (!ok) return null;
        return { id: admin.id, email: admin.email, name: admin.name ?? "מנהל" };
      },
    }),
  ],
  callbacks: {
    authorized({ auth, request }) {
      const isAdmin = request.nextUrl.pathname.startsWith("/admin");
      const isLogin = request.nextUrl.pathname.startsWith("/admin/login");
      if (isLogin) return true;
      if (isAdmin) return !!auth?.user;
      return true;
    },
  },
});
