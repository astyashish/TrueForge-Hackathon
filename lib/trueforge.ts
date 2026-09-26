/**
 * TrueForge bridge — server-side only.
 *
 * Wraps @truefoundry/trueforge-sdk. The browser never touches TrueForge
 * directly; all calls go through Threshold's /api/agent/* routes, which
 * translate TrueForge's turn events into the small Threshold event set below.
 *
 * TrueForge turn model (v0.2):
 * - A session owns an inline AgentSpec (model, instructions, MCP servers).
 * - Each turn streams SSE events. When a tool call needs approval the turn
 *   ends with `tool.approval_required`; the decision is sent as a new turn
 *   whose input is `user.tool_approval` items, which resumes the agent.
 */

import {
  TrueForge,
  TrueForgeApi,
  isEventDelta,
  mergeEventDelta,
} from "@truefoundry/trueforge-sdk";
import fs from "node:fs/promises";
import path from "node:path";
import { type AgentType, getAgentType, readSkillPack } from "@/lib/agent-types";
import { getMemory, type MemoryNote } from "@/lib/agent-memory";
import { type Reporter, silentReporter } from "@/lib/stages";

const TRUEFORGE_BASE = (
  process.env.TRUEFORGE_SERVER_URL ?? "http://localhost:8790"
).replace(/\/$/, "");

let _client: TrueForge | null = null;
function client(): TrueForge {
  if (!_client) {
    _client = new TrueForge({
      baseUrl: TRUEFORGE_BASE,
      token: process.env.TRUEFORGE_API_KEY || undefined,
    });
  }
  return _client;
}

// ---------------------------------------------------------------------------
// Threshold event types (what the browser sees)
// ---------------------------------------------------------------------------

export type RiskLevel = "reversible" | "irreversible" | "catastrophic";

export type PendingToolCall = {
  id: string;
  toolName: string;
  server?: string;
  arguments: Record<string, unknown>;
};

export type TFEvent =
  | { type: "text"; content: string }
  | {
      type: "tool_call";
      toolCallId: string;
      toolName: string;
      server?: string;
      arguments: Record<string, unknown>;
      status: "running" | "done" | "error";
      output?: string;
    }
  | { type: "sandbox_run"; status: "running" | "done" | "error"; stdout?: string; durationMs?: number }
  | {
      type: "approval_required";
      approvalId: string;
      threadId: string;
      toolCalls: PendingToolCall[];
      toolName: string;
      arguments: Record<string, unknown>;
      reasoning?: string;
      riskLevel: RiskLevel;
      summary: string;
    }
  | {
      type: "approval_resolved";
      approvalId: string;
      decision: "approved" | "denied";
      toolName?: string;
      summary?: string;
      /** Set when the decision was made outside the game (embedded TrueForge UI). */
      via?: "trueforge-ui";
    }
  | {
      /** TrueForge's native ask_user_question tool paused the turn for an answer. */
      type: "question";
      questionId: string;
      threadId: string;
      toolCallId: string;
      question: string;
      options: string[];
    }
  | { type: "question_answered"; questionId: string; question?: string; answer: string; via?: "trueforge-ui" }
  /** A message the Operator sent from the embedded TrueForge UI. */
  | { type: "external_message"; content: string }
  | { type: "error"; message: string }
  | { type: "done" };

export type TFApprovalDecision = "approved" | "denied";

// ---------------------------------------------------------------------------
// Agent configuration
// ---------------------------------------------------------------------------

/** Pick the model: TRUEFORGE_MODEL, else the first configured flash-class model, else the first model. */
async function resolveModel(): Promise<string> {
  if (process.env.TRUEFORGE_MODEL) return process.env.TRUEFORGE_MODEL;
  const res = await client().models.list();
  const names = (res.data ?? []).map((m) => m.name);
  if (names.length === 0) {
    throw new Error(
      "TrueForge has no model configured. Run `npm run trueforge:setup` or add one at http://localhost:8790 → Settings → Models."
    );
  }
  return names.find((n) => /flash|haiku|sonnet|-mini\b/.test(n.split("/").pop() ?? n)) ?? names[0];
}

async function sandboxConfigured(): Promise<boolean> {
  try {
    await client().settings.sandboxProviders.get();
    return true;
  } catch {
    return false;
  }
}

