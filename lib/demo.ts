/**
 * The built-in full-feature test: one world prompt + crew + a script that
 * exercises every feature (generation console, three MCP-scoped agents, live
 * ops terminal, approve AND deny at the Threshold, blast radius, memory,
 * System View). Client-safe.
 */

import { DEFAULT_CREW } from "@/lib/crew";

export const DEMO_TITLE = "Threshold HQ — full feature test";

/** World prompt tuned so the three rooms map cleanly onto the default crew. */
export const DEMO_IDEA =
  "Threshold HQ: a late-night software office in Bengaluru the night before a big launch. " +
  "Three rooms joined by glowing neon doorway gates: the Branching Bay, a code-review den of floating diff screens where pull requests wait; " +
  "the Launch Deck, a release control room with a wall of green and red pipeline lights; " +
  "and the Server Vault, a humming cold room of blinking racks where production runs. " +
  "Rain on the windows, cold chai on the desks, and a release that has to ship safely before sunrise.";

export const DEMO_CREW = DEFAULT_CREW;

export type DemoStep = { who: string; say?: string; do: string; feature: string };

/** The test script shown on the landing page. */
export const DEMO_STEPS: DemoStep[] = [
  {
    who: "Start",
    do: "Click “Run the full test”. Watch every model, harness and MCP step stream past, and each frame appear as it is painted.",
    feature: "Generation Console",
  },
  {
    who: "Anywhere",
    do: "Press ` (backtick) at any time to open System View, the raw TrueForge feed for every agent.",
    feature: "System View",
  },
  {
    who: "Git Warden",
    say: "List the open pull requests and run checks on each one.",
    do: "Real git log/diff and test runs stream in the ops terminal on the left. discount-cache fails; health-uptime passes.",
    feature: "MCP tools · Live Ops Terminal",
  },
  {
    who: "Git Warden",
    say: "Merge feature/discount-cache anyway.",
    do: "The Threshold Card fires (cannot be undone). Press DENY: the merge never runs.",
    feature: "Threshold Card · deny",
  },
  {
    who: "Git Warden",
    say: "Merge feature/health-uptime.",
    do: "Open the card's detail first (keeps the blast radius low), then APPROVE. main moves.",
    feature: "Threshold Card · approve · Blast Radius",
  },
  {
    who: "Deploy Runner",
    say: "Run the pipeline on main and deploy it to production if the tests pass.",
    do: "Real pipeline output, then the card at deploy_production. Approve without opening the detail to see the Blast Radius jump. Check http://localhost:4100/health: v1.1.0.",
    feature: "Real deploy · Blast Radius",
  },
  {
    who: "Server Sentinel",
    say: "Is production healthy right now? Check the status and the logs.",
    do: "Live /health probe, log tail and process table from the running server.",
    feature: "Real server",
  },
  {
    who: "Server Sentinel",
    say: "Restart the service.",
    do: "Card fires; deny it and watch the PID stay the same.",
    feature: "Deny on a live system",
  },
  {
    who: "Memory",
    do: "Go back to the landing page and run the test again. When the agents come online the console shows memory notes; ask the Git Warden about discount-cache and it cites the merge you denied.",
    feature: "Agent memory",
  },
];

/** One-click quick replies per agent type — each maps to a step above. */
export const AGENT_QUICK_REPLIES: Record<string, string[]> = {
  "git-warden": [
    "List the open pull requests and run checks on each one.",
    "Merge feature/health-uptime.",
    "Merge feature/discount-cache anyway.",
    "What do you remember from your last shift?",
  ],
  "deploy-runner": [
    "What is live in production right now?",
    "Run the pipeline on main and deploy it to production if the tests pass.",
    "Roll production back to the previous release.",
    "What do you remember from your last shift?",
  ],
  "server-sentinel": [
    "Is production healthy right now? Check the status and the logs.",
    "Show me the process table for the service.",
    "Restart the service.",
    "What do you remember from your last shift?",
  ],
};

export const GENERIC_QUICK_REPLIES = [
  "What have you found so far?",
  "Show me the worst offenders.",
  "Walk me through what you'd do next.",
];
