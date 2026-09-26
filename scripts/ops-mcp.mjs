/**
 * Threshold ops MCP servers — the real systems the crew works on.
 *
 * One process, three remote MCP endpoints (registered in TrueForge by
 * scripts/trueforge-setup.mjs):
 *   http://localhost:8791/git/mcp     → threshold-git     (Git Warden)
 *   http://localhost:8791/deploy/mcp  → threshold-deploy  (Deploy Runner)
 *   http://localhost:8791/server/mcp  → threshold-server  (Server Sentinel)
 *
 * Everything runs for real inside a local workspace (.threshold/workspace):
 * a git repository with open feature branches ("pull requests"), a build +
 * test pipeline that produces numbered releases, and a live demo web service
 * on http://localhost:4100 that deploys restart. Every tool returns the exact
 * commands it ran and their output, which is what the Live Ops Terminal shows.
 *
 * No arbitrary shell: each tool runs a fixed, scoped set of commands.
 *
 * Usage: node scripts/ops-mcp.mjs [--reset] [--exit]
 *   --reset  wipe the workspace and re-seed it (fresh repo, release #1)
 *   --exit   seed if needed, then exit without serving (npm run ops:reset)
 */
import http from "node:http";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";

const MCP_PORT = Number(process.env.OPS_MCP_PORT || 8791);
const APP_PORT = Number(process.env.DEMO_APP_PORT || 4100);
const ROOT = path.resolve(process.cwd(), ".threshold", "workspace");
const REPO = path.join(ROOT, "demo-app");
const RELEASES = path.join(ROOT, "releases");
const CHECKS = path.join(ROOT, "checks");
const LOG_FILE = path.join(ROOT, "logs", "demo-app.log");
const STATE_FILE = path.join(ROOT, "state.json");

const log = (...a) => console.log("[ops-mcp]", ...a);

// ---------------------------------------------------------------------------
// Command runner — every call is recorded into a transcript
// ---------------------------------------------------------------------------

function quote(a) {
  return /[\s"']/.test(a) ? `"${a.replace(/"/g, '\\"')}"` : a;
}

class Transcript {
  lines = [];
  add(text) {
    this.lines.push(text);
  }
  async run(cmd, args, { cwd = REPO, allowFail = true } = {}) {
    const shown = [cmd === process.execPath ? "node" : cmd, ...args].map(quote).join(" ");
    const res = await exec(cmd, args, cwd);
    this.lines.push(`$ ${shown}`);
    const out = (res.stdout + res.stderr).replace(/\s+$/, "");
    if (out) this.lines.push(out.length > 6000 ? `${out.slice(0, 6000)}\n… (truncated)` : out);
    if (res.code !== 0) this.lines.push(`[exit ${res.code}]`);
    if (res.code !== 0 && !allowFail) throw new StepError(this, `${shown} failed (exit ${res.code})`);
    return res;
  }
  text() {
    return this.lines.join("\n");
  }
}

class StepError extends Error {
  constructor(transcript, message) {
    super(message);
    this.transcript = transcript;
  }
}

function exec(cmd, args, cwd) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { cwd, windowsHide: true, env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("error", (err) => resolve({ code: -1, stdout, stderr: stderr + String(err) }));
    child.on("close", (code) => resolve({ code: code ?? -1, stdout, stderr }));
  });
}

const git = (t, ...args) => t.run("git", args);

// One operation at a time — git and deploys must not interleave.
let queue = Promise.resolve();
function serial(fn) {
  const next = queue.then(fn, fn);
  queue = next.catch(() => {});
  return next;
}

// ---------------------------------------------------------------------------
// Workspace state
// ---------------------------------------------------------------------------

function readState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
  } catch {
    return { releases: [], current: null, previous: null };
  }
}
function writeState(s) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(s, null, 2));
}

