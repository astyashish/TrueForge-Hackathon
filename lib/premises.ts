import type { Premise } from "./types";

/**
 * India-set starting worlds. Each one hands the game master a distinct mood,
 * place, visual language, and a concrete destination to travel toward.
 */
export const PREMISES: Premise[] = [
  {
    id: "monsoon-mumbai",
    title: "Monsoon Over Mumbai",
    tagline: "One rain-soaked night. A city that never sleeps.",
    emoji: "🌧️",
    setup:
      "You are a young dabbawala turned reluctant courier in Mumbai. It is the peak of the monsoon, the streets are flooding, and a stranger has handed you a sealed tiffin box you were never meant to open — with instructions to deliver it before midnight to someone at the Gateway of India.",
    styleBible:
      "Cinematic neon-noir Mumbai at night, torrential monsoon rain, reflections on wet asphalt, warm sodium street lamps against cool blue shadows, steam and puddles, dense atmospheric city, 35mm film still, teal-and-amber color grade.",
    goal: "Deliver the sealed tiffin box to the contact at the Gateway of India before midnight.",
    goalLabel: "Gateway of India",
    goalEmoji: "🛕",
    clockLabel: "Midnight",
  },
  {
    id: "himalayan-pilgrimage",
    title: "The Last Pilgrimage",
    tagline: "The mountains keep their oldest secrets.",
    emoji: "🏔️",
    setup:
      "You are a trekker who joined a small pilgrimage into the high Himalayas near a forgotten monastery. A sudden whiteout has separated you from the group, and an old monk's warning about 'the door that should stay shut' is starting to feel less like folklore.",
    styleBible:
      "Epic Himalayan landscape, snow and prayer flags, ancient Buddhist monastery, thin cold mountain light, vast scale, muted blues and stone greys with saffron accents, misty peaks, cinematic wide compositions, film still.",
    goal: "Find your way through the whiteout to the hidden monastery at the summit before nightfall.",
    goalLabel: "The Summit Monastery",
    goalEmoji: "⛩️",
    clockLabel: "Nightfall",
  },
  {
    id: "old-delhi-heist",
    title: "Secrets of Old Delhi",
    tagline: "Every gali hides a story. This one bites back.",
    emoji: "🏛️",
    setup:
      "You are a street-smart antiques dealer in the winding lanes of Chandni Chowk, Old Delhi. A Mughal-era locket has fallen into your hands, and by dusk three very different people — a collector, a cop, and a ghost from your past — all want it.",
    styleBible:
      "Bustling Old Delhi bazaar, Mughal architecture, hanging electric wires, spice-market colors, golden dusk light through narrow lanes, crowds and rickshaws, rich saturated palette, cinematic street photography, film still.",
    goal: "Escape the lanes and reach the safe house at the Red Fort with the locket intact.",
    goalLabel: "The Red Fort",
    goalEmoji: "🏰",
    clockLabel: "Dusk",
  },
  {
    id: "backwaters-myth",
    title: "The Kerala Backwaters",
    tagline: "Still waters. Older gods.",
    emoji: "🛶",
    setup:
      "You are a houseboat guide drifting through the Kerala backwaters at the start of the Onam season. A village elder asks you to carry an offering to a temple that only appears at low tide — and warns you not to speak to whatever answers.",
    styleBible:
      "Lush Kerala backwaters, palm-lined canals, wooden houseboats, emerald-green water, humid golden light, temple lamps and floral offerings, tropical mist, painterly warm palette, cinematic film still.",
    goal: "Deliver the offering to the tidal temple before the water rises and it vanishes.",
    goalLabel: "The Tidal Temple",
    goalEmoji: "🪔",
    clockLabel: "High tide",
  },
];

export function getPremise(id: string): Premise | undefined {
  return PREMISES.find((p) => p.id === id);
}
