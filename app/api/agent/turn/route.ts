/**
 * POST /api/agent/turn
 *
 * Sends the Operator's message to a TrueForge session and streams the
 * agent's work back as Server-Sent Events (text, tool calls, sandbox runs,
 * approval-required).
 *
 * Body: { sessionId: string, content: string, agentTypeId?: string }
 * What happened is written to the character's memory when the turn ends.
 * Response: text/event-stream of TFEvent
 */

import { NextRequest, NextResponse } from "next/server";
import { sendTurn, refreshAgent, sseResponse } from "@/lib/trueforge";
import { rememberTurn } from "@/lib/agent-memory";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 600;

export async function POST(req: NextRequest) {
  const { sessionId, content, agentTypeId } = await req.json().catch(() => ({}));

  if (!sessionId || !content) {
    return NextResponse.json(
      { error: "sessionId and content are required" },
      { status: 400 }
    );
  }

  return sseResponse(rememberTurn(agentTypeId, sessionId, sendTurn(sessionId, content, req.signal), refreshAgent));
}
