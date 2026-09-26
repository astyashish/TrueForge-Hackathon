/**
 * Host vs viewer.
 *
 * Threshold has no login. The host is whoever runs it: a request is the host
 * only when it is addressed to localhost, arrives from the loopback
 * interface, and carries no tunnel header. Everyone else — someone on the
 * LAN, or a visitor through a shared tunnel link — is a read-only viewer.
 *
 * A Cloudflare/ngrok tunnel delivers the tunnel's own domain as Host (plus
 * cf-connecting-ip / ngrok headers), so a visitor cannot pass as localhost.
 */

type HeaderBag = { get(name: string): string | null };

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);
const LOOPBACK = new Set(["::1", "127.0.0.1", "::ffff:127.0.0.1"]);
const TUNNEL_HEADERS = ["cf-connecting-ip", "cf-ray", "ngrok-trace-id", "x-forwarded-server"];

export function isHostRequest(headers: HeaderBag): boolean {
  const host = (headers.get("host") ?? "").replace(/:\d+$/, "").toLowerCase();
  if (!LOCAL_HOSTS.has(host)) return false;
  if (TUNNEL_HEADERS.some((h) => headers.get(h))) return false;
  // Next adds x-forwarded-for = the socket peer; any hop that isn't loopback is remote.
  const chain = (headers.get("x-forwarded-for") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return chain.every((ip) => LOOPBACK.has(ip));
}

/**
 * What a viewer may reach. Everything else is host-only: world generation
 * (spends model quota), agent turns/approvals (real tool calls), agent
 * creation, TrueForge itself, and the landing page.
 */
export function viewerMayAccess(method: string, pathname: string): boolean {
  if (method !== "GET" && method !== "HEAD") return false;
  return (
    /^\/play\/[0-9a-f-]{36}\/?$/i.test(pathname) || // the shared world
    /^\/api\/games\/[0-9a-f-]{36}$/i.test(pathname) || // its saved world data
    /^\/api\/watch\/[0-9a-f-]{36}\/(sessions|poll)$/i.test(pathname) || // read-only live mirror
    pathname === "/shared" ||
    pathname.startsWith("/_next/") ||
    pathname === "/favicon.ico"
  );
}
