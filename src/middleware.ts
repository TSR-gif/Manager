import { NextResponse, type NextRequest } from "next/server";
import { COOKIE, sessionToken } from "@/lib/auth";

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (pathname.startsWith("/login") || pathname === "/manifest.webmanifest" || pathname.startsWith("/icon") || pathname.startsWith("/apple-icon") || pathname === "/offline.html") {
    return NextResponse.next();
  }
  if (!process.env.APP_PASSWORD) {
    return new NextResponse("APP_PASSWORD is not configured", { status: 500 });
  }
  // local MCP bridge authenticates with a header instead of the cookie (checked again in the route)
  if (pathname === "/api/agent/tool" && req.headers.get("x-manager-key") === (await sessionToken())) return NextResponse.next();
  const token = req.cookies.get(COOKIE)?.value;
  if (token && token === (await sessionToken())) return NextResponse.next();
  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.searchParams.set("next", pathname);
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|sw.js).*)"],
};
