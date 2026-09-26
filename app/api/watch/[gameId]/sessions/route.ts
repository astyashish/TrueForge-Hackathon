/**
 * GET /api/watch/[gameId]/sessions — the crew sessions of one game (read-only;
 * reachable by shared-link viewers).
 */

import { NextRequest, NextResponse } from "next/server";
import { watchSessionsForGame } from "@/lib/watch";

export const runtime = "nodejs";

export async function GET(_req: NextRequest, ctx: { params: Promise<{ gameId: string }> }) {
  const { gameId } = await ctx.params;
  const sessions = await watchSessionsForGame(gameId);
  if (!sessions) return NextResponse.json({ error: "Game not found." }, { status: 404 });
  return NextResponse.json({ sessions });
}
