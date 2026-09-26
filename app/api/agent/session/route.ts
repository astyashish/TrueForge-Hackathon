/**
 * POST /api/agent/session
 *
 * Provisions (or resumes) the TrueForge session for one character: the agent
 * type in a given district of a game. Each step is streamed as a Generation
 * Console stage when the client sends `x-stage-stream: 1`.
 *
 * The district → session binding is kept locally (.threshold/) and, when its
 * RLS allows it, in Supabase `agent_bindings`.
 *
 * Sessions are created from the saved TrueForge Agent for the type (synced
 * first), so they are attributed to it on TrueForge's own Sessions page.
 *
 * Body: { gameId, districtId, agentTypeId?, npcName?, worldTitle? }
 * Result: { sessionId, created, pendingApproval, agentType, mcpServers, memoryCount, agentName, agentId, links }
 */

import { NextRequest, NextResponse } from "next/server";
import {
  agentNameFor,
  cachedAgent,
  createSessionFromAgent,
  describeError,
  ensureAgentType,
  getPendingApproval,
  getSession,
  trueforgeLinks,
} from "@/lib/trueforge";
import { getAgentType } from "@/lib/agent-types";
import { getMemory } from "@/lib/agent-memory";
import { createClient } from "@/lib/supabase/server";
import { getLocalBinding, setLocalBinding } from "@/lib/local-bindings";
import { stagedResponse } from "@/lib/stages";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(req: NextRequest) {
  const { gameId, districtId, agentTypeId, npcName, worldTitle } = await req.json().catch(() => ({}));

  if (!gameId || !districtId) {
    return NextResponse.json({ error: "gameId and districtId are required" }, { status: 400 });
  }

  return stagedResponse(
    req,
    async (report) => {
      const type = await getAgentType(agentTypeId);
      const supabase = await createClient();

      // 1. Resume this character's existing session if there is one.
      const bound = await report.stage(
        `looking up ${type.name}'s session`,
        "agent_bindings",
        async () => {
          const { data } = await supabase
            .from("agent_bindings")
            .select("trueforge_session_id")
            .eq("game_id", gameId)
            .eq("district_id", districtId)
            .maybeSingle();
          return data?.trueforge_session_id ?? (await getLocalBinding(gameId, districtId));
        },
        (id) => (id ? `found ${id}` : "none — provisioning a new one")
      );

      if (bound) {
        const session = await report.stage(
          "resuming agent session",
          "trueforge · sessions.get",
          () => getSession(bound),
          (s) => (s ? s.id : "gone — provisioning a new one")
        );
        if (session) {
          const pendingApproval = await report.stage(
            "checking for a paused approval",
            "trueforge · turns + events",
            () => getPendingApproval(session.id),
            (p) => (p ? "agent is waiting at the Threshold" : "none")
          );
          // Keep the saved TrueForge Agent (instructions, memory) in sync; cheap when unchanged.
          const agent =
            (await ensureAgentType(type).catch(() => null)) ??
            (await cachedAgent(type.id).then((c) => (c ? { ...c, mcpServers: [], nativeSkill: false } : null)));
          return {
            sessionId: session.id,
            created: false,
            pendingApproval,
            agentType: { id: type.id, name: type.name, role: type.role, approvalTools: type.approvalTools },
            mcpServers: agent?.mcpServers?.length
              ? agent.mcpServers
              : type.mcpServers.map((name) => ({ name, tools: 0, ok: true })),
            memoryCount: (await getMemory(type.id)).length,
            agentName: agent?.agentName ?? agentNameFor(type.id),
            agentId: agent?.agentId,
            nativeSkill: agent?.nativeSkill ?? false,
            links: trueforgeLinks(agent?.agentId, session.id),
          };
        }
      }

      // 2. Provision a new session.
      const info = await createSessionFromAgent({
        type,
        npcName,
        worldTitle,
        report,
        metadata: { gameId, districtId },
      });

      // 3. Record the binding: always locally, in Supabase when RLS allows.
      await setLocalBinding(gameId, districtId, info.sessionId).catch((err) =>
        console.warn("[agent/session] local binding:", err)
      );
      const { error } = await supabase.from("agent_bindings").upsert(
        {
          game_id: gameId,
          district_id: districtId,
          trueforge_session_id: info.sessionId,
          archetype: type.id,
          mcp_server_id: type.mcpServers[0] ?? null,
        },
        { onConflict: "game_id,district_id" }
      );
      if (error && !/row-level security/i.test(error.message)) {
        console.warn("[agent/session] binding upsert:", error.message);
      }

      return { ...info, created: true, pendingApproval: null };
    },
    (err) => {
      console.error("[agent/session]", err);
      return { message: describeError(err), status: 502 };
    }
  );
}
