"use client";

/**
 * Watch mode — what someone who opens a shared link gets (read-only).
 *
 * - <WatchFeed>: subscribes to /api/watch/<gameId>/feed (this game's crew
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

  useEffect(() => {
    const ctrl = new AbortController();
    (async () => {
      for (let attempt = 0; !ctrl.signal.aborted && attempt < 50; attempt++) {
        try {
          const res = await fetch(`/api/watch/${gameId}/feed`, { signal: ctrl.signal });
          if (!res.ok || !res.body) throw new Error(`feed ${res.status}`);
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
              const { sessionId, event } = JSON.parse(chunk.slice(5).trimStart()) as {
                sessionId: string;
                history?: boolean;
                event: TFEvent | { type: "history_end" };
              };
              if (event.type === "history_end") continue;
              // WORKING while a turn streams; IDLE once it is done.
              setAgentActive(sessionId, event.type !== "done");
              publishAgent({
                ...(event as TFEvent),
                id: `watch-${Date.now()}-${seq.current++}`,
                timestamp: new Date().toISOString(),
                sessionId,
                agent: labels.current.get(sessionId) ?? "crew",
              } as AgentFeedEvent);
            }
          }
        } catch {
          if (ctrl.signal.aborted) return;
        }
        await new Promise((r) => setTimeout(r, 3000)); // reconnect
      }
    })();
    return () => ctrl.abort();
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
            memoryCount={0}
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
