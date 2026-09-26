# Kahani — Game Design Brief

**One-liner:** A fast, image-first mobile choice-game set in India, where every
scene is AI-generated in real time and every decision is answered by a fresh
cinematic frame.

**Platform:** Web, mobile-first responsive (portrait). Must feel like a premium
mobile game, not a web app or a storybook.

## Design north star

The generated **image is the hero** and fills the screen. UI is bright, crisp,
rounded, tactile, and gets out of the way. Interactions feel **instant and
springy**. Reference feel: Reigns × Monument Valley polish, with a warm Indian
palette.

## Core loop

See a scene → pick 1 of 4 actions → **instantly** see the result (new frame +
stat changes) → repeat → reach your goal or die → get a grade → replay.

- Runs are short: ~7 beats, 60–120 seconds.
- While the player decides, all 4 possible next frames are pre-generated in
  parallel, so tapping feels instant.

## Screens

1. **Home / World select** — logo, tagline, 4 "world" cards (emoji, title,
   tagline, play button). Bright, playful, card-based.
2. **Loading (first frame)** — world emoji, title, a lively generating
   indicator. ~4s.
3. **Play** — the core screen (detailed below).
4. **Ending** — win/lose hero frame, a big letter **grade (S–F)**, final stats,
   and a scrollable run recap (filmstrip of every frame). Replay button.

## Play screen anatomy (most important)

- **Image:** full-bleed, cinematic, subtle slow zoom (Ken Burns).
- **HUD — floating rounded pills, top:**
  - ❤️ **Health** (meter 0–100; 0 = death)
  - ⏳ **Time** (meter, drains; 0 = fail)
  - 🪙 **Rupees** (counter)
  - 🧿 **Karma** (counter)
  - **Journey trail** pill: current location name + % progress + a marker
    gliding along a track toward a goal pin (🛕/🏰/⛩️/🪔).
- **Stat feedback:** floating `+N` / `−N` numbers pop over the relevant pill on
  each action (green up, red down).
- **Bottom sheet — bright, frosted, rounded-top:**
  - **Outcome flash** (chip): ≤8 words, what the last action just did.
  - **Caption:** ≤12 words, bold — the only prose on screen.
  - **Pre-gen meter:** `⚡ N/4 moves ready` — a segmented bar that fills as the
    four branches finish generating. Hero micro-detail.
  - **4 action buttons (2×2):** colored icon tile + short label (2–5 words) + a
    ⚡ "ready/instant" badge. Color-coded by play-style:
    - ⚔️ **Bold** (coral-red) · 🛡️ **Cautious** (sky blue) ·
      🎭 **Cunning** (violet) · 🤝 **Kind** (emerald)

## Game systems that surface in UI

- **Objective + progress:** 0→100 along the journey trail toward a themed goal.
- **4 resources:** Health, Time, Rupees, Karma.
- **Win** = reach the goal. **Lose** = Health 0 or Time 0.
- **End grade** S / A / B / C / D / F from the resources you finish with.
- **Choice archetypes:** the 4 color/icon tags above.

## Content constraints (keep text tiny)

Caption ≤12 words · Outcome flash ≤8 words · Action labels 2–5 words. **No
paragraphs during play.** The image carries the story.

## Visual language

- **Feel:** bright, crisp, tactile, warm. Immersive image; light/frosted chrome.
- **Shape:** big radii — pills, rounded-2xl/3xl cards & buttons; soft elevation
  shadows.
- **Type:** rounded bold display for logo / captions / grades (e.g. Baloo 2);
  clean geometric sans for UI (e.g. Plus Jakarta Sans).
- **Palette:** warm saffron/marigold primary; vivid accents — coral, sky blue,
  violet, emerald (mapped to the 4 tags & stats); near-black navy ink on white
  surfaces; light peach → lavender → sky gradient backgrounds for menu/ending.
- **Motion:** springy taps (scale-down), gentle slide/fade between frames,
  floating stat deltas, pulsing "generating" states, marker gliding on the
  trail, spring-in grade badge.
- **Theme:** authentic India — places, textures, festivals, wardrobe — without
  caricature.

## The hero moment to sell in the design

Real-time generation is **load-bearing**, not decoration: every frame is unique
and made live, and all four next frames pre-generate while you think so tapping
is instant. Design the **pre-gen meter** and the **instant frame swap** to read
as a feature, never as a loader.

## States to design (per component)

- **Action button:** default / hover / pressed / pending (chosen → generating) /
  ready (⚡) / disabled-dimmed.
- **HUD pill:** normal / critical (health or time low → red) / value-changed
  (delta pop).
- **Bottom sheet:** entering / outcome-flash visible / ending variant (win vs
  lose).
- **Loading:** cold first frame vs. mid-run instant swap.

## Deliverables

High-fidelity mockups (mobile portrait first, plus desktop): **Home**, **Play**
(with full HUD + 4 buttons + pre-gen meter + outcome flash), **Ending** (win &
lose), **Loading**. Plus a **component sheet**: HUD pills, journey trail, action
button states, pre-gen meter, grade badge.
