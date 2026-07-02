import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getToken } from "next-auth/jwt";

// משתמשים ב-getToken (לא ב-auth() המלא) כדי לא לגרור Prisma/bcrypt ל-Edge Function
// ולהישאר הרבה מתחת למגבלת ה-1MB של Vercel, אבל עדיין לבדוק את ה-role בפועל
// ולא רק "יש קוקי כלשהו" (שזו הייתה הבעיה בגרסה הקודמת - לקוח מחובר היה עובר).
export async function middleware(req: NextRequest) {
  const isLoginPage = req.nextUrl.pathname === "/admin/login";

  const token = await getToken({ req, secret: process.env.AUTH_SECRET });
  const isAdmin = (token as any)?.role === "ADMIN";

  if (!isAdmin && !isLoginPage) {
    const loginUrl = new URL("/admin/login", req.url);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/admin/:path*"],
};
