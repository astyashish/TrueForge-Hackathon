/**
 * `GET /api/games` — list saved worlds.
 * `POST /api/games` — create a new world row.
 * Auth-free: uses guest user, no quota enforcement.
 */

import { NextRequest, NextResponse } from "next/server";
import { toGameListItem } from "@/lib/games";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/supabase/auth";
import { getPostHogClient } from "@/lib/posthog-server";
import type { CreateGameBody, GameRecord } from "@/lib/types/server";

export const runtime = "nodejs";

/** List all saved games. */
export async function GET() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("games")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) {
    console.error("[GET /api/games]", error);
    return NextResponse.json({ error: "Failed to list games." }, { status: 500 });
  }

  return NextResponse.json((data as GameRecord[]).map(toGameListItem));
}

/** Create a game row after the bible is generated. */
export async function POST(req: NextRequest) {
  const user = await requireUser();

  let body: CreateGameBody;
  try {
    body = (await req.json()) as CreateGameBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const idea = body.idea?.trim();
  if (!idea || !body.bible?.title || !body.premise?.title) {
    return NextResponse.json({ error: "Missing idea, bible, or premise." }, { status: 422 });
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("games")
    .insert({
      owner: null as unknown as string,
      title: body.bible.title,
      idea: idea.slice(0, 1200),
      bible: body.bible,
      premise: body.premise,
    })
    .select("*")
    .single();

  if (error || !data) {
    console.error("[POST /api/games]", error);
    return NextResponse.json({ error: "Failed to create game." }, { status: 500 });
  }

  const item = toGameListItem(data as GameRecord);

  const posthog = getPostHogClient();
  posthog.capture({
    distinctId: user.id,
    event: "world_created",
    properties: { game_id: item.id, title: item.title },
  });
  await posthog.flush();

  return NextResponse.json(item, {
    status: 201,
    headers: { Location: `/api/games/${item.id}` },
  });
}
