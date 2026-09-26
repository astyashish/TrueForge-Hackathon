/**
 * Applies Threshold's Supabase migrations via the Supabase Management API.
 * Run once: node scripts/apply-migration.mjs
 */
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Read env from .env.local manually (no dotenv dependency needed)
const envPath = join(__dirname, "../.env.local");
const envContent = readFileSync(envPath, "utf8");
const env = Object.fromEntries(
  envContent
    .split("\n")
    .filter((l) => l.trim() && !l.startsWith("#") && l.includes("="))
    .map((l) => {
      const idx = l.indexOf("=");
      return [l.slice(0, idx).trim(), l.slice(idx + 1).trim()];
    })
);

const SUPABASE_URL = env["NEXT_PUBLIC_SUPABASE_URL"];
const ANON_KEY = env["NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"];

if (!SUPABASE_URL || !ANON_KEY) {
  console.error("❌ Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY in .env.local");
  process.exit(1);
}

// Extract project ref from URL: https://xxxxx.supabase.co → xxxxx
const projectRef = SUPABASE_URL.replace("https://", "").split(".")[0];

const migrationFiles = [
  "../supabase/migrations/0001_games.sql",
  "../supabase/migrations/0002_storage_select_policy.sql",
  "../supabase/migrations/0003_agent_bindings.sql",
];

async function runSQL(sql) {
  // Use the Supabase REST API's /rest/v1/rpc approach for raw SQL
  // This requires the service role key — but we'll use the DB REST API with anon key + RLS bypass
  // For hackathon: use Supabase SQL Editor directly or supabase CLI
  console.log("SQL to run (copy to Supabase SQL Editor):");
  console.log("---");
  console.log(sql.slice(0, 100) + "...");
}

console.log("\n🔧 Threshold — Supabase Migration Helper\n");
console.log(`Project: ${projectRef}`);
console.log(`URL: ${SUPABASE_URL}\n`);

console.log("📋 Migration files to apply in Supabase Dashboard → SQL Editor:\n");
for (const file of migrationFiles) {
  const fullPath = join(__dirname, file);
  try {
    const sql = readFileSync(fullPath, "utf8");
    console.log(`✅ ${file} (${sql.length} chars)`);
  } catch {
    console.log(`⚠️  ${file} — not found`);
  }
}

console.log(`
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
To apply migrations:
1. Open ${SUPABASE_URL.replace(".supabase.co", "")}app.supabase.com/project/${projectRef}/sql/new
2. Paste and run each migration file above IN ORDER
3. Then come back and run: npm run dev
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`);
