/**
 * GET /api/share/status — the public URL shared links should use (host only;
 * the proxy blocks viewers). Read from THRESHOLD_PUBLIC_URL, or from
 * .threshold/public-url, which scripts/tunnel.mjs writes when a tunnel is up.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  let publicUrl = process.env.THRESHOLD_PUBLIC_URL?.trim() || null;
  let source: "env" | "tunnel" | null = publicUrl ? "env" : null;
  if (!publicUrl) {
    try {
      publicUrl = (await fs.readFile(path.join(process.cwd(), ".threshold", "public-url"), "utf8")).trim() || null;
      source = publicUrl ? "tunnel" : null;
    } catch {}
  }
  return NextResponse.json({ publicUrl: publicUrl?.replace(/\/$/, "") ?? null, source });
}