const DEMO_FILES = {
  "package.json": JSON.stringify({ name: "demo-app", version: "1.0.0", private: true, main: "server.js" }, null, 2) + "\n",
  "lib.js": `// Pricing + health helpers for demo-app.
function applyDiscount(price, pct) {
  return Math.round(price * (1 - pct / 100) * 100) / 100;
}

function healthPayload(startedAt) {
  return { status: "ok", version: require("./package.json").version };
}

module.exports = { applyDiscount, healthPayload };
`,
  "test.js": `const assert = require("node:assert");
const { applyDiscount, healthPayload } = require("./lib");

const tests = {
  "applyDiscount(100, 10) === 90": () => assert.strictEqual(applyDiscount(100, 10), 90),
  "applyDiscount(80, 25) === 60": () => assert.strictEqual(applyDiscount(80, 25), 60),
  "repeat calls are stable": () => {
    applyDiscount(50, 50);
    assert.strictEqual(applyDiscount(50, 50), 25);
  },
  "healthPayload reports ok": () => assert.strictEqual(healthPayload(Date.now()).status, "ok"),
};

let failed = 0;
for (const [name, fn] of Object.entries(tests)) {
  try {
    fn();
    console.log("  ok   " + name);
  } catch (err) {
    failed++;
    console.log("  FAIL " + name + " — " + err.message.split("\\n")[0]);
  }
}
console.log(failed ? failed + " test(s) failed" : "all tests passed");
process.exit(failed ? 1 : 0);
`,
  "server.js": `const http = require("node:http");
const { applyDiscount, healthPayload } = require("./lib");
const { version } = require("./package.json");

const port = Number(process.env.PORT || 4100);
const startedAt = Date.now();

http
  .createServer((req, res) => {
    const t = Date.now();
    let status = 200;
    let body;
    try {
      if (req.url === "/health") {
        body = JSON.stringify(healthPayload(startedAt));
      } else if (req.url && req.url.startsWith("/price")) {
        body = JSON.stringify({ price: applyDiscount(100, 10) });
      } else {
        body = "demo-app v" + version + "\\n";
      }
    } catch (err) {
      status = 500;
      body = JSON.stringify({ error: err.message });
      console.error(new Date().toISOString() + " ERROR " + req.url + " " + err.stack.split("\\n")[0]);
    }
    res.writeHead(status, { "content-type": status === 200 && req.url !== "/" ? "application/json" : "text/plain" });
    res.end(body);
    console.log(new Date().toISOString() + " " + req.method + " " + req.url + " " + status + " " + (Date.now() - t) + "ms");
  })
  .listen(port, () => console.log(new Date().toISOString() + " demo-app v" + version + " listening on :" + port));
`,
};

async function seedWorkspace() {
  if (fs.existsSync(path.join(REPO, ".git"))) return;
  log("seeding workspace at", ROOT);
  await fsp.mkdir(REPO, { recursive: true });
  await fsp.mkdir(path.dirname(LOG_FILE), { recursive: true });
  const t = new Transcript();
  const write = (f, c) => fsp.writeFile(path.join(REPO, f), c);
  await git(t, "init", "-q", "-b", "main");
  await git(t, "config", "user.name", "Threshold Ops");
  await git(t, "config", "user.email", "ops@threshold.local");
  await git(t, "config", "core.autocrlf", "false");
  for (const [f, c] of Object.entries(DEMO_FILES)) await write(f, c);
  await git(t, "add", "-A");
  await git(t, "commit", "-q", "-m", "demo-app v1.0.0");

  // PR 1 — clean: adds uptime to /health.
  await git(t, "checkout", "-q", "-b", "feature/health-uptime");
  await write("lib.js", DEMO_FILES["lib.js"].replace(
    `return { status: "ok", version: require("./package.json").version };`,
    `return {\n    status: "ok",\n    version: require("./package.json").version,\n    uptimeSec: Math.round((Date.now() - startedAt) / 1000),\n  };`
  ));
  await write("package.json", DEMO_FILES["package.json"].replace('"1.0.0"', '"1.1.0"'));
  await git(t, "commit", "-q", "-am", "Report uptime on /health (v1.1.0)");
  await git(t, "checkout", "-q", "main");

  // PR 2 — broken: a "faster" memo cache that returns stale prices and
  // crashes /health (reads .entries on a plain object).
  await git(t, "checkout", "-q", "-b", "feature/discount-cache");
  await write("lib.js", `// Pricing + health helpers for demo-app.
const cache = {};

// 2x faster: memoize discounts by price.
function applyDiscount(price, pct) {
  if (cache[price] !== undefined) return cache[price];
  const value = Math.round(price * (1 - pct / 100) * 100) / 100;
  cache[price] = value;
  return value;
}

function healthPayload(startedAt) {
  return {
    status: "ok",
    version: require("./package.json").version,
    cachedPrices: cache.entries.length,
  };
}

module.exports = { applyDiscount, healthPayload };
`);
  await write("package.json", DEMO_FILES["package.json"].replace('"1.0.0"', '"1.2.0"'));
  await git(t, "commit", "-q", "-am", "Speed up discounts with a memo cache (2x faster) (v1.2.0)");
  await git(t, "checkout", "-q", "main");

  // Release #1 from main, live.
  const build = await buildRelease(new Transcript());
  const state = readState();
  state.current = build.release.n;
  writeState(state);
  log("seeded; release #1 built");
}

