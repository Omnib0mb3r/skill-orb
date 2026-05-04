import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * Cheap presence-only auth gate for PAGE routes.
 *
 * Real signature verification happens in the daemon on every API call. The
 * middleware just keeps unauthenticated browsers off the dashboard pages so
 * they don't stare at a half-rendered shell.
 *
 * Daemon-proxied paths (defined as DAEMON_PATHS in next.config.mjs) are
 * NOT gated here. The daemon's authMiddleware does its own check on every
 * request. If we gated /auth/* in middleware too, the unlock and set-pin
 * forms could never reach the daemon to obtain a cookie in the first place.
 */
const DAEMON_PROXY_PREFIXES = [
  "/auth",
  "/dashboard",
  "/sessions",
  "/services",
  "/projects",
  "/reference",
  "/reminders",
  "/notifications",
  "/push",
  "/search",
  "/upload",
  "/graph",
];

function isProxyPath(pathname: string): boolean {
  return DAEMON_PROXY_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(p + "/"),
  );
}

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // unlock + set-pin are always reachable, plus daemon-proxied API paths
  if (
    pathname.startsWith("/unlock") ||
    pathname.startsWith("/set-pin") ||
    pathname.startsWith("/_next") ||
    pathname.startsWith("/static") ||
    pathname === "/manifest.json" ||
    pathname === "/favicon.ico" ||
    isProxyPath(pathname)
  ) {
    return NextResponse.next();
  }

  const cookie = req.cookies.get("dn_session");
  if (!cookie) {
    const url = req.nextUrl.clone();
    url.pathname = "/unlock";
    url.searchParams.set("from", pathname);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: [
    // gate every page route, but skip files with extensions and Next internals
    "/((?!_next/|static/|api/|favicon\\.ico|manifest\\.json|.*\\.[a-zA-Z0-9]+$).*)",
  ],
};
