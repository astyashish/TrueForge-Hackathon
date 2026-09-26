/**
 * GET /api/profile
 * Auth-free mode: always returns unlimited generation quota.
 */
import { NextResponse } from "next/server";
import type { ProfileResponse } from "@/lib/types/client";

export const runtime = "nodejs";

export async function GET() {
  const profile: ProfileResponse = {
    generation: {
      used: 0,
      limit: 999,
      unlimited: true,
      canCreate: true,
    },
  };
  return NextResponse.json(profile);
}