async function exportCommit(t, sha, dir) {
  const files = await git(t, "ls-tree", "-r", "--name-only", sha);
  await fsp.mkdir(dir, { recursive: true });
  const names = files.stdout.split(/\r?\n/).filter(Boolean);
  for (const name of names) {
    const content = await exec("git", ["show", `${sha}:${name}`], REPO);
    await fsp.mkdir(path.dirname(path.join(dir, name)), { recursive: true });
    await fsp.writeFile(path.join(dir, name), content.stdout);
  }
  t.add(`exported ${names.length} files from ${sha} → ${path.relative(ROOT, dir)}`);
}

/** Build + test main HEAD into a new numbered release (not live). */
async function buildRelease(t) {
  const head = (await git(t, "rev-parse", "--short", "main")).stdout.trim();
  const subject = (await git(t, "log", "-1", "--format=%s", "main")).stdout.trim();
  const state = readState();
  const n = (state.releases.at(-1)?.n ?? 0) + 1;
  const dir = path.join(RELEASES, String(n));
  await exportCommit(t, head, dir);
  const test = await t.run(process.execPath, ["test.js"], { cwd: dir });
  const version = JSON.parse(await fsp.readFile(path.join(dir, "package.json"), "utf8")).version;
  const release = { n, commit: head, subject, version, testsPassed: test.code === 0, createdAt: new Date().toISOString() };
  await fsp.writeFile(path.join(dir, "build-info.json"), JSON.stringify(release, null, 2));
  state.releases.push(release);
  writeState(state);
  t.add(
    release.testsPassed
      ? `release #${n} (v${version}, ${head}) built and staged — not live yet`
      : `release #${n} (v${version}, ${head}) FAILED tests — not deployable`
  );
  return { release };
}

// ---------------------------------------------------------------------------
// The live demo service
// ---------------------------------------------------------------------------

let app = null; // { child, pid, release, startedAt }

function appendLog(line) {
  fs.appendFileSync(LOG_FILE, line.endsWith("\n") ? line : line + "\n");
}

async function startApp(releaseN) {
  const dir = path.join(RELEASES, String(releaseN));
  const child = spawn(process.execPath, ["server.js"], {
    cwd: dir,
    env: { ...process.env, PORT: String(APP_PORT) },
    windowsHide: true,
  });
  app = { child, pid: child.pid, release: releaseN, startedAt: Date.now() };
  child.stdout.on("data", (d) => appendLog(String(d).trimEnd()));
  child.stderr.on("data", (d) => appendLog(String(d).trimEnd()));
  child.on("exit", (code, signal) => {
    appendLog(`${new Date().toISOString()} [supervisor] demo-app pid ${child.pid} exited (${signal ?? code})`);
    if (app?.child === child) app = null;
  });
  // Wait for it to listen.
  for (let i = 0; i < 20; i++) {
    await new Promise((r) => setTimeout(r, 150));
    if (await probe()) break;
  }
}

function stopApp() {
  return new Promise((resolve) => {
    if (!app) return resolve(false);
    const { child } = app;
    child.once("exit", () => resolve(true));
    child.kill();
    setTimeout(() => resolve(true), 3000);
  });
}

async function probe() {
  try {
    const res = await fetch(`http://localhost:${APP_PORT}/health`, { signal: AbortSignal.timeout(2000) });
    return { status: res.status, body: (await res.text()).slice(0, 300) };
  } catch (err) {
    return null;
  }
}

async function tailLog(n) {
  try {
    const lines = (await fsp.readFile(LOG_FILE, "utf8")).split(/\r?\n/).filter(Boolean);
    return lines.slice(-n);
  } catch {
    return [];
  }
}

