/**
 * GET /api/watch/[gameId]/feed — live, read-only mirror of one game's crew
 * sessions for shared-link viewers: replays each session's recent turns, then
 * follows new turns live (streamed while they run). Server-Sent Events of
 * { sessionId, event }. Only sessions bound to this game are ever read.
 */

import { NextRequest } from "next/server";
import { watchSessionsForGame } from "@/lib/watch";
import { listAllTurns, pendingForTurn, replayTurn, type TFEvent } from "@/lib/trueforge";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 3600;

const HISTORY_TURNS = 4;

export async function GET(req: NextRequest, ctx: { params: Promise<{ gameId: string }> }) {
  const { gameId } = await ctx.params;
  const sessions = await watchSessionsForGame(gameId);
  if (!sessions) return new Response("Game not found.", { status: 404 });
  const signal = req.signal;
  const encoder = new TextEncoder();

  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (payload: unknown) => {
        if (!signal.aborted) controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
      };
      const ping = setInterval(() => !signal.aborted && controller.enqueue(encoder.encode(": ping\n\n")), 15000);

      async function follow(sessionId: string) {
        const known = new Set<string>();
        const play = async (turnId: string, turns: Awaited<ReturnType<typeof listAllTurns>>, history: boolean) => {
          const turn = turns.find((t) => t.id === turnId)!;
          const prev = turns.find((t) => t.id === turn.previousTurnId);
          const prevPending = prev ? await pendingForTurn(sessionId, prev).catch(() => null) : null;
          for await (const event of replayTurn(sessionId, turn, prevPending, signal, false)) {
            send({ sessionId, history, event: event as TFEvent });
          }
        };
        try {
          const turns = await listAllTurns(sessionId);
          for (const t of turns) known.add(t.id);
          for (const t of turns.slice(-HISTORY_TURNS)) await play(t.id, turns, t.state.status !== "running");
          send({ sessionId, event: { type: "history_end" } });
          while (!signal.aborted) {
            await new Promise((r) => setTimeout(r, 1500));
            const latest = await listAllTurns(sessionId).catch(() => []);
            for (const t of latest) {
              if (known.has(t.id)) continue;
              known.add(t.id);
              await play(t.id, latest, false);
            }
          }
        } catch (err) {
          if (!signal.aborted) send({ sessionId, event: { type: "error", message: String(err).slice(0, 200) } });
        }
      }

      await Promise.all(sessions.map((s) => follow(s.sessionId)));
      clearInterval(ping);
      try {
        controller.close();
      } catch {}
    },
  });
  return new Response(body, {
    headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no" },
  });
}
