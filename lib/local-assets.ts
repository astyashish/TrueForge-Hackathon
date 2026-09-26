/**
 * Local fallback for generated world art (scenes + player sprite).
 *
 * In auth-free mode Supabase Storage rejects uploads until migration 0005 is
 * applied, so nothing was being saved and every load regenerated the world.
 * When a Supabase save fails, the scene (with its inline data-URL images) is
 * written to .threshold/scenes/<gameId>/ instead, and GET /api/games/[id]
 * merges it back — so reloads and shared "Watch" links show the same world
 * without generating anything.
 */

import fs from "node:fs/promises";
import path from "node:path";
import type { SceneData } from "@/lib/universe";

const ROOT = path.join(process.cwd(), ".threshold", "scenes");
const safe = (s: string) => s.replace(/[^A-Za-z0-9_-]/g, "_");
const dir = (gameId: string) => path.join(ROOT, safe(gameId));

export async function saveLocalScene(gameId: string, scene: SceneData): Promise<void> {
  await fs.mkdir(dir(gameId), { recursive: true });
  await fs.writeFile(path.join(dir(gameId), `${safe(scene.id)}.json`), JSON.stringify(scene));
}

export async function listLocalScenes(gameId: string): Promise<SceneData[]> {
  let files: string[] = [];
  try {
    files = (await fs.readdir(dir(gameId))).filter((f) => f.endsWith(".json"));
  } catch {
    return [];
  }
  const out: SceneData[] = [];
  for (const f of files) {
    try {
      out.push(JSON.parse(await fs.readFile(path.join(dir(gameId), f), "utf8")) as SceneData);
    } catch {}
  }
  return out;
}

export async function saveLocalSprite(gameId: string, dataUrl: string): Promise<void> {
  await fs.mkdir(dir(gameId), { recursive: true });
  await fs.writeFile(path.join(dir(gameId), "sprite.txt"), dataUrl);
}

export async function getLocalSprite(gameId: string): Promise<string | null> {
  try {
    return await fs.readFile(path.join(dir(gameId), "sprite.txt"), "utf8");
  } catch {
    return null;
  }
}