// Load-balancer style health check every 15s, so the logs reflect reality.
setInterval(async () => {
  if (!app) return;
  const p = await probe();
  appendLog(`${new Date().toISOString()} [lb-health] ${p ? p.status : "unreachable"}`);
}, 15_000).unref();

// ---------------------------------------------------------------------------
// Tool helpers
// ---------------------------------------------------------------------------

const text = (s) => ({ content: [{ type: "text", text: s }] });

function tool(fn) {
  return (args) =>
    serial(async () => {
      const t = new Transcript();
      try {
        await fn(t, args ?? {});
        return text(t.text());
      } catch (err) {
        if (err instanceof StepError) return { ...text(`${t.text()}\n\n${err.message}`), isError: true };
        return { ...text(`${t.text()}\n\nerror: ${err.message}`), isError: true };
      }
    });
}

async function openBranches(t) {
  const out = await git(t, "for-each-ref", "--format=%(refname:short)", "refs/heads/feature");
  return out.stdout.split(/\r?\n/).filter(Boolean);
}

async function assertBranch(t, branch) {
  const branches = await openBranches(t);
  if (!branches.includes(branch)) {
    throw new StepError(t, `no open pull request for "${branch}" (open: ${branches.join(", ") || "none"})`);
  }
}

// ---------------------------------------------------------------------------
// threshold-git — Git Warden
// ---------------------------------------------------------------------------

function registerGit(server) {
  server.registerTool(
    "list_pull_requests",
    {
      description: "List open pull requests (feature branches not yet merged into main) in the demo-app repository.",
      annotations: { readOnlyHint: true },
    },
    tool(async (t) => {
      await git(t, "log", "--oneline", "-3", "main");
      const branches = await openBranches(t);
      if (branches.length === 0) t.add("no open pull requests");
      for (const b of branches) {
        await git(t, "log", "--oneline", `main..${b}`);
      }
    })
  );
  server.registerTool(
    "view_pull_request",
    {
      description: "Show a pull request's commits and full diff against main.",
      inputSchema: { branch: z.string().describe("Feature branch, e.g. feature/health-uptime") },
      annotations: { readOnlyHint: true },
    },
    tool(async (t, { branch }) => {
      await assertBranch(t, branch);
      await git(t, "log", "--format=%h %an %s", `main..${branch}`);
      await git(t, "diff", "--stat", `main...${branch}`);
      await git(t, "diff", `main...${branch}`);
    })
  );
  server.registerTool(
    "run_checks",
    {
      description: "Check out a pull request into a scratch worktree and run its test suite (node test.js). Reports pass/fail with the real output.",
      inputSchema: { branch: z.string() },
      annotations: { readOnlyHint: true },
    },
    tool(async (t, { branch }) => {
      await assertBranch(t, branch);
      const dir = path.join(CHECKS, branch.replace(/[^\w.-]+/g, "_"));
      if (fs.existsSync(dir)) {
        await fsp.rm(dir, { recursive: true, force: true });
        await exec("git", ["worktree", "prune"], REPO);
      }
      await git(t, "worktree", "add", "--detach", dir, branch);
      const res = await t.run(process.execPath, ["test.js"], { cwd: dir });
      await git(t, "worktree", "remove", "--force", dir);
      t.add(res.code === 0 ? `CHECKS PASSED for ${branch}` : `CHECKS FAILED for ${branch}`);
    })
  );
  server.registerTool(
    "merge_pull_request",
    {
      description: "Merge a pull request into main (git merge --no-ff) and delete the branch. Changes main permanently.",
      inputSchema: { branch: z.string() },
      annotations: { readOnlyHint: false, destructiveHint: true },
    },
    tool(async (t, { branch }) => {
      await assertBranch(t, branch);
      await git(t, "checkout", "-q", "main");
      const res = await git(t, "merge", "--no-ff", "-m", `Merge pull request ${branch}`, branch);
      if (res.code !== 0) {
        await git(t, "merge", "--abort");
        throw new StepError(t, `merge of ${branch} failed`);
      }
      await git(t, "branch", "-d", branch);
      await git(t, "log", "--oneline", "-3", "main");
    })
  );
}

