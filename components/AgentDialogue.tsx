"use client";

/**
 * AgentDialogue — TrueForge-wired NPC dialogue for Threshold.
 *
 * Replaces the static DialogueBox with a live TrueForge session:
 * - Each Operator message is sent as a turn to the real TrueForge session.
 * - Each turn streams back as SSE and is rendered in-world:
 *   - tool_call events → status text below NPC speech ("checking idle EC2…")
 *   - sandbox_run events → animated working indicator with real duration
 *   - text events → NPC speech bubble (typewriter, Sarvam TTS)
 *   - approval_required events → fires onApprovalRequired (renders ThresholdCard)
 * - Dispatch to parent via callbacks rather than managing blast radius here.
 */

import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  Database,
  Send,
  Terminal,
  Volume2,
  VolumeX,
  X,
  Zap,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { playSfx } from "@/lib/sfx";
import type { NpcDef } from "@/lib/universe";
import type { ApprovalPayload } from "@/components/ThresholdCard";
import { publishAgent, setAgentActive, useLiveBus, type AgentFeedEvent } from "@/lib/live-bus";
import type { TFEvent } from "@/lib/trueforge";
import { AGENT_QUICK_REPLIES, GENERIC_QUICK_REPLIES } from "@/lib/demo";

export type AgentDialogueProps = {
  npc: NpcDef;
  sessionId: string;
  gameId: string;
  voiceOn: boolean;
  onToggleVoice: () => void;
  onClose: () => void;
  onApprovalRequired: (payload: ApprovalPayload, resolve: ApprovalResolver) => void;
  /** Approval the session was already paused on (e.g. after a page reload). */
  initialPendingApproval?: TFEvent | null;
  /** Agent type id (lib/agent-types) — scopes memory for this character. */
  agentTypeId: string;
  /** Display label for feeds, e.g. "Ira (Git Warden)". */
  agentLabel: string;
  onFindingResolved: () => void;
  speak: (text: string, voice?: string, pace?: number, temperature?: number) => Promise<void>;
  speaking: boolean;
};

export type ApprovalResolver = (
  decision: "approved" | "denied",
  reviewedDetail: boolean
) => Promise<{ blastRadiusDelta: number }>;

type StatusLine = {
  id: string;
  icon: "tool" | "sandbox" | "approval";
  text: string;
  status: "running" | "done" | "error";
};

type DialogueTurnLocal = {
  speaker: "npc" | "operator";
  text: string;
};


