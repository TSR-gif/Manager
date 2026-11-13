import { NextResponse, type NextRequest } from "next/server";
import { checkToolToken, COOKIE, managerKey, sameText, sessionToken } from "@/lib/auth";

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (pathname === "/login" || pathname === "/manifest.webmanifest" || pathname.startsWith("/icon") || pathname.startsWith("/apple-icon") || pathname === "/offline.html") {
    return NextResponse.next();
  }
  if (!process.env.APP_PASSWORD) {
    return new NextResponse("APP_PASSWORD is not configured", { status: 500 });
  }
  // MyManager's own helpers send a header instead of the cookie (checked again in each route):
  // the phone bot and the 5-minute tick use the helper key; a Claude session only gets a pass for its own run's tools.
  if (["/api/bot", "/api/proactive", "/api/agent"].includes(pathname) && sameText(req.headers.get("x-manager-key"), await managerKey())) return NextResponse.next();
  if (pathname === "/api/agent/tool") {
    if (await checkToolToken(req.headers.get("x-manager-tool"))) return NextResponse.next();
    return new NextResponse("Unauthorized", { status: 401 });
  }
  const token = req.cookies.get(COOKIE)?.value;
  if (sameText(token, await sessionToken())) return NextResponse.next();
  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.searchParams.set("next", pathname);
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|sw.js).*)"],
};