// ---------------------------------------------------------------------------
// threshold-deploy — Deploy Runner
// ---------------------------------------------------------------------------

async function deployStatus(t) {
  const state = readState();
  const live = state.releases.find((r) => r.n === state.current);
  await git(t, "log", "--oneline", "-3", "main");
  t.add(
    live
      ? `live: release #${live.n} v${live.version} (${live.commit}) "${live.subject}"`
      : "live: nothing deployed"
  );
  const staged = state.releases.filter((r) => r.n > (state.current ?? 0));
  for (const r of staged) {
    t.add(`staged: release #${r.n} v${r.version} (${r.commit}) tests ${r.testsPassed ? "passed" : "FAILED"}`);
  }
  const p = await probe();
  t.add(`$ GET http://localhost:${APP_PORT}/health\n${p ? `${p.status} ${p.body}` : "unreachable"}`);
}

function registerDeploy(server) {
  server.registerTool(
    "get_deploy_status",
    {
      description: "Show what is live in production, which releases are staged, and the live health check.",
      annotations: { readOnlyHint: true },
    },
    tool(deployStatus)
  );
  server.registerTool(
    "run_pipeline",
    {
      description: "Run the CI/CD pipeline on main HEAD: export the commit, run the test suite, and stage a numbered release. Does not touch production.",
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    tool(async (t) => {
      await buildRelease(t);
    })
  );
  server.registerTool(
    "deploy_production",
    {
      description: "Deploy a staged release to production: stop the live service, switch to the release, start it and health-check it. Defaults to the newest release that passed tests.",
      inputSchema: { release: z.number().int().optional().describe("Release number; defaults to newest passing") },
      annotations: { readOnlyHint: false, destructiveHint: true },
    },
    tool(async (t, { release }) => {
      const state = readState();
      const target = release
        ? state.releases.find((r) => r.n === release)
        : [...state.releases].reverse().find((r) => r.testsPassed && r.n !== state.current);
      if (!target) throw new StepError(t, "no deployable release — run the pipeline first");
      if (!target.testsPassed) t.add(`WARNING: release #${target.n} failed its tests`);
      t.add(`stopping pid ${app?.pid ?? "-"} (release #${state.current ?? "-"})`);
      await stopApp();
      state.previous = state.current;
      state.current = target.n;
      writeState(state);
      await startApp(target.n);
      t.add(`started release #${target.n} v${target.version} as pid ${app?.pid ?? "?"}`);
      const p = await probe();
      t.add(`$ GET http://localhost:${APP_PORT}/health\n${p ? `${p.status} ${p.body}` : "unreachable"}`);
      if (!p || p.status !== 200) t.add("DEPLOY UNHEALTHY — consider rollback");
    })
  );
  server.registerTool(
    "rollback",
    {
      description: "Roll production back to the previously live release and restart the service.",
      annotations: { readOnlyHint: false, destructiveHint: true },
    },
    tool(async (t) => {
      const state = readState();
      if (!state.previous) throw new StepError(t, "no previous release to roll back to");
      t.add(`rolling back #${state.current} → #${state.previous}`);
      await stopApp();
      [state.current, state.previous] = [state.previous, state.current];
      writeState(state);
      await startApp(state.current);
      const p = await probe();
      t.add(`$ GET http://localhost:${APP_PORT}/health\n${p ? `${p.status} ${p.body}` : "unreachable"}`);
    })
  );
}

// ---------------------------------------------------------------------------
// threshold-server — Server Sentinel
// ---------------------------------------------------------------------------

function registerServer(server) {
  server.registerTool(
    "server_status",
    {
      description: "Live status of the production web service: process, release, uptime, a real /health request and recent error counts.",
      annotations: { readOnlyHint: true },
    },
    tool(async (t) => {
      const state = readState();
      const live = state.releases.find((r) => r.n === state.current);
      t.add(
        app
          ? `process: demo-app pid ${app.pid}, up ${Math.round((Date.now() - app.startedAt) / 1000)}s, release #${app.release} v${live?.version ?? "?"}`
          : "process: NOT RUNNING"
      );
      const p = await probe();
      t.add(`$ GET http://localhost:${APP_PORT}/health\n${p ? `${p.status} ${p.body}` : "unreachable"}`);
      const recent = await tailLog(200);
      const errors = recent.filter((l) => / 500 |ERROR|unreachable/.test(l)).length;
      t.add(`last ${recent.length} log lines: ${errors} error(s)`);
    })
  );
  server.registerTool(
    "tail_logs",
    {
      description: "Tail the production service log.",
      inputSchema: { lines: z.number().int().min(1).max(200).optional() },
      annotations: { readOnlyHint: true },
    },
    tool(async (t, { lines = 30 }) => {
      t.add(`$ tail -n ${lines} logs/demo-app.log`);
      t.add((await tailLog(lines)).join("\n") || "(empty)");
    })
  );
  server.registerTool(
    "list_processes",
    {
      description: "Show the OS process table entry for the production service.",
      annotations: { readOnlyHint: true },
    },
    tool(async (t) => {
      if (!app) return t.add("demo-app is not running");
      if (process.platform === "win32") {
        await t.run("tasklist", ["/FI", `PID eq ${app.pid}`, "/FO", "LIST"], { cwd: ROOT });
      } else {
        await t.run("ps", ["-o", "pid,rss,etime,args", "-p", String(app.pid)], { cwd: ROOT });
      }
    })
  );
  server.registerTool(
    "restart_service",
    {
      description: "Restart the production web service on its current release. Drops in-flight requests.",
      annotations: { readOnlyHint: false, destructiveHint: true },
    },
    tool(async (t) => {
      const state = readState();
      t.add(`stopping pid ${app?.pid ?? "-"}`);
      await stopApp();
      await startApp(state.current);
      t.add(`started pid ${app?.pid ?? "?"} on release #${state.current}`);
      const p = await probe();
      t.add(`$ GET http://localhost:${APP_PORT}/health\n${p ? `${p.status} ${p.body}` : "unreachable"}`);
    })
  );
  server.registerTool(
    "stop_service",
    {
      description: "Stop the production web service. The site goes down until restarted.",
      annotations: { readOnlyHint: false, destructiveHint: true },
    },
    tool(async (t) => {
      const pid = app?.pid;
      const stopped = await stopApp();
      t.add(stopped ? `stopped demo-app pid ${pid}` : "demo-app was not running");
    })
  );
}

// ---------------------------------------------------------------------------
// HTTP / MCP plumbing (stateless streamable HTTP)
// ---------------------------------------------------------------------------

const ENDPOINTS = {
  "/git/mcp": { name: "threshold-git", register: registerGit },
  "/deploy/mcp": { name: "threshold-deploy", register: registerDeploy },
  "/server/mcp": { name: "threshold-server", register: registerServer },
};

async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : undefined;
}

