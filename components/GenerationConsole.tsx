"use client";

/**
 * GenerationConsole — "how the world is cooking" (PRD v2 §1).
 *
 * A pure subscriber to the live bus: every line is a stage streamed by a real
 * backend step (model call, TrueForge call, MCP handshake, database write).
 * There is no timeline of its own — a slow step simply sits at "running".
 *
 * - `full`: the boot screen while a world is first built.
 * - `dock`: a compact corner console during play; appears while anything is
 *   generating and fades out a few seconds after the last step resolves.
 */

import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ChevronDown, ChevronUp, Cpu } from "lucide-react";
import { useLiveBus, type ConsoleGroup } from "@/lib/live-bus";

const SPINNER = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

function useSpinner(active: boolean) {
  const [i, setI] = useState(0);
  useEffect(() => {
    if (!active) return;
    const iv = setInterval(() => setI((n) => (n + 1) % SPINNER.length), 90);
    return () => clearInterval(iv);
  }, [active]);
  return SPINNER[i];
}

function fmtMs(ms?: number) {
  if (ms == null) return "";
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
}

function StageLine({
  stage,
  spin,
  compact,
}: {
  stage: ConsoleGroup["stages"][number];
  spin: string;
  compact?: boolean;
}) {
  const icon =
    stage.status === "running" ? (
      <span className="text-amber-300">{spin}</span>
    ) : stage.status === "done" ? (
      <span className="text-emerald-400">✓</span>
    ) : stage.status === "error" ? (
      <span className="text-red-400">✗</span>
    ) : (
      <span className="text-white/30">–</span>
    );
  return (
    <div className={compact ? "py-px" : "py-0.5"}>
      <div className="flex items-baseline gap-2">
        <span className="w-3 shrink-0 text-center">{icon}</span>
        <span className={`shrink-0 ${stage.status === "running" ? "text-white" : "text-white/75"}`}>
          {stage.label}
        </span>
        <span className="min-w-4 flex-1 overflow-hidden whitespace-nowrap text-white/15">
          {"·".repeat(80)}
        </span>
        <span className="max-w-[45%] shrink-0 truncate text-cyan-300/80">{stage.tech}</span>
        {stage.status !== "running" && (
          <span className="w-12 shrink-0 text-right tabular-nums text-white/35">{fmtMs(stage.ms)}</span>
        )}
      </div>
      {stage.detail && !compact && (
        <div
          className={`ml-5 truncate text-[10px] ${stage.status === "error" ? "text-red-300/80" : "text-white/35"}`}
        >
          {stage.detail}
        </div>
      )}
    </div>
  );
}

/** Latest intermediate artifact, revealed progressively (blurred → sharp). */
function Preview({ src }: { src: string }) {
  return (
    <div className="relative aspect-[4/3] w-full overflow-hidden rounded-md border border-fuchsia-400/30 bg-black">
      <AnimatePresence mode="popLayout">
        <motion.img
          key={src.slice(-64)}
          src={src}
          alt="Frame being generated"
          initial={{ opacity: 0, filter: "blur(14px) saturate(0.2) brightness(1.4)" }}
          animate={{ opacity: 1, filter: "blur(0px) saturate(1) brightness(1)" }}
          exit={{ opacity: 0 }}
          transition={{ duration: 1.6, ease: [0.16, 1, 0.3, 1] }}
          className="absolute inset-0 h-full w-full object-cover [image-rendering:pixelated]"
        />
      </AnimatePresence>
      <div className="pointer-events-none absolute inset-0 bg-[repeating-linear-gradient(0deg,rgba(0,0,0,0.25)_0px,rgba(0,0,0,0.25)_1px,transparent_1px,transparent_3px)]" />
      <motion.div
        className="pointer-events-none absolute inset-x-0 h-10 bg-gradient-to-b from-transparent via-cyan-300/15 to-transparent"
        animate={{ top: ["-15%", "110%"] }}
        transition={{ duration: 2.4, repeat: Infinity, ease: "linear" }}
      />
    </div>
  );
}

const SHELL =
  "relative overflow-hidden border border-cyan-400/25 bg-[#05070d]/95 font-mono text-[11px] leading-relaxed text-white shadow-[0_0_40px_-10px_rgba(34,211,238,0.35)]";

const SCANLINES =
  "pointer-events-none absolute inset-0 bg-[repeating-linear-gradient(0deg,rgba(255,255,255,0.025)_0px,rgba(255,255,255,0.025)_1px,transparent_1px,transparent_3px)]";

