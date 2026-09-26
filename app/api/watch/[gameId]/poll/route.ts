/**
 * GET /api/watch/[gameId]/poll — read-only snapshot of one game's crew
 * sessions for shared-link viewers: the recent turns of each session, each
 * replayed deterministically from TrueForge's stored events. Viewers poll it
 * (Cloudflare quick tunnels don't deliver Server-Sent Events) and render only
 * events they haven't seen, keyed by turn id + position.
 */

import { NextRequest, NextResponse } from "next/server";
import { watchSessionsForGame } from "@/lib/watch";
import { listAllTurns, pendingForTurn, replayTurn, type TFEvent } from "@/lib/trueforge";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RECENT_TURNS = 5;

export async function GET(req: NextRequest, ctx: { params: Promise<{ gameId: string }> }) {
  const { gameId } = await ctx.params;
  const sessions = await watchSessionsForGame(gameId);
  if (!sessions) return NextResponse.json({ error: "Game not found." }, { status: 404 });

  const out = await Promise.all(
    sessions.map(async (s) => {
      try {
        const turns = await listAllTurns(s.sessionId);
        const recent = await Promise.all(
          turns.slice(-RECENT_TURNS).map(async (turn) => {
            const prev = turns.find((t) => t.id === turn.previousTurnId);
            const prevPending = prev ? await pendingForTurn(s.sessionId, prev).catch(() => null) : null;
            const events: TFEvent[] = [];
            for await (const e of replayTurn(s.sessionId, turn, prevPending, req.signal, false, false)) events.push(e);
            return { turnId: turn.id, running: turn.state.status === "running", events };
          })
        );
        return { sessionId: s.sessionId, turns: recent };
      } catch {
        return { sessionId: s.sessionId, turns: [] };
      }
    })
  );
  return NextResponse.json({ sessions: out }, { headers: { "Cache-Control": "no-store" } });
}