function buildInstructions(type: AgentType, skill: string | null, memory: MemoryNote[]): string {
  const memoryBlock = memory.length
    ? memory
        .map((m) => `- ${m.createdAt.slice(0, 16).replace("T", " ")} UTC: ${m.summary}`)
        .join("\n")
    : "- (no previous runs — this is your first shift)";
  return `${skill ? `${skill.trim()}\n\n` : `You are the ${type.name}: ${type.role}. Your skill pack is attached as the TrueForge skill "${skillNameFor(type.id)}" — follow it.\n\n`}## Threshold operating rules
- You are the ${type.name} — a character in Threshold, a live software and server operations simulator. The Operator (the player) walks up to your workstation and talks to you.
- Everything you report must come from a real tool result in this session. Never invent state, numbers or output.
- Keep replies short: 2–4 sentences, in character, concrete. Mention tool names only when useful.
- Actions covered by your approval policy (${type.approvalTools.join(", ")}) pause automatically at the Threshold for the Operator's decision. When the Operator asks for one, call the tool — do not ask for permission in chat first.
- If a request is genuinely ambiguous (e.g. which of several releases or branches), use ask_user_question with concrete options instead of guessing.
- If a tool you need is not available, say which system is not connected.

## Your memory of previous runs (oldest first)
${memoryBlock}
If a memory note is relevant to what the Operator asks, reference it explicitly and let it change how careful you are.`;
}

// ---------------------------------------------------------------------------
// Native TrueForge agents (PRD v3) — one definition, two faces
// ---------------------------------------------------------------------------

/** Public base URL of TrueForge's own UI (for "Open in TrueForge" links). */
const TRUEFORGE_UI = (process.env.TRUEFORGE_PUBLIC_URL ?? TRUEFORGE_BASE).replace(/\/$/, "");

/** Stable TrueForge resource name for an agent type (renames never duplicate). */
export function agentNameFor(typeId: string): string {
  return `threshold-${typeId}`.slice(0, 64).replace(/-+$/, "");
}
function skillNameFor(typeId: string): string {
  return agentNameFor(typeId);
}

export function trueforgeLinks(agentId: string | undefined, sessionId?: string) {
  return {
    agent: agentId ? `${TRUEFORGE_UI}/library/${agentId}` : undefined,
    session: sessionId ? `${TRUEFORGE_UI}/sessions/${sessionId}` : undefined,
    sessions: `${TRUEFORGE_UI}/sessions`,
    agents: `${TRUEFORGE_UI}/library`,
  };
}

/**
 * Git-backed skills need a public GitHub/GitLab repo containing skills/<id>/SKILL.md
 * (THRESHOLD_SKILLS_REPO) AND a sandbox provider — TrueForge mounts skills in the
 * sandbox. Without both, the skill pack is inlined into the agent's Instructions.
 */
function skillsRepo() {
  const url = process.env.THRESHOLD_SKILLS_REPO?.trim();
  if (!url) return null;
  return {
    url,
    ref: process.env.THRESHOLD_SKILLS_REF?.trim() || "main",
    path: (process.env.THRESHOLD_SKILLS_PATH?.trim() || "skills").replace(/^\/+|\/+$/g, ""),
  };
}

type AgentCacheEntry = { agentId: string; agentName: string; digest: string };
const AGENT_CACHE = path.join(process.cwd(), ".threshold", "trueforge-agents.json");

async function readAgentCache(): Promise<Record<string, AgentCacheEntry>> {
  try {
    return JSON.parse(await fs.readFile(AGENT_CACHE, "utf8"));
  } catch {
    return {};
  }
}
let cacheWrite = Promise.resolve();
function writeAgentCache(typeId: string, entry: AgentCacheEntry) {
  cacheWrite = cacheWrite.then(async () => {
    const cache = await readAgentCache();
    cache[typeId] = entry;
    await fs.mkdir(path.dirname(AGENT_CACHE), { recursive: true });
    await fs.writeFile(AGENT_CACHE, JSON.stringify(cache, null, 2));
  }, () => {});
  return cacheWrite;
}

export type EnsuredAgent = {
  agentId: string;
  agentName: string;
  action: "created" | "updated" | "unchanged";
  nativeSkill: boolean;
  sandbox: boolean;
  mcpServers: { name: string; tools: number; ok: boolean }[];
  memoryCount: number;
};

/** GET /agents/{id} only takes the id; fall back to scanning the list by name. */
async function findAgent(name: string, cachedId?: string): Promise<TrueForgeApi.Agent | null> {
  if (cachedId) {
    try {
      const a = (await client().agents.get(cachedId)).data;
      if (a.name === name) return a;
    } catch {}
  }
  for await (const a of await client().agents.list({ limit: 50 })) {
    if (a.name === name) return a;
  }
  return null;
}

// One sync per agent type at a time.
const inflight = new Map<string, Promise<EnsuredAgent>>();

/**
 * ensureAgentType — idempotently create or update the saved TrueForge Agent
 * for a Threshold agent type: Instructions (skill pack + rules + memory),
 * MCP servers with the approval policy, skills, and runtime config. It then
 * shows up on TrueForge's own Agents page, and sessions are created from it.
 */
export function ensureAgentType(type: AgentType, report: Reporter = silentReporter): Promise<EnsuredAgent> {
  const running = inflight.get(type.id);
  if (running) return running;
  const p = syncAgent(type, report).finally(() => inflight.delete(type.id));
  inflight.set(type.id, p);
  return p;
}

