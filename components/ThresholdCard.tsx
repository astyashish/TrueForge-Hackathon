"use client";

/**
 * ThresholdCard — the signature approval gate UI.
 *
 * Rendered when TrueForge emits an approval_required event, replacing the
 * default chat approval UI. The entire game world dims behind it, and the
 * Operator must explicitly Approve or Deny before the agent continues.
 *
 * Design spec (PRD §5.5):
 * - What the agent wants to do (plain language)
 * - Why (one line of the agent's own reasoning)
 * - The blast radius if it's wrong (reversible vs cannot be undone)
 * - Two choices: Approve / Deny
 */

import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  Shield,
  ShieldAlert,
  ShieldX,
  Terminal,
  X,
  Zap,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { playSfx } from "@/lib/sfx";

export type ApprovalPayload = {
  approvalId: string;
  sessionId: string;
  /** TrueForge thread that owns the paused tool calls. */
  threadId: string;
  /** Every tool call this decision resolves. */
  toolCallIds: string[];
  toolName: string;
  /** MCP server the tool lives on, when it's an MCP tool. */
  server?: string;
  /** Plain-language summary of what the agent wants to do. */
  summary: string;
  /** The agent's one-line reasoning (if surfaced by TrueForge). */
  reasoning?: string;
  /** Raw tool arguments for the System View panel. */
  arguments: Record<string, unknown>;
  riskLevel: "reversible" | "irreversible" | "catastrophic";
  gameId?: string;
};

type ThresholdCardProps = {
  payload: ApprovalPayload;
  onDecision: (
    decision: "approved" | "denied",
    reviewedDetail: boolean
  ) => void;
  /** Whether a decision is currently being submitted. */
  loading?: boolean;
};

const RISK_CONFIG = {
  reversible: {
    label: "Reversible",
    color: "text-emerald-400",
    bg: "bg-emerald-400/10",
    border: "border-emerald-400/30",
    Icon: Shield,
    blastLine: "This action can be undone. Low blast radius.",
  },
  irreversible: {
    label: "Cannot be undone",
    color: "text-amber-400",
    bg: "bg-amber-400/10",
    border: "border-amber-400/30",
    Icon: ShieldAlert,
    blastLine: "This action is permanent. Verify before approving.",
  },
  catastrophic: {
    label: "Catastrophic — high blast radius",
    color: "text-red-400",
    bg: "bg-red-400/10",
    border: "border-red-400/30",
    Icon: ShieldX,
    blastLine: "This action cannot be undone and affects multiple resources.",
  },
};

