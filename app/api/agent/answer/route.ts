/**
 * POST /api/agent/answer
 *
 * Answers TrueForge's native `ask_user_question` (a client-side tool that
 * pauses the turn) with a `user.tool_response`, and streams the resumed turn
 * back as Server-Sent Events. The answer is remembered with the turn.
 *
 * Body: { sessionId, questionId, threadId, toolCallId, answer, question?, agentTypeId? }
 */

import { NextRequest, NextResponse } from "next/server";
import { answerQuestion, refreshAgent, sseResponse } from "@/lib/trueforge";
import { rememberTurn } from "@/lib/agent-memory";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 600;

export async function POST(req: NextRequest) {
  const { sessionId, questionId, threadId, toolCallId, answer, question, agentTypeId } = await req
    .json()
    .catch(() => ({}));
  if (!sessionId || !threadId || !toolCallId || typeof answer !== "string" || !answer.trim()) {
    return NextResponse.json(
      { error: "sessionId, threadId, toolCallId and answer are required" },
      { status: 400 }
    );
  }
  return sseResponse(
    rememberTurn(
      agentTypeId,
      sessionId,
      answerQuestion(sessionId, { questionId, threadId, toolCallId, question }, answer.trim(), req.signal),
      refreshAgent
    )
  );
}
