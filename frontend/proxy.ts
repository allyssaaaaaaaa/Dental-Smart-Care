import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { SESSION_COOKIE, roleFromPath } from "@/lib/auth";

export function proxy(request: NextRequest) {
  const url = request.nextUrl.clone();
  const { pathname } = url;
  if (pathname === "/dentist" || pathname.startsWith("/dentist/")) {
    url.pathname = `/admin${pathname.slice("/dentist".length)}`;
    return NextResponse.redirect(url);
  }
  const hasSession = Boolean(request.cookies.get(SESSION_COOKIE)?.value);
  const requiredRole = roleFromPath(pathname);

  if (requiredRole && !hasSession) {
    const url = new URL("/login", request.url);
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/login",
    "/patient",
    "/patient/:path*",
    "/dentist",
    "/dentist/:path*",
    "/admin",
    "/admin/:path*",
  ],
};
