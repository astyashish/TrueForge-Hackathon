"use client";

/**
 * OpsTerminal — the Live Ops Terminal (PRD v2 §2).
 *
 * The character's workstation screen: every tool call their TrueForge session
 * makes, with the literal commands and output the ops MCP servers ran. It is a
 * filter over the live bus for one session — the same events System View and
 * the dialogue render. WORKING/IDLE is derived only from real activity: a turn
 * in flight or a tool call without a result yet.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Brain, ChevronLeft, ChevronRight, ExternalLink, Plug, TerminalSquare } from "lucide-react";
import { useLiveBus, type AgentFeedEvent } from "@/lib/live-bus";

type Props = {
  sessionId: string;
  agentName: string;
  typeName: string;
  mcpServers: { name: string; ok: boolean }[];
  memoryCount?: number;
  /** Same session in TrueForge's own UI. */
  trueforgeUrl?: string;
};

const SPIN = ["▖", "▘", "▝", "▗"];

function colorLine(line: string, i: number) {
  let cls = "text-white/70";
  if (line.startsWith("$ ")) cls = "text-cyan-300";
  else if (/FAIL|\[exit [1-9]|ERROR|UNHEALTHY|NOT RUNNING|unreachable| 500 /.test(line)) cls = "text-red-300";
  else if (/^\s*ok\b|PASSED|all tests passed|^200 |started |staged/.test(line)) cls = "text-emerald-300";
  else if (/^(diff|index|@@|\+\+\+|---)/.test(line)) cls = "text-white/40";
  else if (line.startsWith("+")) cls = "text-emerald-300/80";
  else if (line.startsWith("-")) cls = "text-red-300/80";
  return (
    <div key={i} className={`whitespace-pre-wrap break-all ${cls}`}>
      {line || " "}
    </div>
  );
}

function fmtArgs(args: Record<string, unknown>) {
  return Object.entries(args ?? {})
    .map(([k, v]) => `${k}=${typeof v === "string" ? v : JSON.stringify(v)}`)
    .join(" ");
}

export function OpsTerminal({ sessionId, agentName, typeName, mcpServers, memoryCount, trueforgeUrl }: Props) {
  const { agent, active } = useLiveBus();
  const [open, setOpen] = useState(true);
  const [tick, setTick] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);

  const events = useMemo(() => agent.filter((e) => e.sessionId === sessionId), [agent, sessionId]);

  // Fold each tool call's running + result events into one entry.
  const entries = useMemo(() => {
    const out: (AgentFeedEvent | { kind: "call"; start: AgentFeedEvent; end?: AgentFeedEvent })[] = [];
    const calls = new Map<string, { kind: "call"; start: AgentFeedEvent; end?: AgentFeedEvent }>();
    for (const e of events) {
      if (e.type === "tool_call") {
        const existing = calls.get(e.toolCallId);
        if (existing) existing.end = e.status === "running" ? existing.end : e;
        else {
          const entry = { kind: "call" as const, start: e, end: e.status === "running" ? undefined : e };
          calls.set(e.toolCallId, entry);
          out.push(entry);
        }
      } else if (e.type !== "done" && e.type !== "sandbox_run") {
        out.push(e);
      }
    }
    return out;
  }, [events]);

  const toolRunning = entries.some((e) => "kind" in e && !e.end);
  const working = Boolean(active[sessionId]) || toolRunning;

  useEffect(() => {
    if (!working) return;
    const iv = setInterval(() => setTick((n) => n + 1), 140);
    return () => clearInterval(iv);
  }, [working]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 1e9, behavior: "smooth" });
  }, [events.length, open]);

  return (
    <div className="pointer-events-auto flex h-full items-start">
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ opacity: 0, x: -24 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -24 }}
            transition={{ duration: 0.25 }}
            className="relative flex h-full w-[min(88vw,420px)] flex-col overflow-hidden rounded-xl border border-emerald-400/25 bg-[#04070a]/95 font-mono text-[11px] leading-relaxed shadow-[0_0_40px_-12px_rgba(52,211,153,0.45)]"
          >
            <div className="pointer-events-none absolute inset-0 bg-[repeating-linear-gradient(0deg,rgba(255,255,255,0.02)_0px,rgba(255,255,255,0.02)_1px,transparent_1px,transparent_3px)]" />
            {/* Header */}
            <div className="border-b border-emerald-400/15 px-3 py-2">
              <div className="flex items-center gap-2">
                <TerminalSquare size={13} className="text-emerald-300" />
                <span className="truncate text-[10px] font-bold uppercase tracking-[0.2em] text-emerald-200">
                  {agentName} · ops terminal
                </span>
                <span
                  className={`ml-auto flex items-center gap-1.5 rounded px-1.5 py-0.5 text-[9px] font-bold tracking-widest ${
                    working ? "bg-amber-400/15 text-amber-300" : "bg-white/5 text-white/40"
                  }`}
                >
                  <span className={`size-1.5 rounded-full ${working ? "animate-pulse bg-amber-300" : "bg-white/30"}`} />
                  {working ? "WORKING" : "IDLE"}
                </span>
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[9px] text-white/40">
                <span>{typeName}</span>
                {mcpServers.map((s) => (
                  <span key={s.name} className={`flex items-center gap-1 ${s.ok ? "text-cyan-300/70" : "text-red-300/70"}`}>
                    <Plug size={9} /> {s.name}
                  </span>
                ))}
                {memoryCount != null && (
                  <span className="flex items-center gap-1">
                    <Brain size={9} /> {memoryCount} memory note{memoryCount === 1 ? "" : "s"}
                  </span>
                )}
                {trueforgeUrl && (
                  <a
                    href={trueforgeUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="ml-auto flex items-center gap-1 text-emerald-300/80 hover:text-emerald-200"
                  >
                    Open in TrueForge <ExternalLink size={9} />
                  </a>
                )}
              </div>
            </div>
            {/* Body */}
            <div ref={scrollRef} className="relative flex-1 overflow-y-auto px-3 py-2">
              {entries.length === 0 && (
                <p className="text-white/30">
                  $ _ <span className="ml-1">idle — ask {agentName.split(" ")[0]} to do something.</span>
                </p>
              )}
              {entries.map((e, i) => {
                if ("kind" in e) {
                  const { start, end } = e;
                  if (start.type !== "tool_call") return null;
                  const denied = end?.type === "tool_call" && end.status === "error";
                  return (
                    <div key={`c${i}`} className="mb-2">
                      <div className="flex gap-1.5 text-fuchsia-300">
                        <span>{end ? (denied ? "✗" : "▸") : SPIN[tick % SPIN.length]}</span>
                        <span className="break-all">
                          {start.server ? `${start.server} › ` : "trueforge › "}
                          <span className="font-bold">{start.toolName}</span>
                          {fmtArgs(start.arguments) && <span className="text-white/45"> {fmtArgs(start.arguments)}</span>}
                        </span>
                      </div>
                      {end?.type === "tool_call" && end.output && (
                        <div className="ml-3 border-l border-white/10 pl-2">
                          {end.output.split(/\r?\n/).slice(0, 200).map(colorLine)}
                        </div>
                      )}
                    </div>
                  );
                }
                if (e.type === "approval_required") {
                  return (
                    <div key={i} className="mb-2 rounded border border-amber-400/30 bg-amber-400/5 px-2 py-1 text-amber-200">
                      ⛔ THRESHOLD — {e.summary} · awaiting Operator
                    </div>
                  );
                }
                if (e.type === "approval_resolved") {
                  return (
                    <div key={i} className={`mb-2 ${e.decision === "approved" ? "text-emerald-300" : "text-red-300"}`}>
                      ⏵ Operator {e.decision === "approved" ? "APPROVED" : "DENIED"} {e.toolName ?? ""}
                      {e.via ? " (in TrueForge UI)" : ""}
                    </div>
                  );
                }
                if (e.type === "question") {
                  return (
                    <div key={i} className="mb-2 rounded border border-cyan-400/30 bg-cyan-400/5 px-2 py-1 text-cyan-200">
                      ? ask_user_question — {e.question}
                      {e.options.length > 0 && <span className="text-white/45"> [{e.options.join(" | ")}]</span>}
                    </div>
                  );
                }
                if (e.type === "question_answered") {
                  return (
                    <div key={i} className="mb-2 text-cyan-300">
                      ⏵ Operator answered{e.via ? " in TrueForge UI" : ""}: {e.answer}
                    </div>
                  );
                }
                if (e.type === "external_message") {
                  return (
                    <div key={i} className="mb-2 text-white/70">
                      ⏵ Operator: {e.content}
                    </div>
                  );
                }
                if (e.type === "text") {
                  return (
                    <div key={i} className="mb-2 text-white/45">
                      # {e.content.length > 220 ? `${e.content.slice(0, 220)}…` : e.content}
                    </div>
                  );
                }
                if (e.type === "error") {
                  return (
                    <div key={i} className="mb-2 text-red-300">
                      ! {e.message}
                    </div>
                  );
                }
                return null;
              })}
              {working && !toolRunning && (
                <div className="text-amber-300/80">{SPIN[tick % SPIN.length]} agent thinking…</div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="ml-1 mt-2 rounded-r-md border border-l-0 border-emerald-400/25 bg-[#04070a]/90 px-1 py-3 text-emerald-300"
        title={open ? "Hide terminal" : "Show terminal"}
      >
        {open ? <ChevronLeft size={14} /> : <ChevronRight size={14} />}
      </button>
    </div>
  );
}
