/** Client-safe crew constants (lib/agent-types.ts is server-only). */

/** Default crew, room i → agent type i: code reviewed → shipped → watched. */
export const DEFAULT_CREW = ["git-warden", "deploy-runner", "server-sentinel"];

/** Agent type as the client sees it (GET /api/agent-types). */
export type AgentTypeSummary = {
  id: string;
  name: string;
  role: string;
  mcpServers: string[];
  approvalTools: string[];
  custom?: boolean;
  /** Every MCP server in scope is configured and reachable in TrueForge. */
  ready: boolean;
  /** The saved TrueForge Agent for this type, once synced. */
  trueforge?: { agentName: string; agentId: string; url: string };
};
