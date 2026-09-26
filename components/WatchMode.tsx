"use client";

/**
 * Watch mode — what someone who opens a shared link gets (read-only).
 *
 * - <WatchFeed>: polls /api/watch/<gameId>/poll (this game's crew
 *   sessions only) and puts every event on the live bus, so the rooms' ops
 *   terminals mirror the host's real TrueForge sessions as they happen.
 * - <WatchSystemView>: System View for viewers — the live, read-only session
 *   feed. TrueForge's own UI stays host-only: it would give a visitor full
 *   admin access to the local, unauthenticated TrueForge instance.
 */

import { useEffect, useRef } from "react";
import { Eye, X } from "lucide-react";
import { publishAgent, setAgentActive, type AgentFeedEvent } from "@/lib/live-bus";
import type { TFEvent } from "@/lib/trueforge";
import { OpsTerminal } from "./OpsTerminal";

export type WatchSessionInfo = {
  districtId: string;
  sessionId: string;
  npcName: string;
  agentType: { id: string; name: string; role: string; approvalTools: string[] };
};

export function WatchFeed({ gameId, sessions }: { gameId: string; sessions: WatchSessionInfo[] }) {
  const labels = useRef(new Map<string, string>());
  labels.current = new Map(sessions.map((s) => [s.sessionId, `${s.npcName} (${s.agentType.name})`]));
  const seq = useRef(0);

  // Poll the read-only snapshot (Cloudflare quick tunnels don't deliver
  // Server-Sent Events) and publish only events not seen yet, per turn.
  const seen = useRef(new Map<string, number>());
  useEffect(() => {
    let stopped = false;
    const tick = async () => {
      try {
        const res = await fetch(`/api/watch/${gameId}/poll`, { cache: "no-store" });
        if (!res.ok) return;
        const { sessions: snap } = (await res.json()) as {
          sessions: { sessionId: string; turns: { turnId: string; running: boolean; events: TFEvent[] }[] }[];
        };
        for (const s of snap) {
          const last = s.turns.at(-1);
          setAgentActive(s.sessionId, Boolean(last?.running));
          for (const t of s.turns) {
            const from = seen.current.get(t.turnId) ?? 0;
            for (const event of t.events.slice(from)) {
              publishAgent({
                ...event,
                id: `watch-${t.turnId}-${seq.current++}`,
                timestamp: new Date().toISOString(),
                sessionId: s.sessionId,
                agent: labels.current.get(s.sessionId) ?? "crew",
              } as AgentFeedEvent);
            }
            seen.current.set(t.turnId, Math.max(from, t.events.length));
          }
        }
      } catch {}
    };
    const loop = async () => {
      while (!stopped) {
        await tick();
        await new Promise((r) => setTimeout(r, 2000));
      }
    };
    loop();
    return () => {
      stopped = true;
    };
  }, [gameId]);

  return null;
}

export function WatchSystemView({ sessions, onClose }: { sessions: WatchSessionInfo[]; onClose: () => void }) {
  return (
    <div className="pointer-events-auto fixed inset-y-0 right-0 z-[70] flex w-[min(100vw,460px)] flex-col gap-2 overflow-y-auto border-l border-white/15 bg-black/95 p-2 shadow-2xl">
      <div className="flex items-center gap-2 px-1 py-1 text-[11px] text-white/70">
        <Eye size={13} className="text-cyan-300" />
        <span className="font-bold uppercase tracking-widest text-white">System View</span>
        <span className="text-white/40">live TrueForge sessions · read-only</span>
        <button type="button" onClick={onClose} className="ml-auto rounded p-1 text-white/60 hover:text-white" title="Close (`)">
          <X size={14} />
        </button>
      </div>
      {sessions.length === 0 && (
        <p className="px-2 text-xs text-white/50">No crew member has started a TrueForge session in this world yet.</p>
      )}
      {sessions.map((s) => (
        <div key={s.sessionId} className="h-[30vh] min-h-56 shrink-0">
          <OpsTerminal
            sessionId={s.sessionId}
            agentName={s.npcName}
            typeName={`${s.agentType.name} · session ${s.sessionId.slice(-8)}`}
            mcpServers={[]}

          />
        </div>
      ))}
    </div>
  );
}

export function WatchBanner() {
  return (
    <div className="pointer-events-none absolute left-1/2 top-3 z-40 -translate-x-1/2 rounded-full border border-cyan-300/40 bg-black/80 px-3 py-1 font-mono text-[11px] text-cyan-200">
      <span className="mr-1.5 inline-block size-1.5 animate-pulse rounded-full bg-red-500 align-middle" />
      WATCHING LIVE · read-only · ` for System View
    </div>
  );
}
