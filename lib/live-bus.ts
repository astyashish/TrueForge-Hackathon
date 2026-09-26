/**
 * The live event bus — one client-side pipe for everything real that is
 * happening (PRD v2 §6.1). Generation stages (streamed by staged API routes)
 * and agent events (streamed from TrueForge turns) both land here; the
 * Generation Console, the Live Ops Terminal and System View are just
 * different filters over it. Module state survives client-side navigation.
 */

import { useSyncExternalStore } from "react";
import type { StageEvent } from "@/lib/stages";
import type { TFEvent } from "@/lib/trueforge";

export type ConsoleGroup = {
  id: string;
  title: string;
  startedAt: number;
  status: "running" | "done" | "error";
  stages: (StageEvent & { key: string; at: number })[];
  error?: string;
};

export type AgentFeedEvent = TFEvent & {
  id: string;
  timestamp: string;
  sessionId: string;
  /** Character display name, e.g. "Ira (Git Warden)". */
  agent: string;
  /** Came from a turn started outside the game (the embedded TrueForge UI). */
  external?: boolean;
};

type State = {
  groups: ConsoleGroup[];
  agent: AgentFeedEvent[];
  /** Sessions with a TrueForge turn currently in flight. */
  active: Record<string, boolean>;
};

let state: State = { groups: [], agent: [], active: {} };
const listeners = new Set<() => void>();

function set(next: State) {
  state = next;
  for (const l of listeners) l();
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

let groupSeq = 0;

// ---------------------------------------------------------------------------
// Generation stages
// ---------------------------------------------------------------------------

export function startGroup(title: string): string {
  const id = `g${++groupSeq}`;
  set({
    ...state,
    groups: [...state.groups.slice(-29), { id, title, startedAt: Date.now(), status: "running", stages: [] }],
  });
  return id;
}

export function pushStage(groupId: string, ev: StageEvent) {
  set({
    ...state,
    groups: state.groups.map((g) => {
      if (g.id !== groupId) return g;
      const key = `${groupId}:${ev.id}`;
      const i = g.stages.findIndex((s) => s.key === key);
      const merged = { ...(i >= 0 ? g.stages[i] : {}), ...ev, key, at: i >= 0 ? g.stages[i].at : Date.now() };
      const stages = i >= 0 ? g.stages.map((s, j) => (j === i ? merged : s)) : [...g.stages, merged];
      return { ...g, stages };
    }),
  });
}

export function endGroup(groupId: string, status: "done" | "error", error?: string) {
  set({
    ...state,
    groups: state.groups.map((g) => (g.id === groupId ? { ...g, status, error } : g)),
  });
}

/** Time a client-side call that is itself a real step (e.g. a database insert). */
export async function clientStage<T>(
  groupId: string,
  label: string,
  tech: string,
  fn: () => Promise<T>,
  describe?: (r: T) => string | undefined
): Promise<T> {
  const id = `c${Date.now()}${Math.random().toString(36).slice(2, 6)}`;
  const t0 = Date.now();
  pushStage(groupId, { type: "stage", id, label, tech, status: "running" });
  try {
    const r = await fn();
    pushStage(groupId, { type: "stage", id, label, tech, status: "done", ms: Date.now() - t0, detail: describe?.(r) });
    return r;
  } catch (err) {
    pushStage(groupId, {
      type: "stage",
      id,
      label,
      tech,
      status: "error",
      ms: Date.now() - t0,
      detail: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}

/**
 * POST to a staged route and mirror its stages into the console. Resolves with
 * the route's result. `group` is a title (new group) or an existing group id.
 */
export async function postStaged<T>(url: string, body: unknown, group: string | { id: string }): Promise<T> {
  const groupId = typeof group === "string" ? startGroup(group) : group.id;
  const own = typeof group === "string";
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-stage-stream": "1" },
      body: JSON.stringify(body),
    });
    if (!res.ok || !res.body || !res.headers.get("content-type")?.includes("text/event-stream")) {
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`);
      if (own) endGroup(groupId, "done");
      return data as T;
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let sep: number;
      while ((sep = buffer.indexOf("\n\n")) >= 0) {
        const chunk = buffer.slice(0, sep);
        buffer = buffer.slice(sep + 2);
        if (!chunk.startsWith("data:")) continue;
        const ev = JSON.parse(chunk.slice(5).trimStart()) as
          | StageEvent
          | { type: "result"; data: T }
          | { type: "error"; message: string };
        if (ev.type === "stage") pushStage(groupId, ev);
        else if (ev.type === "result") {
          if (own) endGroup(groupId, "done");
          return ev.data;
        } else if (ev.type === "error") throw new Error(ev.message);
      }
    }
    throw new Error("Stream ended without a result.");
  } catch (err) {
    endGroup(groupId, "error", err instanceof Error ? err.message : String(err));
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Agent events
// ---------------------------------------------------------------------------

export function publishAgent(ev: AgentFeedEvent) {
  set({ ...state, agent: [...state.agent.slice(-499), ev] });
}

export function setAgentActive(sessionId: string, active: boolean) {
  if (Boolean(state.active[sessionId]) === active) return;
  set({ ...state, active: { ...state.active, [sessionId]: active } });
}

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

const getState = () => state;

export function useLiveBus(): State {
  return useSyncExternalStore(subscribe, getState, getState);
}

// ---------------------------------------------------------------------------
// Boot window — which console groups belong to the world being built
// ---------------------------------------------------------------------------

let boot: { key: string; since: number } = { key: "", since: 0 };

/**
 * Mark the start of a world boot and return the timestamp the full console
 * should show groups from. Creating a world ("pending") and then loading it
 * by id counts as one boot, so the bible stages stay visible after the
 * redirect to /play/[id].
 */
export function beginBoot(key: string): number {
  if (boot.key === "pending" && key !== "pending" && Date.now() - boot.since < 10 * 60_000) {
    boot = { key, since: boot.since };
  } else {
    boot = { key, since: Date.now() };
  }
  return boot.since;
}