async function syncAgent(type: AgentType, report: Reporter): Promise<EnsuredAgent> {
  const agentName = agentNameFor(type.id);
  const [model, memory, sandbox] = await Promise.all([
    report.stage("resolving model", "trueforge · models", resolveModel, (m) => m),
    report.stage(
      "recalling agent memory",
      ".threshold/agent-memory.json",
      () => getMemory(type.id),
      (m) => (m.length ? `${m.length} note(s) from previous runs` : "first run — no memory yet")
    ),
    sandboxConfigured(),
  ]);

  // Real MCP handshake per server, through TrueForge.
  const bound: EnsuredAgent["mcpServers"] = [];
  for (const name of type.mcpServers) {
    try {
      const tools = await report.stage(
        `binding mcp server ${name}`,
        "trueforge → mcp handshake",
        () => client().mcpServers.listTools(name),
        (r) => `${r.data.length} tools: ${r.data.map((t) => t.name).join(", ")}`
      );
      bound.push({ name, tools: tools.data.length, ok: true });
    } catch {
      bound.push({ name, tools: 0, ok: false });
    }
  }
  if (type.mcpServers.length === 0) {
    report.note("binding mcp servers", "trueforge", "skipped", "no MCP server in this agent type's scope");
  }

  // Skill pack: a registered TrueForge git skill when possible, otherwise inlined.
  const repo = skillsRepo();
  const nativeSkill = Boolean(repo && sandbox && !type.custom);
  let skillText: string | null = null;
  if (nativeSkill && repo) {
    await report.stage(
      `registering skill ${skillNameFor(type.id)}`,
      "trueforge · settings/skills (git)",
      () =>
        client().settings.skills.createOrUpdate({
          manifest: {
            type: "git",
            name: skillNameFor(type.id),
            url: repo.url,
            path: `${repo.path}/${type.id}`,
            ref: repo.ref,
            description: `${type.name}: ${type.role}`,
          },
        }),
      () => `${repo.url} @ ${repo.ref}:${repo.path}/${type.id}`
    );
  } else {
    skillText = await report.stage(
      `loading skill pack · ${type.name}`,
      `${type.skillPath} → agent instructions`,
      () => readSkillPack(type),
      (s) =>
        `${s.split(/\r?\n/).length} lines inlined${
          type.custom ? "" : " (TrueForge git skills need THRESHOLD_SKILLS_REPO + a sandbox)"
        }`
    );
  }

  const manifest: TrueForgeApi.AgentSpec = {
    model: { name: model },
    instructions: buildInstructions(type, skillText, memory),
    mcpServers: bound
      .filter((b) => b.ok)
      .map((b) => ({ name: b.name, requireApprovalForTools: type.approvalTools, preload: true })),
    ...(nativeSkill ? { skills: [{ name: skillNameFor(type.id), preload: true }] } : {}),
    config: {
      iterationLimit: type.iterationLimit ?? 30,
      sandbox: { enabled: sandbox && (type.sandbox || nativeSkill) },
      dynamicSubAgents: { enabled: false },
      contextManagement: { compaction: { enabled: true }, largeToolResponse: { enabled: true } },
      // The game renders plain text; OpenUI blocks would show up as markup.
      generativeUi: { enabled: false },
      // Native human-in-the-loop questions — answered in the dialogue.
      askUserQuestions: { enabled: true },
    },
  };
  const description = `Threshold crew · ${type.name}: ${type.role}`.slice(0, 1024);
  const digest = JSON.stringify({ description, manifest });

  const result = await report.stage(
    `syncing TrueForge agent ${agentName}`,
    "trueforge · agents (Agents page)",
    async () => {
      const cache = (await readAgentCache())[type.id];
      const existing = await findAgent(agentName, cache?.agentId);
      if (!existing) {
        const created = await client().agents.create({ name: agentName, description, manifest });
        return { agentId: created.data.id, action: "created" as const };
      }
      if (cache?.agentId === existing.id && cache.digest === digest) {
        return { agentId: existing.id, action: "unchanged" as const };
      }
      await client().agents.update(existing.id, { description, manifest });
      return { agentId: existing.id, action: "updated" as const };
    },
    (r) => `${r.action} · ${r.agentId}`
  );
  await writeAgentCache(type.id, { agentId: result.agentId, agentName, digest });

  return {
    agentId: result.agentId,
    agentName,
    action: result.action,
    nativeSkill,
    sandbox: manifest.config?.sandbox?.enabled ?? false,
    mcpServers: bound,
    memoryCount: memory.length,
  };
}

/** Re-sync a type's saved TrueForge Agent (e.g. after its memory changed). */
export async function refreshAgent(typeId: string) {
  return ensureAgentType(await getAgentType(typeId));
}

/** Cached agent id for a type (no network), if it has been synced before. */
export async function cachedAgent(typeId: string): Promise<AgentCacheEntry | undefined> {
  return (await readAgentCache())[typeId];
}

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

