"use client";

/**
 * TrueForgePanel — System View as TrueForge's own UI, embedded.
 *
 * Frames TrueForge's own served app (http://localhost:8790/sessions/<id>) —
 * the upstream UI, unbranded, opened on the exact session the player is in.
 * Approving a tool call here is a real approval on that session; the game
 * picks it up through its session watcher (components/SystemViewHost.tsx).
 *
 * Why a frame and not the @truefoundry/trueforge-ui npm component: v0.3.1 of
 * that component crashed on mount in this app ("Maximum update depth exceeded
 * … getSnapshot should be cached", inside @assistant-ui/tap) with default
 * props, under both the App and Pages routers. TrueForge's own build of the
 * same UI works, so we embed that.
 */

import { ExternalLink, X } from "lucide-react";

type Props = {
  /** TrueForge's own URL for this session (…/sessions/<id>). */
  trueforgeUrl: string;
  agentName: string;
  /** Bump to reload the frame (re-read the session) after the game changed it. */
  refreshKey?: string | number;
  onClose: () => void;
};

export function TrueForgePanel({ trueforgeUrl, agentName, refreshKey, onClose }: Props) {
  return (
    <div className="pointer-events-auto fixed inset-y-0 right-0 z-[70] flex w-[min(100vw,560px)] flex-col border-l border-white/15 bg-black shadow-2xl">
      <div className="flex items-center gap-2 border-b border-white/10 bg-black px-3 py-2 text-[11px] text-white/70">
        <span className="font-bold uppercase tracking-widest text-white">System View</span>
        <span className="truncate font-mono text-white/40">TrueForge · {agentName}</span>
        <a
          href={trueforgeUrl}
          target="_blank"
          rel="noreferrer"
          className="ml-auto flex shrink-0 items-center gap-1 rounded border border-white/15 px-1.5 py-0.5 text-white/80 hover:text-white"
        >
          Open in TrueForge <ExternalLink size={11} />
        </a>
        <button
          type="button"
          onClick={onClose}
          className="shrink-0 rounded p-1 text-white/60 hover:text-white"
          title="Close System View (`)"
        >
          <X size={14} />
        </button>
      </div>
      <iframe
        key={refreshKey ?? 0}
        src={trueforgeUrl}
        title={`TrueForge session — ${agentName}`}
        className="min-h-0 w-full flex-1 border-0 bg-black"
      />
    </div>
  );
}
