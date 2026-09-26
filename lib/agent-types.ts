/**
 * Agent Types — data, not hardcoded per district (PRD v2 §3).
 *
 * Built-in types ship with the repo (skill packs in skills/<id>/SKILL.md).
 * Custom types are created at runtime from the landing page and stored in
 * .threshold/agent-types.json with their skill pack in .threshold/skills/.
 * Server-only (reads the filesystem).
 */

import fs from "node:fs/promises";
import path from "node:path";

export type AgentType = {
  id: string;
  /** Character role name, e.g. "Git Warden". */
  name: string;
  /** One-line job description. */
  role: string;
  /** Real system scope: TrueForge MCP server names this type may reach. */
  mcpServers: string[];
  /** Approval policy: tool names or TrueForge selectors (@write, @destructive, @all). */
  approvalTools: string[];
  /** Ask TrueForge for a sandbox (only honoured when one is configured). */
  sandbox: boolean;
  /** Skill pack path, relative to the app root. */
  skillPath: string;
  /** Max agent-loop iterations per turn (TrueForge runtime config). */
  iterationLimit?: number;
  /** Visual identity used when the world generator paints this character. */
  look: string;
  custom?: boolean;
};

export const BUILTIN_AGENT_TYPES: AgentType[] = [
  {
    id: "git-warden",
    iterationLimit: 30,
    name: "Git Warden",
    role: "Reviews and merges pull requests",
    mcpServers: ["threshold-git"],
    approvalTools: ["merge_pull_request"],
    sandbox: false,
    skillPath: "skills/git-warden/SKILL.md",
    look: "a sharp-eyed code reviewer in a hooded jacket stitched with glowing branch diagrams, surrounded by floating diff panes",
  },
  {
    id: "deploy-runner",
    iterationLimit: 30,
    name: "Deploy Runner",
    role: "Builds, tests and ships releases",
    mcpServers: ["threshold-deploy"],
    approvalTools: ["deploy_production", "rollback"],
    sandbox: false,
    skillPath: "skills/deploy-runner/SKILL.md",
    look: "a restless release engineer in a high-vis flight jacket beside a launch console of pipeline lights",
  },
  {
    id: "server-sentinel",
    iterationLimit: 20,
    name: "Server Sentinel",
    role: "Watches the live server and intervenes",
    mcpServers: ["threshold-server"],
    approvalTools: ["restart_service", "stop_service"],
    sandbox: false,
    skillPath: "skills/server-sentinel/SKILL.md",
    look: "a watchful night-shift sysadmin in a headset, lit by racks of blinking server LEDs and scrolling logs",
  },
  {
    id: "cloud-cost-janitor",
    iterationLimit: 30,
    name: "Cost Janitor",
    role: "Finds idle cloud resources and cleans them up",
    mcpServers: (process.env.CLOUD_MCP_SERVERS ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
    approvalTools: ["@write", "@destructive"],
    sandbox: true,
    skillPath: "skills/cloud-cost-janitor/SKILL.md",
    look: "a scrapyard janitor in a neon-striped coverall sorting glowing decommissioned server blades",
  },
];

export { DEFAULT_CREW } from "./crew";

const DATA_DIR = path.join(process.cwd(), ".threshold");
const CUSTOM_FILE = path.join(DATA_DIR, "agent-types.json");

async function readCustom(): Promise<AgentType[]> {
  try {
    return JSON.parse(await fs.readFile(CUSTOM_FILE, "utf8")) as AgentType[];
  } catch {
    return [];
  }
}

export async function listAgentTypes(): Promise<AgentType[]> {
  return [...BUILTIN_AGENT_TYPES, ...(await readCustom())];
}

export async function getAgentType(id: string | undefined): Promise<AgentType> {
  const all = await listAgentTypes();
  return all.find((t) => t.id === id) ?? all[0];
}

export async function readSkillPack(type: AgentType): Promise<string> {
  try {
    return await fs.readFile(path.join(process.cwd(), type.skillPath), "utf8");
  } catch {
    return `# ${type.name}\n\n${type.role}`;
  }
}

function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "agent"
  );
}

/** Create a custom agent type at runtime; its skill pack is written to disk. */
export async function createAgentType(input: {
  name: string;
  role: string;
  mcpServers: string[];
  approvalTools: string[];
  instructions: string;
  look?: string;
}): Promise<AgentType> {
  const all = await listAgentTypes();
  let id = slugify(input.name);
  for (let i = 2; all.some((t) => t.id === id); i++) id = `${slugify(input.name)}-${i}`;
  const skillPath = path.join(".threshold", "skills", id, "SKILL.md");
  const skill = `---\nname: ${id}\ndescription: ${input.role.replace(/\n/g, " ")}\n---\n\n# ${input.name}\n\n${input.instructions.trim()}\n`;
  await fs.mkdir(path.dirname(path.join(process.cwd(), skillPath)), { recursive: true });
  await fs.writeFile(path.join(process.cwd(), skillPath), skill);
  const type: AgentType = {
    id,
    name: input.name.trim().slice(0, 40),
    role: input.role.trim().slice(0, 120),
    mcpServers: input.mcpServers,
    approvalTools: input.approvalTools.length ? input.approvalTools : ["@write", "@destructive"],
    sandbox: true,
    skillPath: skillPath.replace(/\\/g, "/"),
    look: input.look?.trim() || `an operator-agent known as the ${input.name}, in a neon-lit workstation`,
    custom: true,
  };
  const custom = await readCustom();
  custom.push(type);
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(CUSTOM_FILE, JSON.stringify(custom, null, 2));
  return type;
}
