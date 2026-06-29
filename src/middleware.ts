import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// קוקי הסשן של Auth.js v5 (בפרודקשן עם https זה בדרך כלל __Secure-authjs.session-token,
// ובפיתוח authjs.session-token). בודקים את שניהם כדי שזה יעבוד גם ב-dev וגם ב-prod.
const SESSION_COOKIE_NAMES = [
  "__Secure-authjs.session-token",
  "authjs.session-token",
  "__Secure-next-auth.session-token",
  "next-auth.session-token",
];

export function middleware(req: NextRequest) {
  const isLoggedIn = SESSION_COOKIE_NAMES.some((name) => req.cookies.get(name));
  const isLoginPage = req.nextUrl.pathname === "/admin/login";

  if (!isLoggedIn && !isLoginPage) {
    const loginUrl = new URL("/admin/login", req.url);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/admin/:path*"],
};