export function GenerationConsole({
  variant,
  subtitle,
  since = 0,
}: {
  variant: "full" | "dock";
  subtitle?: string;
  /** Only show groups started at/after this timestamp. */
  since?: number;
}) {
  const { groups } = useLiveBus();
  const visible = useMemo(() => groups.filter((g) => g.startedAt >= since), [groups, since]);
  const running = visible.some((g) => g.status === "running" || g.stages.some((s) => s.status === "running"));
  const spin = useSpinner(running);

  const preview = useMemo(() => {
    for (let gi = visible.length - 1; gi >= 0; gi--) {
      const s = [...visible[gi].stages].reverse().find((x) => x.preview);
      if (s?.preview) return s.preview;
    }
    return null;
  }, [visible]);

  // Dock: stay up while working, fade out 5s after everything resolves.
  const [dockHold, setDockHold] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => {
    if (variant !== "dock") return;
    if (running) {
      setDockHold(true);
      return;
    }
    const t = setTimeout(() => setDockHold(false), 5000);
    return () => clearTimeout(t);
  }, [running, variant]);

  if (variant === "full") {
    return (
      <div className={`${SHELL} w-full max-w-3xl rounded-xl`}>
        <div className={SCANLINES} />
        <div className="flex items-center gap-2 border-b border-cyan-400/15 px-4 py-2.5">
          <Cpu size={13} className="text-cyan-300" />
          <span className="text-[10px] font-bold uppercase tracking-[0.25em] text-cyan-200">
            Threshold · Generation Console
          </span>
          <span className="ml-auto text-[10px] text-white/35">{subtitle}</span>
        </div>
        <div className="grid gap-4 p-4 sm:grid-cols-[1fr_220px]">
          <div className="min-h-48 max-h-[55vh] overflow-y-auto pr-1">
            {visible.length === 0 && <p className="text-white/40">&gt; waiting for the first step…</p>}
            {visible.map((g) => (
              <div key={g.id} className="mb-2">
                <div className="flex items-center gap-2 text-[10px] uppercase tracking-widest text-fuchsia-300/80">
                  <span>#</span>
                  <span>{g.title}</span>
                  {g.status === "error" && <span className="text-red-400">failed</span>}
                </div>
                {g.stages.map((s) => (
                  <StageLine key={s.key} stage={s} spin={spin} />
                ))}
                {g.error && <div className="ml-5 text-[10px] text-red-300">{g.error}</div>}
              </div>
            ))}
            <div className="mt-1 text-white/50">
              &gt; {running ? <span className="text-amber-300">{spin} working</span> : "ready."}
              <span className="ml-1 inline-block h-3 w-1.5 animate-pulse bg-cyan-300/80 align-middle" />
            </div>
          </div>
          <div className="hidden sm:block">
            {preview ? (
              <Preview src={preview} />
            ) : (
              <div className="flex aspect-[4/3] items-center justify-center rounded-md border border-dashed border-white/10 text-[10px] text-white/25">
                frames appear here as they are painted
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  const recent = visible.slice(-3);
  return (
    <AnimatePresence>
      {dockHold && recent.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 12 }}
          transition={{ duration: 0.3 }}
          className={`${SHELL} pointer-events-auto w-[min(92vw,380px)] rounded-lg`}
        >
          <div className={SCANLINES} />
          <button
            type="button"
            onClick={() => setCollapsed((v) => !v)}
            className="flex w-full items-center gap-2 border-b border-cyan-400/15 px-3 py-1.5 text-left"
          >
            <Cpu size={11} className="text-cyan-300" />
            <span className="text-[9px] font-bold uppercase tracking-[0.2em] text-cyan-200">Generation</span>
            <span className="text-[10px] text-amber-300">{running ? spin : ""}</span>
            <span className="ml-auto text-white/40">{collapsed ? <ChevronUp size={12} /> : <ChevronDown size={12} />}</span>
          </button>
          {!collapsed && (
            <div className="max-h-56 overflow-y-auto px-3 py-2">
              {preview && running && (
                <div className="mb-2 w-28">
                  <Preview src={preview} />
                </div>
              )}
              {recent.map((g) => (
                <div key={g.id} className="mb-1">
                  <div className="text-[9px] uppercase tracking-widest text-fuchsia-300/70"># {g.title}</div>
                  {g.stages.slice(-6).map((s) => (
                    <StageLine key={s.key} stage={s} spin={spin} compact />
                  ))}
                </div>
              ))}
            </div>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
