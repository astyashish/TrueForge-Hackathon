/**
 * Share Threshold beyond this machine with a Cloudflare quick tunnel.
 *
 * Builds the app and serves the production build on :3100 for visitors (the
 * dev server on :3000 blocks unknown origins and is too slow over a tunnel),
 * then tunnels ONLY that port. TrueForge (:8790) and the ops
 * MCP servers (:8791) stay on localhost; visitors reach a read-only Watch view
 * enforced server-side (lib/access.ts + proxy.ts).
 *
 * Writes the public https URL to .threshold/public-url (the Share popover
 * reads it) and removes it when the tunnel stops. Quick tunnels get a new
 * random URL on every start.
 *
 * Usage: node scripts/tunnel.mjs [--no-build]   (or share.bat / npm run share)
 */
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const PORT = Number(process.env.SHARE_PORT || 3100);
const NEXT_BIN = path.join(process.cwd(), "node_modules", "next", "dist", "bin", "next");
const URL_FILE = path.join(process.cwd(), ".threshold", "public-url");

function findCloudflared() {
  const candidates = [
    process.env.CLOUDFLARED,
    "cloudflared",
    "C:\\Program Files (x86)\\cloudflared\\cloudflared.exe",
    "C:\\Program Files\\cloudflared\\cloudflared.exe",
    path.join(process.env.LOCALAPPDATA ?? "", "Microsoft", "WinGet", "Links", "cloudflared.exe"),
  ].filter(Boolean);
  for (const c of candidates) {
    const r = spawnSync(c, ["--version"], { encoding: "utf8" });
    if (r.status === 0) return c;
  }
  return null;
}

const bin = findCloudflared();
if (!bin) {
  console.error(
    "cloudflared is not installed.\n" +
      "  Windows: winget install --id Cloudflare.cloudflared\n" +
      "  macOS:   brew install cloudflared\n" +
      "Then run this again."
  );
  process.exit(1);
}

const ping = () =>
  fetch(`http://localhost:${PORT}/shared`, { signal: AbortSignal.timeout(3000) }).then(
    (r) => r.ok,
    () => false
  );

let server = null;
if (!(await ping())) {
  if (!process.argv.includes("--no-build")) {
    console.log("Building the production app for visitors (takes a minute)…");
    const b = spawnSync(process.execPath, [NEXT_BIN, "build"], { stdio: "inherit" });
    if (b.status !== 0) {
      console.error("Build failed — see above.");
      process.exit(1);
    }
  }
  console.log(`Serving it on http://localhost:${PORT} …`);
  server = spawn(process.execPath, [NEXT_BIN, "start", "-p", String(PORT)], { stdio: "inherit" });
  for (let i = 0; i < 60 && !(await ping()); i++) await new Promise((r) => setTimeout(r, 1000));
  if (!(await ping())) {
    console.error("The production server did not start.");
    server.kill();
    process.exit(1);
  }
}

const clear = () => {
  try {
    fs.rmSync(URL_FILE, { force: true });
  } catch {}
};
clear();

console.log(`Starting a Cloudflare quick tunnel to http://localhost:${PORT} …`);
const child = spawn(bin, ["tunnel", "--no-autoupdate", "--url", `http://localhost:${PORT}`], {
  stdio: ["ignore", "pipe", "pipe"],
});

let announced = false;
const onData = (buf) => {
  const text = String(buf);
  const m = text.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
  if (m && !announced) {
    announced = true;
    fs.mkdirSync(path.dirname(URL_FILE), { recursive: true });
    fs.writeFileSync(URL_FILE, m[0]);
    console.log("\n  Public URL: " + m[0]);
    console.log("  Open a world in Threshold and click Share (top-right) to copy its link.");
    console.log("  Visitors get a read-only Watch view. Keep this window open; Ctrl+C stops sharing.\n");
  }
  if (/ERR|error/i.test(text) && !/INF/.test(text)) process.stderr.write(text);
};
child.stdout.on("data", onData);
child.stderr.on("data", onData);

const stop = () => {
  clear();
  child.kill();
  server?.kill();
  process.exit(0);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
child.on("exit", (code) => {
  clear();
  server?.kill();
  console.log(`tunnel stopped (${code})`);
  process.exit(code ?? 0);
});
