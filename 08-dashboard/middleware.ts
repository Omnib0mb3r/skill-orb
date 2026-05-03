import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * Cheap presence-only auth gate.
 *
 * Real signature verification happens in the daemon on every API call. The
 * middleware just keeps unauthenticated browsers off the dashboard pages so
 * they don't stare at a half-rendered shell.
 *
 * Daemon paths (rewritten in next.config) are not gated here — the daemon
 * will respond 401 itself if the cookie is missing or invalid. The pages we
 * gate are app routes only.
 */
export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // unlock + set-pin are always reachable (they're how you get a cookie)
  if (
    pathname.startsWith("/unlock") ||
    pathname.startsWith("/set-pin") ||
    pathname.startsWith("/_next") ||
    pathname.startsWith("/static") ||
    pathname === "/manifest.json" ||
    pathname === "/favicon.ico"
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