const httpServer = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://localhost:${MCP_PORT}`);
  if (url.pathname === "/health") {
    res.writeHead(200, { "content-type": "application/json" });
    return res.end(JSON.stringify({ ok: true, app: Boolean(app), endpoints: Object.keys(ENDPOINTS) }));
  }
  const ep = ENDPOINTS[url.pathname];
  if (!ep) {
    res.writeHead(404).end("not found");
    return;
  }
  if (req.method !== "POST") {
    res.writeHead(405, { allow: "POST" }).end();
    return;
  }
  try {
    const body = await readBody(req);
    const server = new McpServer({ name: ep.name, version: "1.0.0" });
    ep.register(server);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on("close", () => {
      transport.close();
      server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, body);
  } catch (err) {
    log("request failed", err);
    if (!res.headersSent) res.writeHead(500).end(String(err));
  }
});

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

if (process.argv.includes("--reset")) {
  await fsp.rm(ROOT, { recursive: true, force: true });
  log("workspace reset");
}
await seedWorkspace();
if (process.argv.includes("--exit")) {
  log("workspace ready (fresh repo, release #1); exiting");
  process.exit(0);
}
const state = readState();
if (state.current) {
  if (await probe()) log(`port ${APP_PORT} already serving — not starting another demo-app`);
  else await startApp(state.current);
}
// Localhost only: these tools merge, deploy and restart — never expose them on the LAN.
httpServer.listen(MCP_PORT, "localhost", () => {
  log(`MCP endpoints on http://localhost:${MCP_PORT}{/git,/deploy,/server}/mcp`);
  log(`demo-app live on http://localhost:${APP_PORT} (release #${state.current})`);
});

const shutdown = async () => {
  await stopApp();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
