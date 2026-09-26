"use client";

import {
  Heart,
  Hourglass,
  Coins,
  Eye,
  Sword,
  Shield,
  Drama,
  HeartHandshake,
  CloudRain,
  Mountain,
  Landmark,
  Sailboat,
  Flag,
  Zap,
  type LucideIcon,
} from "lucide-react";
import type { ChoiceTag, StatKey } from "@/lib/stats";

/**
 * One consistent icon set for the whole game (Hallmark: a single library, one
 * stroke voice — never OS emoji standing in for iconography).
 */

export const STAT_ICON: Record<StatKey, LucideIcon> = {
  health: Heart,
  karma: Eye, // the nazar / evil-eye motif, as a line icon
  rupees: Coins,
};

export const CLOCK_ICON: LucideIcon = Hourglass;

export const TAG_ICON: Record<ChoiceTag, LucideIcon> = {
  bold: Sword,
  cautious: Shield,
  cunning: Drama, // theatre masks — deception / cunning
  kind: HeartHandshake,
};

export const PREMISE_ICON: Record<string, LucideIcon> = {
  "monsoon-mumbai": CloudRain,
  "himalayan-pilgrimage": Mountain,
  "old-delhi-heist": Landmark,
  "backwaters-myth": Sailboat,
};

export const GoalIcon: LucideIcon = Flag;
export const InstantIcon: LucideIcon = Zap;
