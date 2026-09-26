/** Shared game-mechanics definitions. Safe to import from client and server. */

export type StatKey = "health" | "karma" | "rupees";

export type Stats = Record<StatKey, number>;

/** Deltas the game master applies as a consequence of an action. */
export type Effects = Partial<Record<StatKey, number>>;

export const STAT_META: Record<
  StatKey,
  {
    label: string;
    emoji: string;
    /** CSS color for the meter fill / accents. */
    color: string;
    /** Bar-style meters clamp 0..100; counters just clamp at 0. */
    kind: "meter" | "counter";
    min: number;
    max: number;
  }
> = {
  health: {
    label: "Health",
    emoji: "❤️",
    color: "#b34a44",
    kind: "meter",
    min: 0,
    max: 100,
  },
  karma: {
    label: "Karma",
    emoji: "🧿",
    color: "#4a7c88",
    kind: "meter",
    min: 0,
    max: 100,
  },
  rupees: {
    label: "Rupees",
    emoji: "🪙",
    color: "#b3862f",
    kind: "counter",
    min: 0,
    max: Number.MAX_SAFE_INTEGER,
  },
};

export const STAT_ORDER: StatKey[] = ["health", "karma", "rupees"];

export const INITIAL_STATS: Stats = {
  health: 100,
  karma: 50,
  rupees: 200,
};

export function clampStat(key: StatKey, value: number): number {
  const { min, max } = STAT_META[key];
  return Math.max(min, Math.min(max, Math.round(value)));
}

export function applyEffects(stats: Stats, effects: Effects): Stats {
  const next: Stats = { ...stats };
  for (const key of STAT_ORDER) {
    const delta = effects[key];
    if (typeof delta === "number" && delta !== 0) {
      next[key] = clampStat(key, stats[key] + delta);
    }
  }
  return next;
}

/** True when the run is lost — currently only death by zero Health. */
export function isDead(stats: Stats): boolean {
  return stats.health <= 0;
}

/** ---- Choice archetypes: give each option a readable "play style" tag ---- */

export type ChoiceTag = "bold" | "cautious" | "cunning" | "kind";

export type Choice = {
  text: string;
  tag: ChoiceTag;
};

export const TAG_META: Record<
  ChoiceTag,
  { label: string; emoji: string; color: string }
> = {
  bold: { label: "Bold", emoji: "⚔️", color: "#c04a2f" },
  cautious: { label: "Cautious", emoji: "🛡️", color: "#4a7c88" },
  cunning: { label: "Cunning", emoji: "🎭", color: "#6d5f97" },
  kind: { label: "Kind", emoji: "🤝", color: "#6b8e5a" },
};

export const CHOICE_TAGS: ChoiceTag[] = [
  "bold",
  "cautious",
  "cunning",
  "kind",
];

export type EndingKind = "victory" | "defeat" | "neutral";

/** ---- Clock: a draining time budget, a second fail state beside Health ---- */

export const CLOCK_META = {
  emoji: "⏳",
  color: "#6d5f97",
  min: 0,
  max: 100,
};

export function clampClock(value: number): number {
  return Math.max(CLOCK_META.min, Math.min(CLOCK_META.max, Math.round(value)));
}

/** ---- End-of-run grade: the replay hook ---- */

export type GradeResult = {
  grade: string;
  label: string;
  color: string;
};

export function computeGrade(
  stats: Stats,
  clock: number,
  endingKind: EndingKind
): GradeResult {
  // Weighted 0..100 score from what the player has left at the end.
  const rupeeScore = Math.min(stats.rupees, 500) / 5; // 0..100
  const raw =
    stats.health * 0.4 + clock * 0.3 + stats.karma * 0.2 + rupeeScore * 0.1;

  if (endingKind === "defeat") {
    // A run that ended in death or ran out of time can't rank above C.
    if (raw >= 45) return { grade: "C", label: "Fell short", color: "#c8552e" };
    if (raw >= 25) return { grade: "D", label: "A hard road", color: "#b06a34" };
    return { grade: "F", label: "Lost to the night", color: "#b34a44" };
  }

  if (raw >= 85) return { grade: "S", label: "Legendary run", color: "#b3862f" };
  if (raw >= 70) return { grade: "A", label: "Masterful", color: "#6b8e5a" };
  if (raw >= 55) return { grade: "B", label: "Well played", color: "#4a7c88" };
  if (raw >= 40) return { grade: "C", label: "You made it", color: "#c8552e" };
  return { grade: "D", label: "Barely through", color: "#b06a34" };
}
