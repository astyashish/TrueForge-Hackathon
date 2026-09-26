import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/supabase/auth";
import { generateBible } from "@/lib/world-engine";
import { DEFAULT_CREW, getAgentType } from "@/lib/agent-types";
import { stagedResponse } from "@/lib/stages";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  if (!(await requireUser())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { idea: string; crew?: string[] };
  try {
    body = (await req.json()) as { idea: string; crew?: string[] };
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const idea = body.idea?.trim();
  if (!idea) {
    return NextResponse.json({ error: "Describe your scene first." }, { status: 400 });
  }
  const crewIds = (body.crew?.length ? body.crew : DEFAULT_CREW).slice(0, 3);
  while (crewIds.length < 3) crewIds.push(DEFAULT_CREW[crewIds.length]);
  return stagedResponse(
    req,
    async (report) => {
      const crew = await Promise.all(crewIds.map((id) => getAgentType(id)));
      const bible = await generateBible(
        idea.slice(0, 1200),
        crew.map((t) => ({ id: t.id, name: t.name, role: t.role, look: t.look })),
        report
      );
      return { bible };
    },
    (err) => {
      console.error("[/api/universe]", err);
      return { message: "Couldn't shape that idea into a world. Try rephrasing." };
    }
  );
}