export type TFSession = { id: string; createdAt: string; updatedAt: string };

export type AgentSessionInfo = {
  sessionId: string;
  agentType: Pick<AgentType, "id" | "name" | "role" | "approvalTools">;
  mcpServers: { name: string; tools: number; ok: boolean }[];
  memoryCount: number;
  agentName: string;
  agentId: string;
  nativeSkill: boolean;
  links: ReturnType<typeof trueforgeLinks>;
};

/**
 * createSessionFromAgent — sync the saved TrueForge Agent for this type, then
 * start a session from it, so the run is attributed to the agent (by name)
 * on TrueForge's own Sessions page. Every step is a Generation Console stage.
 */
export async function createSessionFromAgent(opts: {
  type: AgentType;
  npcName?: string;
  worldTitle?: string;
  report?: Reporter;
  metadata?: Record<string, string>;
}): Promise<AgentSessionInfo> {
  const { type } = opts;
  const report = opts.report ?? silentReporter;
  const agent = await ensureAgentType(type, report);

  const session = await report.stage(
    `creating session from agent ${agent.agentName}`,
    "trueforge · sessions.create({ agent: { name } })",
    () =>
      client().sessions.create({
        agent: { name: agent.agentName },
        metadata: { app: "threshold", agentTypeId: type.id, ...(opts.metadata ?? {}) },
      }),
    (s) => s.data.id
  );
  const title = [opts.npcName ? `${opts.npcName} · ${type.name}` : type.name, opts.worldTitle]
    .filter(Boolean)
    .join(" — ")
    .slice(0, 200);
  await report
    .stage("titling session", "trueforge · sessions.update", () =>
      client().sessions.update(session.data.id, { title })
    , () => title)
    .catch(() => null);

  return {
    sessionId: session.data.id,
    agentType: { id: type.id, name: type.name, role: type.role, approvalTools: type.approvalTools },
    mcpServers: agent.mcpServers,
    memoryCount: agent.memoryCount,
    agentName: agent.agentName,
    agentId: agent.agentId,
    nativeSkill: agent.nativeSkill,
    links: trueforgeLinks(agent.agentId, session.data.id),
  };
}

/** Resume (fetch) an existing session by ID. Returns null if not found. */
export async function getSession(sessionId: string): Promise<TFSession | null> {
  try {
    return (await client().sessions.get(sessionId)).data;
  } catch {
    return null;
  }
}

/** Configured MCP servers (for the custom agent form), with tool annotations. */
export async function listMcpServersWithTools() {
  const res = await client().mcpServers.list();
  return Promise.all(
    (res.data ?? []).map(async (s) => {
      try {
        const tools = await client().mcpServers.listTools(s.name);
        return {
          name: s.name,
          ok: true,
          tools: tools.data.map((t) => {
            const a = (t as { annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean } }).annotations;
            return { name: t.name, readOnly: Boolean(a?.readOnlyHint), destructive: Boolean(a?.destructiveHint) };
          }),
        };
      } catch {
        return { name: s.name, ok: false, tools: [] };
      }
    })
  );
}

// ---------------------------------------------------------------------------
// Event translation
// ---------------------------------------------------------------------------

type ModelMessage = TrueForgeApi.ModelMessageEvent;

function parseArgs(raw: string | undefined): Record<string, unknown> {
  if (!raw) return {};
  try {
    const v = JSON.parse(raw);
    return v && typeof v === "object" ? (v as Record<string, unknown>) : { value: v };
  } catch {
    return { raw };
  }
}

function messageText(content: ModelMessage["content"]): string {
  if (!content) return "";
  if (typeof content === "string") return content;
  return content
    .map((p) => ("text" in p ? p.text : "refusal" in p ? p.refusal : ""))
    .join("");
}

/**
 * TrueForge defers MCP tool discovery: real MCP calls arrive as the system
 * tool `call_tool` with `{ mcp_server, tool_name, input }`. Unwrap those so
 * the Operator sees the actual tool on the actual server.
 */
function describeToolCall(tc: TrueForgeApi.ToolCall): PendingToolCall {
  const args = parseArgs(tc.function.arguments);
  const info = tc.toolInfo as { type?: string; name?: string; serverName?: string } | undefined;
  if (info?.type === "mcp") {
    return { id: tc.id, toolName: info.name ?? tc.function.name, server: info.serverName, arguments: args };
  }
  if (tc.function.name === "call_tool" && typeof args.tool_name === "string") {
    const input = args.input && typeof args.input === "object" ? (args.input as Record<string, unknown>) : {};
    return {
      id: tc.id,
      toolName: args.tool_name,
      server: typeof args.mcp_server === "string" ? args.mcp_server : undefined,
      arguments: input,
    };
  }
  return { id: tc.id, toolName: tc.function.name, arguments: args };
}

