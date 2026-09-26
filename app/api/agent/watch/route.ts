/**
 * GET /api/agent/watch?sessionId=…&agentTypeId=…
 *
 * Follows a TrueForge session for turns the game did not start — an approval,
 * answer or message sent from the embedded TrueForge UI (System View) — and
 * streams them as Server-Sent Events, so the game reacts to decisions made in
 * TrueForge's own interface. Each such turn is remembered like any other.
 */

import { NextRequest } from "next/server";
import { refreshAgent, sseResponse, watchSession } from "@/lib/trueforge";
import { rememberTurn } from "@/lib/agent-memory";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 3600;

export async function GET(req: NextRequest) {
  const sessionId = req.nextUrl.searchParams.get("sessionId");
  const agentTypeId = req.nextUrl.searchParams.get("agentTypeId") ?? undefined;
  if (!sessionId) return new Response("sessionId is required", { status: 400 });
  return sseResponse(
    watchSession(sessionId, req.signal, (turn) => rememberTurn(agentTypeId, sessionId, turn, refreshAgent))
  );
}
