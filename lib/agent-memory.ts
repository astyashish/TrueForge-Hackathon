/**
 * Agent memory — continuity between runs (PRD v2 §4).
 *
 * After each turn, a short note is written from what actually happened in
 * that turn (tool results and the Operator's approval decisions) — never
 * invented. The next session for the same character gets its recent notes in
 * its opening instructions. Stored locally in .threshold/agent-memory.json.
 */

import fs from "node:fs/promises";
import path from "node:path";
import type { TFEvent } from "@/lib/trueforge";

export type MemoryNote = {
  sessionId: string;
  summary: string;
  createdAt: string;
};

const FILE = path.join(process.cwd(), ".threshold", "agent-memory.json");
const KEEP = 12;

type Store = Record<string, MemoryNote[]>;

async function readStore(): Promise<Store> {
  try {
    return JSON.parse(await fs.readFile(FILE, "utf8")) as Store;
  } catch {
    return {};
  }
}

// Serialize writes so concurrent turns don't clobber each other.
let writing = Promise.resolve();

export async function getMemory(characterId: string, limit = 6): Promise<MemoryNote[]> {
  return ((await readStore())[characterId] ?? []).slice(-limit);
}

export function addMemory(characterId: string, note: MemoryNote): Promise<void> {
  writing = writing.then(async () => {
    const store = await readStore();
    store[characterId] = [...(store[characterId] ?? []), note].slice(-KEEP);
    await fs.mkdir(path.dirname(FILE), { recursive: true });
    await fs.writeFile(FILE, JSON.stringify(store, null, 2));
  }, () => {});
  return writing;
}

/** Tools that only discover other tools — not worth remembering. */
const DISCOVERY = new Set(["list_tools", "get_tool_info", "search_tools", "ask_user_question"]);

/** Lines in tool output that carry the outcome (see scripts/ops-mcp.mjs). */
const OUTCOME = /CHECKS (PASSED|FAILED)|release #\d+|DEPLOY UNHEALTHY|rolling back|stopped |started |Merge pull request|no open pull request|no deployable|error:|^\d{3} \{|test\(s\) failed|all tests passed/i;

function fmtArgs(args: Record<string, unknown>): string {
  const parts = Object.entries(args)
    .filter(([, v]) => typeof v === "string" || typeof v === "number")
    .map(([k, v]) => `${k}=${v}`);
  return parts.length ? `(${parts.join(", ")})` : "";
}

/** Build a factual note from one turn's events; null when nothing notable happened. */
export function summarizeTurn(events: TFEvent[]): string | null {
  const parts: string[] = [];
  for (const e of events) {
    if (e.type === "tool_call" && e.status === "done" && !DISCOVERY.has(e.toolName)) {
      const lines = (e.output ?? "").split(/\r?\n/).filter((l) => OUTCOME.test(l.trim()));
      const outcome = lines.slice(-2).join(" / ").slice(0, 160);
      parts.push(`ran ${e.toolName}${fmtArgs(e.arguments)}${outcome ? ` → ${outcome}` : ""}`);
    } else if (
      e.type === "tool_call" &&
      e.status === "error" &&
      !DISCOVERY.has(e.toolName) &&
      !/denied at the Threshold/.test(e.output ?? "")
    ) {
      const reason = (e.output ?? "").split(/\r?\n/).filter(Boolean).slice(-1)[0] ?? "failed";
      parts.push(`tried ${e.toolName}${fmtArgs(e.arguments)} → FAILED: ${reason.slice(0, 160)}`);
    } else if (e.type === "approval_resolved") {
      parts.push(
        `the Operator ${e.decision === "approved" ? "APPROVED" : "DENIED"} ${e.toolName ?? "an action"}${e.summary ? ` (${e.summary})` : ""}`
      );
    } else if (e.type === "question_answered") {
      parts.push(`asked "${(e.question ?? "a question").slice(0, 100)}" and the Operator answered "${e.answer.slice(0, 100)}"`);
    } else if (e.type === "error") {
      parts.push(`hit an error: ${e.message.slice(0, 120)}`);
    }
  }
  if (parts.length === 0) return null;
  return parts.join("; ").slice(0, 700);
}

/** Pass events through unchanged, then remember what happened. */
export async function* rememberTurn(
  characterId: string | undefined,
  sessionId: string,
  events: AsyncIterable<TFEvent>,
  /** Called after a note is written (e.g. to push memory into the TrueForge agent). */
  onRemembered?: (characterId: string) => Promise<unknown>
): AsyncGenerator<TFEvent> {
  const seen: TFEvent[] = [];
  try {
    for await (const e of events) {
      seen.push(e);
      yield e;
    }
  } finally {
    const summary = characterId ? summarizeTurn(seen) : null;
    if (characterId && summary) {
      await addMemory(characterId, { sessionId, summary, createdAt: new Date().toISOString() }).catch(
        (err) => console.warn("[agent-memory]", err)
      );
      onRemembered?.(characterId).catch((err) => console.warn("[agent-memory] agent sync", err));
    }
  }
}