const SANDBOX_TOOL = /(^|_)(exec|execute|bash|shell|run_code|python|sandbox|code)(_|$)/i;

function riskFor(toolName: string): RiskLevel {
  if (/delete|terminate|destroy|drop|purge|revoke|remove/i.test(toolName)) return "irreversible";
  return "reversible";
}

/** Destructive tool names per MCP server, from the servers' own annotations. */
const destructiveCache = new Map<string, Promise<Set<string>>>();
function destructiveTools(server: string): Promise<Set<string>> {
  const cached = destructiveCache.get(server);
  if (cached) return cached;
  const p: Promise<Set<string>> = client()
    .mcpServers.listTools(server)
    .then(
      (r) =>
        new Set<string>(
          r.data
            .filter((t) => (t as { annotations?: { destructiveHint?: boolean } }).annotations?.destructiveHint)
            .map((t) => String((t as { name?: unknown }).name))
        )
    )
    .catch(() => {
      destructiveCache.delete(server);
      return new Set<string>();
    });
  destructiveCache.set(server, p);
  return p;
}

/** Upgrade an approval's risk using MCP `destructiveHint` annotations when present. */
async function withAnnotatedRisk(ev: TFEvent): Promise<TFEvent> {
  if (ev.type !== "approval_required" || ev.riskLevel === "irreversible") return ev;
  for (const c of ev.toolCalls) {
    if (c.server && (await destructiveTools(c.server)).has(c.toolName)) {
      return { ...ev, riskLevel: "irreversible" };
    }
  }
  return ev;
}

function summarize(tc: PendingToolCall): string {
  const where = tc.server ? ` on ${tc.server}` : "";
  const target = Object.entries(tc.arguments)
    .filter(([, v]) => typeof v === "string" || typeof v === "number")
    .slice(0, 2)
    .map(([k, v]) => `${k}=${String(v).slice(0, 60)}`)
    .join(", ");
  return `Run ${tc.toolName.replace(/_/g, " ")}${where}${target ? ` (${target})` : ""}`;
}

/** Stateful translator: TrueForge turn events → Threshold events. */
class Translator {
  private messages = new Map<string, ModelMessage>();
  private emittedMessages = new Set<string>();
  private toolCalls = new Map<string, PendingToolCall>();
  private toolStarted = new Map<string, number>();

  constructor(seed?: Iterable<ModelMessage>, knownCalls?: Iterable<PendingToolCall>) {
    for (const m of seed ?? []) this.messages.set(m.id, m);
    // Calls announced in an earlier turn (e.g. the one paused for approval).
    for (const tc of knownCalls ?? []) {
      this.toolCalls.set(tc.id, tc);
      this.toolStarted.set(tc.id, Date.now());
    }
  }

  private completeMessage(m: ModelMessage): TFEvent[] {
    if (this.emittedMessages.has(m.id)) return [];
    this.emittedMessages.add(m.id);
    const out: TFEvent[] = [];
    if (m.threadId !== "main") return out;
    const text = messageText(m.content).trim();
    if (text) out.push({ type: "text", content: text });
    for (const tc of m.toolCalls ?? []) {
      const desc = describeToolCall(tc);
      this.toolCalls.set(tc.id, desc);
      this.toolStarted.set(tc.id, Date.now());
      if (SANDBOX_TOOL.test(desc.toolName) && !desc.server) {
        out.push({ type: "sandbox_run", status: "running" });
      }
      out.push({ type: "tool_call", toolCallId: tc.id, ...desc, status: "running" });
    }
    return out;
  }

  questionFrom(ev: TrueForgeApi.ToolResponseRequiredEvent): TFEvent | null {
    for (const ref of ev.toolCalls) {
      const src =
        this.messages.get(ref.sourceEventId)?.toolCalls?.find((t) => t.id === ref.id) ??
        [...this.messages.values()].flatMap((m) => m.toolCalls ?? []).find((t) => t.id === ref.id);
      if (!src || src.function.name !== "ask_user_question") continue;
      const args = parseArgs(src.function.arguments);
      return {
        type: "question",
        questionId: ev.id,
        threadId: ev.threadId,
        toolCallId: ref.id,
        question: typeof args.question === "string" ? args.question : "The agent needs a decision.",
        options: Array.isArray(args.options) ? args.options.filter((o): o is string => typeof o === "string") : [],
      };
    }
    return null;
  }