export function ThresholdCard({
  payload,
  onDecision,
  loading,
}: ThresholdCardProps) {
  const [detailOpen, setDetailOpen] = useState(false);
  const [reviewedDetail, setReviewedDetail] = useState(false);

  const risk = RISK_CONFIG[payload.riskLevel];
  const RiskIcon = risk.Icon;

  // Play an alert sound when the card appears
  useEffect(() => {
    playSfx("error"); // repurpose the error buzz as the gate alert
  }, []);

  const handleToggleDetail = () => {
    setDetailOpen((v) => !v);
    if (!reviewedDetail) setReviewedDetail(true);
  };

  const handleApprove = () => {
    onDecision("approved", reviewedDetail);
  };

  const handleDeny = () => {
    onDecision("denied", reviewedDetail);
  };

  return (
    <AnimatePresence>
      {/* Full-screen overlay dims the game world */}
      <motion.div
        key="threshold-overlay"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm"
      >
        <motion.div
          key="threshold-card"
          initial={{ scale: 0.92, opacity: 0, y: 20 }}
          animate={{ scale: 1, opacity: 1, y: 0 }}
          exit={{ scale: 0.92, opacity: 0, y: 20 }}
          transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
          className="pointer-events-auto w-full max-w-lg mx-4"
        >
          {/* Card body */}
          <div
            className={`rounded-2xl border-2 bg-background shadow-2xl ${risk.border}`}
          >
            {/* Header */}
            <div className={`rounded-t-2xl px-5 py-4 ${risk.bg}`}>
              <div className="flex items-start gap-3">
                <div className={`mt-0.5 shrink-0 ${risk.color}`}>
                  <RiskIcon size={22} strokeWidth={2} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <span className={`text-[10px] font-bold uppercase tracking-widest ${risk.color}`}>
                      Threshold · Agent Gate
                    </span>
                    <Badge
                      variant="neutral"
                      className={`text-[9px] ${risk.color} ${risk.bg}`}
                    >
                      {risk.label}
                    </Badge>
                  </div>
                  <p className="text-base font-bold text-foreground leading-snug">
                    {payload.summary}
                  </p>
                </div>
              </div>
            </div>

            {/* Body */}
            <div className="px-5 py-4 space-y-3">
              {/* Agent reasoning */}
              {payload.reasoning && (
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-widest text-inksoft mb-1">
                    Agent&apos;s reasoning
                  </p>
                  <p className="text-sm font-medium text-foreground leading-snug">
                    {payload.reasoning}
                  </p>
                </div>
              )}

              {/* Blast radius */}
              <div className="flex items-start gap-2">
                <Zap
                  size={13}
                  className={`mt-0.5 shrink-0 ${risk.color}`}
                  strokeWidth={2.5}
                />
                <p className={`text-xs font-semibold ${risk.color}`}>
                  {risk.blastLine}
                </p>
              </div>

              {/* Tool name */}
              <div className="flex items-center gap-2">
                <Terminal size={12} className="text-inksoft shrink-0" />
                <span className="text-[11px] font-mono text-inksoft">
                  {payload.server ? `${payload.server} / ` : ""}{payload.toolName}
                </span>
              </div>

              {/* Detail expander — tool arguments */}
              <button
                type="button"
                onClick={handleToggleDetail}
                className="flex w-full items-center gap-1.5 text-left text-[11px] font-semibold text-inksoft hover:text-foreground transition-colors"
              >
                {detailOpen ? (
                  <ChevronUp size={12} />
                ) : (
                  <ChevronDown size={12} />
                )}
                {detailOpen ? "Hide" : "Show"} tool arguments
                {!reviewedDetail && (
                  <span className="ml-auto text-[9px] font-bold uppercase tracking-widest text-amber-400">
                    Review reduces blast radius
                  </span>
                )}
              </button>

              <AnimatePresence>
                {detailOpen && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.2 }}
                    className="overflow-hidden"
                  >
                    <pre className="rounded-lg bg-black/30 p-3 text-[11px] font-mono text-emerald-300 overflow-x-auto max-h-40">
                      {JSON.stringify(payload.arguments, null, 2)}
                    </pre>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Warning for non-reviewed irreversible actions */}
              {!reviewedDetail &&
                payload.riskLevel !== "reversible" && (
                  <div className="flex items-center gap-2 rounded-lg bg-amber-400/10 px-3 py-2">
                    <AlertTriangle
                      size={12}
                      className="shrink-0 text-amber-400"
                    />
                    <p className="text-[11px] font-medium text-amber-300">
                      Expand tool arguments above to reduce blast radius before
                      approving.
                    </p>
                  </div>
                )}
            </div>

            {/* Footer — decision buttons */}
            <div className="flex gap-2 border-t border-border px-5 py-4">
              <Button
                id="threshold-deny-btn"
                type="button"
                variant="neutral"
                className="flex-1 gap-2"
                onClick={handleDeny}
                disabled={loading}
              >
                <X size={14} />
                Deny
              </Button>
              <Button
                id="threshold-approve-btn"
                type="button"
                className={`flex-1 gap-2 ${
                  payload.riskLevel === "catastrophic"
                    ? "bg-red-500 hover:bg-red-600"
                    : payload.riskLevel === "irreversible"
                    ? "bg-amber-500 hover:bg-amber-600"
                    : ""
                }`}
                onClick={handleApprove}
                disabled={loading}
              >
                <Shield size={14} />
                {loading ? "Processing…" : "Approve"}
              </Button>
            </div>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
