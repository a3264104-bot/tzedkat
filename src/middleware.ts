import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getToken } from "next-auth/jwt";

export async function middleware(req: NextRequest) {
  const path = req.nextUrl.pathname;
  const isLoginPage = path === "/login";

  const isSecure =
    req.nextUrl.protocol === "https:" ||
    req.headers.get("x-forwarded-proto") === "https";

  const token = await getToken({
    req,
    secret: process.env.AUTH_SECRET,
    secureCookie: isSecure,
    cookieName: isSecure ? "__Secure-authjs.session-token" : "authjs.session-token",
  });

  const role = (token as any)?.role;
  const isAdmin = role === "ADMIN";
  const isAgent = role === "AGENT";

  // אזור הניהול: ADMIN בלבד
  if (path.startsWith("/admin") && !isAdmin) {
    const loginUrl = new URL("/login", req.url);
    loginUrl.searchParams.set("callbackUrl", path);
    return NextResponse.redirect(loginUrl);
  }

  // אזור הנציג: AGENT או ADMIN
  if (path.startsWith("/agent") && !isAgent && !isAdmin) {
    const loginUrl = new URL("/login", req.url);
    loginUrl.searchParams.set("callbackUrl", path);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/admin/:path*", "/agent/:path*"],
};
