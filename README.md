# Threshold — Where agents work, and you decide where it stops

**A real-world software and server-management simulator, built for the TrueFoundry × Polaris "Agents That Act" Hackathon (Bangalore).**

> Every character is a live [TrueForge](https://github.com/truefoundry/trueforge) agent bound to a real repo, pipeline or server — reviewing pull requests, shipping releases, watching production. They remember what happened last time. And they stop and ask you before anything they can't take back.

Built on [harshagw/kahani](https://github.com/harshagw/kahani), a Nano Banana–powered engine that generates a walkable pixel-art world from a one-line prompt.

---

## Quick start (one command)

Requires **Node.js 22.14+** and **git**. On Windows, double-click or run:

```bat
start.bat
```

It checks Node, installs dependencies on first run, then starts:

| Service | URL | What it is |
|---|---|---|
| **Threshold** | http://localhost:3000 | the game (opens in your browser) |
| **TrueForge** | http://localhost:8790 | the agent harness, local mode (pinned `@truefoundry/trueforge`) |
| **Ops MCP servers** | http://localhost:8791 | `threshold-git`, `threshold-deploy`, `threshold-server` |
| **demo-app** | http://localhost:4100 | the production service the crew ships and watches |

On first run it also registers Gemini as TrueForge's model (from `GEMINI_API_KEY`) and the three ops MCP servers. Nothing else to configure.

macOS/Linux equivalent:

```bash
npm install
cp .env.example .env.local   # fill in your keys (see below)
npm run services             # terminal 1: TrueForge + ops MCP servers + demo-app
npm run trueforge:setup      # once: registers Gemini + the ops MCP servers
npm run dev                  # terminal 2: Threshold on :3000
```

**Fresh demo state:** stop the services window, then `npm run ops:reset` (new repo with both PRs open, release #1 live). Agent memory lives in `.threshold/agent-memory.json` — delete it to wipe memory.

---

## Sharing a world (Watch links)

A `localhost` link only opens on your own machine. To share one:

1. Run the game (`start.bat`), open a world.
2. Double-click **`share.bat`** (or `npm run share`). It builds the app, serves the production build on `:3100`, and opens a Cloudflare quick tunnel to **that port only**. Needs `cloudflared` (`winget install --id Cloudflare.cloudflared`).
3. Click **Share** (top-right in the world): copy the link or scan the QR code.

Anyone with the link gets **Watch mode**: the live world, read-only, plus a live mirror of that game's real TrueForge sessions (ops terminals, and a read-only System View). It is enforced on the server (`lib/access.ts`, `proxy.ts`): only requests to `localhost` from this machine are the host; everything else can only read that one game and its crew sessions. Visitors cannot talk to the crew, approve anything, generate art or reach TrueForge. TrueForge (`:8790`) and the ops MCP servers (`:8791`) listen on localhost only and are never tunnelled — TrueForge's local mode has no login, so exposing it (or its UI) would give visitors full admin access.

The link works while your laptop is awake and `share.bat` is running; a quick tunnel gets a new random URL each start. "Play together" (visitors with their own avatars and sessions) is not built.

## The crew

Agent types are data (`lib/agent-types.ts`), not hardcoded districts. Each one has a role, a **real system scope** (TrueForge MCP servers), a **skill pack** (`skills/<id>/SKILL.md`, git-tracked), an **approval policy** and a look for the world generator.

| Character | Reaches | Real activity | Stops at the Threshold for |
|---|---|---|---|
| **Git Warden** | `threshold-git` | `git log/diff`, test suite in a scratch worktree | `merge_pull_request` |
| **Deploy Runner** | `threshold-deploy` | exports `main`, runs tests, stages numbered releases | `deploy_production`, `rollback` |
| **Server Sentinel** | `threshold-server` | live `/health` probes, log tails, OS process table | `restart_service`, `stop_service` |
| Cost Janitor | cloud MCP you add (`CLOUD_MCP_SERVERS`) | cloud waste scan | anything `@write` / `@destructive` |

Pick the crew for rooms 1–3 on the landing page, or create a **new agent type** there: name it, write its skill pack, choose which configured MCP servers it may reach and which tools stop at the Threshold. It is saved to `.threshold/` and usable immediately.

### What the crew works on

`scripts/ops-mcp.mjs` runs three remote MCP servers over a local workspace (`.threshold/workspace`): a real git repository (`demo-app`) with two open pull requests — `feature/health-uptime` (clean) and `feature/discount-cache` (its tests fail, and it would crash `/health` in production) — a build/test pipeline that produces numbered releases, and the live `demo-app` service it deploys and restarts. Each tool runs a fixed, scoped set of commands (no arbitrary shell) and returns the exact commands and output, which is what the ops terminal shows.

TrueForge blocks MCP servers on `localhost` by default; `npm run services` starts it with `OUTBOUND_URL_ALLOWED_HOSTS=["localhost"]` so it can reach them.

---

## What you see

- **Generation Console** — every generation step as it runs, with the real service doing it: world bible (Gemini text), district art (Nano Banana), hotspot trace (second image pass), hotspot read (vision), workstation layout and art, then per agent: skill pack, memory recall, model, **MCP handshake** (`listTools` through TrueForge), `sessions.create`. Frames are revealed as they're painted. Each line is a stage streamed by the backend step it names (`lib/stages.ts`); a slow step just sits at "running".
- **Live Ops Terminal** — in each agent's room, their workstation screen: every tool call with the literal commands and output. `WORKING`/`IDLE` is driven only by a TrueForge turn in flight or a tool call without a result.
- **Threshold Card** — when TrueForge pauses a tool call for approval: what, why (the agent's own words), blast radius (from the MCP server's `destructiveHint`), Approve/Deny. Deny means the tool never runs; the terminal shows `denied at the Threshold — not executed`.
- **Agent memory** — after each turn, a factual note is written from what actually happened (tool outcomes, your approvals/denials) and given to that character's next session. A new Git Warden session opens with "last run you denied merging feature/discount-cache because checks failed".
- **System View** — backtick (`` ` ``): the raw feed for every agent.

All three surfaces read one client event bus (`lib/live-bus.ts`), fed by the staged API routes and the TrueForge turn streams.

**Controls:** `WASD`/arrows move · `E` enter / talk · `1–3` quick replies · `` ` `` System View · `Esc` leave a conversation (the agent keeps working).

---

## Architecture

```
browser ──► Threshold (Next.js :3000)
              ├─ /api/universe /api/screen /api/scene /api/sprite ── Gemini (text + Nano Banana)
              │     (staged: stream Generation Console events)
              ├─ /api/agent/session  ── TrueForge SDK: models, MCP handshake, sessions.create
              ├─ /api/agent/turn     ── TrueForge turn stream ─┐
              └─ /api/agent/approval ── user.tool_approval ────┤
                                                              ▼
                                          TrueForge (:8790, SQLite)
                                                              │ remote MCP
                                                              ▼
                                  ops MCP servers (:8791) ── git repo, pipeline, demo-app (:4100)
```

- The browser only talks to Threshold; model and MCP access stay inside TrueForge.
- Agent sessions, turns and approvals persist in TrueForge. Reloading mid-approval brings the card back.
- District → session bindings, custom agent types and memory live in `.threshold/` (and in Supabase when its RLS allows).

---

## Environment variables

Create `.env.local` from `.env.example` (`start.bat` does this for you and opens it):

| Variable | Description |
|---|---|
| `GEMINI_API_KEY` | Google Gemini key (world art + text; also registered as TrueForge's model) |
| `TEXT_MODEL` | default `gemini-2.5-flash` |
| `IMAGE_MODEL` | default `gemini-2.0-flash-preview-image-generation` — needs a billed key; the free tier rate-limits hard |
| `SARVAM_API_KEY` | Sarvam AI key for NPC voice (Bulbul v3) |
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Supabase project |
| `TRUEFORGE_SERVER_URL` | default `http://localhost:8790` |
| `TRUEFORGE_MODEL` | optional model FQN, e.g. `google-gemini/gemini-3-6-flash` |
| `CLOUD_MCP_SERVERS` | optional MCP server names for the Cost Janitor |

Keep real-system credentials (cloud, GitHub, databases) in TrueForge's own config, never in this repo.

## Supabase setup

1. Create a [Supabase](https://supabase.com/dashboard) project; put its URL and publishable key in `.env.local`.
2. In the SQL editor, run `supabase/migrations/0001` … `0005` in order. `0004`/`0005` enable the auth-free demo mode. Without `0005` the game still runs; scene art just isn't saved across reloads.

---

## Safety

- The crew's systems are a local sandbox workspace; destructive tools only touch `.threshold/workspace` and the local `demo-app` process.
- If you connect real systems through TrueForge, use disposable accounts only.
- TrueForge local mode is unauthenticated — keep it on localhost.

## Demo script (5 minutes)

1. Pick the crew (Git Warden, Deploy Runner, Server Sentinel), click **Night Shift**. The Generation Console builds the world, then brings each agent online: skill pack → memory → MCP handshake → session.
2. Enter the Git Warden's room: "What PRs are open? Run checks." The terminal streams real `git` and test output: `discount-cache` fails, `health-uptime` passes.
3. "Merge health-uptime." Threshold Card fires — narrate the blast radius, approve. `main` moves.
4. Deploy Runner: "Run the pipeline and ship it." Real pipeline output → card at `deploy_production` → approve. `localhost:4100/health` now reports v1.1.0.
5. Server Sentinel: "Is production healthy?" Real probe + log lines.
6. Start a second world: the Git Warden remembers the first run.

---

## AI assistants disclosure

*(Required by hackathon rules)*

- **Google Gemini** — world art (Nano Banana 2 Lite), world bibles, NPC dialogue; also the agents' model via TrueForge
- **Antigravity (Google DeepMind)** — scaffolded the first TrueForge bridge, ThresholdCard, SystemView, AgentDialogue and Supabase migrations
- **Claude Code (Anthropic)** — rewrote the bridge on the official SDK; built the ops MCP servers, agent types, skill packs, memory, Generation Console and Live Ops Terminal; fixed start-up and auth-free mode; verified the flows end to end

The game engine core (rendering, sprite, hotspot detection, spatial prefetch) comes from [harshagw/kahani](https://github.com/harshagw/kahani).
