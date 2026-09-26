/**
 * Local fallback for district → TrueForge session bindings.
 *
 * Supabase `agent_bindings` needs migration 0005 for the auth-free mode; until
 * it is applied (or when running fully offline) bindings live in a JSON file
 * next to the app so a page reload still resumes the district's session.
 */

import fs from "node:fs/promises";
import path from "node:path";

const FILE = path.join(process.cwd(), ".threshold", "agent-bindings.json");

type Bindings = Record<string, string>;

const key = (gameId: string, districtId: string) => `${gameId}:${districtId}`;

async function readAll(): Promise<Bindings> {
  try {
    return JSON.parse(await fs.readFile(FILE, "utf8")) as Bindings;
  } catch {
    return {};
  }
}

export async function getLocalBinding(gameId: string, districtId: string): Promise<string | null> {
  return (await readAll())[key(gameId, districtId)] ?? null;
}

export async function setLocalBinding(gameId: string, districtId: string, sessionId: string) {
  const all = await readAll();
  all[key(gameId, districtId)] = sessionId;
  await fs.mkdir(path.dirname(FILE), { recursive: true });
  await fs.writeFile(FILE, JSON.stringify(all, null, 2));
}

/** Every district → session binding recorded for one game. */
export async function listLocalBindings(gameId: string): Promise<{ districtId: string; sessionId: string }[]> {
  return Object.entries(await readAll())
    .filter(([k]) => k.startsWith(`${gameId}:`))
    .map(([k, sessionId]) => ({ districtId: k.slice(gameId.length + 1), sessionId }));
}
