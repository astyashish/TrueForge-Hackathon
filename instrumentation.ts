/**
 * Server start hook (Next.js). Syncs Threshold's agent types to saved
 * TrueForge Agents so the crew appears on TrueForge's own Agents page —
 * idempotent, so every cold start is safe.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { syncAllAgents } = await import("./lib/trueforge");
  syncAllAgents({ retryForMs: 180_000 })
    .then((results) => {
      for (const r of results) {
        console.log(
          r.error
            ? `[trueforge] agent ${r.type}: ${r.error}`
            : `[trueforge] agent ${r.agent} ${r.action} (visible on TrueForge's Agents page)`
        );
      }
    })
    .catch((err) => console.warn("[trueforge] agent sync failed:", err));
}