  pendingFrom(ev: TrueForgeApi.ToolApprovalRequiredEvent): TFEvent {
    const calls = ev.toolCalls.map((ref) => {
      const known = this.toolCalls.get(ref.id);
      if (known) return known;
      const src = this.messages.get(ref.sourceEventId)?.toolCalls?.find((t) => t.id === ref.id);
      return src ? describeToolCall(src) : { id: ref.id, toolName: "tool", arguments: {} };
    });
    const first = calls[0];
    const reasoning = messageText(this.messages.get(ev.toolCalls[0]?.sourceEventId ?? "")?.content).trim();
    const risk = calls.some((c) => riskFor(c.toolName) === "irreversible") ? "irreversible" : "reversible";
    return {
      type: "approval_required",
      approvalId: ev.id,
      threadId: ev.threadId,
      toolCalls: calls,
      toolName: first.toolName,
      arguments: first.arguments,
      reasoning: reasoning || undefined,
      riskLevel: risk,
      summary: calls.length > 1 ? `${summarize(first)} (+${calls.length - 1} more)` : summarize(first),
    };
  }

  push(ev: TrueForgeApi.TurnStreamingEvent | TrueForgeApi.SessionEvent): TFEvent[] {
    if (isEventDelta(ev)) {
      const base = this.messages.get(ev.id);
      if (!base) return [];
      mergeEventDelta(base, ev);
      return ev.finishReason ? this.completeMessage(base) : [];
    }
    switch (ev.type) {
      case "model.message": {
        const m = ev as ModelMessage;
        this.messages.set(m.id, m);
        return m.finishReason ? this.completeMessage(m) : [];
      }
      case "sandbox.created":
        return [{ type: "sandbox_run", status: "running", stdout: "sandbox created" }];
      case "tool.response": {
        const r = ev as TrueForgeApi.ToolResponseEvent;
        const desc = this.toolCalls.get(r.toolCallId);
        if (!desc) return [];
        // A denied approval comes back as a tool response; it never ran.
        if (/User denied tool call/i.test(r.content)) {
          return [
            {
              type: "tool_call",
              toolCallId: r.toolCallId,
              ...desc,
              status: "error",
              output: "denied at the Threshold — not executed",
            },
          ];
        }
        // Failed MCP calls come back wrapped: {"error":[{"type":"text","text":"…"}]}.
        let output = r.content;
        let failed = false;
        try {
          const parsed = JSON.parse(r.content) as { error?: { type?: string; text?: string }[] };
          if (Array.isArray(parsed?.error)) {
            output = parsed.error.map((p) => p.text ?? "").join("\n");
            failed = true;
          }
        } catch {}
        const out: TFEvent[] = [
          {
            type: "tool_call",
            toolCallId: r.toolCallId,
            ...desc,
            status: failed ? "error" : "done",
            output: output.slice(0, 4000),
          },
        ];
        if (SANDBOX_TOOL.test(desc.toolName) && !desc.server) {
          const started = this.toolStarted.get(r.toolCallId);
          out.unshift({
            type: "sandbox_run",
            status: "done",
            stdout: r.content.slice(0, 4000),
            durationMs: started ? Date.now() - started : undefined,
          });
        }
        return out;
      }
      case "tool.response_required": {
        const q = this.questionFrom(ev as TrueForgeApi.ToolResponseRequiredEvent);
        return q ? [q] : [];
      }
      case "tool.approval_required":
        return [this.pendingFrom(ev as TrueForgeApi.ToolApprovalRequiredEvent)];
      case "turn.done": {
        const done = ev as TrueForgeApi.TurnDoneEvent;
        const out: TFEvent[] = [];
        // Flush a final message that never got a finishReason delta.
        if (done.state.status === "done" && done.state.output) {
          const m = this.messages.get(done.state.output.id) ?? done.state.output;
          out.push(...this.completeMessage(m));
        }
        if (done.state.status === "error") out.push({ type: "error", message: done.state.message });
        out.push({ type: "done" });
        return out;
      }
      default:
        return [];
    }
  }
}

// ---------------------------------------------------------------------------
// Turns
// ---------------------------------------------------------------------------

async function* runTurn(
  sessionId: string,
  input: TrueForgeApi.TurnInputItem[],
  signal?: AbortSignal,
  knownCalls?: PendingToolCall[]
): AsyncGenerator<TFEvent> {
  const translator = new Translator(undefined, knownCalls);
  const stream = await client().sessions.createTurnStream(
    sessionId,
    { input },
    { abortSignal: signal, timeoutInSeconds: 600 }
  );
  let sawDone = false;
  for await (const ev of stream) {
    for (const out of translator.push(ev)) {
      if (out.type === "done") sawDone = true;
      yield await withAnnotatedRisk(out);
    }
  }
  if (!sawDone) yield { type: "done" };
}

/** Send the Operator's message to a session; yields Threshold events as the agent works. */
export function sendTurn(sessionId: string, content: string, signal?: AbortSignal) {
  return runTurn(sessionId, [{ type: "user.message", content }], signal);
}

