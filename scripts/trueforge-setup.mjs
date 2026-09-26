/**
 * One-time, idempotent TrueForge bootstrap for local mode.
 *
 * Waits for the local TrueForge server, then — only if nothing is configured
 * yet — registers a Google Gemini model provider using GEMINI_API_KEY from
 * .env.local. The key stays on this machine (TrueForge's local SQLite).
 * MCP servers and the Daytona sandbox are configured in the TrueForge UI.
 *
 * Usage: node scripts/trueforge-setup.mjs
 */
import fs from "node:fs";
import path from "node:path";

function loadEnv() {
  const env = {};
  for (const file of [".env", ".env.local"]) {
    const p = path.resolve(process.cwd(), file);
    if (!fs.existsSync(p)) continue;
    for (const line of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  }
  return { ...env, ...process.env };
}

const env = loadEnv();
const BASE = (env.TRUEFORGE_SERVER_URL || "http://localhost:8790").replace(/\/$/, "");
const API = `${BASE}/api/v1`;

async function api(pathname, init) {
  const res = await fetch(`${API}${pathname}`, {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });
  const text = await res.text();
  let body;
  try { body = JSON.parse(text); } catch { body = text; }
  return { ok: res.ok, status: res.status, body };
}

async function waitForServer(timeoutMs = 120_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${API}/settings/model-providers`, { signal: AbortSignal.timeout(2000) });
      if (res.ok) return true;
    } catch {}
    await new Promise((r) => setTimeout(r, 1500));
  }
  return false;
}

console.log(`[trueforge-setup] waiting for TrueForge at ${BASE} ...`);
if (!(await waitForServer())) {
  console.error("[trueforge-setup] TrueForge did not come up. Check its window for errors.");
  process.exit(1);
}

const providers = await api("/settings/model-providers");
if (Array.isArray(providers.body?.data) && providers.body.data.length > 0) {
  console.log(`[trueforge-setup] model provider already configured: ${providers.body.data.map((p) => p.name ?? p.manifest?.type).join(", ")}`);
} else if (!env.GEMINI_API_KEY) {
  console.warn("[trueforge-setup] no model provider and no GEMINI_API_KEY — add one in the TrueForge UI (Settings → Models).");
} else {
  const catalog = await api("/catalogs/model-providers");
  const gemini = catalog.body?.data?.find((p) => p.type === "google-gemini");
  if (!gemini) {
    console.error("[trueforge-setup] google-gemini not in TrueForge catalog; configure a provider in the UI.");
  } else {
    const res = await api("/settings/model-providers", {
      method: "POST",
      body: JSON.stringify({
        manifest: { type: "google-gemini", auth: { api_key: env.GEMINI_API_KEY }, models: gemini.models },
      }),
    });
    if (res.ok) console.log(`[trueforge-setup] registered Gemini provider (${gemini.models.map((m) => m.name).join(", ")})`);
    else console.error(`[trueforge-setup] failed to register Gemini provider: ${res.status} ${JSON.stringify(res.body)}`);
  }
}

// The crew's real systems: the local ops MCP servers (scripts/ops-mcp.mjs).
const OPS = (env.OPS_MCP_URL || "http://localhost:8791").replace(/\/$/, "");
let opsUp = false;
for (let i = 0; i < 40 && !opsUp; i++) {
  opsUp = await fetch(`${OPS}/health`, { signal: AbortSignal.timeout(2000) }).then((r) => r.ok).catch(() => false);
  if (!opsUp) await new Promise((r) => setTimeout(r, 1500));
}
if (!opsUp) {
  console.warn(`[trueforge-setup] ops MCP servers not reachable at ${OPS} — start them with \`npm run services\`.`);
} else {
  for (const [name, desc] of [
    ["git", "demo-app git repository: open pull requests, diffs, checks, merges"],
    ["deploy", "demo-app CI/CD: pipeline runs, staged releases, production deploys and rollbacks"],
    ["server", "demo-app production server: status, logs, processes, restarts"],
  ]) {
    const res = await api("/settings/mcp-servers", {
      method: "PUT",
      body: JSON.stringify({
        manifest: { type: "remote", name: `threshold-${name}`, url: `${OPS}/${name}/mcp`, description: desc },
      }),
    });
    if (!res.ok) {
      console.error(`[trueforge-setup] could not register threshold-${name}: ${JSON.stringify(res.body)}`);
      if (/Outbound URL blocked/.test(JSON.stringify(res.body))) {
        console.error('[trueforge-setup] start TrueForge via `npm run services` (it sets OUTBOUND_URL_ALLOWED_HOSTS=["localhost"]).');
      }
    }
  }
}

const models = await api("/models");
console.log(`[trueforge-setup] models available: ${(models.body?.data ?? []).map((m) => m.name ?? m.id).join(", ") || "none"}`);
const mcp = await api("/mcp-servers");
const mcpNames = (mcp.body?.data ?? []).map((s) => s.name);
console.log(`[trueforge-setup] MCP servers: ${mcpNames.join(", ") || "none (add one in the TrueForge UI → Connectors)"}`);
const sandbox = await api("/settings/sandbox-providers");
console.log(`[trueforge-setup] sandbox: ${sandbox.ok ? "configured" : "not configured (add Daytona in the TrueForge UI → Sandbox for code execution)"}`);
