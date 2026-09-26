"use client";

/**
 * Two-way glue between the game and TrueForge's own UI for one session.
 *
 * - <SessionWatcher>: while the game has no turn of its own in flight, follow
 *   the session (/api/agent/watch) for turns started elsewhere — an approval,
 *   answer or message sent from the embedded TrueForge UI — and put them on
 *   the live bus (flagged `external`), so the dialogue, ops terminal and
 *   Threshold Card react to them.
 * - <SystemViewHost>: TrueForge's own UI in a frame, reloaded after each
 *   turn the game itself ran so it re-reads the session.
 */

import { useEffect, useMemo, useRef } from "react";
import { publishAgent, useLiveBus, type AgentFeedEvent } from "@/lib/live-bus";
import type { TFEvent } from "@/lib/trueforge";
import { TrueForgePanel } from "./TrueForgePanel";

export function SessionWatcher({
  sessionId,
  agentLabel,
  agentTypeId,
  onExternalDecision,
}: {
  sessionId: string;
  agentLabel: string;
  agentTypeId: string;
  onExternalDecision: (decision: "approved" | "denied") => void;
}) {
  const busy = Boolean(useLiveBus().active[sessionId]);
  const onDecisionRef = useRef(onExternalDecision);
  onDecisionRef.current = onExternalDecision;
  const seq = useRef(0);

  useEffect(() => {
    if (busy) return;
    const ctrl = new AbortController();
    (async () => {
      try {
        const res = await fetch(
          `/api/agent/watch?sessionId=${encodeURIComponent(sessionId)}&agentTypeId=${encodeURIComponent(agentTypeId)}`,
          { signal: ctrl.signal }
        );
        if (!res.ok || !res.body) return;
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
            let ev: TFEvent;
            try {
              ev = JSON.parse(chunk.slice(5).trimStart()) as TFEvent;
            } catch {
              continue;
            }
            publishAgent({
              ...ev,
              id: `ext-${Date.now()}-${seq.current++}`,
              timestamp: new Date().toISOString(),
              sessionId,
              agent: agentLabel,
              external: true,
            } as AgentFeedEvent);
            if (ev.type === "approval_resolved") onDecisionRef.current(ev.decision);
          }
        }
      } catch {
        // aborted (the game started its own turn) or the server went away
      }
    })();
    return () => ctrl.abort();
  }, [busy, sessionId, agentLabel, agentTypeId]);

  return null;
}

export function SystemViewHost(props: {
  sessionId: string;
  agentName: string;
  trueforgeUrl: string;
  onClose: () => void;
}) {
  const { agent } = useLiveBus();
  // Turns the game ran (not external) — remount the panel so it re-reads the session.
  const refreshKey = useMemo(
    () => agent.filter((e) => e.sessionId === props.sessionId && e.type === "done" && !e.external).length,
    [agent, props.sessionId]
  );
  return (
    <TrueForgePanel
      trueforgeUrl={props.trueforgeUrl}
      agentName={props.agentName}
      refreshKey={refreshKey}
      onClose={props.onClose}
    />
  );
}
