/**
 * `GET /api/agent-types`  — agent types + which MCP servers are live in TrueForge.
 * `POST /api/agent-types` — create a custom agent type at runtime; it is synced
 *   to a saved TrueForge Agent immediately.
 *
 * POST body: { name, role, instructions, mcpServers: string[], approvalTools: string[], look? }
 */

import { NextRequest, NextResponse } from "next/server";
import { createAgentType, listAgentTypes } from "@/lib/agent-types";
import {
  cachedAgent,
  describeError,
  ensureAgentType,
  listMcpServersWithTools,
  trueforgeLinks,
} from "@/lib/trueforge";
import type { AgentTypeSummary } from "@/lib/crew";

export const runtime = "nodejs";

export async function GET() {
  const [types, servers] = await Promise.all([
    listAgentTypes(),
    listMcpServersWithTools().catch((err) => {
      console.warn("[agent-types] TrueForge unreachable:", describeError(err));
      return null;
    }),
  ]);
  const live = new Set((servers ?? []).filter((s) => s.ok).map((s) => s.name));
  const agents = await Promise.all(types.map((t) => cachedAgent(t.id)));
  const summaries: AgentTypeSummary[] = types.map((t, i) => ({
    id: t.id,
    name: t.name,
    role: t.role,
    mcpServers: t.mcpServers,
    approvalTools: t.approvalTools,
    custom: t.custom,
    ready: t.mcpServers.length > 0 && t.mcpServers.every((m) => live.has(m)),
    trueforge: agents[i]
      ? { ...agents[i]!, url: trueforgeLinks(agents[i]!.agentId).agent! }
      : undefined,
  }));
  return NextResponse.json({
    types: summaries,
    trueforge: servers !== null,
    mcpServers: servers ?? [],
  });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const role = typeof body.role === "string" ? body.role.trim() : "";
  const instructions = typeof body.instructions === "string" ? body.instructions.trim() : "";
  const strings = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
  if (!name || !role || !instructions) {
    return NextResponse.json({ error: "name, role and instructions are required" }, { status: 400 });
  }
  const type = await createAgentType({
    name,
    role,
    instructions,
    mcpServers: strings(body.mcpServers),
    approvalTools: strings(body.approvalTools),
    look: typeof body.look === "string" ? body.look : undefined,
  });
  // Make it a real TrueForge Agent right away — visible on TrueForge's Agents page.
  const agent = await ensureAgentType(type).catch((err) => {
    console.warn("[agent-types] TrueForge agent sync failed:", describeError(err));
    return null;
  });
  return NextResponse.json(
    {
      type: {
        ...type,
        trueforge: agent
          ? { agentName: agent.agentName, agentId: agent.agentId, url: trueforgeLinks(agent.agentId).agent }
          : undefined,
      },
      trueforgeError: agent ? undefined : "TrueForge unreachable — the agent will sync on next start.",
    },
    { status: 201 }
  );
}
