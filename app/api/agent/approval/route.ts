/**
 * POST /api/agent/approval
 *
 * Resolves a pending TrueForge approval checkpoint — the Threshold Card
 * decision — and streams the resumed agent turn back as Server-Sent Events.
 * Each decision is logged to Supabase `approval_events` (best-effort) for the
 * finale summary.
 *
 * Body: {
 *   sessionId: string,
 *   approvalId: string,
 *   threadId: string,
 *   toolCallIds: string[],
 *   decision: "approved" | "denied",
 *   toolName?: string,
 *   server?: string,
 *   summary?: string,
 *   riskLevel?: "reversible" | "irreversible" | "catastrophic",
 *   reviewedDetail?: boolean,
 *   blastRadiusDelta?: number,
 *   gameId?: string,
 *   agentTypeId?: string,
 * }
 * Response: text/event-stream of TFEvent
 */

import { NextRequest, NextResponse } from "next/server";
import { resolveApproval, refreshAgent, sseResponse } from "@/lib/trueforge";
import { rememberTurn } from "@/lib/agent-memory";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 600;

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const {
    sessionId,
    approvalId,
    threadId,
    toolCallIds,
    decision,
    toolName,
    server,
    summary,
    riskLevel = "irreversible",
    reviewedDetail = false,
    blastRadiusDelta = 0,
    gameId,
    agentTypeId,
  } = body;

  if (
    !sessionId ||
    !approvalId ||
    !threadId ||
    !Array.isArray(toolCallIds) ||
    toolCallIds.length === 0 ||
    (decision !== "approved" && decision !== "denied")
  ) {
    return NextResponse.json(
      { error: "sessionId, approvalId, threadId, toolCallIds and decision are required" },
      { status: 400 }
    );
  }

  const supabase = await createClient();
  const { error } = await supabase.from("approval_events").insert({
    session_id: sessionId,
    game_id: gameId ?? null,
    tool_name: toolName ?? "unknown",
    summary: summary ?? "",
    risk_level: riskLevel,
    decision,
    reviewed_detail: reviewedDetail,
    blast_radius_delta: blastRadiusDelta,
  });
  if (error) console.warn("[agent/approval] log insert:", error.message);

  return sseResponse(
    rememberTurn(
      agentTypeId,
      sessionId,
      resolveApproval(
        sessionId,
        { approvalId, threadId, toolCallIds, toolName, server, summary },
        decision,
        req.signal
      ),
      refreshAgent
    )
  );
}
