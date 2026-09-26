/**
 * `POST /api/sprite` — generate the player character sprite for a world.
 */

import { NextRequest, NextResponse } from "next/server";
import { stagedResponse } from "@/lib/stages";
import { fetchImageAsBase64 } from "@/lib/games";
import { requireUser } from "@/lib/supabase/auth";
import type { SpriteRequest } from "@/lib/types/server";
import { generateSprite } from "@/lib/world-engine";

export const runtime = "nodejs";
export const maxDuration = 60;

/** Forge a walkable sprite matched to the first screen's art style. */
export async function POST(req: NextRequest) {
  if (!(await requireUser())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: SpriteRequest;
  try {
    body = (await req.json()) as SpriteRequest;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  if (!body.premise?.id) {
    return NextResponse.json({ error: "Missing premise." }, { status: 400 });
  }
  const premise = body.premise;
  return stagedResponse(
    req,
    async (report) => {
      let referenceFrame = body.referenceFrame ?? null;
      if (!referenceFrame && body.referenceFrameUrl) {
        referenceFrame = await fetchImageAsBase64(body.referenceFrameUrl);
      }
      return { sprite: await generateSprite(premise, referenceFrame, report) };
    },
    (err) => {
      console.error("[/api/sprite]", err);
      return { message: "Failed to generate the player sprite." };
    }
  );
}
