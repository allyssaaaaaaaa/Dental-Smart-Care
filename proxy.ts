import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { ROLE_HOME, SESSION_COOKIE, parseSession, roleFromPath } from "@/lib/auth";

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const session = parseSession(request.cookies.get(SESSION_COOKIE)?.value);
  const requiredRole = roleFromPath(pathname);

  if (requiredRole) {
    if (!session) {
      const url = new URL("/login", request.url);
      url.searchParams.set("next", pathname);
      if (requiredRole === "patient") url.searchParams.set("audience", "patient");
      else url.searchParams.set("audience", "staff");
      return NextResponse.redirect(url);
    }
    if (session.role !== requiredRole) {
      return NextResponse.redirect(new URL(ROLE_HOME[session.role], request.url));
    }
  }

  if (pathname === "/login" && session) {
    const allowSwitch = request.nextUrl.searchParams.get("switch") === "1";
    if (!allowSwitch) {
      return NextResponse.redirect(new URL(ROLE_HOME[session.role], request.url));
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/login",
    "/patient",
    "/patient/:path*",
    "/clerk",
    "/clerk/:path*",
    "/dentist",
    "/dentist/:path*",
    "/admin",
    "/admin/:path*",
  ],
};