export function AgentDialogue({
  npc,
  sessionId,
  gameId,
  voiceOn,
  onToggleVoice,
  onClose,
  onApprovalRequired,
  initialPendingApproval,
  agentTypeId,
  agentLabel,
  onFindingResolved,
  speak,
  speaking,
}: AgentDialogueProps) {
  /** One-click replies for this agent type (each exercises a real tool). */
  const OPENING_OPTIONS = AGENT_QUICK_REPLIES[agentTypeId] ?? GENERIC_QUICK_REPLIES;
  const [history, setHistory] = useState<DialogueTurnLocal[]>([
    { speaker: "npc", text: npc.opening },
  ]);
  const [statusLines, setStatusLines] = useState<StatusLine[]>([]);
  const [thinking, setThinking] = useState(false);
  const [draft, setDraft] = useState("");
  const [hasApprovalPending, setHasApprovalPending] = useState(false);
  /** TrueForge's native ask_user_question waiting for the Operator. */
  const [pendingQuestion, setPendingQuestion] = useState<Extract<TFEvent, { type: "question" }> | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const eventCountRef = useRef(0);

  const lastNpcLine = [...history].reverse().find((t) => t.speaker === "npc");
  const [typed, setTyped] = useState(0);

  // Typewriter effect for last NPC line
  useEffect(() => {
    setTyped(0);
  }, [lastNpcLine?.text]);

  useEffect(() => {
    if (!lastNpcLine || (voiceOn && !speaking)) return;
    const iv = setInterval(() => {
      setTyped((n) => {
        if (n >= lastNpcLine.text.length) { clearInterval(iv); return n; }
        return n + 2;
      });
    }, 18);
    return () => clearInterval(iv);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastNpcLine?.text, voiceOn, speaking]);

  // Speak the NPC opening
  useEffect(() => {
    speak(npc.opening, npc.voice, 0.95, 0.5).catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-scroll
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 99999, behavior: "smooth" });
  }, [history.length, statusLines.length, thinking, typed]);

  // Keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { onClose(); return; }
      if (document.activeElement?.tagName === "INPUT") return;
      const n = Number(e.key);
      if (!thinking && !hasApprovalPending && !pendingQuestion && n >= 1 && n <= OPENING_OPTIONS.length) {
        playSfx("tap");
        sendMessage(OPENING_OPTIONS[n - 1]);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [thinking, hasApprovalPending, pendingQuestion]);

  const abortRef = useRef<AbortController | null>(null);

  /** Publish an event on the live bus (System View + ops terminal) and return it. */
  const emit = useCallback(
    (event: TFEvent) => {
      publishAgent({
        ...event,
        id: `ev-${Date.now()}-${eventCountRef.current++}`,
        timestamp: new Date().toISOString(),
        sessionId,
        agent: agentLabel,
      } as AgentFeedEvent);
      return event;
    },
    [sessionId, agentLabel]
  );

  // The handlers below reference each other; route through a ref so the
  // stream reader always dispatches to the latest handler.
  const handleRef = useRef<(event: TFEvent) => void>(() => {});

  /** Read a Server-Sent Events response from /api/agent/* and render each event. */
  const consume = useCallback(
    async (res: Response) => {
      if (!res.ok || !res.body) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? `Request failed (${res.status})`);
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let sep: number;
        while ((sep = buffer.indexOf("\n\n")) >= 0) {
          const chunk = buffer.slice(0, sep);
          buffer = buffer.slice(sep + 2);
          const data = chunk
            .split("\n")
            .filter((l) => l.startsWith("data:"))
            .map((l) => l.slice(5).trimStart())
            .join("\n");
          if (!data) continue;
          let event: TFEvent;
          try {
            event = JSON.parse(data) as TFEvent;
          } catch {
            continue;
          }
          handleRef.current(emit(event));
        }
      }
    },
    [emit]
  );

  /** Resolve the pending approval: log it, resume the agent, and stream what it does next. */
  const resolveApproval = useCallback(
    async (
      payload: ApprovalPayload,
      decision: "approved" | "denied",
      reviewedDetail: boolean
    ): Promise<{ blastRadiusDelta: number }> => {
      // Approving without opening the card's detail grows the blast radius faster.
      const blastRadiusDelta = decision === "approved" ? (reviewedDetail ? 5 : 15) : 0;
      abortRef.current?.abort();
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      const res = await fetch("/api/agent/approval", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: ctrl.signal,
        body: JSON.stringify({
          sessionId: payload.sessionId,
          approvalId: payload.approvalId,
          threadId: payload.threadId,
          toolCallIds: payload.toolCallIds,
          decision,
          toolName: payload.toolName,
          server: payload.server,
          summary: payload.summary,
          riskLevel: payload.riskLevel,
          reviewedDetail,
          blastRadiusDelta,
          gameId,
          agentTypeId,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? `Approval failed (${res.status})`);
      }
      setHasApprovalPending(false);
      setThinking(true);
      setAgentActive(sessionId, true);
      consume(res)
        .catch((err) => {
          if (ctrl.signal.aborted) return;
          handleRef.current(
            emit({ type: "error", message: err instanceof Error ? err.message : String(err) })
          );
        })
        .finally(() => {
          setThinking(false);
          setAgentActive(sessionId, false);
        });
      return { blastRadiusDelta };
    },
    [consume, emit, gameId, agentTypeId, sessionId]
  );

  const raiseApproval = useCallback(
    (event: Extract<TFEvent, { type: "approval_required" }>) => {
      setThinking(false);
      setHasApprovalPending(true);
      const payload: ApprovalPayload = {
        approvalId: event.approvalId,
        sessionId,
        threadId: event.threadId,
        toolCallIds: event.toolCalls.map((t) => t.id),
        toolName: event.toolName,
        server: event.toolCalls[0]?.server,
        summary: event.summary,
        reasoning: event.reasoning,
        arguments: event.arguments,
        riskLevel: event.riskLevel,
        gameId,
      };
      onApprovalRequired(payload, (decision, reviewed) =>
        resolveApproval(payload, decision, reviewed)
      );
    },
    [gameId, onApprovalRequired, resolveApproval, sessionId]
  );

  /** Handle a single Threshold event from the stream. */
  const handleTFEvent = useCallback(
    (event: TFEvent) => {
      switch (event.type) {
        case "text":
          setStatusLines([]);
          setHistory((h) => [...h, { speaker: "npc", text: event.content }]);
          speak(event.content, npc.voice, 0.95, 0.5).catch(() => {});
          break;

        case "tool_call": {
          const label = `${event.server ? `${event.server}: ` : ""}${event.toolName.replace(/_/g, " ")}`;
          const text = event.status === "running" ? `${label}…` : label;
          setStatusLines((prev) => {
            if (prev.some((s) => s.id === event.toolCallId)) {
              return prev.map((s) =>
                s.id === event.toolCallId ? { ...s, status: event.status, text } : s
              );
            }
            return [
              ...prev.slice(-4),
              { id: event.toolCallId, icon: "tool", text, status: event.status },
            ];
          });
          break;
        }

        case "sandbox_run": {
          const text =
            event.status === "done"
              ? `sandbox run finished${event.durationMs != null ? ` (${(event.durationMs / 1000).toFixed(1)}s)` : ""}`
              : "running in sandbox…";
          setStatusLines((prev) =>
            prev.some((s) => s.id === "sandbox")
              ? prev.map((s) => (s.id === "sandbox" ? { ...s, status: event.status, text } : s))
              : [...prev, { id: "sandbox", icon: "sandbox", text, status: event.status }]
          );
          break;
        }

        case "approval_required":
          raiseApproval(event);
          break;

        case "approval_resolved":
          setHasApprovalPending(false);
          onFindingResolved();
          if (event.via === "trueforge-ui") {
            setHistory((h) => [
              ...h,
              { speaker: "operator", text: `[TrueForge UI] ${event.decision === "approved" ? "Approved" : "Denied"} ${event.toolName ?? "the action"}` },
            ]);
          }
          break;

        case "question":
          setThinking(false);
          setPendingQuestion(event);
          setHistory((h) => [...h, { speaker: "npc", text: `❓ ${event.question}` }]);
          speak(event.question, npc.voice, 0.95, 0.5).catch(() => {});
          break;

        case "question_answered":
          setPendingQuestion(null);
          if (event.via === "trueforge-ui") {
            setHistory((h) => [...h, { speaker: "operator", text: `[TrueForge UI] ${event.answer}` }]);
          }
          break;

        case "external_message":
          setHistory((h) => [...h, { speaker: "operator", text: `[via TrueForge] ${event.content}` }]);
          break;

        case "error":
          setThinking(false);
          setHistory((h) => [...h, { speaker: "npc", text: `⚠ ${event.message}` }]);
          break;

        case "done":
          setThinking(false);
          break;
      }
    },
    [npc.voice, onFindingResolved, raiseApproval, speak]
  );
  handleRef.current = handleTFEvent;

  /** Send a message turn to the TrueForge session and stream the agent's work. */
  const sendMessage = useCallback(
    async (content: string) => {
      if (thinking || hasApprovalPending || !content.trim()) return;
      setThinking(true);
      setHistory((h) => [...h, { speaker: "operator", text: content }]);
      abortRef.current?.abort();
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      setAgentActive(sessionId, true);
      try {
        const res = await fetch("/api/agent/turn", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionId, content, agentTypeId }),
          signal: ctrl.signal,
        });
        await consume(res);
      } catch (err) {
        if (ctrl.signal.aborted) return;
        handleTFEvent(
          emit({
            type: "error",
            message: err instanceof Error ? err.message : "Lost connection to TrueForge. Try again.",
          })
        );
      } finally {
        setThinking(false);
        setAgentActive(sessionId, false);
      }
    },
    [thinking, hasApprovalPending, sessionId, agentTypeId, consume, emit, handleTFEvent]
  );

  /** Answer TrueForge's ask_user_question and stream the resumed turn. */
  const answerQuestion = useCallback(
    async (answer: string) => {
      const q = pendingQuestion;
      if (!q || thinking || !answer.trim()) return;
      setPendingQuestion(null);
      setThinking(true);
      setHistory((h) => [...h, { speaker: "operator", text: answer }]);
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      setAgentActive(sessionId, true);
      try {
        const res = await fetch("/api/agent/answer", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sessionId,
            agentTypeId,
            questionId: q.questionId,
            threadId: q.threadId,
            toolCallId: q.toolCallId,
            question: q.question,
            answer,
          }),
          signal: ctrl.signal,
        });
        await consume(res);
      } catch (err) {
        if (!ctrl.signal.aborted) {
          handleTFEvent(emit({ type: "error", message: err instanceof Error ? err.message : String(err) }));
        }
      } finally {
        setThinking(false);
        setAgentActive(sessionId, false);
      }
    },
    [pendingQuestion, thinking, sessionId, agentTypeId, consume, emit, handleTFEvent]
  );

  // Events from turns started in the embedded TrueForge UI (via the session
  // watcher on the live bus) drive this dialogue too.
  const { agent: busEvents } = useLiveBus();
  const seenExternal = useRef<number | null>(null);
  useEffect(() => {
    if (seenExternal.current === null) {
      seenExternal.current = busEvents.length; // ignore history from before this dialogue opened
      return;
    }
    const fresh = busEvents.slice(seenExternal.current);
    seenExternal.current = busEvents.length;
    for (const e of fresh) {
      if (e.external && e.sessionId === sessionId) handleTFEvent(e);
    }
  }, [busEvents, sessionId, handleTFEvent]);

  // Reloaded mid-approval / mid-question: re-raise what the agent is waiting on.
  useEffect(() => {
    if (initialPendingApproval?.type === "approval_required") {
      raiseApproval(initialPendingApproval);
    } else if (initialPendingApproval?.type === "question") {
      handleTFEvent(initialPendingApproval);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialPendingApproval]);

  // No abort on unmount: walking away lets the agent finish its turn, and the
  // ops terminal keeps streaming it.

  return (
    <motion.div
      initial={{ y: 24, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      exit={{ y: 24, opacity: 0 }}
      transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
      className="pointer-events-auto w-full max-w-2xl"
    >
      <Card className="gap-0 rounded-t-base py-4 sm:rounded-base">
        <CardContent className="px-5">
          {/* NPC header */}
          <div className="mb-2 flex items-center gap-2.5">
            <div>
              <p className="font-display text-lg font-bold leading-none text-foreground">
                {npc.name}
              </p>
              <p className="mt-0.5 text-xs font-medium text-inksoft">
                {npc.role}
              </p>
            </div>
            <Badge variant="neutral" className="uppercase tracking-wide text-[10px] text-main bg-main/10">
              <Zap size={9} className="mr-1" />
              TrueForge agent
            </Badge>
            <Button
              type="button"
              variant={voiceOn ? "noShadow" : "neutral"}
              size="icon"
              className={`ml-auto size-8 ${voiceOn ? "bg-main/10 text-main" : ""}`}
              onClick={onToggleVoice}
              title={voiceOn ? "Voice on" : "Voice off"}
            >
              {voiceOn ? <Volume2 size={15} /> : <VolumeX size={15} />}
            </Button>
            <Button
              type="button"
              variant="neutral"
              size="sm"
              onClick={onClose}
            >
              Esc · leave
            </Button>
          </div>

          {/* Dialogue history */}
          <div
            ref={scrollRef}
            className="no-scrollbar max-h-36 space-y-1.5 overflow-y-auto pb-1"
          >
            {history.slice(-6).map((t, i, arr) => {
              const isLastNpc =
                t.speaker === "npc" &&
                t.text === lastNpcLine?.text &&
                i === arr.length - 1;
              return (
                <p
                  key={`${i}-${t.text.slice(0, 12)}`}
                  className={
                    t.speaker === "npc"
                      ? "text-[15px] font-medium leading-snug text-foreground"
                      : "text-right text-sm font-semibold text-main"
                  }
                >
                  {isLastNpc ? t.text.slice(0, typed) : t.text}
                </p>
              );
            })}

            {/* Live tool/sandbox status lines */}
            {statusLines.map((s) => (
              <div key={s.id} className="flex items-center gap-1.5 text-xs font-medium text-inksoft">
                {s.icon === "tool" ? (
                  <Terminal size={11} className={s.status === "done" ? "text-emerald-400" : "text-amber-400 animate-pulse"} />
                ) : s.icon === "sandbox" ? (
                  <Database size={11} className={s.status === "done" ? "text-purple-400" : "text-purple-400 animate-pulse"} />
                ) : (
                  <Zap size={11} className="text-amber-400 animate-pulse" />
                )}
                <span className={s.status === "done" ? "text-foreground/50" : ""}>{s.text}</span>
              </div>
            ))}

            {thinking && (
              <p className="flex items-center gap-1.5 text-sm font-medium text-inksoft">
                <span className="animate-breathe inline-block size-1.5 rounded-full bg-main" />
                <span className="animate-breathe inline-block size-1.5 rounded-full bg-main" style={{ animationDelay: "0.15s" }} />
                <span className="animate-breathe inline-block size-1.5 rounded-full bg-main" style={{ animationDelay: "0.3s" }} />
              </p>
            )}
            {speaking && !thinking && lastNpcLine && (
              <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-widest text-main/70">
                <Volume2 size={11} /> speaking…
              </p>
            )}
          </div>

          {/* Quick-reply options */}
          <AnimatePresence mode="wait">
            {!thinking && pendingQuestion && (
              <motion.div
                key={`q-${pendingQuestion.questionId}`}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.25 }}
                className="mt-2.5 flex flex-wrap gap-2"
              >
                <p className="w-full text-[11px] font-semibold uppercase tracking-widest text-main">
                  TrueForge · ask_user_question — pick one or type an answer
                </p>
                {pendingQuestion.options.map((opt) => (
                  <Button
                    key={opt}
                    type="button"
                    size="sm"
                    className="h-auto whitespace-normal py-2 text-left"
                    onClick={() => { playSfx("tap"); answerQuestion(opt); }}
                  >
                    {opt}
                  </Button>
                ))}
              </motion.div>
            )}
            {!thinking && !hasApprovalPending && !pendingQuestion && (
              <motion.div
                key={history.length}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.25 }}
                className="mt-2.5 flex flex-wrap gap-2"
              >
                {OPENING_OPTIONS.map((opt, i) => (
                  <Button
                    key={opt}
                    type="button"
                    variant="neutral"
                    size="sm"
                    className="h-auto whitespace-normal py-2 text-left"
                    onClick={() => { playSfx("tap"); sendMessage(opt); }}
                  >
                    <span className="text-[11px] font-bold tabular-nums text-main">{i + 1}.</span>
                    {opt}
                  </Button>
                ))}
              </motion.div>
            )}
            {hasApprovalPending && (
              <motion.p
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="mt-2.5 text-xs font-semibold text-amber-400 flex items-center gap-1.5"
              >
                <Zap size={11} />
                Threshold Gate active — make your decision above to continue.
              </motion.p>
            )}
          </AnimatePresence>

          {/* Free-text input */}
          <form
            className="mt-3 flex items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              const line = draft.trim();
              if (!line || thinking || hasApprovalPending) return;
              setDraft("");
              if (pendingQuestion) answerQuestion(line);
              else sendMessage(line);
            }}
          >
            <Input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder={pendingQuestion ? "Type your answer…" : `Say anything to ${npc.name}…`}
              className="min-w-0 flex-1 rounded-base"
              disabled={hasApprovalPending}
            />
            <Button
              type="submit"
              size="icon"
              disabled={thinking || !draft.trim() || hasApprovalPending}
            >
              <Send size={15} />
            </Button>
          </form>
        </CardContent>
      </Card>
    </motion.div>
  );
}