/** Resolve a pending approval (the Threshold Card decision) and resume the agent. */
export async function* resolveApproval(
  sessionId: string,
  approval: {
    approvalId: string;
    threadId: string;
    toolCallIds: string[];
    toolName?: string;
    server?: string;
    summary?: string;
  },
  decision: TFApprovalDecision,
  signal?: AbortSignal
): AsyncGenerator<TFEvent> {
  yield {
    type: "approval_resolved",
    approvalId: approval.approvalId,
    decision,
    toolName: approval.toolName,
    summary: approval.summary,
  };
  const verdict: TrueForgeApi.ApprovalDecision =
    decision === "approved"
      ? { status: "allow" }
      : { status: "deny", reason: "The Operator denied this action at the Threshold. Do not retry it; explain what you would do instead." };
  yield* runTurn(
    sessionId,
    approval.toolCallIds.map((toolCallId) => ({
      type: "user.tool_approval" as const,
      threadId: approval.threadId,
      toolCallId,
      approval: verdict,
    })),
    signal,
    approval.toolCallIds.map((id) => ({
      id,
      toolName: approval.toolName ?? "tool",
      server: approval.server,
      arguments: {},
    }))
  );
}

/** Answer TrueForge's ask_user_question (user.tool_response) and resume the agent. */
export async function* answerQuestion(
  sessionId: string,
  q: { questionId: string; threadId: string; toolCallId: string; question?: string },
  answer: string,
  signal?: AbortSignal
): AsyncGenerator<TFEvent> {
  yield { type: "question_answered", questionId: q.questionId, question: q.question, answer };
  yield* runTurn(
    sessionId,
    [{ type: "user.tool_response", threadId: q.threadId, toolCallId: q.toolCallId, content: answer }],
    signal,
    [{ id: q.toolCallId, toolName: "ask_user_question", arguments: {} }]
  );
}

export async function listAllTurns(sessionId: string): Promise<TrueForgeApi.Turn[]> {
  // Turns list oldest-first with no sort option.
  const out: TrueForgeApi.Turn[] = [];
  for await (const turn of await client().sessions.listTurns(sessionId, { limit: 25 })) out.push(turn);
  return out;
}

/** The approval/question a finished turn left pending, rebuilt from its stored events. */
export async function pendingForTurn(sessionId: string, turn: TrueForgeApi.Turn): Promise<TFEvent | null> {
  if (turn.state.status !== "done") return null;
  const pending = turn.state.requiredActions.find(
    (a): a is TrueForgeApi.ToolApprovalRequiredEvent => a.type === "tool.approval_required"
  );
  const question = turn.state.requiredActions.find(
    (a): a is TrueForgeApi.ToolResponseRequiredEvent => a.type === "tool.response_required"
  );
  if (!pending && !question) return null;
  const messages: ModelMessage[] = [];
  for await (const ev of await client().sessions.listTurnEvents(sessionId, turn.id, { limit: 100 })) {
    if (ev.type === "model.message") messages.push(ev as ModelMessage);
  }
  const translator = new Translator(messages);
  if (pending) return await withAnnotatedRisk(translator.pendingFrom(pending));
  return question ? translator.questionFrom(question) : null;
}

/**
 * If the session's last turn ended paused on an approval (or a native
 * ask_user_question), rebuild it so a page reload can show it again.
 */
export async function getPendingApproval(sessionId: string): Promise<TFEvent | null> {
  try {
    const last = (await listAllTurns(sessionId)).at(-1);
    return last ? await pendingForTurn(sessionId, last) : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Session watcher — turns started outside the game (the embedded TrueForge UI)
// ---------------------------------------------------------------------------

function sleep(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(t);
      resolve();
    });
  });
}

/** Replay one turn: live via subscribe while it runs, from stored events once it is done. */
export async function* replayTurn(
  sessionId: string,
  turn: TrueForgeApi.Turn,
  prevPending: TFEvent | null,
  signal: AbortSignal,
  /** Mark decisions as made in the TrueForge UI (true for the owner's watcher). */
  fromTrueForgeUi = true
): AsyncGenerator<TFEvent> {
  // What the Operator did to start this turn (from the turn's real input).
  for (const item of turn.input ?? []) {
    if (item.type === "user.message") {
      const content = typeof item.content === "string" ? item.content : "(message with attachments)";
      yield { type: "external_message", content };
    } else if (item.type === "user.tool_approval") {
      const call =
        prevPending?.type === "approval_required"
          ? prevPending.toolCalls.find((c) => c.id === item.toolCallId)
          : undefined;
      yield {
        type: "approval_resolved",
        approvalId: prevPending?.type === "approval_required" ? prevPending.approvalId : item.toolCallId,
        decision: item.approval.status === "allow" ? "approved" : "denied",
        toolName: call?.toolName,
        summary: prevPending?.type === "approval_required" ? prevPending.summary : undefined,
        via: fromTrueForgeUi ? "trueforge-ui" : undefined,
      };
    } else if (item.type === "user.tool_response") {
      yield {
        type: "question_answered",
        questionId: prevPending?.type === "question" ? prevPending.questionId : item.toolCallId,
        question: prevPending?.type === "question" ? prevPending.question : undefined,
        answer: item.content,
        via: fromTrueForgeUi ? "trueforge-ui" : undefined,
      };
    }
  }

  const knownCalls: PendingToolCall[] =
    prevPending?.type === "approval_required"
      ? prevPending.toolCalls
      : prevPending?.type === "question"
        ? [{ id: prevPending.toolCallId, toolName: "ask_user_question", arguments: {} }]
        : [];
  const translator = new Translator(undefined, knownCalls);
  let sawDone = false;
  let streamed = false;
  try {
    const live = await client().sessions.subscribeToTurn(sessionId, turn.id, {}, { abortSignal: signal, timeoutInSeconds: 600 });
    for await (const ev of live) {
      streamed = true;
      for (const out of translator.push(ev)) {
        if (out.type === "done") sawDone = true;
        yield await withAnnotatedRisk(out);
      }
    }
  } catch {
    // 412 once the turn has finished: its live stream is gone — read the stored events.
  }
  if (!streamed) {
    for await (const ev of await client().sessions.listTurnEvents(sessionId, turn.id, { limit: 100 })) {
      for (const out of translator.push(ev as TrueForgeApi.TurnStreamingEvent)) {
        if (out.type === "done") sawDone = true;
        yield await withAnnotatedRisk(out);
      }
    }
  }
  if (!sawDone) yield { type: "done" };
}

