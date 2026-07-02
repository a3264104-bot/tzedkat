import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getToken } from "next-auth/jwt";

// getToken חייב לדעת את שם ה-cookie הנכון. בפרודקשן (https) Auth.js v5 משתמש
// ב-__Secure-authjs.session-token, ובפיתוח ב-authjs.session-token.
// בלי לציין זאת במפורש, getToken לא מוצא את ה-cookie בפרודקשן ומחזיר null,
// וכל בקשה ל-/admin נדחית - זו הייתה הבעיה.
export async function middleware(req: NextRequest) {
  const isLoginPage = req.nextUrl.pathname === "/admin/login";

  // מזהים אם אנחנו על https (פרודקשן) לפי הפרוטוקול או הheader
  const isSecure =
    req.nextUrl.protocol === "https:" ||
    req.headers.get("x-forwarded-proto") === "https";

  const token = await getToken({
    req,
    secret: process.env.AUTH_SECRET,
    secureCookie: isSecure,
    cookieName: isSecure ? "__Secure-authjs.session-token" : "authjs.session-token",
  });

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
