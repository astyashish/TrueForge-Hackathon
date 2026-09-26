"use client";

import { useCallback, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import type { HistoryEntry, Premise, Scene, TurnResponse } from "@/lib/types";
import { INITIAL_CLOCK } from "@/lib/constants";
import { applyEffects, clampClock, INITIAL_STATS, type Stats } from "@/lib/stats";
import { PREMISES } from "@/lib/premises";
import { Landing } from "./Landing";
import { SceneView } from "./SceneView";
import { Ending } from "./Ending";

type Phase = "landing" | "playing" | "ending";

function stripDataUrl(dataUrl: string): string {
  const comma = dataUrl.indexOf(",");
  return comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
}

function sceneFromTurn(turn: TurnResponse, turnNumber: number): Scene {
  return {
    turn: turnNumber,
    image: turn.image,
    caption: turn.caption,
    outcomeFlash: turn.outcomeFlash ?? "",
    choices: turn.choices,
    effects: turn.effects ?? {},
    timeCost: turn.timeCost ?? 0,
    location: turn.location,
    progress: turn.progress,
    isEnding: turn.isEnding,
    endingKind: turn.endingKind,
    endingTitle: turn.endingTitle,
  };
}

export function Game() {
  const [phase, setPhase] = useState<Phase>("landing");
  const [premise, setPremise] = useState<Premise | null>(null);
  const [scenes, setScenes] = useState<Scene[]>([]);
  const [stats, setStats] = useState<Stats>(INITIAL_STATS);
  const [clock, setClock] = useState(INITIAL_CLOCK);
  const [progress, setProgress] = useState(0);
  const [busy, setBusy] = useState(false);
  const [pendingChoice, setPendingChoice] = useState<string | null>(null);
  const [pendingIndex, setPendingIndex] = useState<number | null>(null);
  const [readyIndices, setReadyIndices] = useState<Set<number>>(new Set());
  const [error, setError] = useState<string | null>(null);

  // Speculative branch cache: choiceIndex → in-flight/resolved next scene.
  const cacheRef = useRef<Map<number, Promise<TurnResponse>>>(new Map());
  // Cancels the previous batch of prefetches when a new scene supersedes it.
  const prefetchAbortRef = useRef<AbortController | null>(null);

  const current = scenes[scenes.length - 1] ?? null;

  const requestTurn = useCallback(
    async (
      thePremise: Premise,
      history: HistoryEntry[],
      choice: string | null,
      prevImage: string | null,
      curStats: Stats,
      curClock: number,
      curProgress: number,
      signal?: AbortSignal
    ): Promise<TurnResponse> => {
      const res = await fetch("/api/turn", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal,
        body: JSON.stringify({
          premise: thePremise,
          history,
          choice,
          prevImage,
          stats: curStats,
          clock: curClock,
          progress: curProgress,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `Request failed (${res.status}).`);
      }
      return (await res.json()) as TurnResponse;
    },
    []
  );

  /**
   * The moment a scene is shown, generate the entire next state for all four
   * choices in parallel. Whichever the player taps is then instant.
   */
  const prefetchBranches = useCallback(
    (
      thePremise: Premise,
      node: Scene,
      scenesAfter: Scene[],
      curStats: Stats,
      curClock: number,
      curProgress: number
    ) => {
      // Supersede any still-running prefetch from the previous scene.
      prefetchAbortRef.current?.abort();
      const controller = new AbortController();
      prefetchAbortRef.current = controller;

      cacheRef.current = new Map();
      setReadyIndices(new Set());
      if (node.isEnding) return;

      const prevImage = node.image ? stripDataUrl(node.image) : null;
      node.choices.forEach((choice, i) => {
        const history: HistoryEntry[] = scenesAfter.map((s, idx) => ({
          caption: s.caption,
          choice:
            idx === scenesAfter.length - 1 ? choice.text : s.chosen ?? "",
        }));
        const p = requestTurn(
          thePremise,
          history,
          choice.text,
          prevImage,
          curStats,
          curClock,
          curProgress,
          controller.signal
        ).then((res) => {
          setReadyIndices((prev) => new Set(prev).add(i));
          return res;
        });
        p.catch(() => {}); // avoid unhandled rejection; tap handler surfaces it
        cacheRef.current.set(i, p);
      });
    },
    [requestTurn]
  );

  const begin = useCallback(
    async (chosenPremise: Premise) => {
      setPremise(chosenPremise);
      setPhase("playing");
      setScenes([]);
      setStats(INITIAL_STATS);
      setClock(INITIAL_CLOCK);
      setProgress(0);
      setError(null);
      setBusy(true);
      setPendingChoice(null);
      setPendingIndex(null);
      cacheRef.current = new Map();
      setReadyIndices(new Set());
      try {
        const turn = await requestTurn(
          chosenPremise,
          [],
          null,
          null,
          INITIAL_STATS,
          INITIAL_CLOCK,
          0
        );
        const node = sceneFromTurn(turn, 1);
        const nextStats = applyEffects(INITIAL_STATS, turn.effects ?? {});
        const nextClock = clampClock(INITIAL_CLOCK - (turn.timeCost ?? 0));
        setScenes([node]);
        setStats(nextStats);
        setClock(nextClock);
        setProgress(turn.progress ?? 0);
        prefetchBranches(
          chosenPremise,
          node,
          [node],
          nextStats,
          nextClock,
          turn.progress ?? 0
        );
      } catch (e) {
        setError(e instanceof Error ? e.message : "Something went wrong.");
      } finally {
        setBusy(false);
      }
    },
    [requestTurn, prefetchBranches]
  );

  const choose = useCallback(
    async (option: string, index: number) => {
      if (!premise || !current || busy) return;
      setError(null);
      setBusy(true);
      setPendingChoice(option);
      setPendingIndex(index);

      const resolved = scenes.map((s, i) =>
        i === scenes.length - 1 ? { ...s, chosen: option } : s
      );

      try {
        // Prefer the speculatively-generated branch; fall back to a live call.
        let promise = cacheRef.current.get(index);
        if (!promise) {
          const history: HistoryEntry[] = resolved.map((s) => ({
            caption: s.caption,
            choice: s.chosen ?? option,
          }));
          const prevImage = current.image
            ? stripDataUrl(current.image)
            : null;
          promise = requestTurn(
            premise,
            history,
            option,
            prevImage,
            stats,
            clock,
            progress
          );
        }
        const turn = await promise;

        const nextStats = applyEffects(stats, turn.effects ?? {});
        const nextClock = clampClock(clock - (turn.timeCost ?? 0));
        const nextProgress = turn.progress ?? progress;
        const node = sceneFromTurn(turn, current.turn + 1);
        const scenesAfter = [...resolved, node];

        setScenes(scenesAfter);
        setStats(nextStats);
        setClock(nextClock);
        setProgress(nextProgress);
        prefetchBranches(
          premise,
          node,
          scenesAfter,
          nextStats,
          nextClock,
          nextProgress
        );
      } catch (e) {
        setError(e instanceof Error ? e.message : "Something went wrong.");
      } finally {
        setBusy(false);
        setPendingChoice(null);
        setPendingIndex(null);
      }
    },
    [premise, current, scenes, busy, stats, clock, progress, requestTurn, prefetchBranches]
  );

  const retry = useCallback(() => {
    if (!premise) return;
    if (scenes.length === 0) {
      begin(premise);
    } else if (pendingChoice != null && pendingIndex != null) {
      choose(pendingChoice, pendingIndex);
    }
  }, [premise, scenes.length, pendingChoice, pendingIndex, begin, choose]);

  const reset = useCallback(() => {
    prefetchAbortRef.current?.abort();
    setPhase("landing");
    setPremise(null);
    setScenes([]);
    setStats(INITIAL_STATS);
    setClock(INITIAL_CLOCK);
    setProgress(0);
    setError(null);
    setBusy(false);
    setPendingChoice(null);
    setPendingIndex(null);
    cacheRef.current = new Map();
    setReadyIndices(new Set());
  }, []);

  return (
    <main className="relative min-h-dvh w-full overflow-hidden">
      <AnimatePresence mode="wait">
        {phase === "landing" && (
          <motion.div
            key="landing"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.5 }}
          >
            <Landing
              onStart={(idea) =>
                begin(PREMISES.find((p) => p.setup === idea) ?? PREMISES[0])
              }
            />
          </motion.div>
        )}

        {phase === "playing" && premise && (
          <motion.div
            key="playing"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.5 }}
          >
            <SceneView
              premise={premise}
              scene={current}
              stats={stats}
              clock={clock}
              progress={progress}
              scenes={scenes}
              busy={busy}
              pendingChoice={pendingChoice}
              readyIndices={readyIndices}
              error={error}
              onChoose={choose}
              onRetry={retry}
              onFinish={() => setPhase("ending")}
              onQuit={reset}
            />
          </motion.div>
        )}

        {phase === "ending" && premise && (
          <motion.div
            key="ending"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.6 }}
          >
            <Ending
              premise={premise}
              scenes={scenes}
              stats={stats}
              clock={clock}
              onReplay={reset}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </main>
  );
}
