# Kahani — Product Requirements Document (v1)

**A fast, image-first choice game where you _see_ every decision.**

---

## 1. Why this rewrite

The current MVP works, but it reads like an _illustrated story_: a paragraph of
narration per beat, one image generated on demand, and a ~5–7s wait after every
choice. That is exactly the "prompt-box-to-image" pattern the hackathon warns
against.

We want the inverse: **the image is the interface**, decisions resolve
**instantly**, and it's the _volume and speed_ of generation — not the text —
that carries the experience. Generation is load-bearing.

## 2. Vision

A tap-to-play visual adventure. You look at a scene, pick one of four actions,
and **immediately see it happen**. Stakes are real — you can die, and you're
racing to a goal. Every run is different; every frame is freshly generated. It
should feel like flipping through a living graphic novel at the speed of thought.

## 3. Design pillars

1. **Image-first** — the generated frame fills the screen and tells the story.
   Text is a whisper (a caption), never a paragraph.
2. **Instant** — the next frame is already generated _before_ you tap. Target
   perceived response **< 300 ms** from turn 2 onward.
3. **Consequential** — every choice visibly changes your state (a hit of damage,
   a step closer, a shift in fortune) and the world reacts on screen.
4. **Replayable** — short runs (60–120s), branching outcomes, and an end-of-run
   grade that makes you want to go again.

## 4. Core loop (redesigned)

```
[situation frame] → tap 1 of 4 actions → [instant result frame + stat change] → repeat → [win / lose] → grade + recap
```

**Turn anatomy**

- **Situation frame:** full-bleed image · ≤12-word caption · 4 action chips
  (tag-colored) · compact HUD (progress, health, clock).
- **On tap:** cut _immediately_ to the pre-generated result frame for that
  action; animate the stat deltas; flash a ≤8-word outcome line.
- **In background:** the moment any frame appears, prefetch all 4 of its
  branches in parallel.

## 5. Prefetch architecture — the core innovation

While the player is reading/deciding, we generate the **entire next state for all
four choices**:

- For scene _N_, fire **4 parallel pipelines** (choices A–D). Each returns:
  result **image**, short caption, **stat effects**, new location/progress, and
  the **next 4 choices**.
- Player taps → we already hold that branch → **instant** transition, no spinner.
- The chosen branch's own 4 sub-branches begin prefetching instantly. The 3
  unused branches are discarded.
- **Depth = 1** (immediate branches only), so fan-out is bounded to 4 per turn,
  not 4ⁿ.
- Fallback: if the player taps before a branch is ready, _only that one branch_
  shows a brief loader.

**Why this is the thesis, not a gimmick**

- We generate ~**4× the images we show**. At **$0.034 / 1,000 images**, a 7-turn
  run ≈ **28 images ≈ $0.001**. Speed + cost make the waste free.
- Perceived latency collapses from ~6s/turn to ~instant.
- It only works _because_ NB2 Lite is fast and cheap — the demo literally can't
  exist on slow/expensive generation. That's the point of the challenge.

## 6. Text budget (less text)

| Element        | Limit             | Example                         |
| -------------- | ----------------- | ------------------------------- |
| Scene caption  | 1 line, ≤12 words | "The flood swallows the road."  |
| Action label   | 2–5 words         | "Wade across", "Bribe the cop"  |
| Outcome flash  | ≤8 words          | "Bribe paid. The gate opens."   |

No paragraphs during play. The **recap** screen can show the longer arc for
players who want it.

## 7. Game mechanics (what makes it a game, not a story)

- **Objective:** reach the destination — progress `0 → 100`, shown as a journey
  trail. **Win** at 100.
- **Health (0–100):** hits 0 → **death**, run over.
- **Clock (proposed, NEW):** every action costs time; reach the goal before it
  runs out. A second fail state that creates urgency and rewards decisiveness.
  (Fits premises like "before midnight".)
- **Karma & Rupees:** modifiers that _gate_ actions (can't bribe at ₹0) and feed
  the final grade.
- **Fail:** Health 0 **or** Clock 0. **Win:** progress 100.
- **End grade:** S / A / B / C computed from health, time, karma, and rupees
  remaining — the replay hook.

## 8. Screens

- **Home:** title + 4 world cards (as today, tightened).
- **Play:** full-bleed frame · top HUD (progress trail + health + clock as
  compact icons) · bottom row of 4 action chips · transient outcome flash + stat
  deltas.
- **End:** win/lose hero frame · grade + stat sheet · filmstrip recap · replay.

## 9. Performance targets

- **Turn 1 (cold):** first frame ≤ 5 s.
- **Turns 2+:** perceived response ≤ 300 ms (served from prefetch cache).
- Prefetch 4 branches concurrently; degrade gracefully to a per-branch loader.

## 10. Technical changes from the current build

- **Speculative resolution:** generating a scene also enumerates its 4 choices
  _and_ kicks off 4 `resolveBranch` generations (text + image) in parallel.
- **Client branch cache:** keyed by `(sceneId, choiceIndex)`; a tap reads cache
  and, on miss, awaits that single branch.
- **Prompt changes:** replace the long `narrative` with `caption`
  (≤12 words) + `outcomeFlash` (≤8 words); add a `timeCost` per action.
- **State:** add `clock` to the run and to the model context.

## 11. Cost model (NB2 Lite)

- **$0.034 / 1,000 images.** ~28 images/run → **~$0.00095 per playthrough**.
- 1,000 full playthroughs ≈ **$0.95**. Prefetch waste is a rounding error.

## 12. Scope

**This iteration (MVP of the redesign):** image-first UI · ≤12-word captions +
outcome flash · full-branch prefetch (depth 1) · instant transitions · health +
clock + objective · win/lose · end grade.

**Later:** per-choice cost previews · shareable run card · more worlds ·
reference-image character lock · prefetch depth 2.

## 13. Locked decisions

- **A. Prefetch strategy → Full-branch.** While the player deliberates, generate
  the entire next state (image + caption + stats + next choices) for all 4
  choices. Tapping is truly instant.
- **B. Clock/time pressure → In for MVP.** A time budget that every action spends;
  running out is a fail state alongside death.
- **C. Text level → Caption + outcome flash.** ≤12-word caption per frame, ≤8-word
  flash on resolve. No paragraphs during play.
