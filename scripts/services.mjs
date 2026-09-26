/**
 * Runs Threshold's backing services in one window:
 *   - TrueForge (local mode, :8790), allowed to reach MCP servers on localhost
 *   - the ops MCP servers + live demo service (scripts/ops-mcp.mjs, :8791 / :4100)
 *
 * Ctrl+C stops both. Usage: node scripts/services.mjs [--reset]
 */
import { spawn } from "node:child_process";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const trueforgeCli = path.join(
  path.dirname(require.resolve("@truefoundry/trueforge/package.json")),
  "dist",
  "cli.js"
);

const children = [];

function run(name, color, args, env = {}) {
  const child = spawn(process.execPath, args, {
    env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const prefix = `\x1b[${color}m[${name}]\x1b[0m `;
  const pipe = (stream, out) => {
    let buf = "";
    stream.on("data", (d) => {
      buf += d;
      const lines = buf.split(/\r?\n/);
      buf = lines.pop() ?? "";
      for (const line of lines) out.write(prefix + line + "\n");
    });
  };
  pipe(child.stdout, process.stdout);
  pipe(child.stderr, process.stderr);
  child.on("exit", (code) => {
    console.log(`${prefix}exited (${code})`);
    shutdown(code ?? 1);
  });
  children.push(child);
}

let stopping = false;
function shutdown(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const c of children) c.kill();
  setTimeout(() => process.exit(code), 1500);
}
process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

run("trueforge", "36", [trueforgeCli], {
  // Let agents reach the local ops MCP servers (TrueForge blocks private hosts by default).
  OUTBOUND_URL_ALLOWED_HOSTS: JSON.stringify(["localhost"]),
});
run("ops-mcp", "35", ["scripts/ops-mcp.mjs", ...process.argv.slice(2)]);