/**
 * Follow a session for turns the game did not start (e.g. an approval or a
 * message sent from the embedded TrueForge UI) and stream them as Threshold
 * events. Turns that exist when the watch opens are skipped, so the game
 * reopens the watch after each of its own turns.
 */
export async function* watchSession(
  sessionId: string,
  signal: AbortSignal,
  wrapTurn: (events: AsyncGenerator<TFEvent>) => AsyncIterable<TFEvent> = (e) => e
): AsyncGenerator<TFEvent> {
  const known = new Set((await listAllTurns(sessionId)).map((t) => t.id));
  while (!signal.aborted) {
    await sleep(1500, signal);
    if (signal.aborted) break;
    const turns = await listAllTurns(sessionId).catch(() => [] as TrueForgeApi.Turn[]);
    for (const turn of turns) {
      if (known.has(turn.id)) continue;
      known.add(turn.id);
      const prev = turns.find((t) => t.id === turn.previousTurnId);
      const prevPending = prev ? await pendingForTurn(sessionId, prev).catch(() => null) : null;
      yield* wrapTurn(replayTurn(sessionId, turn, prevPending, signal));
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Wrap a Threshold event generator as a Server-Sent Events response. */
export function sseResponse(
  events: AsyncIterable<TFEvent>,
  onEvent?: (e: TFEvent) => void | Promise<void>
): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (e: TFEvent) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(e)}\n\n`));
      try {
        for await (const e of events) {
          send(e);
          await onEvent?.(e);
        }
      } catch (err) {
        console.error("[trueforge] stream failed", err);
        send({ type: "error", message: describeError(err) });
        send({ type: "done" });
      } finally {
        controller.close();
      }
    },
  });
  return new Response(body, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

/** Human-readable error, with a hint when TrueForge simply isn't running. */
export function describeError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  const cause = err instanceof Error && err.cause instanceof Error ? err.cause.message : "";
  if (/ECONNREFUSED|fetch failed|Timeout|ENOTFOUND/i.test(msg + cause)) {
    return `TrueForge is not reachable at ${TRUEFORGE_BASE}. Start it with start.bat or \`npm run trueforge\`.`;
  }
  const body = (err as { body?: unknown })?.body;
  if (body && typeof body === "object") {
    const inner = (body as { error?: { message?: string } }).error?.message;
    if (inner) return `TrueForge: ${inner}`;
  }
  return msg;
}

/** Returns true if the TrueForge server is reachable. */
export async function isTrueForgeReachable(): Promise<boolean> {
  try {
    const res = await fetch(`${TRUEFORGE_BASE}/api/v1/models`, { signal: AbortSignal.timeout(3000) });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Sync every agent type to a saved TrueForge Agent. Run at server start
 * (instrumentation.ts) so the crew is on TrueForge's Agents page before
 * anyone plays; retries while TrueForge is still booting.
 */
export async function syncAllAgents(opts: { retryForMs?: number } = {}) {
  const { listAgentTypes } = await import("@/lib/agent-types");
  const deadline = Date.now() + (opts.retryForMs ?? 0);
  while (!(await isTrueForgeReachable())) {
    if (Date.now() > deadline) return [];
    await new Promise((r) => setTimeout(r, 3000));
  }
  const results: { type: string; agent?: string; action?: string; error?: string }[] = [];
  for (const type of await listAgentTypes()) {
    try {
      const a = await ensureAgentType(type);
      results.push({ type: type.id, agent: a.agentName, action: a.action });
    } catch (err) {
      results.push({ type: type.id, error: describeError(err) });
    }
  }
  return results;
}
