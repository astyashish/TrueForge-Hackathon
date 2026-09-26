import { type NextRequest, NextResponse } from "next/server";
import { isHostRequest, viewerMayAccess } from "@/lib/access";

/**
 * No login. The host (requests to localhost from this machine) can do
 * everything; anyone else — a LAN visitor or someone opening a shared tunnel
 * link — is a read-only viewer of a specific game (lib/access.ts).
 */
export async function proxy(request: NextRequest) {
  if (isHostRequest(request.headers)) return NextResponse.next({ request });

  const { pathname } = request.nextUrl;
  if (viewerMayAccess(request.method, pathname)) return NextResponse.next({ request });

  if (pathname.startsWith("/api/")) {
    return NextResponse.json(
      { error: "This is a shared, read-only view. Only the host can do that." },
      { status: 403 }
    );
  }
  // Pages other than a shared world: explain instead of a bare error.
  return NextResponse.rewrite(new URL("/shared", request.url));
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
