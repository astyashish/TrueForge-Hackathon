/**
 * Read-only "Watch" data for shared links: which TrueForge sessions belong to
 * one game, and a live feed of those sessions only. Scoped by the game's own
 * district → session bindings, so a viewer can never reach other games'
 * sessions or TrueForge itself.
 */

import { getGameRecord } from "@/lib/games";
import { listLocalBindings } from "@/lib/local-bindings";
import { createClient } from "@/lib/supabase/server";
import { getAgentType } from "@/lib/agent-types";

export type WatchSession = {
  districtId: string;
  sessionId: string;
  npcName: string;
  agentType: { id: string; name: string; role: string; approvalTools: string[] };
};

export async function watchSessionsForGame(gameId: string): Promise<WatchSession[] | null> {
  const game = await getGameRecord(gameId);
  if (!game) return null;
  const bindings = new Map<string, string>();
  for (const b of await listLocalBindings(gameId)) bindings.set(b.districtId, b.sessionId);
  try {
    const supabase = await createClient();
    const { data } = await supabase
      .from("agent_bindings")
      .select("district_id, trueforge_session_id")
      .eq("game_id", gameId);
    for (const row of data ?? []) bindings.set(row.district_id, row.trueforge_session_id);
  } catch {}

  const out: WatchSession[] = [];
  for (const [districtId, sessionId] of bindings) {
    const m = /^b(\d)$/.exec(districtId);
    if (!m) continue; // only the game's crew rooms
    const i = Number(m[1]);
    const type = await getAgentType(game.bible.crew?.[i]);
    out.push({
      districtId,
      sessionId,
      npcName: game.bible.npcs[i]?.name ?? type.name,
      agentType: { id: type.id, name: type.name, role: type.role, approvalTools: type.approvalTools },
    });
  }
  return out.sort((a, b) => a.districtId.localeCompare(b.districtId));
}
